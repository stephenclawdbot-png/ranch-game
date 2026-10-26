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
    WAL["Optional wallet<br/>(off unless WEB3_ENABLED)"]
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
  CHAIN["ChainAdapter (server only)<br/>Mock by default, or EVM via viem"]
  RH[("Robinhood Chain (EVM L2)<br/>RaceProofRegistry, PremiumStore")]
  PXL["PixelLab adapter<br/>offline build-time only"]

  UI -->|HTTPS| API
  RV -->|GET replay checkpoints| API
  ART --> BLOB
  WAL --> API
  API --> ENG & GEN & TRN & ECO & MKT
  CRON --> API
  ENG & GEN & TRN & ECO & MKT --> REPO
  REPO --> DB
  ECO --> CHAIN
  ENG -.->|proof roots| CHAIN
  CHAIN -.->|optional| RH
  WAL -.->|USDG purchase tx| RH
  PXL -.->|approved assets + manifest| BLOB
```

## 2. Race fairness pipeline

The server runs a race once, at post time. Everyone then plays the same stored
checkpoints, in sync with the post-time clock. Live races need no WebSockets.

```mermaid
flowchart LR
  A[Entries open] --> B["Seed commitment published<br/>sha256(seed)"]
  B -.-> BA["Optional: commitment Merkle root<br/>anchored on Robinhood Chain"]
  B --> C[Entry lock]
  C --> D["Immutable snapshot<br/>horses + track + weather"]
  D --> E["Final seed = H(server seed + external entropy)<br/>demo: HMAC(secret, raceId)"]
  E --> F["simulateRace()<br/>20 Hz integer timestep"]
  F --> G["Checkpoints + events<br/>finish times in µs"]
  G --> H["Result hash + seed reveal"]
  H --> I[Replay viewer]
  H --> J["Settlement: credits ledger<br/>(idempotent, once)"]
  H --> K[Leaderboard / records]
  H -.->|"only after the broadcast ends"| HA["Optional: result + seed Merkle root<br/>anchored on Robinhood Chain"]
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
  chain["packages/contracts/adapter<br/>Robinhood Chain, optional (Phase 6)"]
  web -.-> econ & chain
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

Stable Credits live only in the Postgres double-entry ledger. They are **never on-chain and
never cashed out**. The optional web3 layer (`docs/web3.md`) is a one-way checkout for
premium entitlements, plus public fairness anchors.

```mermaid
flowchart LR
  Player -->|Play races / goals| Credits["Stable Credits<br/>(Postgres ledger only)"]
  Credits -->|Training / entries / breeding / packs| Sink[Credit sinks]
  Credits -->|Market, 5% fee burned| Market[Credits-only marketplace escrow]
  Wallet -.->|"Optional: USDG purchase (EIP-712 voucher)"| Store[PremiumStore on Robinhood Chain]
  Store -.->|Purchased event, verified by server| Ent["Premium entitlements<br/>(packs, season pass, cosmetics)"]
  Store -.->|Withdraw| Treasury[Studio treasury multisig]
  Ent --> Player
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
  MD --> ME["E: optional web3: Robinhood Chain testnet<br/>(proof anchors + premium store)"]
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
| Optional chain (server only) | `@thoroughbred/contracts/adapter` | `createChainAdapter()`: `verifyPurchase`, `publishProofBatch`, `getBalances` (Mock unless `WEB3_ENABLED=true`) |

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

## 10. Optional web3: Robinhood Chain (EVM)

The chain is Robinhood Chain, an Arbitrum-based L2: mainnet 4663, testnet 46630. **It's off by
default** (`WEB3_ENABLED` unset), and the game never needs it. The full design, threat model
and rollout gates are in `docs/web3.md`.

- **What's on-chain:**
  - `RaceProofRegistry`: write-once Merkle roots of seed commitments (at entry open) and
    of results plus revealed seeds (after the broadcast ends). Anyone can verify with
    `verifyRace`.
  - `PremiumStore`: one-way USDG checkout using server-signed EIP-712 vouchers and
    single-use order ids.
- **What isn't on-chain:** Stable Credits, horses, the market, the ledger. Postgres stays
  the source of truth.
- **Server adapter:** `packages/contracts/adapter`. `MockChainAdapter` (default) and
  `EvmChainAdapter` (viem) share one `ChainAdapter` interface. Keys come from Vercel env
  and are never sent to the client.

## 11. Accounts (anonymous device sessions)

There are no emails or passwords. An account is a device: the browser holds a random 256-bit
token in the httpOnly `tb_session` cookie, and only its sha256 (`accounts.token_hash`) is
stored. `authenticate()` resolves the token to the account (and its stable) on every request.

**Device linking** (`packages/db` `services/devices.ts`, routes under `/api/account/*`): to
play the same stable on another device, the signed-in browser gets a one-time code
(`POST /api/account/link-code`) — 8 characters from an unambiguous alphabet (no 0/O/1/I/L),
shown as `XXXX-XXXX`, valid 10 minutes, single use; a new code expires the account's previous
unused ones. Codes are stored hashed (`link_codes.code_hash`). The other device redeems it at
`POST /api/account/link` (works signed out): the redemption is one transaction that marks the
code used only while still fresh (`used_at is null`), so two devices can never share one code,
and it inserts a per-device token into `account_devices` and sets the session cookie. Every
failure answers the same generic "That code didn't work"; failed redemptions are rate-limited
per IP (20/hour → 429); a browser that already has a stable in play must confirm
`{ replace: true }`. Successful links are recorded as an identity signal (kind "device"), so
anti-multi-account sees one person. `GET/DELETE /api/account/devices` list and revoke linked
devices; the founding browser's token is not a device and can't be revoked from there.

**Wallet sign-in** (`apps/web` `src/server/walletAuth.ts`, routes under `/api/auth/wallet/*`,
detailed in `docs/web3.md` §3.4): a wallet can bring the stable to any device with one free
SIWE signature — no code, no transaction. The login wallet is `accounts.wallet_address`
(unique): every successful SIWE verification sets it when unset, and lookups fall back to a
verified tester row. `POST /api/auth/wallet/challenge` stores a one-time 10-minute
login-purpose message (no account bound; `wallet_challenges.purpose` keeps it separate from
payout-link challenges); `POST /api/auth/wallet/verify` checks the signature against the
address in the stored message, consumes the nonce, and either signs the wallet's stable in
(an `account_devices` row, with the same `{ replace: true }` guard), links an unknown wallet
to the browser's stable, or answers `{ needsStable }` — `{ create: true }` founds the stable
and links the wallet in one request. Challenge + verify are rate-limited per IP (30/hour →
429). WalletConnect (optional env, loaded on click) covers phone wallets; injected EIP-6963
wallets always work. Web3 stays optional — the code-link flow above is unchanged.
