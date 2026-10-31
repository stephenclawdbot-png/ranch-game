# Real-money tote (USDG): dormant scaffold

**Status: OFF. Not deployed. Do not enable without every item in [Before enabling](#before-enabling).**

The in-game tote (credits, and practice T-USDG while `USDG_MODE=practice`) is separate from
everything here, apart from the pool rules both share (game-core `tote.ts`). This document covers
a real-money version that the owner authorised to be built "on the side, just in case" and kept
switched off: it stays OFF until testing with T-USDG is complete and the owner explicitly says to
enable it, with legal approval and the checklist below done. Until then the in-game tote never
accepts real money.

Code:

| Layer | Path |
|---|---|
| Contract | `packages/contracts/contracts/TotePools.sol` (+ `test/tote-pools.test.ts`, 47 tests) |
| Chain helpers | `packages/contracts/adapter/totePools.ts` (EIP-712 `BetPermit`, market keys, final seed, result hash, position packing, odds) |
| Rules | `packages/game-core/src/tote.ts` (pool maths, shared with the in-game tote), `packages/game-core/src/realTote.ts` (switch, timing, caps, keeper knobs, fat-finger checks) |
| Seed | `packages/racing-engine/src/hash.ts` `mixSeedEntropy` (and `packages/db/src/crypto.ts`) |
| Database | `packages/db/src/services/realTote.ts`, tables `real_tote_races`, `real_tote_permits`, `real_tote_events` (migrations `0025_real_tote`, `0026_real_tote_hardening`) |
| Operator / keeper | `apps/web/src/server/chain/toteChain.ts`, routes `GET /api/races/:id/tote/real`, `POST /api/races/:id/tote/real/permit`, cron `/api/cron/chain` |
| Result attestor | `apps/web/src/server/chain/toteAttestor.ts` (its own key and RPC; run from the cron today, its own deployment once live) |
| UI | `apps/web/src/components/tote/RealToteSlip.tsx` (mounted in the tote panel; renders nothing while off) |

## The switch

Every entry point refuses unless **all three** are set:

- `REAL_TOTE_ENABLED=true` (default false)
- `WEB3_ENABLED=true`
- `TOTE_POOLS_ADDRESS` (a deployed TotePools)

and, to do anything on chain, `ROBINHOOD_RPC_URL`, `TOTE_OPERATOR_PRIVATE_KEY`,
`TOTE_PERMIT_SIGNER_PRIVATE_KEY` (a different key), `TOTE_ATTESTOR_PRIVATE_KEY` (a third key,
ideally with its own `TOTE_ATTESTOR_RPC_URL`) and `REAL_TOTE_ALLOWED_COUNTRIES` (an allow-list;
empty means nowhere). `USDG_TOKEN_ADDRESS` names the stake asset (it defaults to testnet USDG on
chain 46630 only). `TOTE_STAFF_ACCOUNT_IDS` lists staff accounts, which can't bet. While off, the
board route answers `{available: false}` without touching the database, the permit route answers
503, the keeper and the attestor return `{skipped: "off"}`, and the seed hook does nothing. Tests
assert each of these.

## Trust model

Precisely what the contract guarantees, and what it doesn't:

- **Custody.** Player stakes sit only in TotePools. No role can transfer a stake anywhere except
  back to the player who staked it (`claim`, to an address that player chooses) or, for the
  takeout and rounding dust, to the treasury. There is no owner withdrawal, no sweep of player
  funds, no upgrade path and no arbitrary transfer.
- **Who wins is decided by a posted result, not by the contract.** The contract checks the seed
  and the shape of the result; it can't run the race. So the result keys decide where the pool
  goes. A result pays only when **two independent keys agree**: the OPERATOR posts it and the
  RESULT_ATTESTOR (a separate key and service that replays the race from `finalSeed`) attests the
  same result hash. A mismatch freezes the market until the GUARDIAN multisig corrects or voids
  it, and every result also waits out a challenge window in which the guardian can correct it
  (each correction reopens the full window; at most two, then only a void) or void it.
- **What would still go wrong:** the operator and attestor keys compromised together could post
  and attest a false result; only the guardian, inside the challenge window, would stop it. A
  compromised guardian multisig could correct a result to a false one (it still needs the
  attestor's matching hash to finalize) or void markets (refunds). Keep the three in separate
  services, secret stores and hands.
- **Withholding** a result, or never sealing the entropy, can only end in refunds: an unsettled
  market expires `MAX_SETTLE_DELAY` after its close (anyone can call it), and a posted result that
  never gets a matching attestation expires `MAX_SETTLE_DELAY` after its window. The keeper alerts
  on withheld results (public 30 minutes but not posted).
- **Unclaimed money stays claimable forever.** Winnings and refunds have no deadline and nobody
  can sweep them. Tokens sent to the contract directly (not through `bet`) are not accounted
  anywhere and stay in it for good: there is deliberately no function that could move them. Plain
  ETH transfers are refused.

## Architecture

```
player wallet ──approve exact amount──► USDG
player wallet ──bet(permit)───────────► TotePools ◄── createMarket / postResult / cancelMarket* (OPERATOR, server key)
                                           ▲  ▲   ◄── attestResult (RESULT_ATTESTOR, separate key + service, replays from finalSeed)
server: checks ─► signs BetPermit ─────────┘  │   ◄── correctResult / voidMarket (GUARDIAN, multisig)
player wallet ◄── claim (pull) ───────────────┘   ◄── lockEntropy / sealEntropy / finalize / expireMarket (anyone)
                                                  ──► withdrawTreasury: takeout + dust to TREASURY (multisig)
database: flag per race, permits issued, mirror of TotePools events, keeper bookkeeping, alerts
* only before the entropy block is picked
```

- **Stake asset per market.** `createMarket` takes the asset: an allow-listed ERC-20 (only USDG is
  allow-listed at deployment) or native ETH (`address(0)`: `bet` is payable with
  `msg.value == amount`, payouts are pull-based ETH calls under the reentrancy guard). ETH is off
  until an admin sets its stake limits and allow-lists it. Each market settles entirely in its own
  asset, with no conversion and no price oracle. Stake limits and the treasury's accrued take are
  per asset. De-listing an asset stops new markets and new bets in it, never results, refunds or
  claims. The web app only creates USDG markets today.

### Market lifecycle

1. **Flag** (server): `enableRealToteForRace` moves the race's field lock to
   `REAL_TOTE_FIELD_LOCK_MS` (15 min) before the off. Only for open Live card races, before the
   new lock time; idempotent. No flag, no change: every other race keeps its usual timing.
2. **Create** (OPERATOR, when the field locks): `createMarket(raceId, asset, closeTime,
   runnerCount, placeTerms, seedCommitment, takeoutBps, maxPool)`. `seedCommitment` is the race's
   `sha256(serverSeed)`, fixed before any bet and never changeable; so is the randomness beacon,
   if one is configured. `closeTime` = off − `REAL_TOTE_ENTROPY_LEAD_MS` (1 min). Runner `i` is
   gate `i + 1`. A flagged race whose betting closes before its market exists is closed locally.
3. **Bet** (player): `bet(raceId, runner, pool, amount, permit, signature)` with a `BetPermit
   {bettor, raceId, runner, pool, maxAmount, nonce, issuedAt, expiry}` signed by PERMIT_SIGNER. The
   permit is bound to one runner in one pool (a permit for runner 0 / WIN can't be used on runner
   5 / PLACE), isn't valid before `issuedAt` and at most 10 minutes after it (the server backdates
   `issuedAt` 30 s for clock skew and lets it run 2 minutes). Refused from `closeTime −
   CLOSE_MARGIN`, below the minimum, above the per-bet maximum, past the per-wallet-per-race cap,
   past `maxPool`, while paused, or with any permit problem. The received amount is checked
   (fee-on-transfer tokens refused). **No cancellation.**
4. **Entropy** (anyone, after `closeTime`): `lockEntropy` fixes the first of `ENTROPY_BLOCKS`
   consecutive future blocks (and requests the beacon's randomness when the market has a beacon);
   `sealEntropy` mixes them once they all exist (see [Seed fairness](#seed-fairness)).
5. **Result** (OPERATOR, once the broadcast is over): `postResult(raceId, revealedSeed,
   positions)` checks `sha256(revealedSeed) == seedCommitment`, needs the sealed entropy, stores
   `finalSeed = sha256(serverSeed ‖ entropy)` and each runner's position (0 = non-runner; equal
   positions = dead heat; validated as a standard ranking), emits the result hash
   `keccak256(abi.encode(raceId, finalSeed, positions))` and opens `CHALLENGE_WINDOW` (1 h).
6. **Attest** (RESULT_ATTESTOR): `attestResult(raceId, hash)` with the hash of its own replay. A
   match makes the result finalizable after the window; a mismatch freezes it (`disputed`, which
   only a guardian correction clears).
7. **Challenge** (GUARDIAN): `correctResult` (in the window, or any time the result isn't
   finalizable; reopens the full window; at most 2) or `voidMarket`.
8. **Finalize** (anyone, after the window, with a matching attestation): the pari-mutuel split on
   chain with game-core's rules (below). No token moves in `finalize`.
9. **Claim** (player, pull): once per wallet per race, to any address. The last claim of a pool
   sweeps its rounding dust to the treasury's account, so after all claims and `withdrawTreasury`
   the contract holds 0.
10. **Never stuck**: no result `MAX_SETTLE_DELAY` (1 day) after `closeTime`, or a posted result
    still not finalizable `MAX_SETTLE_DELAY` after its window → anyone `expireMarket` → full
    refunds. OPERATOR may `cancelMarket` only while no entropy block has been picked (the hash of a
    picked block becomes readable as soon as it exists, so a later cancel could be chosen with the
    outcome in view); after that only the guardian voids. Pausing blocks new bets only.

### Pool rules (the same as the in-game tote)

- **Minimum pool:** a pool needs at least 2 distinct bettors backing at least 2 distinct runners
  that ran; otherwise it is void and every stake is refunded in full with no take (`PoolRefunded`
  `thin_pool`). On chain a bettor is a wallet; the server refuses permits that would let linked
  accounts back different runners of the same pool (fraud event), and the in-game tote counts
  linked accounts as one bettor.
- **Winners never lose:** every winning stake comes back first; the profit (net pool less the
  winning stakes) is split into equal parts per paying place (dead heats share the places they
  cover; an unbacked paying runner's part goes to the others). When the 15 % take would leave less
  than the winning stakes, the take is cut, down to zero, so every winner gets at least 1.00 per
  unit. The house never pays in, and there is no minimum dividend above 1.00. A zero take always
  covers the winning stakes (they are part of the pool); the "void if not" branch is an assertion.
- Place pays the first 2 from 5–7 runners, the first 3 from 8; nobody backed a paying runner → the
  net pool back pro rata; non-runner stakes and a place pool with too few runners refunded in full;
  everything rounds down; takeout and rounding to the treasury.
- **Declared dividends stand.** The challenge window plays the part a racecourse's "weighed in"
  does: the result can be corrected or the pool voided before anything is paid, never after.

`test/toteReference.ts` is a copy of game-core `settleTotePool`; game-core's `tote.parity.test.ts`
proves the copy identical over 4,000 random pools (thin pools, heavy favourites, dead heats,
non-runners), and the contract's randomized test (24 rounds) proves the contract pays exactly what
the copy says. The on-chain split is per wallet position rather than per ticket, so a wallet with
two bets on the same runner can receive up to a unit more than two separate tickets would.

### Roles

| Role | Power | Holder |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | roles, stake limits, asset allow-list, treasury address, randomness beacon, unpause | **admin multisig** |
| `PAUSER_ROLE` | pause new bets | admin multisig (+ an on-call key if wanted) |
| `OPERATOR_ROLE` | create markets, post results, cancel before the entropy block is picked | server key (operator service) |
| `RESULT_ATTESTOR_ROLE` | attest a posted result's hash from its own replay | a separate key in a separate service (and RPC) |
| `PERMIT_SIGNER_ROLE` | sign BetPermits | a separate server key; rotate by grant then revoke |
| `GUARDIAN_ROLE` | correct or void a posted result, void an open market | **guardian multisig** |
| treasury | receives takeout and dust only | **treasury multisig** |

The constructor refuses one key in two of operator, attestor, guardian and permit signer. The
admin and guardian multisigs must have **different signers**: the admin can grant roles, so an
admin that could also act as guardian (or grant itself the attestor role) would hold the result
alone. Use separate signer sets for admin, guardian and treasury.

## Seed fairness

Today the server picks each race's seed and therefore knows the outcome before the off. With
real money that would let an insider who knows the seed know the winner. For races with a
real-money pool only:

```
finalSeed = sha256(serverSeed ‖ entropy)
entropy   = keccak256(raceId ‖ hash(b) ‖ hash(b+1) ‖ … ‖ hash(b+ENTROPY_BLOCKS−1))   [‖ beacon randomness]
```

- `serverSeed` is the race's existing seed; its `sha256` is the market's commitment, posted
  before betting opens and never changeable.
- `b` is chosen **after betting has closed**: `lockEntropy` (anyone, at or after `closeTime`)
  fixes `b = current + ENTROPY_DELAY_BLOCKS`, which doesn't exist yet. `sealEntropy` (anyone)
  mixes the hashes of `ENTROPY_BLOCKS` (3 or more) consecutive blocks once the last exists. Block
  numbers and hashes come from the ArbSys precompile (required, with code, on chains 4663 and
  46630); `block.number` and `block.prevrandao` are not used.
- If any of those hashes is no longer readable (256 blocks), the market is **void** (refunds)
  rather than re-locked: re-picking blocks would let whoever knows the server seed choose among
  outcomes. Only ArbSys' own out-of-range error counts as "no longer readable": any other failure
  (an out-of-gas call included) reverts, so nobody can void a market by starving the call.
- **Optional randomness beacon** (`IEntropyBeacon`, off by default): an admin can plug in a
  verifiable random function or public beacon adapter for markets created afterwards. It is asked
  for randomness at `lockEntropy` and mixed in at `sealEntropy`; the block part is stored while
  the beacon's answer is awaited, so a slow beacon doesn't void the market (a beacon that never
  answers ends in expiry and refunds).
- The race is simulated on `finalSeed`. The choice of seed is made once, at the first
  simulation, and stored, so every server instance runs the same race. If the entropy is not
  sealed in time, the race runs on its server seed as an ordinary race would and its market is
  refunded (cancelled by the operator if no entropy block was picked, otherwise voided by the
  guardian, whom the keeper alerts, or expired).
- Anyone can verify: the result event carries `revealedSeed`, `finalSeed` and the result hash;
  `sha256(revealedSeed)` matches the commitment, `finalSeed = sha256(revealedSeed ‖ entropy)`, and
  the engine replays the race from `finalSeed` (`/api/races/:id/verify` checks both).

**Residual trust (honest version):**

- **The sequencer.** Robinhood Chain has a single sequencer that orders transactions and so
  determines block contents and hashes. A sequencer that also knew the server seed could shape the
  entropy blocks. Mixing several blocks raises the cost but doesn't remove it; the scheme assumes
  the sequencer does not collude with the operator. A beacon removes this dependency only if its
  randomness can't be known before the blocks are fixed.
- **A quiet chain.** With little traffic, a party that knows the server seed and can place its own
  transactions in all of the entropy blocks could try to steer them. Several consecutive blocks
  (rather than one) and anyone being able to lock and seal make this harder, not impossible.
- **A refund option.** Whoever controls sealing can let the window lapse, which voids the market:
  only ever a refund, never a win, and public on chain. Such markets should be investigated.
- **The field.** The attestor replays from the chain's `finalSeed` but reads the race's locked
  field (runners and their engine inputs) from the same database as the operator: it catches a
  wrong or forged result, not a tampered field.

## Timing

| Moment | Ordinary Live race | Race with a real-money pool |
|---|---|---|
| Field locks | usual entries close | `REAL_TOTE_FIELD_LOCK_MS` (15 min) before the off, or earlier if already earlier |
| Market opens | n/a | when the field locks (bettors see the final field) |
| Betting closes | at the off (credits / T-USDG) | off − 1 min − `CLOSE_MARGIN` (on chain, by block time) |
| Entropy | n/a | locked at off − 1 min, sealed a few blocks later |
| Result public | after the broadcast | same; only then is the result posted on chain (no spoilers: chain data is permanent) |
| Result final | n/a | attested, then after the challenge window (1 h) |

## Server side

- **Permits** (`issueRealTotePermit` + `requestBetPermit`): the same checks as the in-game tote,
  shared code (`toteBettorChecksTx`: staff, 18+, time-outs and self-exclusion, the hourly reality
  check, the horse runs, a place pool exists, no own / lease / linked-account runner), plus: the
  switch, a live market, the betting close, the account's linked wallet as the bettor, no linked
  account on another runner of the same pool, the location allow-list, real-money caps (per bet
  100, per race 250, per day 500 USDG) and the player's own lower limits. A permit is for exactly
  the amount typed, on one runner in one pool, single-use. It counts toward the limits at its
  maximum until the mirror sees the bet (then at the amount staked) or it lapses: after expiry the
  server asks the chain (`nonceUsed`) and lapses unused ones; once betting has closed on chain
  (`EntropyLocked`) or the market is void, all unused ones lapse. An expired permit whose bet
  isn't mirrored yet never counts as free.
- **Keeper** (`realToteBackstop` from the cron, `realToteTick` from the board poll, throttled,
  and `prepareRealToteSeed` before simulation): creates markets, closes never-opened ones, locks
  and seals entropy, cancels (before the entropy block only), posts results once public,
  finalizes attested results after the window, expires markets that can't settle any more. Its
  work list is ordered by when each step fell due (not by age); a failing step backs off (30 s
  doubling to 30 min) and after 6 failures in a row the market is **parked** (skipped, with an
  alert) until someone unparks it, so a stuck market never holds up the others. Event mirroring
  resumes from a per-market block cursor, paged (`CHAIN_LOG_PAGE_BLOCKS`), filtered at the node by
  the indexed race key.
- **Result attestor** (`toteAttestor.ts`, its own key and RPC): for each posted result not yet
  matched, reads `finalSeed` and the posted positions from the chain, re-runs the race on the
  locked field from that seed, and attests the hash of its own positions. A forged or wrong result
  gets the replay's hash (the market freezes) and an alert to the guardian.
- **Alerts and monitoring** (audit log `real_tote.alert.<kind>`, and `[real-tote][ALERT]` in the
  server log): `abandoned_after_entropy` (guardian should void), `result_disputed`,
  `attestation_missing` (window over, no matching attestation), `result_withheld` (result public
  30 min, not posted), `result_mismatch` (from the attestor), `keeper_parked`, `attestor_error`.
  A guardian request is raised once per market. Watch also: voided and expired markets, missed
  seals, guardian actions, permit volume.
- **Odds**: from the mirrored on-chain stakes (or read straight from the contract), with the
  in-game tote's pool formula; the slip shows the pool's players, a small-pool note, and place
  odds as a range, every figure marked as an estimate.

## Fat-finger UX

The real-money slip (`RealToteSlip`) shows the minimum and the per-bet maximum next to the
amount field; accepts only plain amounts (no separators, at most 6 decimals); asks for an
explicit second confirmation above `REAL_TOTE_CONFIRM_ABOVE` (25 USDG); states that bets can't be
cancelled; says the odds move until betting closes and are final only then; and, before the
wallet opens, shows the exact amount that will leave the wallet and the contract it goes to. The
token approval is for exactly that amount, never unlimited. The permit itself caps the bet at the
reviewed amount on the reviewed runner and pool.

## Abuse matrix

| Threat | Mitigation |
|---|---|
| **Late bets** (betting after the result is knowable) | Contract refuses from `closeTime − CLOSE_MARGIN` by block time; permits expire before the close and are bound to an issue time; the outcome depends on entropy fixed only after the close |
| **Fat fingers** | Strict amount parsing, max per bet on show, second confirmation for large stakes, exact-amount permit and approval, wallet preview; contract caps per bet, per wallet per race and per pool |
| **Permit reuse** | Single-use nonce; bound to the bettor, race, runner, pool, max amount and a 10-minute lifetime from issue |
| **Spoofing** (big bets to move odds, then cancel) | No cancellation at all; per-bet and per-wallet caps; pools capped by `maxPool` |
| **Insider seed knowledge** | `finalSeed = sha256(serverSeed ‖ mixed future block hashes [‖ beacon])`; the commitment is posted before betting; a missed seal voids instead of re-picking; the operator can't cancel once the entropy block is picked. Residual trust in the sequencer (above) |
| **Wrong or forged result** | Two keys must agree (operator post + independent attestor replay); a mismatch freezes the market for the guardian; challenge window reopened by every correction (at most 2); anyone can replay from `finalSeed`; finalize only after the window |
| **Withheld result** | Only refunds (expiry); keeper alert after 30 min |
| **Stuck funds** | Pull claims to any address; expiry to full refunds for unsettled markets and unattested results; pause never blocks refunds or claims; finalize makes no external calls; dust swept so the contract empties |
| **Keeper stall** | Due-ordered work list, backoff, parking with alerts, paged cursor-based log mirroring |
| **Front-running / MEV** | First come, first served ordering; permits bound to the bettor and terms; pari-mutuel odds aren't fixed at bet time; betting closes before the entropy exists |
| **Sybil wallets / transfers between accounts** | Permits only for the account's linked wallet; account-level caps and self-exclusion; linked accounts can't back different runners of a pool (fraud event); the minimum pool counts wallets on chain and linked accounts as one in game; KYC before enabling |
| **Conflicts of interest** | Shared tote checks refuse bets on races with the bettor's, a lease partner's or a linked account's runner; staff can't bet |
| **Owner / operator collusion** | No role can move stakes except back to their owners; operator plus attestor plus a silent guardian would be needed to pay a false result (see the trust model); no upgrade path; every action is an on-chain event mirrored for audit |
| **Hostile or quirky tokens** | Allow-listed assets only; exact received amount checked; reentrancy guard on bet, claim and treasury withdrawal |
| **Signer key leak** | A leaked permit key only lets people bet within the contract's caps (never move funds); rotate by grant then revoke; pause new bets meanwhile |

## Before enabling

All of these, in this order, with sign-off recorded:

1. **Legal approval** for real-money pool betting in each place it will be offered, including the
   terms of service, responsible-play obligations, tax and reporting.
2. **KYC, age and location**: identity and 18+ verification for real-money accounts, sanctions
   screening, and the location allow-list (`REAL_TOTE_ALLOWED_COUNTRIES`) agreed with counsel.
3. **External audit** of `TotePools.sol` by an independent firm, with findings fixed and
   re-audited; measure coverage (not yet measured).
4. **RNG / seed review** by an independent reviewer: the entropy scheme, the residual trust above,
   and whether a randomness beacon should be required before launch.
5. **Multisig setup**: admin, guardian and treasury on separate multisigs with separate signer
   sets; operator, attestor and permit-signer keys generated for production only, each in its own
   service's secret store; the attestor on its own deployment and RPC provider; the deployer
   renounced.
6. **Testnet rehearsal** on Robinhood testnet with test USDG: full lifecycle, a forged-result
   drill (attestor freezes, guardian corrects), void, expiry and key rotation drills, the keeper
   under load and with a parked market, and a guardian drill.

## Enable checklist

- [ ] Every item in "Before enabling" signed off
- [ ] TotePools deployed with the audited bytecode; constructor: `Roles {admin, operator,
      permitSigner, guardian, attestor}`, treasury, USDG, ArbSys (`0x…64`), `Timing {closeMargin,
      challengeWindow, maxSettleDelay, entropyDelayBlocks, entropyBlocks}`; verified on the explorer
- [ ] Stake limits reviewed per asset; ETH left off unless separately approved
- [ ] Deployer has no roles; roles checked on chain; beacon decision recorded
- [ ] Env set on Preview first: `TOTE_POOLS_ADDRESS`, `TOTE_OPERATOR_PRIVATE_KEY`,
      `TOTE_PERMIT_SIGNER_PRIVATE_KEY`, `TOTE_ATTESTOR_PRIVATE_KEY`, `TOTE_ATTESTOR_RPC_URL`,
      `REAL_TOTE_ALLOWED_COUNTRIES`, `USDG_TOKEN_ADDRESS`, `TOTE_STAFF_ACCOUNT_IDS`,
      `ROBINHOOD_RPC_URL` (a provider URL), then `REAL_TOTE_ENABLED=true`
- [ ] The keeper's cadence covers the minute between the close and the off (the board poll and
      the pre-simulation hook do this; the cron is a backstop) and the attestor runs within the
      challenge window
- [ ] Alerts (`real_tote.alert.*`) routed to the operators and the guardian signers
- [ ] Production only after a clean Preview period

## Not done yet (and for the external audit)

- No deploy script for TotePools (deliberately); coverage not measured. Deployed size is
  24.2 KB, about 340 bytes under the 24,576-byte limit, so further features need trimming.
- No admin screen to flag races or unpark markets (`flagRaceForRealTote`, `unparkRealToteRace`
  are server calls); no claim button (players can claim from the contract directly).
- No beacon adapter: the hook exists and is tested with a mock; a real provider needs its own
  review.
- The attestor trusts the database's locked field; committing a hash of the field at
  `createMarket` would close that gap.
- For the audit: the permit/nonce model, the attestation and dispute state machine (including
  the guardian's power to correct after the window while not finalizable), the entropy mixing and
  the narrowed ArbSys catch, the take cut and dust accounting, and the size margin.
- ETH markets are supported by the contract only; the app creates USDG markets.
