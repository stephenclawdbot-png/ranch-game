/**
 * Monte Carlo population model: many players over many competition seasons, using the real
 * game-core rules (minting, packs + pity + limits, care-gated growth, career clock, breeding
 * limits, kin blocks, COI, inheritance, stall caps, nursery overflow, Legacy Farm, release to
 * Club). Racing is abstracted to "starts per active day" — genetics and population only.
 *
 * Reports how fast the top end rises (first B/A/S-grade horse: season and generation), the
 * population mean, and the active population per player over time.
 *
 *   pnpm --filter @thoroughbred/game-core sim     # full report (src/sim/report.test.ts)
 */
import type { HorseState, PedigreeIndex, PityState, StatKey } from "../types";
import { STAT_KEYS } from "../types";
import { meanPotential, potentials, locusValue, INBREEDING_AFFECTED, INBREEDING_DEPRESSION_PERMILLE } from "../genome";
import { coiOf, kinBlock } from "../genetics";
import { CARE_TO_RACING, CAREER_MAX_STARTS, BREED_FROM_STARTS, createHorseState, isFemale, normaliseLocation, pensionHorse, recordCare, retireFromRacing, settleIdle, stageOf } from "../lifecycle";
import { breedingEligibility, cover, deliverFoal } from "../breeding";
import { NEW_PITY, packBlock, packBinding, pullPack, pullSex, PADDOCK_CREDIT_BUYS_PER_WEEK, type PackMode } from "../packs";
import { MAX_STALLS } from "../economy";
import { MS_PER_DAY, SEASON_DAYS, seasonOf, weekIndex } from "../time";
import { Rng, seedFrom } from "../rng";
import { gradeOf } from "../genome";

export type Archetype = "casual" | "active" | "breeder";

export interface ArchetypeProfile {
  /** Chance (permille) of playing on a given day. */
  playPermille: number;
  /** Starts per racing horse per play day (fractional allowed, max 3). */
  startsPerDay: number;
  maxRacers: number;
  /** Bought paddock packs per week (≤ 3). */
  paddockBuysPerWeek: number;
  /** Stall upgrades: +1 every N play days, up to `maxStalls`. */
  stallEveryDays: number;
  maxStalls: number;
  /** Stallion candidates considered from the stud market. */
  studCandidates: number;
  /** Retire promising youngsters at racing age to breed immediately (top share of the stable). */
  earlyRetireTopPermille: number;
  /** Chance per eligible mare per play day of arranging a covering. */
  breedPermille: number;
}

export const ARCHETYPES: Record<Archetype, ArchetypeProfile> = {
  casual: { playPermille: 450, startsPerDay: 1, maxRacers: 2, paddockBuysPerWeek: 0, stallEveryDays: 0, maxStalls: 6, studCandidates: 5, earlyRetireTopPermille: 0, breedPermille: 300 },
  active: { playPermille: 850, startsPerDay: 1.2, maxRacers: 4, paddockBuysPerWeek: 1, stallEveryDays: 14, maxStalls: 12, studCandidates: 20, earlyRetireTopPermille: 200, breedPermille: 800 },
  breeder: { playPermille: 970, startsPerDay: 1.5, maxRacers: 5, paddockBuysPerWeek: 3, stallEveryDays: 7, maxStalls: MAX_STALLS, studCandidates: 40, earlyRetireTopPermille: 500, breedPermille: 1000 },
};

export interface SimConfig {
  seed: string;
  players: number;
  seasons: number;
  /** Share of each archetype (permille, sums to 1000). */
  mix: Record<Archetype, number>;
  /** Pack-foal crop cap per season, per player in the sim (10,000 global ≈ 3 per player at ~3.3k players). */
  cropCapPerPlayer: number;
  /** New players joining per season (as a share of the starting count, permille). */
  joinPermillePerSeason: number;
}

export const DEFAULT_SIM: SimConfig = {
  seed: "pop-sim-v1",
  players: 400,
  seasons: 10,
  mix: { casual: 500, active: 350, breeder: 150 },
  cropCapPerPlayer: 3,
  joinPermillePerSeason: 100,
};

interface SimPlayer {
  id: string;
  archetype: Archetype;
  horses: HorseState[];
  stalls: number;
  playDays: number;
  freeClaimed: number;
  pity: PityState;
  boughtWeek: number;
  boughtThisWeek: number;
  counter: number;
  joinedDay: number;
}

