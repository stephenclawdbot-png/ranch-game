/** Test helpers: build valid horses and race inputs. Not exported from the package entry. */
import { FRAME_STRIDE } from "@thoroughbred/shared";
import type { Going, Horse, HorseStats, RaceEntry, RaceInput, RaceReplay, RunningStyle, Surface, Weather } from "@thoroughbred/shared";

export interface HorseOpts {
  id?: string;
  name?: string;
  stats?: Partial<HorseStats> | number;
  style?: RunningStyle;
  preferredDistanceM?: number;
  preferredSurface?: Surface;
}

export function makeStats(stats: Partial<HorseStats> | number = 650): HorseStats {
  if (typeof stats === "number") {
    return { speed: stats, stamina: stats, burst: stats, durability: stats, adaptability: stats, temperament: stats };
  }
  return { speed: 650, stamina: 650, burst: 650, durability: 650, adaptability: 650, temperament: 650, ...stats };
}

export function makeHorse(i: number, opts: HorseOpts = {}): Horse {
  return {
    id: opts.id ?? `h${i}`,
    name: opts.name ?? `Horse ${i}`,
    sex: "colt",
    age: 3,
    stage: "prime",
    generation: 0,
    ownerId: "owner-1",
    sireId: null,
    damId: null,
    stats: makeStats(opts.stats),
    preferredDistanceM: opts.preferredDistanceM ?? 1600,
    preferredSurface: opts.preferredSurface ?? "dirt",
    style: opts.style ?? "stalker",
    appearance: {
      coat: "bay",
      face: "star",
      legs: ["none", "sock", "none", "none"],
      silks: { primary: "#aa2233", secondary: "#ffffff", pattern: "hoops", cap: "#112233" },
    },
    record: { starts: 0, wins: 0, places: 0, shows: 0, earnings: 0 },
  };
}

export interface RaceOpts {
  distanceM?: number;
  surface?: Surface;
  going?: Going;
  weather?: Weather;
  purse?: number;
  seed?: string;
  id?: string;
}

export interface EntryOpts extends HorseOpts {
  tactic?: RunningStyle;
  gate?: number;
}

export function makeInput(entries: EntryOpts[], race: RaceOpts = {}): RaceInput {
  const list: RaceEntry[] = entries.map((e, i) => {
    const horse = makeHorse(i + 1, e);
    return { gate: e.gate ?? i + 1, tactic: e.tactic ?? horse.style, horse };
  });
  return {
    race: {
      id: race.id ?? "race-1",
      name: "Test Stakes",
      distanceM: race.distanceM ?? 1600,
      surface: race.surface ?? "dirt",
      weather: race.weather ?? "clear",
      going: race.going ?? "good",
      raceClass: "handicap",
      postTimeMs: 1_700_000_000_000,
      purse: race.purse ?? 10_000,
    },
    entries: list,
    seed: race.seed ?? seedFor(1),
  };
}

/** Deterministic 64-hex seed from an integer (test use only). */
export function seedFor(k: number): string {
  let out = "";
  let x = (k * 2654435761 + 12345) >>> 0;
  for (let i = 0; i < 8; i++) {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    x = (x ^ (x >>> 12)) >>> 0;
    out += x.toString(16).padStart(8, "0");
  }
  return out;
}

/** A typical mixed field: stats spread around 600-700, tactics matching style. */
export function typicalField(n: number, distanceM: number): EntryOpts[] {
  const styles: RunningStyle[] = ["front", "stalker", "closer"];
  const out: EntryOpts[] = [];
  for (let i = 0; i < n; i++) {
    const style = styles[i % 3]!;
    const wobble = ((i * 37) % 9) * 15 - 60;
    out.push({
      style,
      tactic: style,
      preferredDistanceM: distanceM,
      stats: {
        speed: 650 + wobble,
        stamina: 650 - wobble,
        burst: 640 + ((i * 53) % 7) * 10,
        durability: 650,
        adaptability: 600,
        temperament: 600 + ((i * 29) % 5) * 40,
      },
    });
  }
  return out;
}

/**
 * Physical invariants every replay must satisfy; throws a descriptive Error on violation.
 * Integers only, monotonic distance, lanes in range, no two running horses in the same spot,
 * every horse finishes, final frame all at trackLengthMm.
 */
export function checkFrames(input: RaceInput, replay: RaceReplay): void {
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  const n = input.entries.length;
  const L = input.race.distanceM * 1000;
  const laneMax = (replay.laneCount - 1) * 1000;
  if (replay.trackLengthMm !== L) fail("trackLengthMm mismatch");
  if (replay.horses.length !== n) fail("horse count mismatch");
  if (replay.frames.length !== replay.totalTicks / replay.sampleEvery + 1) fail("frame count mismatch");
  const prev = new Array<number>(n).fill(0);
  for (let f = 0; f < replay.frames.length; f++) {
    const fr = replay.frames[f]!;
    if (fr.length !== n * FRAME_STRIDE) fail(`frame ${f} has wrong length`);
    for (const x of fr) if (!Number.isSafeInteger(x)) fail(`non-integer frame value ${x} at frame ${f}`);
    for (let h = 0; h < n; h++) {
      const d = fr[h * FRAME_STRIDE]!;
      const lane = fr[h * FRAME_STRIDE + 1]!;
      const v = fr[h * FRAME_STRIDE + 2]!;
      const e = fr[h * FRAME_STRIDE + 3]!;
      if (d < prev[h]!) fail(`distance decreased for horse ${h} at frame ${f}`);
      prev[h] = d;
      if (d > L || lane < 0 || lane > laneMax || v < 0 || e < 0 || e > 1000) fail(`out of range at frame ${f} horse ${h}`);
      if (f === 0 && (d !== 0 || v !== 0 || e !== 1000)) fail("frame 0 must be the standing start");
    }
    for (let a = 0; a < n; a++) {
      const da = fr[a * FRAME_STRIDE]!;
      if (da >= L) continue;
      for (let b = a + 1; b < n; b++) {
        const db = fr[b * FRAME_STRIDE]!;
        if (db >= L) continue;
        const dl = Math.abs(fr[a * FRAME_STRIDE + 1]! - fr[b * FRAME_STRIDE + 1]!);
        if (dl < 700 && Math.abs(da - db) < 1900) fail(`horses ${a} and ${b} overlap at frame ${f}`);
      }
    }
  }
  const last = replay.frames[replay.frames.length - 1]!;
  for (let h = 0; h < n; h++) if (last[h * FRAME_STRIDE] !== L) fail(`horse ${h} did not finish`);
}
