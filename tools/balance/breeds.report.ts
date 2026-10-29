/**
 * Genetics v2 breed balance (docs/genetics-v2.md "Balance check"): no breed is better overall.
 *   npx vitest run --config tools/balance/vitest.config.ts breeds          # full run
 *   BAL_BREED_RACES=300 npx vitest run --config tools/balance/vitest.config.ts breeds
 *
 * A pool of mature horses of every breed (minted with the breed forced as the main breed, the
 * same rarity, season 1: what packs, starters and Club runners are) races 8-runner fields
 * through the real engine:
 *   - "fitted": every race is filled with horses whose best trip is within 300 m of the race and
 *     whose surface suits it (how players actually enter Live races);
 *   - "open": random runners at random conditions (no choosing; niche breeds lose here).
 * The report prints each breed's win rate against 1/8 and its mean shape (potential stats, size,
 * MSTN types), plus bred foals' size spread. Spec band: every breed within 1/n ± 3 points.
 * Breed signatures (strengths and weaknesses, G3) are not in the game yet, so they are not here.
 */
import { it } from "vitest";
import type { Going, Surface } from "@thoroughbred/shared";
import { simulateRace } from "../../packages/racing-engine/src/index";
import {
  BREEDS,
  BREED_LABEL,
  CARE_TO_RACING,
  Rng,
  createHorseState,
  deriveSeed,
  generateFoundationGenome,
  inherit,
  mstnType,
  overallPotential,
  potentials,
  preferredDistanceM,
  preferredSurface,
  raceSnapshot,
  runningStyle,
  sizePermille,
  type Breed,
  type HorseState,
} from "../../packages/game-core/src/index";
import { writeReport, yieldNow } from "./out";

const RACES = Number(process.env.BAL_BREED_RACES ?? 1500);
const PER_BREED = 150;
const FIELD = 8;
const DISTANCES = [1000, 1200, 1400, 1600, 2000, 2400, 2800];
const SURFACES: Surface[] = ["turf", "dirt", "synthetic"];
const GOINGS: Going[] = ["good", "good", "firm", "soft"];
const SILKS = { primary: "#112233", secondary: "#ffffff", pattern: "hoops", cap: "#aa0000" } as const;
const T0 = 1_800_000_000_000;

function horse(breed: Breed, i: number): HorseState {
  const genome = generateFoundationGenome(`breeds-${breed}-${i}`, { season: 1, rarity: "rare", breed });
  const h = createHorseState({ id: `${breed}-${i}`, name: `${breed} ${i}`.slice(0, 32), sex: i % 2 ? "colt" : "filly", ownerId: "bal", sireId: null, damId: null, generation: 0, genome, bornAtMs: T0, bornSeason: 1, careSessions: CARE_TO_RACING });
  // Mid-career and fully trained: every horse at its peak, so only genes differ.
  const full = { speed: 1000, stamina: 1000, burst: 1000, durability: 1000, adaptability: 1000, temperament: 1000 };
  return { ...h, career: { ...h.career, starts: 14 }, training: { ...h.training, realisation: full } };
}

