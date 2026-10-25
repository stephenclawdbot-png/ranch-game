# Project Thoroughbred: System Architecture

This is the map for the whole project. Every module, agent workstream and milestone
refers back to these graphs. Diagrams are Mermaid source.

## 1. Whole system

```mermaid
flowchart TB
  subgraph Client["Browser (Next.js + React)"]
    UI[Stable / Horse / Races / Market / Season UI]
    RV["Race Viewer<br/>PixiJS HD 2.5D renderer"]
    ART["Art manifest loader<br/>sprite atlas or procedural placeholder"]
    WAL[Optional wallet link]
    RV --> ART
  end

  subgraph Vercel["Vercel (single Next.js deployment)"]
    API["Route handlers /api/*<br/>typed with Zod"]
    CRON["Vercel Cron<br/>backstop settlement"]
    subgraph Domain["Domain services (pure TS packages)"]
      ENG["racing-engine<br/>deterministic sim, fixed-point"]
      GEN[genetics + breeding]
      TRN[training + aging + lifecycle]
      ECO["economy<br/>double-entry ledger"]
      MKT[marketplace + escrow]
    end
    REPO["Repository interfaces<br/>Demo (stateless) or Postgres"]
  end

  DB[("Neon Postgres<br/>source of truth")]
  BLOB[("Vercel Blob / static<br/>approved sprite atlases")]
  SOL["Solana adapter<br/>mock, then devnet"]
  PXL["PixelLab adapter<br/>offline build-time only"]

  UI -->|HTTPS| API
  RV -->|GET replay checkpoints| API
  ART --> BLOB
  WAL --> API
  API --> ENG & GEN & TRN & ECO & MKT
  CRON --> API
  ENG & GEN & TRN & ECO & MKT --> REPO
  REPO --> DB
  ECO --> SOL
  PXL -.->|approved assets + manifest| BLOB
```

## 2. Race fairness pipeline

The server runs a race once, at post time. Everyone then plays the same stored
checkpoints, in sync with the post-time clock. Live races need no WebSockets.

```mermaid
flowchart LR
  A[Entries open] --> B["Seed commitment published<br/>sha256(seed)"]
  B --> C[Entry lock]
  C --> D["Immutable snapshot<br/>horses + track + weather"]
  D --> E["Final seed = H(server seed + external entropy)<br/>demo: HMAC(secret, raceId)"]
  E --> F["simulateRace()<br/>20 Hz integer timestep"]
  F --> G["Checkpoints + events<br/>finish times in µs"]
  G --> H["Result hash + seed reveal"]
  H --> I[Replay viewer]
  H --> J["Settlement: credits ledger<br/>(idempotent, once)"]
  H --> K[Leaderboard / records]
```

## 3. Race request sequence

```mermaid
sequenceDiagram
  participant P as Player browser
  participant A as /api (Vercel Function)
  participant R as Repository
  participant E as racing-engine
  P->>A: POST /api/races/quick {horseId, tactic}
  A->>R: create race (entries locked, seed committed)
  A-->>P: {raceId, postTime, seedCommitment}
  P->>A: GET /api/races/:id/replay
  A->>R: load race input
  alt post time reached
    A->>E: simulateRace(input)  (deterministic)
    E-->>A: replay + result + resultHash
    A-->>P: replay (seed revealed)
  else before post time
    A-->>P: 425 too early (commitment only)
  end
  P->>P: Viewer plays checkpoints synced to postTime
```

## 4. Module dependency graph (monorepo)

The arrows are imports. The domain packages never import from apps.

```mermaid
flowchart BT
  shared["packages/shared<br/>types + zod contracts"]
  engine["packages/racing-engine"] --> shared
  art["packages/art-pipeline<br/>manifest + PixelLab adapter"] --> shared
  viewer["packages/race-viewer<br/>React + PixiJS"] --> shared
  viewer --> art
  web["apps/web<br/>Next.js pages + /api"] --> engine & viewer & art & shared
  econ["packages/economy (Milestone C)"] --> shared
  sol["packages/solana (Milestone E)"] --> shared
  web -.-> econ & sol
```

## 5. Horse lifecycle

```mermaid
flowchart LR
  Foal --> Development --> Prime --> Veteran --> Retired
  Retired --> Stud["Finite breeding career"]
  Stud --> End["End of life (published schedule only)"]
  Retired --> Legacy["Permanent pedigree / Hall of Fame"]
  End --> Legacy
```

## 6. Economy

```mermaid
flowchart LR
  Player -->|Play races| Credits[Stable Credits]
  Credits -->|Training / upkeep / entry| Sink[Credit sinks]
  Wallet -->|Deposit, devnet first| Token[SPL token ledger]
  Token -->|Buy horses / stud fees| Market[Marketplace escrow]
  Market -->|Net proceeds| Seller[Player seller]
  Market -->|Fee| Studio[Studio treasury]
```

## 7. Delivery pipeline and agent workstreams

```mermaid
flowchart TB
  C0["Contract: packages/shared<br/>(owned by lead)"] --> W1 & W2 & W3
  W1["Agent: Engine<br/>packages/racing-engine + tests"]
  W2["Agent: Viewer + Art<br/>packages/race-viewer, packages/art-pipeline"]
  W3["Agent: Web app<br/>apps/web pages, API, demo repository"]
  W1 & W2 & W3 --> I["Lead: integrate, build, Playwright smoke"]
  I --> D[Vercel preview deploy]
  D --> MA[Milestone A demo]
  MA --> MB["B: metagame (training, genetics, lifecycle, Postgres)"]
  MB --> MC["C: credits ledger + marketplace"]
  MC --> MD["D: PixelLab art swap via manifest"]
  MD --> ME["E: Solana devnet adapter"]
  ME --> MF[F: launch readiness]
```

## 8. Integration contract with other branches

Other branches (for example a parallel prototype) can adopt pieces one at a time,
because each module only talks through `packages/shared`:

| Want | Import | Contract |
|---|---|---|
| Deterministic races | `@thoroughbred/racing-engine` | `simulateRace(RaceInput): RaceReplay` |
| Race visuals | `@thoroughbred/race-viewer` | `<RaceViewer replay startAtMs? />` |
| Art slots | `@thoroughbred/art-pipeline` | `AssetManifest`, `PixelLabAdapter` |
| Types / validation | `@thoroughbred/shared` | Zod schemas + TS types |

Persistence is behind `RaceRepository` / `HorseRepository` in `apps/web/src/server`.
The stateless demo repository can be replaced with Postgres without changing pages.

## 9. Vercel runtime decisions

- **One deployment.** Next.js pages and `/api` route handlers. There's no separate API server.
- **Races are computed on request, at or after post time.** A race takes milliseconds to
  simulate and is idempotent, so the result can be cached forever once revealed.
- **Settlement happens on request, with cron as a backstop.** The first read after post
  time settles the race exactly once, using an idempotency key. A cron sweep covers races
  nobody looks at.
- **Live viewing is synchronized playback** of stored checkpoints against `postTimeMs`.
- **PixelLab runs at build time only.** It never runs per request or per frame.