export interface SeasonRow {
  season: number;
  players: number;
  /** Horses in stalls + nursery per player (the active population). */
  activePerPlayer: number;
  maxActive: number;
  legacyPerPlayer: number;
  releasedTotal: number;
  foalsBred: number;
  packFoals: number;
  bestMean: number;
  bestGeneration: number;
  top1Mean: number;
  popMean: number;
  maxGeneration: number;
  meanCoi: number;
}

export interface SimReport {
  config: SimConfig;
  rows: SeasonRow[];
  /** First time a horse with mean potential ≥ grade floor appeared: season, day, generation. */
  firsts: Partial<Record<"B" | "A" | "S", { season: number; day: number; generation: number }>>;
  /** Best mean potential by generation (over the whole run). */
  bestByGeneration: number[];
}

const GRADE_FLOOR = { B: 700, A: 800, S: 900 } as const;

/** Expected foal mean potential and its standard deviation (independent loci, exact per locus). */
export function foalOutlook(sire: HorseState, dam: HorseState, coi: number): { expected: number; sd: number } {
  let mean = 0;
  let variance = 0;
  for (const k of STAT_KEYS) {
    const vals: number[] = [];
    for (const a of sire.genome.stats[k]) for (const b of dam.genome.stats[k]) {
      let v = locusValue([a, b]);
      if (coi > 0 && INBREEDING_AFFECTED.includes(k as StatKey)) v -= Math.floor((v * coi * INBREEDING_DEPRESSION_PERMILLE) / 1_000_000);
      vals.push(v);
    }
    const m = (vals[0]! + vals[1]! + vals[2]! + vals[3]!) / 4;
    mean += m / 6;
    variance += vals.reduce((s, v) => s + (v - m) * (v - m), 0) / 4 / 36;
  }
  return { expected: mean, sd: Math.sqrt(variance) };
}