it("breeds report", async () => {
  const pool = BREEDS.flatMap((b) => Array.from({ length: PER_BREED }, (_, i) => horse(b, i)));
  const breedOf = new Map(pool.map((h) => [h.id, (h.id.split("-")[0] as Breed)]));
  const rng = new Rng("breeds-report");
  const tally = (mode: "fitted" | "open") => {
    const starts = new Map<Breed, number>();
    const wins = new Map<Breed, number>();
    return { mode, starts, wins };
  };
  const modes = [tally("fitted"), tally("open")];
  for (let r = 0; r < RACES; r++) {
    for (const m of modes) {
      const distanceM = rng.pick(DISTANCES);
      const surface = rng.pick(SURFACES);
      const going: Going = surface === "synthetic" ? "good" : rng.pick(GOINGS);
      const fits = m.mode === "open" ? pool : pool.filter((h) => Math.abs(preferredDistanceM(h.genome) - distanceM) <= 300 && [surface, "synthetic"].includes(preferredSurface(h.genome)));
      if (fits.length < FIELD) continue;
      const runners: HorseState[] = [];
      while (runners.length < FIELD) {
        const h = rng.pick(fits);
        if (!runners.includes(h)) runners.push(h);
      }
      const entries = runners.map((h, i) => {
        const snap = raceSnapshot(h, { nowMs: T0, silks: SILKS, race: { going, fieldSize: FIELD, bigCrowd: false, surface, distanceM }, plan: { tactic: runningStyle(h.genome), intensity: "normal" } }).horse;
        return { gate: i + 1, tactic: snap.style, horse: snap };
      });
      const replay = simulateRace({
        race: { id: `br-${m.mode}-${r}`, name: "Breeds", distanceM, surface, weather: "clear", going, raceClass: "listed", postTimeMs: T0, purse: 0 },
        entries,
        seed: deriveSeed("breeds-report", `${m.mode}:${r}`),
      });
      const winner = replay.result.finishOrder.find((f) => f.position === 1)!.horseId;
      for (const h of runners) {
        const b = breedOf.get(h.id)!;
        m.starts.set(b, (m.starts.get(b) ?? 0) + 1);
        if (h.id === winner) m.wins.set(b, (m.wins.get(b) ?? 0) + 1);
      }
    }
    if (r % 50 === 0) await yieldNow();
  }

  const pct = (x: number) => (x * 100).toFixed(1).padStart(5);
  const lines = [`# Breed balance: win rate in 8-runner fields (1/8 = 12.5%), ${RACES} races per mode, ${PER_BREED} rare mints per breed`];
  lines.push(`${"breed".padEnd(14)} fitted  open   overall  spd  sta  bur  dur  ada  tem  size%  sprinter/miler/stayer`);
  const data: Record<string, unknown> = {};
  for (const b of BREEDS) {
    const mine = pool.filter((h) => breedOf.get(h.id) === b);
    const mean = (f: (h: HorseState) => number) => mine.reduce((s, h) => s + f(h), 0) / mine.length;
    const pot = (k: keyof ReturnType<typeof potentials>) => Math.round(mean((h) => potentials(h.genome)[k]));
    const types = ["sprinter", "miler", "stayer"].map((t) => mine.filter((h) => mstnType(h.genome) === t).length);
    const rate = (m: (typeof modes)[number]) => (m.wins.get(b) ?? 0) / Math.max(1, m.starts.get(b) ?? 0);
    data[b] = { fitted: rate(modes[0]!), open: rate(modes[1]!), starts: modes.map((m) => m.starts.get(b) ?? 0), overall: mean((h) => overallPotential(h.genome)), size: mean((h) => sizePermille(h.genome) / 10) };
    lines.push(
      `${BREED_LABEL[b].padEnd(14)} ${pct(rate(modes[0]!))}% ${pct(rate(modes[1]!))}%  ${mean((h) => overallPotential(h.genome)).toFixed(1)}  ${(["speed", "stamina", "burst", "durability", "adaptability", "temperament"] as const).map((k) => String(pot(k)).padStart(4)).join(" ")}  ${mean((h) => sizePermille(h.genome) / 10).toFixed(1).padStart(5)}  ${types.join("/")}`,
    );
  }

  // Bred foals: size and its stat effect show in foals (mints absorb it into their planned stats).
  lines.push("", "# Purebred foals (two mints of the breed): size spread and mean potential speed/burst");
  for (const b of BREEDS) {
    const mine = pool.filter((h) => breedOf.get(h.id) === b);
    const sizes: number[] = [];
    let spd = 0;
    let bur = 0;
    for (let i = 0; i + 1 < mine.length; i += 2) {
      const f = inherit(mine[i]!.genome, mine[i + 1]!.genome, `breeds-foal-${b}-${i}`);
      sizes.push(Math.trunc(sizePermille(f) / 10));
      spd += potentials(f).speed;
      bur += potentials(f).burst;
    }
    sizes.sort((x, y) => x - y);
    lines.push(`${BREED_LABEL[b].padEnd(14)} size ${sizes[0]}..${sizes[sizes.length - 1]}% (median ${sizes[sizes.length >> 1]}%)  speed ${Math.round(spd / sizes.length)}  burst ${Math.round(bur / sizes.length)}`);
  }
  writeReport("breeds", data, lines);
});
