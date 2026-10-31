# Real-money tote (USDG): dormant scaffold

**Status: OFF. Not deployed. Do not enable without every item in [Before enabling](#before-enabling).**

The in-game tote (credits, and practice T-USDG while `USDG_MODE=practice`) is unchanged by
everything here. This document covers a separate, real-money version that the owner authorised
to be built "on the side, just in case" and kept switched off: it stays OFF until testing with
T-USDG is complete and the owner explicitly says to enable it, with legal approval and the
checklist below done. Until then the in-game tote never accepts real money.

Code:

| Layer | Path |
|---|---|
| Contract | `packages/contracts/contracts/TotePools.sol` (+ `test/tote-pools.test.ts`, 36 tests) |
| Chain helpers | `packages/contracts/adapter/totePools.ts` (EIP-712 `BetPermit`, market keys, final seed, position packing, odds) |
| Rules | `packages/game-core/src/realTote.ts` (switch, timing, caps, fat-finger checks) |
| Seed | `packages/racing-engine/src/hash.ts` `mixSeedEntropy` (and `packages/db/src/crypto.ts`) |
| Database | `packages/db/src/services/realTote.ts`, tables `real_tote_races`, `real_tote_permits`, `real_tote_events` (migration `0025_real_tote`) |
| Server | `apps/web/src/server/chain/toteChain.ts`, routes `GET /api/races/:id/tote/real`, `POST /api/races/:id/tote/real/permit`, cron `/api/cron/chain` |
| UI | `apps/web/src/components/tote/RealToteSlip.tsx` (mounted in the tote panel; renders nothing while off) |

## The switch

Every entry point refuses unless **all three** are set:

- `REAL_TOTE_ENABLED=true` (default false)
- `WEB3_ENABLED=true`
- `TOTE_POOLS_ADDRESS` (a deployed TotePools)

and, to do anything on chain, `ROBINHOOD_RPC_URL`, `TOTE_OPERATOR_PRIVATE_KEY`,
`TOTE_PERMIT_SIGNER_PRIVATE_KEY` (a different key) and `REAL_TOTE_ALLOWED_COUNTRIES` (an
allow-list; empty means nowhere). `USDG_TOKEN_ADDRESS` names the stake asset (it defaults to
testnet USDG on chain 46630 only). While off, the board route answers `{available: false}`
without touching the database, the permit route answers 503, the keeper returns
`{skipped: "off"}`, and the seed hook does nothing. Tests assert each of these.

## Architecture

```
player wallet ──approve exact amount──► USDG
player wallet ──bet(permit)───────────► TotePools ◄── createMarket / postResult / cancelMarket (OPERATOR, server key)
                                           ▲  ▲   ◄── correctResult / voidMarket (GUARDIAN, multisig)
server: checks ─► signs BetPermit ─────────┘  │   ◄── lockEntropy / sealEntropy / finalize / expireMarket (anyone)
player wallet ◄── claim (pull) ───────────────┘   ──► withdrawTreasury: takeout + dust to TREASURY (multisig)
database: flag per race, permits issued, mirror of TotePools events (display only)
```

- **Non-custodial.** Stakes move from the player's wallet into TotePools and leave only through
  `claim` (to an address the player chooses) or, for the takeout and rounding dust, to the
  treasury. No role can move a player's stake: there is no owner withdrawal, no sweep, no
  upgrade path, no arbitrary transfer. The server holds no player funds and the database holds no
  balances: it records the race-level flag, the permits it signed, and a mirror of chain events.
- **Stake asset per market.** `createMarket` takes the asset: an allow-listed ERC-20 (only USDG is
  allow-listed at deployment) or native ETH (`address(0)`: `bet` is payable with
  `msg.value == amount`, payouts are pull-based ETH calls under the reentrancy guard). ETH is off
  until an admin sets its stake limits and allow-lists it. Each market settles entirely in its own
  asset: a race could carry a USDG market and an ETH market under different market ids, with no
  conversion and no price oracle. Stake limits and the treasury's accrued take are per asset.
  De-listing an asset stops new markets and new bets in it, never results, refunds or claims. The
  web app only creates USDG markets today.

### Market lifecycle

1. **Flag** (server): `enableRealToteForRace` moves the race's field lock to
   `REAL_TOTE_FIELD_LOCK_MS` (15 min) before the off. Only for open Live card races, before the
   new lock time; idempotent. No flag, no change: every other race keeps its usual timing.
2. **Create** (OPERATOR, when the field locks): `createMarket(raceId, asset, closeTime,
   runnerCount, placeTerms, seedCommitment, takeoutBps, maxPool)`. `seedCommitment` is the race's
   `sha256(serverSeed)` (the engine's `commitSeed`), fixed before any bet and never changeable.
   `closeTime` = off − `REAL_TOTE_ENTROPY_LEAD_MS` (1 min). Runner `i` is gate `i + 1`.
3. **Bet** (player): `bet(raceId, runner, pool, amount, permit, signature)` with a `BetPermit
   {bettor, raceId, maxAmount, nonce, expiry}` signed by PERMIT_SIGNER. Refused from
   `closeTime − CLOSE_MARGIN` (immutable, 60 s in tests), below the minimum, above the per-bet
   maximum, past the per-wallet-per-race cap, past the market's `maxPool`, while paused, or with
   any permit problem (missing, tampered, wrong signer, another bettor's, another race's, above
   `maxAmount`, expired, valid for over 10 minutes, nonce reused). The received amount is checked
   (fee-on-transfer tokens refused). **No cancellation.**
4. **Entropy** (anyone, after `closeTime`): `lockEntropy` fixes a future block; `sealEntropy`
   stores its hash once it exists (see [Seed fairness](#seed-fairness)).
5. **Result** (OPERATOR, once the broadcast is over): `postResult(raceId, revealedSeed,
   positions)` checks `sha256(revealedSeed) == seedCommitment`, needs the sealed entropy, stores
   `finalSeed = sha256(serverSeed ‖ entropy)` and each runner's position (0 = non-runner; equal
   positions = dead heat; validated as a standard ranking) and opens `CHALLENGE_WINDOW` (1 h).
6. **Challenge** (GUARDIAN, inside the window only): `correctResult` or `voidMarket`.
7. **Finalize** (anyone, after the window): the pari-mutuel split on chain with game-core's rules
   (WIN: one part; PLACE: equal parts per paying place, 2 from 5–7 runners, 3 from 8; dead heats
   share the places they cover; an unbacked paying runner's part goes to the other paying
   runners; nobody backed a paying runner → the net pool back pro rata; non-runner stakes and a
   place pool with too few runners refunded in full; everything rounds down; takeout and
   rounding go to the treasury). No token moves in `finalize`.
8. **Claim** (player, pull): once per wallet per race, to any address (a frozen or ETH-refusing
   wallet can claim elsewhere). The last claim of a pool sweeps its rounding dust to the
   treasury's account, so after all claims and `withdrawTreasury` the contract holds 0.
9. **Never stuck**: no result `MAX_SETTLE_DELAY` (1 day) after `closeTime` → anyone
   `expireMarket` → full refunds. OPERATOR may `cancelMarket` only before the entropy is sealed
   (before anyone can know the outcome). GUARDIAN may void an open market at any time (abandoned
   race). Pausing blocks new bets only; entropy, results, refunds and claims keep working.

`test/toteReference.ts` is a copy of game-core `settleTotePool`; game-core's
`tote.parity.test.ts` proves the copy identical over 3,000 random pools, and the contract's
randomized test (20 rounds, up to 24 runners, dead heats, non-runners, several takeouts) proves
the contract pays exactly what the copy says, with `sum(payouts) + take + remainder == stakes`.
The on-chain split is per wallet position rather than per ticket, so a wallet with two bets on
the same runner can receive up to a unit more than two separate tickets would (rounding only).

### Roles

| Role | Power | Holder |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | roles, stake limits, asset allow-list, treasury address, unpause | **multisig** |
| `PAUSER_ROLE` | pause new bets | multisig (+ an on-call key if wanted) |
| `OPERATOR_ROLE` | create markets, post results, cancel before the entropy is sealed | server key (low value: it can never move stakes; the guardian can void its results) |
| `PERMIT_SIGNER_ROLE` | sign BetPermits | a separate server key; rotate by grant then revoke |
| `GUARDIAN_ROLE` | correct or void during the challenge window, void an open market | **multisig**, independent of the operator |
| treasury | receives takeout and dust only | **multisig** |

## Seed fairness

Today the server picks each race's seed and therefore knows the outcome before the off. With
real money that would let an insider who knows the seed know the winner. For races with a
real-money pool only:

```
finalSeed = sha256(serverSeed ‖ entropy)
```

- `serverSeed` is the race's existing seed; its `sha256` is the market's commitment, posted
  before betting opens and never changeable.
- `entropy` is the hash of a Robinhood Chain L2 block **chosen after betting has closed**:
  `lockEntropy` (anyone, at or after `closeTime`) fixes block `current + ENTROPY_DELAY_BLOCKS`,
  which does not exist yet, so its hash is unknown to everyone, the caller included.
  `sealEntropy` (anyone) stores it once the block exists. Block numbers and hashes come from the
  ArbSys precompile (`arbBlockNumber`, `arbBlockHash`): on Arbitrum chains `block.number` is an L1
  estimate and `block.prevrandao` is constant, so neither is used.
- If nobody seals while the hash is readable (256 blocks), the market is **void** (refunds)
  rather than re-locked: re-picking a block would let whoever knows the server seed choose among
  outcomes.
- The race is simulated on `finalSeed`. The choice of seed is made once, at the first
  simulation, and stored (`real_tote_races.seed_mode`), so every server instance runs the same
  race. If the entropy is not sealed in time (the minute between the close and the off), the race
  runs on its server seed exactly as an ordinary race would and its market is cancelled
  (refunds): the race still happens, but no money rides on an outcome the operator could know.
- Anyone can verify: the result event carries `revealedSeed` and `finalSeed`;
  `sha256(revealedSeed)` matches the commitment, `finalSeed = sha256(revealedSeed ‖ entropy)`, and
  the engine replays the race from `finalSeed` (`/api/races/:id/verify` checks both for these
  races). Credit and T-USDG races, golden fixtures and engine outputs are untouched.

**Residual trust (honest version):**

- **The sequencer.** Robinhood Chain has a single sequencer that orders transactions and so
  determines block contents and hashes. A sequencer that also knew the server seed could choose
  which transactions land in the entropy block and so steer its hash. The scheme assumes the
  sequencer does not collude with the operator.
- **A quiet chain.** On a chain with little traffic, a party that knows the server seed and can
  place its own transactions could try to predict or shape the target block. Mitigations: the
  target is fixed only after the close and is a few blocks ahead; anyone can lock and seal; the
  guardian can review who sent transactions into the entropy block. The stronger fix is an
  external randomness source (a verifiable random function or a public randomness beacon) once
  one is available and audited on this chain.
- **A refund option.** Whoever controls sealing can let the window lapse, which voids the market.
  That can only turn a bet into a refund, never into a win, and it is public on chain; a market
  voided this way should be investigated.
- **Result posting.** The contract cannot run the race. It checks the seed and the shape of the
  result; the result itself is trusted to the operator, checked by anyone through replay, and
  correctable or voidable by the guardian during the challenge window.

## Timing

| Moment | Ordinary Live race | Race with a real-money pool |
|---|---|---|
| Field locks | usual entries close | `REAL_TOTE_FIELD_LOCK_MS` (15 min) before the off, or earlier if already earlier |
| Market opens | n/a | when the field locks (bettors see the final field) |
| Betting closes | at the off (credits / T-USDG) | off − 1 min − `CLOSE_MARGIN` (on chain, by block time) |
| Entropy | n/a | locked at off − 1 min, sealed a few blocks later |
| Result public | after the broadcast | same; only then is the result posted on chain (no spoilers: chain data is permanent) |

The in-game credit pools on a flagged race keep their own rules (bets close at the off).

## Server side

- **Permits** (`issueRealTotePermit` + `requestBetPermit`): the same checks as the in-game tote,
  shared code (`toteBettorChecksTx`: 18+ confirmed, self-exclusion, the horse runs, a place pool
  exists, no own / lease / linked-account runner, with a fraud event for linked accounts), plus:
  the switch, a live market, the betting close, the account's linked wallet as the bettor, the
  location allow-list, real-money caps (per bet 100, per race 250, per day 500 USDG) and the
  player's own lower limits (`tote_settings.limits.USDG`). A permit is for exactly the amount the
  player typed, single-use, valid 2 minutes and never past the betting close, and counts toward
  the limits until it expires unused (spent ones at the amount actually staked).
- **Keeper** (`realToteBackstop` from the cron, `realToteTick` from the board poll, throttled,
  and `prepareRealToteSeed` before simulation): creates markets for locked fields, locks and seals
  entropy, cancels markets whose race ran without it, posts results once public, finalizes after
  the window, and mirrors events. All of it is safe to retry: chain calls are write-once or
  idempotent, and event mirroring is keyed by transaction and log index.
- **Odds**: from the mirrored on-chain stakes (or read straight from the contract with
  `realToteChainOdds`), with the same pool formula as the in-game tote.

## Fat-finger UX

The real-money slip (`RealToteSlip`) shows the minimum and the per-bet maximum next to the
amount field; accepts only plain amounts (no separators, at most 6 decimals); asks for an
explicit second confirmation above `REAL_TOTE_CONFIRM_ABOVE` (25 USDG); states that bets can't be
cancelled; says the odds move until betting closes and are final only then; and, before the
wallet opens, shows the exact amount that will leave the wallet and the contract it goes to. The
token approval is for exactly that amount, never unlimited. The permit itself caps the bet at the
reviewed amount, so a wallet can't send more.

## Abuse matrix

| Threat | Mitigation |
|---|---|
| **Late bets** (betting after the result is knowable) | Contract refuses from `closeTime − CLOSE_MARGIN` by block time (covers sequencer clock drift); permits expire before the close; the outcome depends on entropy fixed only after the close |
| **Fat fingers** | Strict amount parsing, max per bet on show, second confirmation for large stakes, exact-amount permit and approval, wallet preview; contract caps per bet, per wallet per race and per pool |
| **Spoofing** (big bets to move odds, then cancel) | No cancellation at all; per-bet and per-wallet caps; pools capped by `maxPool` |
| **Insider seed knowledge** | `finalSeed = sha256(serverSeed ‖ future block hash)`; the commitment is posted before betting; a missed seal voids instead of re-picking; a race that ran without entropy gets its market cancelled. Residual trust in the sequencer (above) |
| **Wrong result** | Seed checked on chain; result public only after the broadcast; anyone can replay from `finalSeed`; guardian multisig can correct or void within the challenge window; finalize only after it |
| **Stuck funds** | Pull claims to any address; expiry to full refunds after `MAX_SETTLE_DELAY`; void and cancel paths; pause never blocks refunds or claims; finalize makes no external calls; dust swept so the contract empties |
| **Front-running / MEV** | Robinhood Chain orders first come, first served (no priority auction); permits are bound to the bettor (`msg.sender`), the race, a max amount and a nonce; pari-mutuel odds aren't fixed at bet time, so seeing a pending bet gives no locked-in edge; betting closes before the entropy exists |
| **Sybil wallets** | Permits only for the account's linked wallet (one wallet per account), the account-level caps and self-exclusion, linked-account detection (device, fingerprint, IP, wallet) with fraud events, the location allow-list; KYC before enabling |
| **Conflicts of interest** | Shared tote checks refuse bets on races with the bettor's, a lease partner's or a linked account's runner |
| **Owner / operator collusion** | No role can move stakes; operator can't cancel once the outcome is knowable; guardian and treasury are separate multisigs; no upgrade path; every action is an on-chain event mirrored for audit |
| **Hostile or quirky tokens** | Allow-listed assets only; exact received amount checked; reentrancy guard on bet, claim and treasury withdrawal (tested with a hostile token and an ETH receiver) |
| **Signer key leak** | A leaked permit key can only let people bet within the contract's caps (never move funds); rotate by grant then revoke; pause new bets meanwhile |

## Before enabling

All of these, in this order, with sign-off recorded:

1. **Legal approval** for real-money pool betting in each place it will be offered, including the
   terms of service, responsible-play obligations, tax and reporting.
2. **KYC, age and location**: identity and 18+ verification for real-money accounts, sanctions
   screening, and the location allow-list (`REAL_TOTE_ALLOWED_COUNTRIES`) agreed with counsel.
3. **External audit** of `TotePools.sol` by an independent firm, with findings fixed and
   re-audited; measure coverage (not yet measured).
4. **RNG / seed review** by an independent reviewer: the entropy scheme, the residual trust above,
   and whether an external randomness source should replace the block hash first.
5. **Multisig setup**: admin, guardian and treasury on separate multisigs with independent
   signers; an operator and a permit-signer key generated for production only, in the hosting
   environment's secret store; the deployer renounced.
6. **Testnet rehearsal** on Robinhood testnet with test USDG: full lifecycle, void, expiry and
   key rotation drills, the keeper under load, and a guardian drill.

## Enable checklist

- [ ] Every item in "Before enabling" signed off
- [ ] TotePools deployed with the audited bytecode; constructor: admin, operator, permit signer,
      guardian, treasury, USDG, ArbSys (`0x…64`), `CLOSE_MARGIN`, `CHALLENGE_WINDOW`,
      `MAX_SETTLE_DELAY`, `ENTROPY_DELAY_BLOCKS`; verified on the explorer
- [ ] Stake limits reviewed per asset; ETH left off unless separately approved (`setStakeLimits`
      then `setAssetAllowed(address(0), true)`)
- [ ] Deployer has no roles; roles checked on chain
- [ ] Env set on Preview first: `TOTE_POOLS_ADDRESS`, `TOTE_OPERATOR_PRIVATE_KEY`,
      `TOTE_PERMIT_SIGNER_PRIVATE_KEY`, `REAL_TOTE_ALLOWED_COUNTRIES`, `USDG_TOKEN_ADDRESS`,
      `ROBINHOOD_RPC_URL` (a provider URL), then `REAL_TOTE_ENABLED=true`
- [ ] The keeper's cadence covers the minute between the close and the off (the board poll and
      the pre-simulation hook do this; the daily cron is only a backstop)
- [ ] Monitoring: voided and cancelled markets, missed seals, guardian actions, permit volume
- [ ] Production only after a clean Preview period

## Not done yet

- No deploy script for TotePools (deliberately) and coverage not measured.
- No admin screen to flag races; `flagRaceForRealTote` is the server call.
- No UI for real-money own limits (`tote_settings.limits.USDG` is read but not yet settable) and
  no claim button (players can claim from the contract directly; the slip covers betting only).
- ETH markets are supported by the contract only; the app creates USDG markets.