export function runPopulationSim(cfg: SimConfig = DEFAULT_SIM): SimReport {
  const rng = new Rng(cfg.seed);
  const epochMs = 1_800_000_000_000 - (1_800_000_000_000 % MS_PER_DAY);
  const clock = { epochMs };
  const ped: Record<string, { sireId: string | null; damId: string | null; generation: number }> = {};
  const byId = new Map<string, HorseState>();
  const players: SimPlayer[] = [];
  const rows: SeasonRow[] = [];
  const firsts: SimReport["firsts"] = {};
  const bestByGeneration: number[] = [];
  let released = 0;
  let foalsBred = 0;
  let packFoals = 0;
  let cropUsed = 0;
  let cropSeason = 1;

  const pickArchetype = (): Archetype => {
    const r = rng.int(1000);
    return r < cfg.mix.casual ? "casual" : r < cfg.mix.casual + cfg.mix.active ? "active" : "breeder";
  };
  const track = (h: HorseState) => {
    byId.set(h.id, h);
    ped[h.id] = { sireId: h.sireId, damId: h.damId, generation: h.generation };
    const m = meanPotential(h.genome);
    while (bestByGeneration.length <= h.generation) bestByGeneration.push(0);
    if (m > bestByGeneration[h.generation]!) bestByGeneration[h.generation] = m;
  };
  const update = (p: SimPlayer, h: HorseState) => {
    const i = p.horses.findIndex((x) => x.id === h.id);
    if (i >= 0) p.horses[i] = h;
    byId.set(h.id, h);
  };
  const inStalls = (p: SimPlayer) => p.horses.filter((h) => h.location === "stable").length;
  const nursery = (p: SimPlayer) => p.horses.filter((h) => h.location === "nursery").length;
  const pendingFoals = (p: SimPlayer) => p.horses.filter((h) => h.pregnancy).length;

  const addPlayer = (day: number) => {
    const id = `p${players.length}`;
    const p: SimPlayer = { id, archetype: pickArchetype(), horses: [], stalls: 6, playDays: 0, freeClaimed: 0, pity: { ...NEW_PITY }, boughtWeek: -1, boughtThisWeek: 0, counter: 0, joinedDay: day };
    // Starters: 3 race-ready Club-bred horses, minted under the ceiling via the same path as packs.
    const season = seasonOf(clock, epochMs + day * MS_PER_DAY);
    for (let i = 0; i < 3; i++) {
      const { pull } = pullPack("paddock", { ...NEW_PITY, pulls: i }, { serverSeed: seedFrom(cfg.seed, "starter"), accountId: id, season });
      const h = createHorseState({ id: `${id}-h${p.counter++}`, name: "Starter", sex: i === 1 ? "filly" : i === 0 ? "colt" : pullSex(pull), ownerId: id, sireId: null, damId: null, generation: 0, genome: pull.genome, bornAtMs: epochMs, bornSeason: season, binding: "club_bred", careSessions: CARE_TO_RACING });
      p.horses.push(h);
      track(h);
    }
    players.push(p);
  };
  for (let i = 0; i < cfg.players; i++) addPlayer(0);

  const days = cfg.seasons * SEASON_DAYS;
  for (let day = 0; day < days; day++) {
    const nowMs = epochMs + day * MS_PER_DAY + 12 * 3_600_000;
    const season = seasonOf(clock, nowMs);
    if (season !== cropSeason) {
      cropSeason = season;
      cropUsed = 0;
    }
    if (day > 0 && day % SEASON_DAYS === 0) {
      const joins = Math.round((cfg.players * cfg.joinPermillePerSeason) / 1000);
      for (let i = 0; i < joins; i++) addPlayer(day);
    }
    const cropCap = cfg.cropCapPerPlayer * players.length;
    // Stud market: eligible stallions this season, best first.
    const studs = [...byId.values()]
      .filter((h) => !isFemale(h.sex) && h.location !== "club" && breedingEligibility(h, season) === null)
      .map((h) => ({ h, m: meanPotential(h.genome) }))
      .sort((a, b) => b.m - a.m || (a.h.id < b.h.id ? -1 : 1));

    for (const p of players) {
      const prof = ARCHETYPES[p.archetype];
      // Idle settlement happens for everyone (healing, pregnancies) — never anything else.
      for (const h of [...p.horses]) {
        const { state, events } = settleIdle(h, nowMs);
        if (state !== h) update(p, state);
        if (events.foalDue && state.pregnancy) {
          const sire = byId.get(state.pregnancy.sireId)!;
          const free = inStalls(p) < p.stalls;
          const { dam, foal } = deliverFoal(state, sire, { foalId: `${p.id}-h${p.counter++}`, name: "Foal", nowMs, season, stallFree: free });
          update(p, dam);
          p.horses.push(foal);
          track(foal);
          foalsBred++;
        }
      }
      if (rng.int(1000) >= prof.playPermille) continue;
      p.playDays++;

      // Nursery foals move into free stalls.
      for (const h of p.horses) if (h.location === "nursery" && inStalls(p) < p.stalls) update(p, { ...h, location: "stable" });

      // Care every horse (one counted session per day).
      for (const h of [...p.horses]) if (h.location !== "legacy_farm" && h.location !== "club" && h.care.sessions < CARE_TO_RACING + 1) update(p, recordCare(h, "growth_mix", nowMs).state);

      // Racing: the best racing-age horses run (career clock).
      const racers = p.horses
        .filter((h) => h.location === "stable" && stageOf(h) !== "stud" && stageOf(h) !== "pasture" && h.care.sessions >= CARE_TO_RACING && !h.career.racingRetired && !h.pregnancy)
        .sort((a, b) => meanPotential(b.genome) - meanPotential(a.genome))
        .slice(0, prof.maxRacers);
      for (const h of racers) {
        let n = Math.floor(prof.startsPerDay);
        if (rng.int(1000) < Math.round((prof.startsPerDay - n) * 1000)) n++;
        let next: HorseState = { ...h, career: { ...h.career, starts: Math.min(CAREER_MAX_STARTS, h.career.starts + n) } };
        if (next.career.starts >= CAREER_MAX_STARTS) next = retireFromRacing(next, "max_starts");
        update(p, next);
      }

      // Early retirement to stud for the most promising youngsters (breeders).
      if (prof.earlyRetireTopPermille > 0) {
        const young = p.horses.filter((h) => h.location === "stable" && h.care.sessions >= CARE_TO_RACING && !h.career.racingRetired && h.career.starts < BREED_FROM_STARTS);
        const all = p.horses.filter((h) => h.location === "stable").map((h) => meanPotential(h.genome)).sort((a, b) => b - a);
        const cut = all[Math.max(0, Math.floor((all.length * prof.earlyRetireTopPermille) / 1000) - 1)] ?? 1000;
        for (const h of young) if (meanPotential(h.genome) >= cut) update(p, retireFromRacing(h, "choice"));
      }

      // Breeding: each eligible mare (within capacity: stalls + one nursery overflow).
      const mares = p.horses.filter((h) => isFemale(h.sex) && h.location === "stable" && breedingEligibility(h, season) === null);
      for (const mare of mares) {
        if (inStalls(p) + nursery(p) + pendingFoals(p) >= p.stalls + 1) break;
        if (rng.int(1000) >= prof.breedPermille) continue;
        const cands = studs.slice(0, prof.studCandidates).map((s) => s.h);
        for (const own of p.horses) if (!isFemale(own.sex) && breedingEligibility(own, season) === null && !cands.includes(own)) cands.push(own);
        let best: { h: HorseState; score: number } | null = null;
        for (const c of cands) {
          const live = byId.get(c.id)!;
          if (breedingEligibility(live, season) !== null) continue;
          if (kinBlock(live.id, mare.id, ped as PedigreeIndex)) continue;
          const coi = p.archetype === "casual" ? 0 : coiOf(live.id, mare.id, ped as PedigreeIndex);
          const o = foalOutlook(live, mare, coi);
          const score = o.expected + (p.archetype === "breeder" ? 0.8 * o.sd : 0);
          if (!best || score > best.score) best = { h: live, score };
        }
        if (!best) continue;
        const res = cover(best.h, mare, ped as PedigreeIndex, season, nowMs, `${cfg.seed}-${day}`);
        update(p, res.dam);
        const owner = players.find((q) => q.id === best!.h.ownerId);
        if (owner) update(owner, res.sire);
        else byId.set(res.sire.id, res.sire);
      }

      // Stall upgrades.
      if (prof.stallEveryDays > 0 && p.playDays % prof.stallEveryDays === 0 && p.stalls < prof.maxStalls) p.stalls++;

      // Housekeeping: pension spent horses; when full, breeders release their weakest unraced youngster.
      for (const h of [...p.horses]) {
        const st = stageOf(h);
        if (st === "pasture" && h.location === "stable") update(p, normaliseLocation(h));
        // Retired horses that won't breed again (no good mates) are pensioned when space is needed.
      }
      if (inStalls(p) >= p.stalls && p.archetype !== "casual") {
        const pool = p.horses.filter((h) => h.location === "stable" && !h.pregnancy && h.binding !== "club_bred");
        const weakest = pool.sort((a, b) => meanPotential(a.genome) - meanPotential(b.genome))[0];
        if (weakest && meanPotential(weakest.genome) < 520) {
          update(p, { ...weakest, ownerId: "club", location: "club" });
          released++;
        } else {
          const retired = p.horses.filter((h) => h.location === "stable" && h.career.racingRetired && !h.pregnancy).sort((a, b) => meanPotential(a.genome) - meanPotential(b.genome))[0];
          if (retired) update(p, pensionHorse(retired));
        }
      }
      if (inStalls(p) >= p.stalls && p.archetype === "casual") {
        const retired = p.horses.find((h) => h.location === "stable" && h.career.racingRetired && !h.pregnancy);
        if (retired) update(p, pensionHorse(retired));
      }

      // Packs: free paddock every 3rd play day, bought paddocks up to the weekly quota.
      const week = weekIndex(nowMs);
      if (p.boughtWeek !== week) {
        p.boughtWeek = week;
        p.boughtThisWeek = 0;
      }
      const tryPack = (mode: PackMode) => {
        const block = packBlock(mode, {
          playDays: p.playDays,
          freePaddockClaimed: p.freeClaimed,
          paddockBoughtThisWeek: p.boughtThisWeek,
          premiumThisWeek: 0,
          seasonCropUsed: cropUsed,
          seasonCropCap: cropCap,
          stallsFree: p.stalls - inStalls(p) - nursery(p) - pendingFoals(p),
          credits: 1_000_000,
          premiumAllowedInRegion: true,
        });
        if (block) return false;
        const { pull, pity } = pullPack("paddock", p.pity, { serverSeed: seedFrom(cfg.seed, "packs"), accountId: p.id, season });
        p.pity = pity;
        const h = createHorseState({ id: `${p.id}-h${p.counter++}`, name: "Pack Foal", sex: pullSex(pull), ownerId: p.id, sireId: null, damId: null, generation: 0, genome: pull.genome, bornAtMs: nowMs, bornSeason: season, binding: packBinding(mode) });
        p.horses.push(h);
        track(h);
        cropUsed++;
        packFoals++;
        if (mode === "free") p.freeClaimed++;
        else p.boughtThisWeek++;
        return true;
      };
      tryPack("free");
      for (let i = 0; i < Math.min(PADDOCK_CREDIT_BUYS_PER_WEEK, prof.paddockBuysPerWeek); i++) if (p.boughtThisWeek < prof.paddockBuysPerWeek) tryPack("credits");
    }

    // Records.
    for (const h of byId.values()) {
      const m = meanPotential(h.genome);
      for (const g of ["B", "A", "S"] as const) {
        if (!firsts[g] && m >= GRADE_FLOOR[g]) firsts[g] = { season, day, generation: h.generation };
      }
    }

    if ((day + 1) % SEASON_DAYS === 0) {
      const all = [...byId.values()];
      const owned = all.filter((h) => h.location !== "club");
      const active = players.map((p) => p.horses.filter((h) => h.location === "stable" || h.location === "nursery").length);
      const means = owned.map((h) => meanPotential(h.genome)).sort((a, b) => b - a);
      const bestH = owned.reduce((a, b) => (meanPotential(b.genome) > meanPotential(a.genome) ? b : a));
      const bred = owned.filter((h) => h.generation > 0);
      rows.push({
        season,
        players: players.length,
        activePerPlayer: Math.round((active.reduce((a, b) => a + b, 0) / players.length) * 10) / 10,
        maxActive: Math.max(...active),
        legacyPerPlayer: Math.round((owned.filter((h) => h.location === "legacy_farm").length / players.length) * 10) / 10,
        releasedTotal: released,
        foalsBred,
        packFoals,
        bestMean: means[0] ?? 0,
        bestGeneration: bestH.generation,
        top1Mean: Math.round(means.slice(0, Math.max(1, Math.floor(means.length / 100))).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(means.length / 100))),
        popMean: Math.round(means.reduce((a, b) => a + b, 0) / Math.max(1, means.length)),
        maxGeneration: Math.max(...owned.map((h) => h.generation)),
        meanCoi: bred.length ? Math.round(bred.reduce((a, h) => a + h.genome.coi, 0) / bred.length) : 0,
      });
    }
  }
  return { config: cfg, rows, firsts, bestByGeneration };
}

