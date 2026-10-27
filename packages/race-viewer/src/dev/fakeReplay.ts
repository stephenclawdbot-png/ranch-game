/**
 * DEV / TEST ONLY. Builds a plausible RaceReplay without the racing engine so the
 * viewer can be developed in isolation. Not deterministic-fair, not used in production.
 */
import {
  FRAME_STRIDE,
  FURLONG_MM,
  HORSE_LENGTH_MM,
  PHOTO_FINISH_MM,
  type Coat,
  type FaceMarking,
  type FinishRecord,
  type Going,
  type LegMarking,
  type RaceEvent,
  type RaceReplay,
  type ReplayHorse,
  type RunningStyle,
  type SilkPattern,
  type Surface,
  type Weather,
} from "@thoroughbred/shared";

export interface FakeReplayOptions {
  horses?: number;
  distanceM?: number;
  surface?: Surface;
  weather?: Weather;
  going?: Going;
  seed?: number;
  name?: string;
  postTimeMs?: number;
  /** Force the first two home within a photo margin (default true). */
  photoFinish?: boolean;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [
  "Copper Comet",
  "Midnight Ledger",
  "Silver Bramble",
  "Harbour Light",
  "Velvet Thunder",
  "Quiet Riot",
  "Golden Mile",
  "Northern Tide",
  "Rosewood Rebel",
  "Ashford Arrow",
  "Lucky Lantern",
  "Storm Warden",
  "Paper Moon",
  "Bold Venture",
  "Kestrel Bay",
  "Iron Duchess",
];
const COATS: Coat[] = ["bay", "dark_bay", "chestnut", "grey", "black", "dapple_grey", "liver_chestnut", "palomino", "buckskin", "roan", "bay", "chestnut", "dark_bay", "grey", "bay", "black"];
const FACES: FaceMarking[] = ["blaze", "star", "none", "stripe", "snip", "bald", "star", "none"];
const LEGS: LegMarking[] = ["none", "sock", "stocking", "coronet"];
const PATTERNS: SilkPattern[] = ["hoops", "solid", "chevron", "stripes", "diamonds", "sash", "quartered", "stars"];
const SILK_COLORS: [string, string, string][] = [
  ["#1d3f8f", "#f2c230", "#f2c230"],
  ["#c8102e", "#ffffff", "#c8102e"],
  ["#0f6b3a", "#f4f0e6", "#f4f0e6"],
  ["#5b2a86", "#f28c28", "#5b2a86"],
  ["#111111", "#e9e4d4", "#d4202f"],
  ["#f2c230", "#1d1d1b", "#1d1d1b"],
  ["#00857c", "#ffffff", "#ff6f61"],
  ["#e8457c", "#2b2b6e", "#2b2b6e"],
  ["#ffffff", "#0b5394", "#0b5394"],
  ["#8b1e2b", "#d9b86c", "#d9b86c"],
  ["#2e7dd1", "#f7f7f7", "#f7f7f7"],
  ["#ff7a00", "#141414", "#ff7a00"],
  ["#4a5d23", "#e6d3a3", "#e6d3a3"],
  ["#d61f69", "#ffe14d", "#ffe14d"],
  ["#14213d", "#fca311", "#e5e5e5"],
  ["#7a0019", "#ffcc33", "#7a0019"],
];
const STYLES: RunningStyle[] = ["front", "stalker", "closer"];

function hex64(rand: () => number): string {
  let s = "";
  for (let i = 0; i < 64; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}

function marginLabel(mm: number): string {
  const l = mm / HORSE_LENGTH_MM;
  if (l < 0.05) return "nose";
  if (l < 0.1) return "short head";
  if (l < 0.2) return "head";
  if (l < 0.3) return "neck";
  if (l < 0.6) return "1/2";
  if (l < 0.85) return "3/4";
  if (l > 30) return "dist";
  const whole = Math.floor(l);
  const q = Math.round((l - whole) * 4);
  const frac = ["", " 1/4", " 1/2", " 3/4", ""][q]!;
  return `${q === 4 ? whole + 1 : whole}${frac}`;
}

interface Plan {
  base: number; // cruising m/s
  early: number; // early pace multiplier
  kickAt: number; // fraction of race when the kick starts
  kick: number; // kick extra m/s
  fade: number; // late fade m/s
  laneTarget: number;
  slowStart: number; // seconds lost at the gate
  wobble: number;
}

const TICK_HZ = 20;
const SAMPLE_EVERY = 2;

function speedAt(p: Plan, frac: number, t: number, extra: number): number {
  const accel = Math.min(1, t / 3.2); // ~3 s to reach cruising speed
  let v = p.base * (frac < 0.35 ? p.early : 1);
  if (frac > p.kickAt) v += (p.kick + extra) * Math.min(1, (frac - p.kickAt) / 0.08);
  if (frac > 0.7) v -= p.fade * ((frac - 0.7) / 0.3);
  v += Math.sin(t * 0.7 + p.wobble) * 0.18;
  return Math.max(0, v * accel * accel * (3 - 2 * accel) * 0.85 + v * 0.15 * accel);
}

interface Track {
  dist: number[]; // mm per tick
  speed: number[];
  finishTime: number; // s
}

function runHorse(p: Plan, lengthMm: number, extra: number, maxTicks: number): Track {
  const dt = 1 / TICK_HZ;
  const dist: number[] = [];
  const speed: number[] = [];
  let d = 0;
  let finishTime = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= maxTicks; i++) {
    const t = i * dt - p.slowStart;
    const v = t <= 0 ? 0 : speedAt(p, d / lengthMm, t, extra);
    const prev = d;
    if (d < lengthMm) d += v * 1000 * dt;
    if (prev < lengthMm && d >= lengthMm) {
      finishTime = (i - 1) * dt + ((lengthMm - prev) / (d - prev)) * dt;
      d = lengthMm;
    }
    dist.push(d);
    speed.push(prev >= lengthMm ? Math.max(0, (speed[i - 1] ?? v * 1000) - 4000 * dt) : v * 1000);
  }
  return { dist, speed, finishTime };
}

export function fakeReplay(opts: FakeReplayOptions = {}): RaceReplay {
  const n = Math.min(16, Math.max(2, opts.horses ?? 10));
  const distanceM = opts.distanceM ?? 1200;
  const surface = opts.surface ?? "turf";
  const weather = opts.weather ?? "clear";
  const rand = mulberry32(opts.seed ?? 7);
  const lengthMm = distanceM * 1000;
  const maxTicks = Math.ceil((distanceM / 11) * TICK_HZ);
  const goingPenalty = { firm: 0.15, good: 0, soft: -0.35, heavy: -0.7 }[opts.going ?? (weather === "rain" ? "soft" : "good")];

  const horses: ReplayHorse[] = [];
  const plans: Plan[] = [];
  for (let i = 0; i < n; i++) {
    const tactic = STYLES[Math.floor(rand() * 3)]!;
    const [primary, secondary, cap] = SILK_COLORS[i % SILK_COLORS.length]!;
    const legs = [0, 1, 2, 3].map(() => (rand() < 0.55 ? "none" : LEGS[1 + Math.floor(rand() * 3)]!)) as [
      LegMarking,
      LegMarking,
      LegMarking,
      LegMarking,
    ];
    horses.push({
      horseId: `h${i + 1}`,
      name: NAMES[i % NAMES.length]!,
      gate: i + 1,
      tactic,
      appearance: {
        coat: COATS[i % COATS.length]!,
        face: FACES[Math.floor(rand() * FACES.length)]!,
        legs,
        // Buckskin and red-dun-looking chestnuts double as dun runners in the dev fixture.
        dun: COATS[i % COATS.length] === "buckskin" || (i % 4 === 2 && COATS[i % COATS.length] === "chestnut") || undefined,
        silks: { primary, secondary, cap, pattern: PATTERNS[i % PATTERNS.length]! },
      },
    });
    const base = 16.2 + goingPenalty + (rand() - 0.5) * 0.7;
    plans.push({
      base,
      early: tactic === "front" ? 1.035 : tactic === "stalker" ? 1.0 : 0.965,
      kickAt: tactic === "closer" ? 0.72 + rand() * 0.06 : 0.8 + rand() * 0.06,
      kick: tactic === "closer" ? 1.5 + rand() * 0.6 : 0.6 + rand() * 0.6,
      fade: tactic === "front" ? 0.9 + rand() * 0.6 : 0.4 + rand() * 0.4,
      laneTarget: 0,
      slowStart: rand() < 0.15 ? 0.35 + rand() * 0.25 : rand() * 0.08,
      wobble: rand() * 6,
    });
  }

  let tracks = plans.map((p) => runHorse(p, lengthMm, 0, maxTicks));
  // Close finish: tune the runner-up's kick so it misses by a whisker.
  if (opts.photoFinish ?? true) {
    const byTime = tracks.map((t, i) => ({ i, t: t.finishTime })).sort((a, b) => a.t - b.t);
    const w = byTime[0]!;
    const r = byTime[1]!;
    const target = w.t + 0.004; // ~6-7 cm at 16 m/s
    let lo = 0;
    let hi = 3;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      const ft = runHorse(plans[r.i]!, lengthMm, mid, maxTicks).finishTime;
      if (ft > target) lo = mid;
      else hi = mid;
    }
    tracks[r.i] = runHorse(plans[r.i]!, lengthMm, lo, maxTicks);
    tracks = [...tracks];
  }

