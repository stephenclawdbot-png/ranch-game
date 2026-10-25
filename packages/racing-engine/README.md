# @thoroughbred/racing-engine

Deterministic, integer-only horse race simulation. Same `RaceInput` gives the same `RaceReplay`
in Node and in every browser, so anyone can re-run a race and check the published result.

## API

```ts
import { ENGINE_VERSION, simulateRace, verifyReplay, commitSeed, deriveSeed } from "@thoroughbred/racing-engine";

const seed = deriveSeed(serverSecret, race.id);  // HMAC-SHA256(secret, label) hex (stateless demo seeds)
const commitment = commitSeed(seed);             // sha256(seed bytes) hex: publish before the race
const replay = simulateRace({ race, entries, seed });
verifyReplay({ race, entries, seed }, replay);   // true only if a fresh re-simulation matches exactly
```

- `simulateRace(input)` validates with `RaceInputSchema.parse`, sorts entries by gate (the caller's
  array order never matters) and throws on duplicate gates or horse ids. `horses[]` and the frame
  layout are in gate order.
- `verifyReplay(input, replay)` checks the engine version, seed, commitment and that the replay's own
  result hashes to `resultHash`. It then re-simulates and compares the full result, `totalTicks` and
  every frame. It never throws.
- Also exported: `marginLabel(mm)`, `splitPurse(purse, runners)`, `PRIZE_SPLIT_PCT`, `TICK_HZ`, `SAMPLE_EVERY`.
- `resultHash = sha256(JSON.stringify(["thoroughbred-result", 1, ENGINE_VERSION, seed, [[position, horseId, finishTimeUs, marginMm], ...]]))`.

## Determinism rules

- All state is integers: positions in mm × 20 (one tick at v mm/s adds exactly v), speeds in mm/s,
  energy in millionths, lanes in milli-lanes. The code only uses `+ - *`, floored division, bit ops
  and `Math.min/max/abs/floor/trunc/imul`. Square roots use an integer Newton `isqrt`. All products
  stay far below 2^53.
- Randomness comes from xoshiro128** streams, built with `Math.imul` only. Each horse gets 3
  independent streams (form, pace, decisions) seeded by `sha256(seed ‖ "tb-stream" ‖ gate ‖ purpose)`.
  Adding a roll in one place never shifts other horses.
- No `Date`, `Math.random`, transcendental math, Node or DOM APIs. A test scans the sources for these.
- 20 Hz ticks, and a frame every 2 ticks. Frame 0 is the standing start. The run ends on the first
  even tick after the last horse finishes. A 10-minute cap throws.
- Any change to the output must bump `ENGINE_VERSION` and update the golden test.

## Model summary

- **Pace:** the par cruise speed falls with distance and is adjusted for going. Each horse's cruise
  comes from its speed, surface, going and distance fit (`adaptability` softens the penalties), plus a
  small bonus when the tactic matches its natural style. A per-race "day form" draw, narrower for
  calm horses (`temperament`), adds to that. Per-segment noise then varies the pace every 2 s, and
  rain widens both.
- **Gate:** the reaction delay comes from temperament. A slow start is more likely in a nervous horse.
- **Tactics:** `front` goes hard early and duels for the lead. `stalker` tracks 2–4 lengths off the
  leader. `closer` saves energy at the back, and once more than ~12 lengths behind it eases off less.
- **Energy:** a full tank drains per metre, normalised to the race distance. Drain grows
  quadratically above cruise and falls below it. It is scaled by stamina (weak in sprints, dominant
  over staying trips), by distance beyond the horse's preferred trip, and by durability. Drafting 1–3
  lengths behind a horse cuts drain by 13%. A nearly empty tank caps speed down towards a floor
  (~85% of cruise).
- **Kick:** front-runners kick at ~300 m out, stalkers at ~420 m and closers at ~660 m, scaled by
  distance. The kick speed is the fastest the remaining energy can pay for to the line, capped by a
  top speed that `burst` sets.
- **Traffic:** horses drift towards their preferred lane, usually the rail. A horse blocked by a slower
  one either sits behind it (and may be boxed in) or swings out a lane to pass. Every lane out from the
  rail costs 0.1% of speed. In the same lane band (<0.7 lanes) horses keep at least 0.8 lengths apart.
- **Finish:** the crossing time is interpolated inside the tick, to the microsecond. Ties break on
  overshoot, then gate. Margins are the time gap × the follower's speed. Labels run nose / short head
  / head / neck, then lengths up to 15, then "dist". It is a photo finish when the margin is under
  150 mm.
- **Purse:** 55/20/12/7/4/2%, with each share floored. The remainder goes to the winner, so the prizes
  always add up to the purse.
- **Commentary:** about 8–25 short lines per race: start, slow starts, lead changes (debounced), moves,
  boxed in, kicks, tiring, the final furlong, photo finish and the winner. Phrasing rotates and is
  never random.

## Tests

```sh
pnpm --filter @thoroughbred/racing-engine test       # vitest: determinism, golden, invariants, balance, property, perf
pnpm --filter @thoroughbred/racing-engine typecheck
```

`src/test-fixtures.ts` has helpers that build valid horses and race inputs (`makeInput`,
`typicalField`, `seedFor`, `checkFrames`).
