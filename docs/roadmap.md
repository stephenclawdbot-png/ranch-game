# Roadmap

**Vision.** Breed it like Photo Finish, manage it like Football Manager, raise it like a ranch
sim, *ride* it like Rival Stars. One horse you care about at the centre. Simple on the
surface, deep underneath, and it never punishes absence. See `docs/game-design.md`.

## Phase 1: Core feel *(current)*

- [x] Deterministic race engine and fairness proofs
- [x] HD-2D race viewer (Three.js), cinematic camera
- [x] Live broadcast with no spoilers
- [~] HD pixel art v2 (PixelLab) and pixel rig (`?rig=1`, to become the default after a real-GPU check)
- [~] Camera and lanes: the whole field visible
- [~] Website redesign from `docs/design-research.md`
- [~] Balance pass (`docs/balance.md`)
- [~] Game rules (`packages/game-core`): genetics, career clock (40 starts), rest cap, care and growth, training, ratings and handicaps, breeding (4 per horse), packs (foal-only, limits, pity), stalls and Legacy Farm, ledger, seasons, Daily Cup, leagues
- [~] Server persistence (`packages/db`): PGlite in dev and previews, Neon in production
- [ ] Two modes: Story (solo vs AI rivals, skip allowed; base = solo quick races) and Live (shared 3-min card, always live; needs DB)
- [ ] Integration: web screens for care, training, breeding, nursery, market, packs, Daily Cup, league, Hall of Fame
- [ ] Playtest with 10–20 people, plus basic telemetry

**Exit criteria:**
- first race in under 60 s;
- no WebGL errors on real devices;
- 60 fps desktop and 30 fps mobile;
- every server-side invariant test passing;
- playtesters come back on day 2.

## Phase 2: Ride mode

- Race engine runs in segments, with decision windows (turn, 600 m, final furlong) and a
  drive meter. Ride influence is capped at ±3–5%.
- Riders' inputs become part of the race record (seed plus a command log), so rides stay
  replayable and verifiable.
- Live races: decision windows run at the same time for every rider; the auto-jockey
  follows the race plan for anyone who doesn't respond.
- Daily Cup becomes a ghost race (ride against a fixed field).
- Jockey staff for players who never ride.

## Phase 3: Ranch & career

- Facilities: barn, paddocks, training track, vet, stud barn.
- Staff with traits.
- Bond.
- Licence tiers (Club, County, National, Classics).
- **Story mode chapters:** named AI rival stables, licences unlocking Live classes, capped story rewards.

## Phase 4: Breeding economy

- Breeding barn and preview.
- Stud market and horse market (credits).
- Packs with a seasonal foal crop.
- Seasons, Season Final, Hall of Fame.

## Phase 5: Social & live ops

- Clubs.
- Events.
- Share cards.
- Friend rivalries.
- Telemetry dashboards.

## Phase 6: Optional web3 (Robinhood Chain)

Off by default (`WEB3_ENABLED=false`); the game never depends on it. Details, threat model
and gates: `docs/web3.md`.

- [x] Research Robinhood Chain: an Arbitrum-based EVM L2; mainnet 4663 has been live since
  2026-07-01; testnet is 46630; the stablecoin is USDG.
- [x] Contracts (`packages/contracts`):
  - `RaceProofRegistry` (fairness Merkle roots);
  - `PremiumStore` (USDG checkout with EIP-712 vouchers);
  - optional `ThoroughbredToken`, not deployed;
  - 70 tests.
- [x] Server `ChainAdapter`: mock by default, EVM via viem; Merkle batching shared with
  Solidity.
- [ ] Testnet: deploy, anchor proofs in shadow mode, `/verify` page, store dogfood with
  testnet USDG.
- [ ] Web integration:
  - checkout and confirm routes;
  - pending orders, with fulfilment idempotent through the ledger;
  - a purchase backstop cron;
  - SIWE wallet link feeding the linked-account flags.
- [ ] Hardening: static analysis, fuzzing, a Safe multisig admin, KMS for server keys,
  monitoring.
- [ ] External audit.
- [ ] **Legal review first**, before any mainnet money: loot boxes per market, consumer
  law, VAT, sanctions, Robinhood ToS.
- [ ] Mainnet in this order:
  1. fairness proofs only;
  2. a store beta (cosmetics and season pass);
  3. premium packs per cleared market.
- Rules:
  - USDG (or another stablecoin) is a premium currency only;
  - **credits are never cashed out**;
  - no prize money and no play-to-earn;
  - a token only after a legal opinion and a user decision.

**Targets:**
- More than 70% of new players start a first race.
- Day-1 retention 45%, day-7 20%, day-30 10%.
- 2–3 sessions per day.
- More than 60% of active players do the Daily Cup.
- More than 30% of players who try ride mode keep using it.