  // Finish order + margins.
  const order = tracks.map((t, i) => ({ i, t: t.finishTime })).sort((a, b) => a.t - b.t);
  const lastFinish = order[order.length - 1]!.t;
  const totalTicks = Math.ceil(lastFinish * TICK_HZ) + 1;
  const purse = 50_000;
  const split = [0.55, 0.2, 0.12, 0.08, 0.05];
  const finishOrder: FinishRecord[] = order.map((o, k) => {
    const prev = order[k - 1];
    const marginMm = prev ? Math.round((o.t - prev.t) * (tracks[o.i]!.speed[Math.floor(o.t * TICK_HZ)] ?? 16000)) : 0;
    return {
      horseId: horses[o.i]!.horseId,
      position: k + 1,
      finishTimeUs: Math.round(o.t * 1e6),
      marginMm,
      marginLabel: k === 0 ? "" : marginLabel(marginMm),
      prize: Math.round(purse * (split[k] ?? 0)),
    };
  });

  // Lanes: drift toward the rail, swing wide when passing, never collapse onto one lane.
  const frames: number[][] = [];
  const lanes = horses.map((h) => (h.gate - 1) * 1.0);
  let leader = -1;
  let lastLeadChange = -10;
  const events: RaceEvent[] = [{ tick: 0, type: "start", text: "They're off!" }];
  plans.forEach((p, i) => {
    if (p.slowStart > 0.3) events.push({ tick: 4, type: "slow_start", horseId: horses[i]!.horseId, text: `${horses[i]!.name} is slowly away.` });
  });
  const kicked = new Set<number>();
  const tired = new Set<number>();
  let finalFurlong = false;
  for (let tick = 0; tick <= totalTicks; tick++) {
    const d = tracks.map((t) => t.dist[Math.min(tick, t.dist.length - 1)]!);
    const ranks = d.map((x, i) => ({ x, i })).sort((a, b) => b.x - a.x);
    ranks.forEach((r, rank) => {
      const behindClose = ranks.slice(0, rank).some((a) => a.x - r.x < 3000 && a.x - r.x > 0 && Math.abs(lanes[a.i]! - lanes[r.i]!) < 0.9);
      const target = Math.min(n - 1, rank * 0.55 + (behindClose ? 1.2 : 0));
      const rate = (tick < 60 ? 0.0 : 0.35) / TICK_HZ;
      lanes[r.i]! += Math.max(-rate, Math.min(rate, target - lanes[r.i]!));
    });
    const lead = ranks[0]!.i;
    const tSec = tick / TICK_HZ;
    if (lead !== leader && tSec > 2 && ranks[0]!.x < lengthMm) {
      if (tick - lastLeadChange > 3 * TICK_HZ) {
        events.push({ tick, type: "lead_change", horseId: horses[lead]!.horseId, text: `${horses[lead]!.name} takes it up!` });
        lastLeadChange = tick;
      }
    }
    leader = lead;
    if (!finalFurlong && ranks[0]!.x >= lengthMm - FURLONG_MM) {
      finalFurlong = true;
      events.push({ tick, type: "final_furlong", text: `Into the final furlong, ${horses[lead]!.name} in front!` });
    }
    plans.forEach((p, i) => {
      const frac = d[i]! / lengthMm;
      if (!kicked.has(i) && frac > p.kickAt && frac < 0.97 && p.kick > 1.4) {
        kicked.add(i);
        events.push({ tick, type: "kick", horseId: horses[i]!.horseId, text: `${horses[i]!.name} finds another gear!` });
      }
      if (!tired.has(i) && frac > 0.82 && p.fade > 1.2) {
        tired.add(i);
        events.push({ tick, type: "tiring", horseId: horses[i]!.horseId, text: `${horses[i]!.name} is starting to tire.` });
      }
    });
    if (tick % SAMPLE_EVERY === 0) {
      const frame = new Array<number>(n * FRAME_STRIDE);
      for (let i = 0; i < n; i++) {
        const t = tracks[i]!;
        const frac = d[i]! / lengthMm;
        frame[i * FRAME_STRIDE] = Math.round(d[i]!);
        frame[i * FRAME_STRIDE + 1] = Math.round(lanes[i]! * 1000);
        frame[i * FRAME_STRIDE + 2] = Math.round(t.speed[Math.min(tick, t.speed.length - 1)]!);
        frame[i * FRAME_STRIDE + 3] = Math.max(0, Math.round(1000 - frac * (700 + plans[i]!.fade * 150)));
      }
      frames.push(frame);
    }
  }
  const winner = horses[order[0]!.i]!;
  const photo = finishOrder[1] ? finishOrder[1].marginMm < PHOTO_FINISH_MM : false;
  events.push({ tick: Math.floor(order[0]!.t * TICK_HZ), type: "finish", horseId: winner.horseId, text: `${winner.name} wins it!` });
  if (photo) events.push({ tick: Math.floor(order[0]!.t * TICK_HZ), type: "photo_finish", text: "Photograph! Too close to call." });
  events.sort((a, b) => a.tick - b.tick);

  const seed = hex64(rand);
  return {
    version: 1,
    engineVersion: "fake-dev-0",
    race: {
      id: `fake-${opts.seed ?? 7}`,
      name: opts.name ?? "Kingsbridge Sprint Stakes",
      distanceM,
      surface,
      weather,
      going: opts.going ?? (weather === "rain" ? "soft" : surface === "dirt" ? "good" : "firm"),
      raceClass: "listed",
      postTimeMs: opts.postTimeMs ?? Date.now(),
      purse,
    },
    seedCommitment: hex64(rand),
    seed,
    tickHz: TICK_HZ,
    sampleEvery: SAMPLE_EVERY,
    trackLengthMm: lengthMm,
    laneCount: Math.max(n, 8),
    horses,
    frames,
    totalTicks,
    events,
    result: { finishOrder, winningTimeUs: finishOrder[0]!.finishTimeUs, photoFinish: photo, resultHash: hex64(rand) },
  };
}
