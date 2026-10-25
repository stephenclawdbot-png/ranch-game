import {
  FRAME_STRIDE,
  FURLONG_MM,
  HORSE_LENGTH_MM,
  PHOTO_FINISH_MM,
  formatRaceTime,
  type FinishRecord,
  type RaceEntry,
  type RaceEvent,
  type RaceInput,
  type RaceReplay,
} from "@thoroughbred/shared";
import { Commentator, finishLine, photoLine } from "./commentary";
import { commitSeed, sha256Hex, streamSeedBytes } from "./hash";
import { ENERGY_MAX, MAX_TICKS, SAMPLE_EVERY, TICK_HZ, US_PER_TICK, buildProfile, type Profile } from "./model";
import { Rng } from "./prng";
import { marginLabel, splitPurse } from "./results";

export const ENGINE_VERSION = "1.0.0";

// Positions are tracked in "sub-mm" units: mm * TICK_HZ. Advancing one tick at speed v (mm/s)
// adds exactly v units, so no rounding ever accumulates.
const SUB = TICK_HZ;
const MIN_GAP_MM = 1920; // 0.8 horse lengths nose-to-nose in the same lane band
const LAT_SEP = 700; // milli-lanes considered "the same lane band"
const LAT_WINDOW_MM = 2920; // longitudinal window used when checking a sideways move
const BLOCK_LOOKAHEAD_MM = 3600; // 1.5 lengths
const DRAFT_MIN_MM = 1900;
const DRAFT_MAX_MM = 3 * HORSE_LENGTH_MM;
const DRAFT_LAT = 600;
const DRAFT_MUL = 870;
const BASE_BUDGET = 960_000; // energy used by running the whole race exactly at cruise (before multipliers)
const DRAIN_OVER_S2 = 1150 * 1150; // excess speed at which drain doubles, squared
const DRAIN_UNDER_K = 900; // permille drain saved per 1000 mm/s below cruise
const DRAIN_MIN = 420;
const TIRE_E = 60_000; // below this, achievable speed falls linearly towards the horse's floor
const WIDE_COST_DIV = 1_000_000; // 1 permille of speed per lane out from the rail
const KICK_RESERVE = 20_000;
const SEG_TICKS = 40;
const PURPOSE_FORM = 1;
const PURPOSE_PACE = 2;
const PURPOSE_CHOICE = 3;

/** Entries sorted by gate; throws on duplicate gates / horse ids. */
export function normalizeEntries(entries: readonly RaceEntry[]): RaceEntry[] {
  const sorted = [...entries].sort((a, b) => a.gate - b.gate);
  const ids = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]!;
    if (i > 0 && sorted[i - 1]!.gate === e.gate) throw new Error(`duplicate gate ${e.gate}`);
    if (ids.has(e.horse.id)) throw new Error(`duplicate horse id ${e.horse.id}`);
    ids.add(e.horse.id);
  }
  return sorted;
}