/** Plain-text table for the README / console. */
export function formatReport(r: SimReport): string {
  const lines = [
    `players ${r.config.players} (+${r.config.joinPermillePerSeason / 10}%/season), mix casual/active/breeder ${r.config.mix.casual}/${r.config.mix.active}/${r.config.mix.breeder}‰, crop cap ${r.config.cropCapPerPlayer}/player/season`,
    "season players active/pl maxActive legacy/pl released foalsBred packFoals best(gen) top1% popMean maxGen meanCOI‰",
  ];
  for (const x of r.rows) {
    lines.push(
      [x.season, x.players, x.activePerPlayer, x.maxActive, x.legacyPerPlayer, x.releasedTotal, x.foalsBred, x.packFoals, `${x.bestMean}(g${x.bestGeneration}) ${gradeOf(x.bestMean)}`, x.top1Mean, x.popMean, x.maxGeneration, x.meanCoi].join("  "),
    );
  }
  lines.push(`first B: ${fmt(r.firsts.B)}; first A: ${fmt(r.firsts.A)}; first S: ${fmt(r.firsts.S)}`);
  lines.push(`best mean potential by generation: ${r.bestByGeneration.map((v, g) => `g${g}=${v}`).join(" ")}`);
  return lines.join("\n");
}

function fmt(x: { season: number; day: number; generation: number } | undefined): string {
  return x ? `season ${x.season} (day ${x.day}), generation ${x.generation}` : "not reached";
}

export { potentials };
