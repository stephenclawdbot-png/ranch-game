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
import { activity, checks, createCohortTable, farmerReport, outcomes, sampleDay, snapshot, type ByCohort, type Checks, type CohortOutcome, type DaySample, type FarmerReport, type Snapshot } from "./metrics";
import { sum } from "./stats";

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
  finishedAt: string;
}

export interface Totals {
  created: Record<string, number>;
  destroyed: Record<string, number>;
  transfers: Record<string, number>;
  liveRaces: number;
  liveRacesWithPlayers: number;
  avgField: number;
  playerShare: number;
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
}

export interface RunResult {
  meta: RunMeta;
  days: DaySample[];
  totals: Totals;
  outcomes: ByCohort<CohortOutcome>;
  farmers: FarmerReport;
  checks: Checks;
  activity: ReturnType<typeof activity>;
  errors: UnexpectedError[];
}

/** Clears the per-instance caches game.ts and friends keep on globalThis (a fresh server). */
function freshServer(): void {
  const g = globalThis as Record<string, unknown>;
  for (const k of ["__tbTick", "__tbGiftDone", "__tbHouseStudsAt", "__tbPopulation", "__tbHall"]) delete g[k];
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
    avgField: live ? Math.round((10 * sum(days.map((d) => d.races.avgField * d.races.live))) / live) / 10 : 0,
    playerShare: live ? Math.round((10 * sum(days.map((d) => d.races.playerShare * d.races.live * d.races.avgField))) / Math.max(1, sum(days.map((d) => d.races.live * d.races.avgField)))) / 10 : 0,
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
    const times = visitsOn(a, dayStartMs);
    times.forEach((atMs, i) => out.push({ atMs, agent: a, first: i === 0, last: i === times.length - 1 }));
  }
  return out.sort((x, y) => x.atMs - y.atMs || x.agent.index - y.agent.index);
}

export async function runSeason(cfg: HarnessConfig, log: (line: string) => void = () => undefined): Promise<RunResult> {
  installDeterministicRandom(cfg.seed);
  freshServer();
  const wallStart = Date.now();
  const handle = await createDb({ url: null, pglite: "memory" });
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
    for (let t = cfg.startMs; t <= end; t += cfg.stepMs) {
      const now = new Date(t);
      try {
        await driveCard(world.db, now, { force: true, maintenance: true });
      } catch (e) {
        world.errors.push({ atMs: t, agent: "(card)", action: "driveCard", message: e instanceof Error ? e.message : String(e) });
      }
      while (t >= dayStart + DAY) {
        const cur = await snapshot(world);
        const sample = await sampleDay(world, days.length + 1, dayStart, dayStart + DAY, prev, cur);
        days.push(sample);
        prev = cur;
        log(
          `day ${sample.day} ${sample.date}: ${sample.races.live} Live races (avg field ${sample.races.avgField}, players ${sample.races.playerShare}%), ` +
            `${sample.races.story} Story, created ${sample.credits.createdTotal.toLocaleString("en-GB")} / destroyed ${sample.credits.destroyedTotal.toLocaleString("en-GB")}, ` +
            `${world.errors.length} errors, ${((Date.now() - dayWall) / 1000).toFixed(1)} s`,
        );
        dayWall = Date.now();
        dayStart += DAY;
        if (dayStart < end) visits = visits.concat(scheduleDay(world, dayStart));
      }
      if (t >= end) break;
      const due = visits.filter((v) => v.atMs < t + cfg.stepMs);
      visits = visits.filter((v) => v.atMs >= t + cfg.stepMs);
      for (const v of due) {
        const at = new Date(Math.max(t, v.atMs));
        try {
          await visit(world, v.agent, at, v.first, v.last, v.agent.role === "alt" ? (mainOf.get(v.agent.group!) ?? null) : null);
        } catch (e) {
          world.errors.push({ atMs: at.getTime(), agent: v.agent.name, action: "visit", message: e instanceof Error ? e.message : String(e) });
        }
      }
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
        finishedAt: utcDay(new Date()),
      },
      days,
      totals: totalsOf(days, last),
      outcomes: await outcomes(world),
      farmers: await farmerReport(world),
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