/** Integer square root (floor), Newton's method on integers only. */
export function isqrt(n: number): number {
  if (n < 2) return n < 0 ? 0 : n;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

/**
 * Insertion sort of horse indices by position desc, then index asc (a total order).
 * The field barely reshuffles between ticks, so this is ~O(n) per call.
 */
function sortByPosition(order: number[], pos: Int32Array): void {
  for (let k = 1; k < order.length; k++) {
    const x = order[k]!;
    const px = pos[x]!;
    let j = k - 1;
    while (j >= 0) {
      const y = order[j]!;
      const py = pos[y]!;
      if (py > px || (py === px && y < x)) break;
      order[j + 1] = y;
      j--;
    }
    order[j + 1] = x;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function canonicalResult(seed: string, finishOrder: readonly FinishRecord[]): string {
  return JSON.stringify([
    "thoroughbred-result",
    1,
    ENGINE_VERSION,
    seed,
    finishOrder.map((f) => [f.position, f.horseId, f.finishTimeUs, f.marginMm]),
  ]);
}

/** Core simulation. `input` must already be schema-validated. */
export function runRace(input: RaceInput): RaceReplay {
  const race = input.race;
  const entries = normalizeEntries(input.entries);
  const n = entries.length;
  const laneCount = Math.max(6, n);
  const laneMax = (laneCount - 1) * 1000;
  const L = race.distanceM * 1000;
  const LU = L * SUB;

  const profiles: Profile[] = [];
  const pace: Rng[] = [];
  const choice: Rng[] = [];
  for (let i = 0; i < n; i++) {
    const e = entries[i]!;
    const form = new Rng(streamSeedBytes(input.seed, e.gate, PURPOSE_FORM));
    profiles.push(buildProfile(e, race, laneMax, form));
    pace.push(new Rng(streamSeedBytes(input.seed, e.gate, PURPOSE_PACE)));
    choice.push(new Rng(streamSeedBytes(input.seed, e.gate, PURPOSE_CHOICE)));
  }
  const names = entries.map((e) => e.horse.name);

  // --- state ---------------------------------------------------------------
  // Int32 is ample: positions stay below 2^31 sub-mm even at the tick cap.
  const pos = new Int32Array(n);
  const oldPos = new Int32Array(n);
  const vel = new Int32Array(n);
  const lane = new Int32Array(n).map((_, i) => i * 1000);
  const energy = new Int32Array(n).fill(ENERGY_MAX);
  const finished = new Uint8Array(n);
  const finPrev = new Uint8Array(n);
  const finishUs = new Array<number>(n).fill(0);
  const finishTick = new Array<number>(n).fill(0);
  const finishOver = new Array<number>(n).fill(0);
  const finishSpeed = new Array<number>(n).fill(0);
  const segNoise = new Array<number>(n).fill(0);
  const passTarget = new Array<number>(n).fill(-1);
  const passFail = new Array<number>(n).fill(0);
  const decideAt = new Array<number>(n).fill(0);
  const boxedTicks = new Array<number>(n).fill(0);
  const kicking = new Array<boolean>(n).fill(false);
  const order = entries.map((_, i) => i);

  // --- events ----------------------------------------------------------------
  const events: RaceEvent[] = [];
  const ev = (tick: number, type: RaceEvent["type"], text: string, i?: number) => {
    const e: RaceEvent = { tick, type, text };
    if (i !== undefined) e.horseId = entries[i]!.horse.id;
    events.push(e);
  };
  const say = new Commentator(parseInt(input.seed.slice(0, 4), 16));
  ev(0, "start", say.line("start", { race: race.name, n }));
  let slowEvents = 0;
  for (let i = 0; i < n; i++) {
    if (profiles[i]!.slowStart && slowEvents < 3) {
      slowEvents++;
      ev(profiles[i]!.reactTicks, "slow_start", say.line("slowStart", { a: names[i]! }), i);
    }
  }
  let announcedLeader = -1;
  let leadCandidate = -1;
  let leadSince = 0;
  let lastLeadTick = -1000;
  let leadEvents = 0;
  let moveEvents = 0;
  let boxedEvents = 0;
  let kickEvents = 0;
  let tiringEvents = 0;
  let furlongDone = false;
  const boxedAnnounced = new Array<boolean>(n).fill(false);
  const tiringAnnounced = new Array<boolean>(n).fill(false);
  const lastMoveTick = new Array<number>(n).fill(-10_000);
  const lastKickTick = new Array<number>(n).fill(-10_000);
  const rank = new Int32Array(n);
  const rankHistory: Int32Array[] = [];

  // --- frames ----------------------------------------------------------------
  const frames: number[][] = [];
  const pushFrame = () => {
    // Built with push so V8 keeps a packed small-integer array.
    const f: number[] = [];
    for (let i = 0; i < n; i++) {
      const d = Math.floor(pos[i]! / SUB);
      f.push(d > L ? L : d, lane[i]!, vel[i]!, Math.floor(energy[i]! / 1000));
    }
    frames.push(f);
  };
  pushFrame();

  let finishedCount = 0;
  let tick = 0;

  while (finishedCount < n || tick % SAMPLE_EVERY !== 0) {
    tick++;
    if (tick > MAX_TICKS) throw new Error(`race exceeded ${MAX_TICKS} ticks; simulation aborted`);

    for (let i = 0; i < n; i++) {
      oldPos[i] = pos[i]!;
      finPrev[i] = finished[i]!;
    }
    // `order` is already sorted by position: it was re-sorted at the end of the previous tick.

    // Leader and second (by position, unfinished only) from the previous tick.
    let lead = -1;
    let second = -1;
    for (const i of order) {
      if (finPrev[i]) continue;
      if (lead < 0) lead = i;
      else if (second < 0) second = i;
    }

    for (let k = 0; k < n; k++) {
      const i = order[k]!;
      const p = profiles[i]!;
      if (finPrev[i]) {
        // Pulling up past the post.
        vel[i] = Math.max(5000, vel[i]! - 40);
        pos[i] = pos[i]! + vel[i]!;
        continue;
      }
      if (tick <= p.reactTicks) continue;

      const myOld = oldPos[i]!;
      const posMm = Math.floor(myOld / SUB);
      const remaining = L - posMm;
      const v = vel[i]!;
      const E = energy[i]!;
      const tactic = entries[i]!.tactic;
      const early = posMm * 4 < L;

      if ((tick - p.reactTicks) % SEG_TICKS === 1) segNoise[i] = pace[i]!.range(-p.segAmp, p.segAmp);

      // --- desired speed ------------------------------------------------------
      const cr = p.cruise;
      const isLeader = i === lead;
      const gapLead = lead >= 0 ? Math.floor((oldPos[lead]! - myOld) / SUB) : 0;
      const leadBy = isLeader && second >= 0 ? Math.floor((myOld - oldPos[second]!) / SUB) : 0;
      if (!kicking[i] && remaining <= p.kickAtMm) {
        kicking[i] = true;
        const r = rank[i]!;
        const contender = r < Math.max(3, Math.floor(n / 3)) || (tactic === "closer" && r < Math.ceil(n / 2) + 1);
        if (kickEvents < 5 && contender && E > 150_000 && tick > 40) {
          kickEvents++;
          lastKickTick[i] = tick;
          ev(tick, "kick", say.line(isLeader ? "kickLeader" : tactic === "closer" ? "kickCloser" : "kickChaser", { a: names[i]! }), i);
        }
      }
      let target: number;
      if (kicking[i]) {
        // Energy-budgeted kick: the fastest pace the remaining tank can pay for to the line.
        const cap = cr + Math.floor(((p.top - cr) * p.kickStrength) / 1000);
        const avail = E - KICK_RESERVE;
        const cost = Math.floor((Math.floor((remaining * BASE_BUDGET) / L) * p.drainMul) / 1000);
        const F = cost > 0 ? Math.floor((Math.max(0, avail) * 1000) / cost) : 5000;
        let sustain: number;
        if (F >= 1000) sustain = cr + isqrt(Math.floor((Math.min(F, 5000) - 1000) * DRAIN_OVER_S2 / 1000));
        else sustain = cr - Math.min(1500, Math.floor(((1000 - F) * 1000) / DRAIN_UNDER_K));
        target = sustain < cap ? sustain : cap;
      } else if (tactic === "front") {
        if (early) target = cr + 420;
        else if (isLeader) target = leadBy > 2 * HORSE_LENGTH_MM ? cr - 40 : cr + 60;
        else target = cr + 180;
      } else if (tactic === "stalker") {
        if (early) target = cr + 120;
        else if (isLeader) target = cr - 60;
        else target = clamp(vel[lead]! + Math.floor((gapLead - 7200) / 8), cr - 250, cr + 260);
      } else {
        if (early) target = cr - 320;
        else target = gapLead > 12 * HORSE_LENGTH_MM ? cr - 40 : cr - 220;
      }
      target += segNoise[i]!;

      // Fatigue caps the achievable speed.
      if (E < TIRE_E) {
        const cap = p.floor + Math.floor(((p.top - p.floor) * E) / TIRE_E);
        if (target > cap) target = cap;
      }
      // Running wide costs ground.
      target -= Math.floor((target * lane[i]!) / WIDE_COST_DIV);

      // --- traffic ------------------------------------------------------------
      let blocker = -1;
      let blockGap = 0;
      // `order` is sorted by previous position, so horses ahead of i sit at order[0..k-1]
      // and nearby ones are adjacent: scan outwards and stop once out of range.
      for (let q = k - 1; q >= 0; q--) {
        const j = order[q]!;
        if (oldPos[j]! - myOld > BLOCK_LOOKAHEAD_MM * SUB) break;
        if (finPrev[j]) continue;
        if (Math.abs(lane[j]! - lane[i]!) >= 800) continue;
        const gap = Math.floor((pos[j]! - myOld) / SUB);
        if (gap <= 0 || gap > BLOCK_LOOKAHEAD_MM) continue;
        if (blocker < 0 || gap < blockGap || (gap === blockGap && j < blocker)) {
          blocker = j;
          blockGap = gap;
        }
      }
      const blocked = blocker >= 0 && vel[blocker]! < target - 60;
      if (blocked) {
        if (passTarget[i]! < 0 && tick >= decideAt[i]!) {
          decideAt[i] = tick + 10;
          const pPass = kicking[i] ? 850 : tactic === "front" ? 350 : 550;
          if (choice[i]!.chance(pPass)) {
            const out = lane[i]! + 1000 <= laneMax ? lane[i]! + 1000 : -1;
            const inn = lane[i]! - 1000 >= 0 ? lane[i]! - 1000 : -1;
            if (out >= 0 && pathFree(i, k, out)) passTarget[i] = out;
            else if (inn >= 0 && pathFree(i, k, inn)) passTarget[i] = inn;
          }
        }
        if (passTarget[i]! < 0) {
          const follow = vel[blocker]! + clamp(blockGap - 2600, -600, 600);
          if (target > follow) target = follow;
          boxedTicks[i] = boxedTicks[i]! + 1;
        }
      } else {
        boxedTicks[i] = 0;
      }
      if (
        boxedTicks[i]! >= 30 &&
        !boxedAnnounced[i] &&
        boxedEvents < 2 &&
        remaining > 150_000 &&
        !early &&
        rank[i]! < Math.max(4, Math.ceil(n / 2))
      ) {
        boxedAnnounced[i] = true;
        boxedEvents++;
        ev(tick, "boxed_in", say.line("boxedIn", { a: names[i]! }), i);
      }

      // --- lateral movement ---------------------------------------------------
      let newLane = lane[i]!;
      const pt = passTarget[i]!;
      if (pt >= 0) {
        const step = clamp(pt - newLane, -60, 60);
        const cand = newLane + step;
        if (lateralAllowed(i, k, cand)) {
          newLane = cand;
          passFail[i] = 0;
        } else if ((passFail[i] = passFail[i]! + 1) > 20) {
          passTarget[i] = -1;
          passFail[i] = 0;
        }
        if (newLane === pt) passTarget[i] = -1;
      } else if (!blocked && newLane !== p.prefLane) {
        const cand = newLane + clamp(p.prefLane - newLane, -15, 15);
        if (lateralAllowed(i, k, cand)) newLane = cand;
      }
      if (newLane !== lane[i]) target -= Math.floor(target / 200);
      newLane = clamp(newLane, 0, laneMax);
      lane[i] = newLane;

      // --- speed update -------------------------------------------------------
      let nv: number;
      if (target > v) {
        const acc = v < cr - 800 ? p.accStart : p.accRun;
        nv = Math.min(target, v + acc);
      } else {
        nv = Math.max(target, v - (blocked ? 200 : 70));
      }
      if (nv < 0) nv = 0;

      // Hard separation: never run up the back of a horse in the same lane band.
      let np = myOld + nv;
      const reach = MIN_GAP_MM * SUB + nv;
      for (let q = k - 1; q >= 0; q--) {
        const j = order[q]!;
        if (oldPos[j]! - myOld > reach) break;
        if (finPrev[j]) continue;
        if (Math.abs(lane[j]! - newLane) >= LAT_SEP) continue;
        if (pos[j]! < myOld) continue;
        const limit = pos[j]! - MIN_GAP_MM * SUB;
        if (np > limit) np = limit;
      }
      if (np < myOld) np = myOld;
      nv = np - myOld;

      // --- energy -------------------------------------------------------------
      if (nv > 0) {
        let drain = Math.floor((nv * BASE_BUDGET) / LU);
        const rel = nv - cr;
        const factor =
          rel > 0 ? 1000 + Math.floor((rel * rel * 1000) / DRAIN_OVER_S2) : Math.max(DRAIN_MIN, 1000 - Math.floor((-rel * DRAIN_UNDER_K) / 1000));
        drain = Math.floor((drain * factor) / 1000);
        drain = Math.floor((drain * p.drainMul) / 1000);
        if (early && p.keenMul !== 1000) drain = Math.floor((drain * p.keenMul) / 1000);
        for (let q = k - 1; q >= 0; q--) {
          const j = order[q]!;
          if (oldPos[j]! - myOld > (DRAFT_MAX_MM + 1) * SUB) break;
          if (finPrev[j]) continue;
          if (Math.abs(lane[j]! - newLane) >= DRAFT_LAT) continue;
          const gap = Math.floor((oldPos[j]! - myOld) / SUB);
          if (gap >= DRAFT_MIN_MM && gap <= DRAFT_MAX_MM) {
            drain = Math.floor((drain * DRAFT_MUL) / 1000);
            break;
          }
        }
        energy[i] = Math.max(0, E - drain);
      }

      pos[i] = np;
      vel[i] = nv;

      if (myOld < LU && np >= LU) {
        finished[i] = 1;
        finishedCount++;
        finishTick[i] = tick;
        finishUs[i] = (tick - 1) * US_PER_TICK + Math.floor(((LU - myOld) * US_PER_TICK) / nv);
        finishOver[i] = np - LU;
        finishSpeed[i] = nv;
      }

      // Tiring commentary.
      if (
        !tiringAnnounced[i] &&
        tiringEvents < 3 &&
        energy[i]! < 70_000 &&
        rank[i]! < 4 &&
        remaining < 900_000 &&
        remaining > 60_000 &&
        nv < cr
      ) {
        tiringAnnounced[i] = true;
        tiringEvents++;
        ev(tick, "tiring", say.line("tiring", { a: names[i]! }), i);
      }
    }

    // --- race-level commentary ----------------------------------------------
    sortByPosition(order, pos);
    for (let r = 0; r < n; r++) rank[order[r]!] = r;

    if (finishedCount === 0) {
      let cand = -1;
      for (const i of order) {
        cand = i;
        break;
      }
      if (cand !== leadCandidate) {
        leadCandidate = cand;
        leadSince = tick;
      }
      const leaderRemaining = L - Math.floor(pos[cand]! / SUB);
      if (
        cand !== announcedLeader &&
        tick - leadSince >= 30 &&
        tick >= 100 &&
        tick - lastLeadTick >= 80 &&
        leadEvents < 7 &&
        leaderRemaining > FURLONG_MM / 2
      ) {
        leadEvents++;
        lastLeadTick = tick;
        const text =
          announcedLeader < 0
            ? say.line("earlyLead", { a: names[cand]! })
            : say.line("leadChange", { a: names[cand]!, b: names[announcedLeader]! });
        ev(tick, "lead_change", text, cand);
        announcedLeader = cand;
      }
      if (!furlongDone && leaderRemaining <= FURLONG_MM) {
        furlongDone = true;
        const sec = order[1];
        ev(tick, "final_furlong", sec !== undefined
            ? say.line("finalFurlong", { a: names[cand]!, b: names[sec]! })
            : say.line("finalFurlongAlone", { a: names[cand]! }), cand);
      }
    }

    if (tick % 20 === 0) {
      rankHistory.push(rank.slice());
      // Compare with the order 10 s ago: big gains are "moves", leaders dropping back are "tiring".
      const past = rankHistory.length > 10 ? rankHistory[rankHistory.length - 11] : undefined;
      if (past && tick > 200 && finishedCount === 0) {
        for (let i = 0; i < n; i++) {
          const gained = past[i]! - rank[i]!;
          const rem = L - Math.floor(pos[i]! / SUB);
          if (rem < 100_000) continue;
          if (
            moveEvents < 7 &&
            gained >= 2 &&
            rank[i]! < 6 &&
            i !== announcedLeader &&
            rem * 4 < L * 3 &&
            tick - lastMoveTick[i]! > 240 &&
            tick - lastKickTick[i]! > 60
          ) {
            moveEvents++;
            lastMoveTick[i] = tick;
            ev(tick, "move", say.line(lane[i]! >= 2000 ? "moveWide" : "moveInside", { a: names[i]! }), i);
          } else if (tiringEvents < 3 && !tiringAnnounced[i] && past[i]! < 3 && gained <= -3 && rem * 2 < L) {
            tiringAnnounced[i] = true;
            tiringEvents++;
            ev(tick, "tiring", say.line("tiring", { a: names[i]! }), i);
          }
        }
      }
    }

    if (tick % SAMPLE_EVERY === 0) pushFrame();
  }

  // --- result ----------------------------------------------------------------
  const finOrder = entries.map((_, i) => i);
  finOrder.sort((a, b) => finishUs[a]! - finishUs[b]! || finishOver[b]! - finishOver[a]! || a - b);
  const prizes = splitPurse(race.purse, n);
  const finishRecords: FinishRecord[] = finOrder.map((i, k) => {
    let marginMm = 0;
    if (k > 0) {
      const ahead = finOrder[k - 1]!;
      marginMm = Math.floor(((finishUs[i]! - finishUs[ahead]!) * finishSpeed[i]!) / 1_000_000);
    }
    return {
      horseId: entries[i]!.horse.id,
      position: k + 1,
      finishTimeUs: finishUs[i]!,
      marginMm,
      marginLabel: k === 0 ? "" : marginLabel(marginMm),
      prize: prizes[k] ?? 0,
    };
  });
  const winner = finOrder[0]!;
  const runnerUp = finOrder[1]!;
  const second = finishRecords[1]!;
  const photoFinish = second.marginMm < PHOTO_FINISH_MM;
  const winTick = finishTick[winner]!;
  if (photoFinish) ev(winTick, "photo_finish", photoLine(names[winner]!, names[runnerUp]!), winner);
  ev(winTick, "finish", finishLine(names[winner]!, second.marginLabel, formatRaceTime(finishUs[winner]!), photoFinish), winner);

  events.sort((a, b) => a.tick - b.tick); // stable: insertion order within a tick

  return {
    version: 1,
    engineVersion: ENGINE_VERSION,
    race,
    seedCommitment: commitSeed(input.seed),
    seed: input.seed,
    tickHz: TICK_HZ,
    sampleEvery: SAMPLE_EVERY,
    trackLengthMm: L,
    laneCount,
    horses: entries.map((e) => ({
      horseId: e.horse.id,
      name: e.horse.name,
      gate: e.gate,
      tactic: e.tactic,
      appearance: e.horse.appearance,
    })),
    frames,
    totalTicks: tick,
    events,
    result: {
      finishOrder: finishRecords,
      winningTimeUs: finishUs[winner]!,
      photoFinish,
      resultHash: sha256Hex(canonicalResult(input.seed, finishRecords)),
    },
  };

  /** Is the lane band around `cand` clear for a sideways move by horse i? */
  function pathFree(i: number, k: number, cand: number): boolean {
    const me = oldPos[i]!;
    const w = LAT_WINDOW_MM * SUB;
    for (let q = k - 1; q >= 0; q--) {
      const j = order[q]!;
      if (oldPos[j]! - me >= w) break;
      if (finPrev[j] || pos[j]! - me >= w) continue;
      if (Math.abs(lane[j]! - cand) < LAT_SEP) return false;
    }
    for (let q = k + 1; q < n; q++) {
      const j = order[q]!;
      if (me - oldPos[j]! >= w) break;
      if (finPrev[j]) continue;
      if (Math.abs(lane[j]! - cand) < LAT_SEP) return false;
    }
    return true;
  }

  /** A sideways step may not bring horse i within LAT_SEP of a horse alongside. */
  function lateralAllowed(i: number, k: number, cand: number): boolean {
    if (cand < 0 || cand > laneMax) return false;
    const me = oldPos[i]!;
    const w = LAT_WINDOW_MM * SUB;
    for (let q = k - 1; q >= 0; q--) {
      const j = order[q]!;
      if (oldPos[j]! - me >= w) break;
      if (finPrev[j] || pos[j]! - me >= w) continue;
      const dNew = Math.abs(lane[j]! - cand);
      if (dNew < LAT_SEP && dNew < Math.abs(lane[j]! - lane[i]!)) return false;
    }
    for (let q = k + 1; q < n; q++) {
      const j = order[q]!;
      if (me - oldPos[j]! >= w) break;
      if (finPrev[j]) continue;
      const dNew = Math.abs(lane[j]! - cand);
      if (dNew < LAT_SEP && dNew < Math.abs(lane[j]! - lane[i]!)) return false;
    }
    return true;
  }
}
