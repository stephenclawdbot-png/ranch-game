/**
 * The season loop. One in-memory PGlite database, the simulated clock advanced one card slot
 * (RULES.slotMs) at a time:
 *
 *   for each step t:
 *     driveCard(t, force + maintenance)        ← exactly what the cron route does every minute
 *     at each midnight (UTC): sample the day that just ended
 *     every agent visit due in [t, t + step): visit(agent, its own instant)
 *
 * Races are published, locked (house runners fill the gates), simulated by the racing engine
 * and settled by game.ts's own driveCard / settleIfDue; nothing is shortcut.
 */
import { ENGINE_VERSION } from "@thoroughbred/racing-engine";
import { createDb, RULES, seasonNumberAt, utcDay } from "@thoroughbred/db";
import { driveCard } from "@/server/game";
import { foundAgent, visit, visitsOn, World, type Agent, type UnexpectedError } from "./agents";
import { COHORTS, type HarnessConfig } from "./config";
import { installDeterministicRandom } from "./determinism";
import { activity, checks, claimingTotals, createCohortTable, farmerReport, leasingTotals, notables, outcomes, sampleDay, snapshot, type ByCohort, type Checks, type CohortOutcome, type DaySample, type ClaimingTotals, type FarmerReport, type LeasingTotals, type Snapshot } from "./metrics";
import { median, sum } from "./stats";

const DAY = 86_400_000;

export interface RunMeta {
  tag: string;
  seed: string;
  days: number;
  stables: number;
  cohorts: HarnessConfig["cohorts"];
  altsPerMain: number;
  detectedFarmerGroups: number;
  start: string;
  season: number;
  stepMs: number;
  /** Game schedule as read from the code at run time. */
  slotMs: number;
  cardHorizonMs: number;
  engineVersion: string;
  runtimeMs: number;
  /** Wall time split: card driving, agent visits by cohort, metric sampling. */
  timing: Record<string, number>;
  finishedAt: string;
}

export interface Totals {
  created: Record<string, number>;
  destroyed: Record<string, number>;
  transfers: Record<string, number>;
  liveRaces: number;
  liveRacesWithPlayers: number;
  /** Ordinary card races called off at the close with no player runner (0 in runs before the race meetings). */
  liveRacesCalledOff?: number;
  avgField: number;
  playerShare: number;
  /** Live races won by a player horse (absent in runs before the Club fill fix). */
  livePlayerWins?: number;
  /** Player runners in settled Live races (absent in runs before the Club fill fix). */
  livePlayerRunners?: number;
  /** Median winner-to-last spread and winning margin of settled Live races, mm (absent before 2026-10-30). */
  liveSpreadMedianMm?: number;
  liveWinMarginMedianMm?: number;
  storyRaces: number;
  cupRuns: number;
  born: Record<string, number>;
  retired: Record<string, number>;
  legacy: number;
  died: number;
  covers: number;
  foals: number;
  potential: { below: number; between: number; above: number };
  listings: number;
  sales: number;
  marketVolume: number;
  fqPlayerRunners: number;
  fqQualifiers: number;
  wfPlayerRunners: number;
  injuries: Record<string, number>;
  trainingInjuries: number;
  /** Horse leasing over the run (packages/db leasing.ts). */
  leasing?: LeasingTotals;
  /** Claiming races over the run (packages/db claiming.ts). */
  claiming?: ClaimingTotals;
}

export interface RunResult {
  meta: RunMeta;
  days: DaySample[];
  totals: Totals;
  outcomes: ByCohort<CohortOutcome>;
  farmers: FarmerReport;
  /** Player runs in calendar races and the top-rated player horses at the end. */
  notables: Awaited<ReturnType<typeof notables>>;
  checks: Checks;
  activity: ReturnType<typeof activity>;
  errors: UnexpectedError[];
}

/** Clears the per-instance caches game.ts and friends keep on globalThis (a fresh server). */
function freshServer(): void {
  const g = globalThis as Record<string, unknown>;
  // game.ts and competition.ts hold these objects from module load: reset them in place.
  if (g.__tbTick) Object.assign(g.__tbTick, { at: 0, inflight: null });
  if (g.__tbHall) Object.assign(g.__tbHall, { at: 0 });
  for (const k of ["__tbGiftDone", "__tbHouseStudsAt", "__tbPopulation", "__tbLeaseSweepAt"]) delete g[k];
}

