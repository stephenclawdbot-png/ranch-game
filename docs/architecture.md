# PROJECT THOROUGHBRED — Architecture (MVP)

Target: Vercel (Next.js App Router + API routes / Route Handlers), external Postgres (Neon/Supabase), background workers via Vercel Cron + a queue, Solana behind an adapter interface (mock first, devnet later).

## 1. System architecture & service boundaries

```mermaid
flowchart LR
  subgraph Client["Browser client"]
    UI["Next.js React UI<br/>stable, market, races"]
    PIXI["PixiJS race renderer<br/>replays deterministic frames"]
    WAL["Wallet adapter<br/>Phantom / mock wallet"]
  end

  subgraph Vercel["Vercel deployment"]
    API["API routes<br/>/api/horses /api/races /api/market /api/auth"]
    AUTH["Auth<br/>wallet signature (SIWS) + session"]
    CRON["Vercel Cron<br/>race scheduler, training ticks"]
  end

  subgraph Workers["Workers (queue consumers)"]
    RACE["Race engine worker<br/>seeded deterministic sim"]
    ECON["Economy worker<br/>payouts, fees, emissions"]
    BREED["Breeding worker<br/>genetics roll"]
  end

  subgraph Data["Data"]
    PG[("PostgreSQL<br/>users, horses, races, results, ledger")]
    Q[["Queue<br/>Vercel Queues / Upstash"]]
  end

  subgraph Chain["Solana adapter boundary"]
    SA["SolanaAdapter interface"]
    MOCK["MockAdapter<br/>Postgres-backed fake chain"]
    DEV["DevnetAdapter (later)<br/>Metaplex NFTs, SPL token, VRF"]
  end

  UI --> API
  PIXI --> API
  WAL --> AUTH
  AUTH --> API
  API --> PG
  API --> Q
  CRON --> Q
  Q --> RACE & ECON & BREED
  RACE --> PG
  ECON --> PG
  BREED --> PG
  RACE --> SA
  ECON --> SA
  BREED --> SA
  API --> SA
  SA --> MOCK
  SA -.-> DEV
```

Boundaries: the client never computes outcomes, only replays them. API routes are thin (validate, write intent, enqueue). Workers own all state transitions. Everything chain-related goes through `SolanaAdapter`, so swapping mock for devnet changes no game code.

## 2. Product loops

```mermaid
flowchart TD
  subgraph Core["Core loop (minutes)"]
    A[Pick horse from stable] --> B[Enter race / pay entry fee]
    B --> C[Watch race replay]
    C --> D[Receive prize + XP]
    D --> E[Train / rest horse]
    E --> A
  end

  subgraph Meta["Meta loop (days)"]
    F[Earn currency] --> G[Buy / breed horses]
    G --> H[Improve stable quality]
    H --> I[Enter higher race classes]
    I --> F
  end

  subgraph Social["Social / market loop"]
    J[List horse on market] --> K[Other player buys]
    K --> L[Seller earns, protocol fee]
    L --> M[Leaderboards & seasons]
    M --> J
  end

  D --> F
  H --> J
```

## 3. Horse lifecycle

```mermaid
stateDiagram-v2
  [*] --> Minted: genesis mint / foaled
  Minted --> Foal
  Foal --> Training: matures (N days)
  Training --> Racing: passes class qualifier
  Racing --> Training: post-race recovery
  Racing --> Resting: fatigue threshold
  Resting --> Racing
  Racing --> Listed: owner lists
  Training --> Listed
  Listed --> Racing: sold or delisted
  Racing --> Stud: retires (age / owner choice)
  Stud --> Breeding: breed request
  Breeding --> Stud: cooldown
  Stud --> Retired: max breeds / age cap
  Retired --> [*]
```

## 4. Race engine fairness sequence

Commit-reveal so neither the server nor players can steer results after entries close.

```mermaid
sequenceDiagram
  autonumber
  participant P as Player
  participant API as API route
  participant DB as Postgres
  participant S as Scheduler (Cron)
  participant W as Race worker
  participant SA as SolanaAdapter
  participant C as Client (PixiJS)

  S->>DB: create race (open)
  S->>DB: store commit = hash(serverSeed)
  Note over DB: commit hash is public before entries
  P->>API: enter race (horseId, signed)
  API->>DB: validate eligibility, lock horse, debit fee
  S->>DB: close entries at T, freeze field
  S->>W: enqueue run(raceId)
  W->>SA: fetch entropy (mock: slot hash stub / later: VRF or slot hash)
  W->>W: seed = hash(serverSeed ‖ chainEntropy ‖ raceId ‖ sorted entries)
  W->>W: deterministic sim (fixed timestep, seeded PRNG)
  W->>DB: write results + frame log + reveal serverSeed
  W->>SA: settle (mock ledger / later on-chain record)
  C->>API: GET race replay
  API-->>C: frames + seed + commit
  C->>C: render; optional local re-sim to verify
```

## 5. Economy flows

```mermaid
flowchart LR
  P((Player wallet))
  TR[(Treasury)]
  PP[(Race prize pool)]
  BURN{{Burn / sink}}
  EM[Season emissions]

  P -- entry fee --> PP
  PP -- 85% prizes --> P
  PP -- 10% protocol fee --> TR
  PP -- 5% --> BURN
  P -- training / feed cost --> BURN
  P -- breeding fee --> TR
  P -- market purchase --> P
  P -. 3-5% royalty .-> TR
  TR -- season rewards --> EM
  EM -- leaderboard payouts --> P
```

Splits are placeholders to tune. In the MVP every arrow is a row in a double-entry `ledger` table via `MockAdapter`; nothing touches real funds.

## Quick demo branch, horizontal integration

```mermaid
flowchart LR
  subgraph Shared["Shared contracts (main)"]
    T["packages/types<br/>Horse, Race, Result, Frame"]
    ENG["packages/race-engine<br/>pure deterministic sim"]
    ADP["SolanaAdapter interface"]
  end
  DEMO["demo branch<br/>seeded race + PixiJS replay, fixtures, no DB"]
  MAIN["main prototype<br/>API, Postgres, workers, auth"]
  DEMO -- imports --> T & ENG
  MAIN -- imports --> T & ENG & ADP
  DEMO -- "PRs: renderer, engine fixes" --> MAIN
  MAIN -- "rebase weekly" --> DEMO
```

1. Main owns the shared contracts: types, the pure race engine, and the adapter interface. These change only by PR to main.
2. The demo branch builds the visible slice (deterministic race + PixiJS replay) against fixtures, with no database or wallet.
3. Engine and renderer improvements from the demo merge back to main as small PRs; main gets rebased into demo regularly.
4. Integration point: once main's `/api/races/:id/replay` returns the same `Frame[]` shape, the demo renderer is dropped into the real app unchanged.
5. CI on both runs the same golden-seed test (same seed and entries produce identical results) so they can't drift.