function addInto(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

function totalsOf(days: DaySample[], last: Snapshot): Totals {
  const injuries: Record<string, number> = {};
  for (const d of days) addInto(injuries, d.injuries.live);
  const live = sum(days.map((d) => d.races.live));
  return {
    created: last.created,
    destroyed: last.destroyed,
    transfers: last.transfers,
    liveRaces: live,
    liveRacesWithPlayers: sum(days.map((d) => d.races.liveWithPlayers)),
    liveRacesCalledOff: sum(days.map((d) => d.races.calledOff ?? 0)),
    avgField: live ? Math.round((10 * sum(days.map((d) => d.races.avgField * d.races.live))) / live) / 10 : 0,
    playerShare: live ? Math.round((10 * sum(days.map((d) => d.races.playerShare * d.races.live * d.races.avgField))) / Math.max(1, sum(days.map((d) => d.races.live * d.races.avgField)))) / 10 : 0,
    livePlayerWins: sum(days.map((d) => d.races.playerWins ?? 0)),
    livePlayerRunners: sum(days.map((d) => d.races.playerRunners ?? 0)),
    liveSpreadMedianMm: median(days.flatMap((d) => d.races.spreadsMm ?? [])),
    liveWinMarginMedianMm: median(days.flatMap((d) => d.races.winMarginsMm ?? [])),
    storyRaces: sum(days.map((d) => d.races.story)),
    cupRuns: sum(days.map((d) => d.races.cup)),
    born: last.born,
    retired: last.retired,
    legacy: last.legacy,
    died: last.died,
    covers: sum(days.map((d) => d.breeding.covers)),
    foals: last.foals,
    potential: last.potential,
    listings: sum(days.map((d) => d.market.listed)),
    sales: sum(days.map((d) => d.market.sold)),
    marketVolume: sum(days.map((d) => d.market.volume)),
    fqPlayerRunners: sum(days.map((d) => d.features.fqPlayerRunners)),
    fqQualifiers: sum(days.map((d) => d.features.fqQualifiers)),
    wfPlayerRunners: sum(days.map((d) => d.features.wfPlayerRunners)),
    injuries,
    trainingInjuries: last.trainingInjuries,
  };
}

interface Visit {
  atMs: number;
  agent: Agent;
  first: boolean;
  last: boolean;
}

function scheduleDay(world: World, dayStartMs: number): Visit[] {
  const out: Visit[] = [];
  for (const a of world.agents) {
    const times = visitsOn(world, a, dayStartMs);
    times.forEach((atMs, i) => out.push({ atMs, agent: a, first: i === 0, last: i === times.length - 1 }));
  }
  return out.sort((x, y) => x.atMs - y.atMs || x.agent.index - y.agent.index);
}

export async function runSeason(cfg: HarnessConfig, log: (line: string) => void = () => undefined): Promise<RunResult> {
  installDeterministicRandom(cfg.seed);
  freshServer();
  const wallStart = Date.now();
  const handle = await createDb({ url: null, pglite: "memory" });
  // A second stream from here on, once the database has booted (migrations) and served a first
  // query: PGlite draws randomness only the first time its runtime loads in a process, which
  // would otherwise shift a second run in the same process (the smoke test). It must differ
  // from the boot stream, or the UUIDs the migrations drew would come round again.
  await handle.db.execute("select gen_random_uuid()");
  installDeterministicRandom(`${cfg.seed}:run`);
  try {
    const world = new World(handle.db, cfg.seed);
    const start = new Date(cfg.startMs);
    const end = cfg.startMs + cfg.days * DAY;
    const empty = await snapshot(world);

    // Found every stable (POST /api/account's path) at the start of the season.
    let index = 0;
    for (const cohort of COHORTS) {
      if (cohort === "farmer") continue;
      for (let i = 0; i < cfg.cohorts[cohort]; i++) world.agents.push(await foundAgent(world, { index: index++, cohort, group: null, role: null, detected: false, now: start }));
    }
    const groups = cfg.cohorts.farmer / (cfg.altsPerMain + 1);
    for (let g = 0; g < groups; g++) {
      const detected = g < cfg.detectedFarmerGroups;
      for (let i = 0; i <= cfg.altsPerMain; i++) {
        world.agents.push(await foundAgent(world, { index: index++, cohort: "farmer", group: g, role: i === 0 ? "main" : "alt", detected, now: start }));
      }
    }
    await createCohortTable(world);
    const mainOf = new Map(world.agents.filter((a) => a.role === "main").map((a) => [a.group!, a]));
    log(`founded ${world.agents.length} stables at ${start.toISOString()} (season ${seasonNumberAt(start)}); slot ${RULES.slotMs / 60_000} min, step ${cfg.stepMs / 60_000} min, ${cfg.days} days`);

    const days: DaySample[] = [];
    let prev = empty;
    let visits = scheduleDay(world, cfg.startMs);
    let dayStart = cfg.startMs;
    let dayWall = Date.now();
    const timing: Record<string, number> = { drive: 0, sample: 0, casual: 0, grinder: 0, breeder: 0, farmer: 0 };
    const timed = async <T>(k: string, f: () => Promise<T>): Promise<T> => {
      const t0 = Date.now();
      try {
        return await f();
      } finally {
        timing[k] = (timing[k] ?? 0) + Date.now() - t0;
      }
    };
    for (let t = cfg.startMs; ; t = Math.min(t + cfg.stepMs, end)) {
      const now = new Date(t);
      try {
        await timed("drive", () => driveCard(world.db, now, { force: true, maintenance: true }));
      } catch (e) {
        world.errors.push({ atMs: t, agent: "(card)", action: "driveCard", message: e instanceof Error ? e.message : String(e) });
      }
      while (t >= dayStart + DAY) {
        const cur = await timed("sample", () => snapshot(world));
        const sample = await timed("sample", () => sampleDay(world, days.length + 1, dayStart, dayStart + DAY, prev, cur));
        days.push(sample);
        prev = cur;
        log(
          `day ${sample.day} ${sample.date}: ${sample.races.live} Live races (avg field ${sample.races.avgField}, players ${sample.races.playerShare}%), ` +
            `${sample.races.story} Story, created ${sample.credits.createdTotal.toLocaleString("en-GB")} / destroyed ${sample.credits.destroyedTotal.toLocaleString("en-GB")}, ` +
            `${world.errors.length} errors, ${((Date.now() - dayWall) / 1000).toFixed(1)} s (${Object.entries(timing).map(([k, v]) => `${k} ${Math.round(v / 1000)}`).join(", ")} s so far)`,
        );
        dayWall = Date.now();
        dayStart += DAY;
        if (dayStart < end) visits = visits.concat(scheduleDay(world, dayStart));
      }
      if (t >= end) break;
      const next = Math.min(t + cfg.stepMs, end);
      const due = visits.filter((v) => v.atMs < next);
      visits = visits.filter((v) => v.atMs >= next);
      for (const v of due) {
        const at = new Date(Math.max(t, v.atMs));
        try {
          await timed(v.agent.cohort, () => visit(world, v.agent, at, v.first, v.last, v.agent.role === "alt" ? (mainOf.get(v.agent.group!) ?? null) : null));
        } catch (e) {
          world.errors.push({ atMs: at.getTime(), agent: v.agent.name, action: "visit", message: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    // A run that ends mid-day (the smoke test) samples the part-day too.
    if (dayStart < end) {
      const cur = await snapshot(world);
      days.push(await sampleDay(world, days.length + 1, dayStart, end, prev, cur));
      prev = cur;
    }
    const last = await snapshot(world);
    const result: RunResult = {
      meta: {
        tag: cfg.tag,
        seed: cfg.seed,
        days: cfg.days,
        stables: world.agents.length,
        cohorts: cfg.cohorts,
        altsPerMain: cfg.altsPerMain,
        detectedFarmerGroups: cfg.detectedFarmerGroups,
        start: start.toISOString(),
        season: seasonNumberAt(start),
        stepMs: cfg.stepMs,
        slotMs: RULES.slotMs,
        cardHorizonMs: RULES.cardHorizonMs,
        engineVersion: ENGINE_VERSION,
        runtimeMs: Date.now() - wallStart,
        timing,
        finishedAt: utcDay(new Date()),
      },
      days,
      totals: { ...totalsOf(days, last), leasing: await leasingTotals(world), claiming: await claimingTotals(world) },
      outcomes: await outcomes(world),
      farmers: await farmerReport(world),
      notables: await notables(world),
      checks: await checks(world, last),
      activity: activity(world),
      errors: world.errors.slice(0, 200),
    };
    result.meta.runtimeMs = Date.now() - wallStart;
    return result;
  } finally {
    await handle.close();
  }
}
