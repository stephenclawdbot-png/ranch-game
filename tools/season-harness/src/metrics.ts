/**
 * Metrics, read straight from the game's tables (and the agents' counters for what the
 * database doesn't keep, e.g. training injuries). Flows (credits by kind, horses born, retired,
 * died) are cumulative snapshots diffed day by day, so they never depend on wall-clock
 * timestamps; per-day race statistics use the races' own post times (simulated time).
 *
 * The harness keeps its own table `harness_cohort` (account, stable, cohort, farmer group and
 * role) in the run's private in-memory database, so every query can group by cohort.
 */
import * as gc from "@thoroughbred/game-core";
import { ledgerHealth, liveRunsBetween, utcDay, utcWeekStart, weekBounds, weekScore, type Db, type LedgerHealth } from "@thoroughbred/db";
import type { Agent, AgentStats, World } from "./agents";
import { COHORTS, type Cohort } from "./config";
import { dist, mean, median, pct, round1, sum, type Dist } from "./stats";

type Row = Record<string, unknown>;

export async function q<T extends Row = Row>(db: Db, sql: string): Promise<T[]> {
  const res = await db.execute(sql);
  return ((Array.isArray(res) ? res : (res as { rows: T[] }).rows) ?? []) as T[];
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const iso = (ms: number) => new Date(ms).toISOString();
const LIVE_KINDS = "('scheduled','feature','final')";

export async function createCohortTable(world: World): Promise<void> {
  await world.db.execute("create table harness_cohort (account_id uuid primary key, stable_id uuid not null, cohort text not null, role text, grp int, name text not null)");
  for (const a of world.agents) {
    await world.db.execute(
      `insert into harness_cohort values ('${a.accountId}', '${a.stableId}', '${a.cohort}', ${a.role ? `'${a.role}'` : "null"}, ${a.group ?? "null"}, '${a.name.replace(/'/g, "''")}')`,
    );
  }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type ByCohort<T> = Record<Cohort, T>;

export interface CreditsDay {
  created: Record<string, number>;
  destroyed: Record<string, number>;
  /** Player-to-player volume by kind (stud fees, market sales). */
  transfers: Record<string, number>;
  createdTotal: number;
  destroyedTotal: number;
  /** Sum of every player balance at the end of the day. */
  playerTotal: number;
}

export interface DaySample {
  day: number;
  date: string;
  credits: CreditsDay;
  balances: ByCohort<Dist>;
  horses: {
    /** Player-owned horses by stage (racing career) plus retired / Legacy Farm / dead. */
    byStage: Record<string, number>;
    born: Record<string, number>;
    retired: Record<string, number>;
    legacy: number;
    died: number;
    standingAtStud: number;
  };
  races: {
    live: number;
    liveWithPlayers: number;
    avgField: number;
    /** Share of all Live runners that belong to players (%). */
    playerShare: number;
    avgPlayerRunners: number;
    /** Live races won by a player horse (absent in runs before 2026-10-30). */
    playerWins?: number;
    /** Player runners in settled Live races (absent in runs before 2026-10-30). */
    playerRunners?: number;
    sisters: number;
    cancelled: number;
    /** Ordinary card races called off at the close because no player entered (race meetings). */
    calledOff: number;
    story: number;
    cup: number;
    purses: number;
    /** Winner-to-last (sum of finish margins) and winning margin of each settled Live race, mm (absent before 2026-10-30). */
    spreadsMm?: number[];
    winMarginsMm?: number[];
  };
  /** Live stable entries used per stable (entry cost), and Live starts per stable. */
  entriesPerStable: ByCohort<number>;
  startsPerStable: ByCohort<number>;
  refills: number;
  league: { pointsPerStable: ByCohort<number>; tiers: Record<string, number>; promoted: number; relegated: number };
  features: {
    fqRaces: number;
    fqPlayerRunners: number;
    fqQualifiers: number;
    wfRaces: number;
    wfPlayerRunners: number;
    /** Racing horses rated 100+ (Weekend Feature place by right). */
    ratedHundred: number;
    byCohort: ByCohort<{ fqRunners: number; qualifiers: number; wfRunners: number }>;
  };
  injuries: { live: Record<string, number>; story: Record<string, number>; training: number };
  breeding: { covers: number; foals: number; potential: { below: number; between: number; above: number } };
  market: { listed: number; sold: number; medianPrice: number; volume: number; expired: number };
  ratings: ByCohort<Dist>;
  licence: ByCohort<number>;
}

export interface Snapshot {
  created: Record<string, number>;
  destroyed: Record<string, number>;
  transfers: Record<string, number>;
  born: Record<string, number>;
  retired: Record<string, number>;
  legacy: number;
  died: number;
  foals: number;
  trainingInjuries: number;
  refills: number;
  potential: { below: number; between: number; above: number };
}

const zeroCohorts = <T>(f: () => T): ByCohort<T> => Object.fromEntries(COHORTS.map((c) => [c, f()])) as ByCohort<T>;

function diff(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = (a[k] ?? 0) - (b[k] ?? 0);
    if (d !== 0) out[k] = d;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cumulative snapshot
// ---------------------------------------------------------------------------

/** Foal potential vs its parents, cached per foal (the genome never changes). */
const potentialCache = new Map<string, "below" | "between" | "above">();

async function foalPotential(db: Db): Promise<{ below: number; between: number; above: number }> {
  const rows = await q<{ id: string; g: unknown; sg: unknown; dg: unknown }>(
    db,
    `select f.id, f.genome g, s.genome sg, d.genome dg from horses f join horses s on s.id = f.sire_id join horses d on d.id = f.dam_id where f.origin = 'bred'`,
  );
  for (const r of rows) {
    if (potentialCache.has(r.id)) continue;
    try {
      const p = gc.overallPotential(r.g as gc.Genome);
      const lo = Math.min(gc.overallPotential(r.sg as gc.Genome), gc.overallPotential(r.dg as gc.Genome));
      const hi = Math.max(gc.overallPotential(r.sg as gc.Genome), gc.overallPotential(r.dg as gc.Genome));
      potentialCache.set(r.id, p < lo ? "below" : p > hi ? "above" : "between");
    } catch {
      /* legacy genome rows: not classified */
    }
  }
  const out = { below: 0, between: 0, above: 0 };
  for (const v of potentialCache.values()) out[v]++;
  return out;
}

export async function snapshot(world: World): Promise<Snapshot> {
  const db = world.db;
  const created: Record<string, number> = {};
  const destroyed: Record<string, number> = {};
  for (const r of await q<{ kind: string; acct: string; amt: string }>(
    db,
    `select t.kind, la.kind acct, sum(p.amount)::bigint amt from ledger_postings p join ledger_transactions t on t.id = p.transaction_id join ledger_accounts la on la.id = p.ledger_account_id where la.kind <> 'player' group by 1, 2`,
  )) {
    if (r.acct === "mint") created[r.kind] = (created[r.kind] ?? 0) - num(r.amt);
    else destroyed[r.kind] = (destroyed[r.kind] ?? 0) + num(r.amt);
  }
  const transfers: Record<string, number> = {};
  for (const r of await q<{ kind: string; v: string }>(
    db,
    `select kind, sum(least(pos, neg))::bigint v from (
       select t.id, t.kind, sum(greatest(p.amount, 0)) pos, sum(greatest(-p.amount, 0)) neg
       from ledger_postings p join ledger_transactions t on t.id = p.transaction_id join ledger_accounts la on la.id = p.ledger_account_id
       where la.kind = 'player' group by t.id, t.kind) x where pos > 0 and neg > 0 group by kind`,
  )) transfers[r.kind] = num(r.v);
  const born: Record<string, number> = {};
  for (const r of await q<{ origin: string; n: number }>(db, `select origin, count(*)::int n from horses where origin in ('bred','pack','gift','starter') group by 1`)) born[r.origin] = num(r.n);
  const retired: Record<string, number> = {};
  for (const r of await q<{ reason: string; n: number }>(db, `select retirement_reason reason, count(*)::int n from horses where retired_at is not null and origin <> 'house' group by 1`)) retired[r.reason] = num(r.n);
  const [life] = await q<{ legacy: number; died: number }>(
    db,
    `select count(*) filter (where pastured_at is not null and dynamics->>'diedAtMs' is null)::int legacy, count(*) filter (where dynamics->>'diedAtMs' is not null)::int died from horses where origin <> 'house'`,
  );
  return {
    created,
    destroyed,
    transfers,
    born,
    retired,
    legacy: num(life?.legacy),
    died: num(life?.died),
    foals: born.bred ?? 0,
    trainingInjuries: sum(world.agents.map((a) => a.stats.trainingInjuries)),
    refills: sum(world.agents.map((a) => a.stats.refills)),
    potential: await foalPotential(db),
  };
}

// ---------------------------------------------------------------------------
// Daily sample
// ---------------------------------------------------------------------------

function byCohortCount(world: World): ByCohort<number> {
  const n = zeroCohorts(() => 0);
  for (const a of world.agents) n[a.cohort]++;
  return n;
}

export async function sampleDay(world: World, day: number, fromMs: number, toMs: number, prev: Snapshot, cur: Snapshot): Promise<DaySample> {
  const db = world.db;
  const from = `'${iso(fromMs)}'`;
  const to = `'${iso(toMs)}'`;
  const counts = byCohortCount(world);
  const per = (v: ByCohort<number>): ByCohort<number> => Object.fromEntries(COHORTS.map((c) => [c, counts[c] ? round1(v[c] / counts[c]) : 0])) as ByCohort<number>;

  // Credits
  const createdDay = diff(cur.created, prev.created);
  const destroyedDay = diff(cur.destroyed, prev.destroyed);
  const [pt] = await q<{ s: string }>(db, `select coalesce(sum(balance), 0)::bigint s from ledger_accounts where kind = 'player'`);
  const balRows = await q<{ cohort: Cohort; b: number }>(db, `select c.cohort, coalesce(la.balance, 0)::bigint b from harness_cohort c left join ledger_accounts la on la.owner_account_id = c.account_id and la.kind = 'player'`);
  const balances = zeroCohorts<number[]>(() => []);
  for (const r of balRows) balances[r.cohort].push(num(r.b));

  // Horses
  const byStage: Record<string, number> = {};
  for (const r of await q<{ stage: string; status: string; dead: boolean; n: number }>(
    db,
    `select h.stage, h.career_status status, (h.dynamics->>'diedAtMs') is not null dead, count(*)::int n from horses h join harness_cohort c on c.stable_id = h.owner_stable_id group by 1, 2, 3`,
  )) {
    const k = r.dead ? "dead" : r.status === "racing" ? r.stage : r.status === "retired" ? "retired" : "legacy";
    byStage[k] = (byStage[k] ?? 0) + num(r.n);
  }
  const [stud] = await q<{ n: number }>(db, `select count(*)::int n from horses where stud_fee is not null and owner_stable_id is not null and career_status <> 'pasture'`);

  // Races
  const raceRows = await q<{ kind: string; slot_key: string | null; status: string; n: number; p: number; pw: number; purse: number; ck: string | null }>(
    db,
    `select r.kind, r.slot_key, r.status, r.purse, r.conditions->'calendar'->>'kind' ck,
            count(e.id) filter (where e.status = 'entered')::int n, count(e.id) filter (where e.status = 'entered' and e.stable_id is not null)::int p,
            count(e.id) filter (where e.status = 'entered' and e.stable_id is not null and e.finish_position = 1)::int pw
       from races r left join race_entries e on e.race_id = r.id
      where r.post_time >= ${from} and r.post_time < ${to} group by r.id`,
  );
  const live = raceRows.filter((r) => ["scheduled", "feature", "final"].includes(r.kind) && r.status === "settled");
  const runners = sum(live.map((r) => num(r.n)));
  const playerRunners = sum(live.map((r) => num(r.p)));
  const [cup] = await q<{ n: number }>(db, `select count(*)::int n from daily_cup_entries where day = '${utcDay(new Date(fromMs))}'`);
  const [purses] = await q<{ s: string }>(
    db,
    `select coalesce(sum(e.prize), 0)::bigint s from race_entries e join races r on r.id = e.race_id where e.stable_id is not null and r.kind in ${LIVE_KINDS} and r.post_time >= ${from} and r.post_time < ${to}`,
  );
  // Field spread of settled Live races: winner to last (sum of the finish margins) and the winning margin, mm.
  const finishes = await q<{ spread: string; margin: string }>(
    db,
    `select (select coalesce(sum((f->>'marginMm')::bigint), 0) from jsonb_array_elements(rr.result->'finishOrder') f) spread,
            coalesce((rr.result->'finishOrder'->1->>'marginMm')::bigint, 0) margin
       from race_results rr join races r on r.id = rr.race_id where r.kind in ${LIVE_KINDS} and r.post_time >= ${from} and r.post_time < ${to}`,
  );

  // Entries and starts per stable
  const entries = zeroCohorts(() => 0);
  const starts = zeroCohorts(() => 0);
  for (const r of await q<{ cohort: Cohort; cost: number; n: number }>(
    db,
    `select c.cohort, coalesce(sum(e.entry_cost), 0)::int cost, count(*)::int n from race_entries e join races r on r.id = e.race_id join harness_cohort c on c.stable_id = e.stable_id
      where e.status = 'entered' and r.kind in ${LIVE_KINDS} and r.status <> 'cancelled' and r.post_time >= ${from} and r.post_time < ${to} group by 1`,
  )) {
    entries[r.cohort] = num(r.cost);
    starts[r.cohort] = num(r.n);
  }

  // League: this week's points (game rules: weekScore over settled Live runs), tiers, movement
  const week = weekBounds(utcWeekStart(new Date(toMs - 1)));
  const runs = await liveRunsBetween(db, { from: week.from, to: new Date(Math.min(toMs, week.to.getTime())) });
  const runsBy = new Map<string, typeof runs>();
  for (const r of runs) runsBy.set(r.accountId, [...(runsBy.get(r.accountId) ?? []), r]);
  const points = zeroCohorts(() => 0);
  for (const a of world.agents) points[a.cohort] += weekScore(runsBy.get(a.accountId) ?? []).points;
  const tiers: Record<string, number> = {};
  for (const r of await q<{ tier: number; n: number }>(
    db,
    `select l.tier, count(*)::int n from league_members m join leagues l on l.id = m.league_id where m.week_start = '${utcWeekStart(new Date(toMs - 1))}' group by 1`,
  )) tiers[gc.LEAGUE_TIERS[Math.max(0, num(r.tier) - 1)] ?? String(r.tier)] = num(r.n);
  const [moves] = await q<{ up: number; down: number }>(db, `select count(*) filter (where movement > 0)::int up, count(*) filter (where movement < 0)::int down from league_members`);

  // Features (Feature Qualifiers, Weekend Feature, Season Final) run today
  const feat = await q<{ ck: string; race: string; cohort: Cohort | null; pos: number | null }>(
    db,
    `select r.conditions->'calendar'->>'kind' ck, r.id race, c.cohort, e.finish_position pos
       from races r left join race_entries e on e.race_id = r.id and e.status = 'entered' and e.stable_id is not null left join harness_cohort c on c.stable_id = e.stable_id
      where r.status = 'settled' and r.conditions->'calendar'->>'kind' is not null and r.post_time >= ${from} and r.post_time < ${to}`,
  );
  const fByCohort = zeroCohorts(() => ({ fqRunners: 0, qualifiers: 0, wfRunners: 0 }));
  for (const r of feat) {
    if (!r.cohort) continue;
    if (r.ck === "feature_qualifier") {
      fByCohort[r.cohort].fqRunners++;
      if (r.pos !== null && num(r.pos) >= 1 && num(r.pos) <= 3) fByCohort[r.cohort].qualifiers++;
    } else if (r.ck === "weekend_feature") fByCohort[r.cohort].wfRunners++;
  }
  const [hundred] = await q<{ n: number }>(db, `select count(*)::int n from horses h join harness_cohort c on c.stable_id = h.owner_stable_id where h.career_status = 'racing' and h.rating >= 100`);

  // Injuries from today's results (Live and Story), training from the agents' counters
  const injLive: Record<string, number> = {};
  const injStory: Record<string, number> = {};
  for (const r of await q<{ sev: string; kind: string; n: number }>(
    db,
    `select i.data->>'injury' sev, r.kind, count(*)::int n from inbox_items i join races r on r.id = i.race_id
      where i.kind = 'race_result' and i.data->>'injury' is not null and r.post_time >= ${from} and r.post_time < ${to} group by 1, 2`,
  )) {
    const into = r.kind === "quick" ? injStory : injLive;
    into[r.sev] = (into[r.sev] ?? 0) + num(r.n);
  }

  // Breeding and market (their rows carry the simulated `now`)
  const [covers] = await q<{ n: number }>(db, `select count(*)::int n from breeding_events where created_at >= ${from} and created_at < ${to}`);
  const [listed] = await q<{ n: number }>(db, `select count(*)::int n from market_listings where created_at >= ${from} and created_at < ${to}`);
  const prices = (await q<{ price: number }>(db, `select price from trades where created_at >= ${from} and created_at < ${to}`)).map((r) => num(r.price));
  const [expired] = await q<{ n: number }>(db, `select count(*)::int n from market_listings where status = 'expired' and closed_at >= ${from} and closed_at < ${to}`);

  // Ratings of racing-age horses in training, licences
  const ratings = zeroCohorts<number[]>(() => []);
  for (const r of await q<{ cohort: Cohort; rating: number }>(
    db,
    `select c.cohort, h.rating from horses h join harness_cohort c on c.stable_id = h.owner_stable_id where h.career_status = 'racing' and h.care_sessions >= ${gc.CARE_TO_RACING}`,
  )) ratings[r.cohort].push(num(r.rating));
  const licence = zeroCohorts(() => 0);
  for (const r of await q<{ cohort: Cohort; lv: number }>(db, `select c.cohort, avg(s.licence_level)::float lv from stables s join harness_cohort c on c.stable_id = s.id group by 1`)) licence[r.cohort] = round1(num(r.lv));

  return {
    day,
    date: utcDay(new Date(fromMs)),
    credits: {
      created: createdDay,
      destroyed: destroyedDay,
      transfers: diff(cur.transfers, prev.transfers),
      createdTotal: sum(Object.values(createdDay)),
      destroyedTotal: sum(Object.values(destroyedDay)),
      playerTotal: num(pt?.s),
    },
    balances: Object.fromEntries(COHORTS.map((c) => [c, dist(balances[c])])) as ByCohort<Dist>,
    horses: {
      byStage,
      born: diff(cur.born, prev.born),
      retired: diff(cur.retired, prev.retired),
      legacy: cur.legacy - prev.legacy,
      died: cur.died - prev.died,
      standingAtStud: num(stud?.n),
    },
    races: {
      live: live.length,
      liveWithPlayers: live.filter((r) => num(r.p) > 0).length,
      avgField: round1(live.length ? runners / live.length : 0),
      playerShare: pct(playerRunners, runners),
      avgPlayerRunners: round1(live.length ? playerRunners / live.length : 0),
      playerWins: sum(live.map((r) => num(r.pw))),
      playerRunners,
      sisters: live.filter((r) => /^live(?:\d+m)?:\d+:\d+$/.test(r.slot_key ?? "")).length,
      cancelled: raceRows.filter((r) => r.status === "cancelled" && r.kind !== "quick").length,
      calledOff: raceRows.filter((r) => r.status === "cancelled" && (r.kind === "scheduled" || r.kind === "feature") && /^live(?:\d+m)?:/.test(r.slot_key ?? "") && num(r.n) === 0).length,
      story: raceRows.filter((r) => r.kind === "quick" && r.status === "settled").length,
      cup: num(cup?.n),
      purses: num(purses?.s),
      spreadsMm: finishes.map((f) => num(f.spread)),
      winMarginsMm: finishes.map((f) => num(f.margin)),
    },
    entriesPerStable: per(entries),
    startsPerStable: per(starts),
    refills: cur.refills - prev.refills,
    league: { pointsPerStable: per(points), tiers, promoted: num(moves?.up), relegated: num(moves?.down) },
    features: {
      fqRaces: new Set(feat.filter((r) => r.ck === "feature_qualifier").map((r) => r.race)).size,
      fqPlayerRunners: sum(COHORTS.map((c) => fByCohort[c].fqRunners)),
      fqQualifiers: sum(COHORTS.map((c) => fByCohort[c].qualifiers)),
      wfRaces: new Set(feat.filter((r) => r.ck === "weekend_feature").map((r) => r.race)).size,
      wfPlayerRunners: sum(COHORTS.map((c) => fByCohort[c].wfRunners)),
      ratedHundred: num(hundred?.n),
      byCohort: fByCohort,
    },
    injuries: { live: injLive, story: injStory, training: cur.trainingInjuries - prev.trainingInjuries },
    breeding: { covers: num(covers?.n), foals: cur.foals - prev.foals, potential: cur.potential },
    market: { listed: num(listed?.n), sold: prices.length, medianPrice: median(prices), volume: sum(prices), expired: num(expired?.n) },
    ratings: Object.fromEntries(COHORTS.map((c) => [c, dist(ratings[c])])) as ByCohort<Dist>,
    licence,
  };
}

// ---------------------------------------------------------------------------
// End of run: retention proxies, farmer channels, checks
// ---------------------------------------------------------------------------

export interface CohortOutcome {
  stables: number;
  /** Share of the cohort's stables (%) that did each at least once. */
  wonLive: number;
  ranFeatureQualifier: number;
  qualified: number;
  ranWeekendFeature: number;
  bredFoal: number;
  soldHorse: number;
  licence3: number;
  promoted: number;
  endedAboveStart: number;
  avgLiveStarts: number;
  avgVisits: number;
}

export interface FarmerReport {
  groups: { group: number; detected: boolean; mainStallion: boolean; altMaresCovered: number; studFeesToMain: number; marketToMain: number; horsesToMain: number; mainBalance: number; altBalances: number[]; blockedTrades: number }[];
  fraudEvents: Record<string, number>;
}

export interface NotableRun {
  date: string;
  race: string;
  calendar: string;
  minRating: number | null;
  cohort: Cohort;
  stable: string;
  horse: string;
  ratingBefore: number;
  position: number | null;
}

export interface NotableHorse {
  name: string;
  cohort: Cohort;
  stable: string;
  origin: string;
  careerStatus: string;
  rating: number;
  peakOr: number;
  starts: number;
  wins: number;
}

/** Every player run in a calendar race (qualifiers, Weekend Features, finals) and the top-rated player horses. */
export async function notables(world: World): Promise<{ featureRuns: NotableRun[]; topHorses: NotableHorse[] }> {
  const db = world.db;
  const featureRuns = (
    await q<Row>(
      db,
      `select r.post_time, r.name race, r.conditions->'calendar'->>'kind' ck, (r.conditions->>'minRating')::int minr, c.cohort, c.name stable, h.name horse, e.rating_before, e.finish_position
         from race_entries e join races r on r.id = e.race_id join harness_cohort c on c.stable_id = e.stable_id join horses h on h.id = e.horse_id
        where r.conditions->'calendar'->>'kind' is not null and e.status = 'entered' order by r.post_time`,
    )
  ).map((r) => ({
    date: iso(new Date(r.post_time as string | Date).getTime()),
    race: String(r.race),
    calendar: String(r.ck),
    minRating: r.minr === null ? null : num(r.minr),
    cohort: r.cohort as Cohort,
    stable: String(r.stable),
    horse: String(r.horse),
    ratingBefore: num(r.rating_before),
    position: r.finish_position === null ? null : num(r.finish_position),
  }));
  const topHorses = (
    await q<Row>(
      db,
      `select h.name, c.cohort, c.name stable, h.origin, h.career_status, h.rating, coalesce((h.dynamics->>'peakOr')::int, h.rating) peak, h.starts, h.wins
         from horses h join harness_cohort c on c.stable_id = h.owner_stable_id order by h.rating desc, h.starts desc limit 15`,
    )
  ).map((r) => ({
    name: String(r.name),
    cohort: r.cohort as Cohort,
    stable: String(r.stable),
    origin: String(r.origin),
    careerStatus: String(r.career_status),
    rating: num(r.rating),
    peakOr: num(r.peak),
    starts: num(r.starts),
    wins: num(r.wins),
  }));
  return { featureRuns, topHorses };
}

export interface Checks {
  ledger: LedgerHealth;
  /** Σ created − Σ destroyed by kind must equal the players' total (double entry). */
  conservation: { created: number; destroyed: number; playerTotal: number; drift: number; ok: boolean };
  unexpectedErrors: number;
  ok: boolean;
}

export async function outcomes(world: World): Promise<ByCohort<CohortOutcome>> {
  const db = world.db;
  const rows = await q<Row & { cohort: Cohort; account_id: string }>(
    db,
    `select c.cohort, c.account_id,
       exists (select 1 from race_entries e join races r on r.id = e.race_id where e.stable_id = c.stable_id and r.kind in ${LIVE_KINDS} and e.finish_position = 1) won,
       exists (select 1 from race_entries e join races r on r.id = e.race_id where e.stable_id = c.stable_id and r.status = 'settled' and r.conditions->'calendar'->>'kind' = 'feature_qualifier') fq,
       (exists (select 1 from race_entries e join races r on r.id = e.race_id where e.stable_id = c.stable_id and r.conditions->'calendar'->>'kind' = 'feature_qualifier' and e.finish_position between 1 and 3)
         or exists (select 1 from horses h where h.owner_stable_id = c.stable_id and h.rating >= 100)) qual,
       exists (select 1 from race_entries e join races r on r.id = e.race_id where e.stable_id = c.stable_id and r.status = 'settled' and r.conditions->'calendar'->>'kind' = 'weekend_feature') wf,
       exists (select 1 from breeding_events b where b.requested_by = c.account_id) bred,
       exists (select 1 from trades t where t.seller_stable_id = c.stable_id) sold,
       (select licence_level from stables s where s.id = c.stable_id) >= 3 lic3,
       exists (select 1 from league_members m where m.account_id = c.account_id and m.movement > 0) promoted,
       (select count(*)::int from race_entries e join races r on r.id = e.race_id where e.stable_id = c.stable_id and r.kind in ${LIVE_KINDS} and r.status = 'settled') starts,
       coalesce((select balance from ledger_accounts la where la.owner_account_id = c.account_id and la.kind = 'player'), 0) bal
     from harness_cohort c`,
  );
  const out = {} as ByCohort<CohortOutcome>;
  for (const cohort of COHORTS) {
    const rs = rows.filter((r) => r.cohort === cohort);
    const share = (k: string) => pct(rs.filter((r) => r[k] === true).length, rs.length);
    const agents = world.agents.filter((a) => a.cohort === cohort);
    out[cohort] = {
      stables: rs.length,
      wonLive: share("won"),
      ranFeatureQualifier: share("fq"),
      qualified: share("qual"),
      ranWeekendFeature: share("wf"),
      bredFoal: share("bred"),
      soldHorse: share("sold"),
      licence3: share("lic3"),
      promoted: share("promoted"),
      endedAboveStart: pct(rs.filter((r) => num(r.bal) > gc.STARTER_GRANT).length, rs.length),
      avgLiveStarts: round1(mean(rs.map((r) => num(r.starts)))),
      avgVisits: round1(mean(agents.map((a) => a.stats.visits))),
    };
  }
  return out;
}

export async function farmerReport(world: World): Promise<FarmerReport> {
  const db = world.db;
  const groups: FarmerReport["groups"] = [];
  const mains = world.agents.filter((a) => a.role === "main");
  for (const main of mains) {
    const alts = world.agents.filter((a) => a.group === main.group && a.role === "alt");
    const altIds = alts.map((a) => `'${a.accountId}'`).join(",") || "null";
    const altStables = alts.map((a) => `'${a.stableId}'`).join(",") || "null";
    const [stud] = await q<{ s: string }>(
      db,
      `select coalesce(sum(p.amount), 0)::bigint s from breeding_events b join ledger_postings p on p.transaction_id = b.ledger_transaction_id join ledger_accounts la on la.id = p.ledger_account_id
        where b.requested_by in (${altIds}) and la.owner_account_id = '${main.accountId}'`,
    );
    const [mkt] = await q<{ s: string }>(db, `select coalesce(sum(price - fee), 0)::bigint s from trades where seller_stable_id = '${main.stableId}' and buyer_stable_id in (${altStables})`);
    const [horses] = await q<{ n: number }>(db, `select count(*)::int n from trades where buyer_stable_id = '${main.stableId}' and seller_stable_id in (${altStables})`);
    const [stallion] = await q<{ n: number }>(db, `select count(*)::int n from horses where owner_stable_id = '${main.stableId}' and stud_fee is not null`);
    const [covered] = await q<{ n: number }>(db, `select count(*)::int n from breeding_events where requested_by in (${altIds}) and sire_owner_stable_id = '${main.stableId}'`);
    const bal = async (a: Agent) => num((await q<{ b: string }>(db, `select balance b from ledger_accounts where owner_account_id = '${a.accountId}' and kind = 'player'`))[0]?.b);
    const blocked = sum(alts.concat(main).map((a) => sum(Object.entries(a.stats.refused).filter(([k]) => k.startsWith("market_buy:")).map(([, n]) => n))));
    groups.push({
      group: main.group!,
      detected: main.detected,
      mainStallion: num(stallion?.n) > 0,
      altMaresCovered: num(covered?.n),
      studFeesToMain: num(stud?.s),
      marketToMain: num(mkt?.s),
      horsesToMain: num(horses?.n),
      mainBalance: await bal(main),
      altBalances: await Promise.all(alts.map(bal)),
      blockedTrades: blocked,
    });
  }
  const fraudEvents: Record<string, number> = {};
  for (const r of await q<{ kind: string; n: number }>(db, `select kind, count(*)::int n from fraud_events group by 1`)) fraudEvents[r.kind] = num(r.n);
  return { groups, fraudEvents };
}

export async function checks(world: World, last: Snapshot): Promise<Checks> {
  const ledger = await ledgerHealth(world.db);
  const [pt] = await q<{ s: string }>(world.db, `select coalesce(sum(balance), 0)::bigint s from ledger_accounts where kind = 'player'`);
  const playerTotal = num(pt?.s);
  const created = sum(Object.values(last.created));
  const destroyed = sum(Object.values(last.destroyed));
  const drift = created - destroyed - playerTotal;
  const conservation = { created, destroyed, playerTotal, drift, ok: drift === 0 };
  const ledgerOk = ledger.totalPostings === 0 && !ledger.unbalancedTransactions.length && !ledger.driftedAccounts.length && !ledger.negativeAccounts.length;
  return { ledger, conservation, unexpectedErrors: world.errors.length, ok: ledgerOk && conservation.ok && world.errors.length === 0 };
}

export interface LeasingTotals {
  offers: number;
  leases: number;
  activeAtEnd: number;
  /** Leases ended by reason (term, returned, injured, retired, died). */
  ended: Record<string, number>;
  racesOnLease: number;
  /** Purse shares paid (kind lease_share): to owners and to lessees. */
  sharesToOwners: number;
  sharesToLessees: number;
  /** Fraud events: linked leases refused, reciprocal leases flagged. */
  linkedBlocked: number;
  reciprocalFlags: number;
  /** The Club seeding the markets (packages/db clubMarket.ts): its lots and lease offers, Club horses bought and leased. */
  club: { lots: number; offers: number; sales: number; leases: number };
  /** Market sales between players (not Club lots). */
  playerSales: number;
}

/** Horse leasing over the run, from the lease tables and fraud events. */
export async function leasingTotals(world: World): Promise<LeasingTotals> {
  const db = world.db;
  const [o] = await q<{ n: number; club: number }>(db, `select count(*)::int n, count(*) filter (where club)::int club from horse_lease_listings`);
  const [cl] = await q<{ lots: number }>(db, `select count(*)::int lots from market_listings where club`);
  const [tr] = await q<{ club: number; player: number }>(db, `select count(*) filter (where club)::int club, count(*) filter (where not club)::int player from trades`);
  const [l] = await q<{ n: number; club: number; active: number; races: number; owner: string; lessee: string }>(
    db,
    `select count(*)::int n, count(*) filter (where club)::int club, count(*) filter (where status = 'active')::int active, coalesce(sum(races), 0)::int races,
            coalesce(sum(owner_earned), 0)::bigint owner, coalesce(sum(lessee_earned), 0)::bigint lessee from horse_leases`,
  );
  const ended: Record<string, number> = {};
  for (const r of await q<{ reason: string; n: number }>(db, `select end_reason reason, count(*)::int n from horse_leases where status = 'ended' group by 1`)) ended[r.reason] = num(r.n);
  const [f] = await q<{ linked: number; recip: number }>(
    db,
    `select count(*) filter (where kind = 'linked_lease_blocked')::int linked, count(*) filter (where kind = 'lease_reciprocal')::int recip from fraud_events`,
  );
  return {
    offers: num(o?.n),
    leases: num(l?.n),
    activeAtEnd: num(l?.active),
    ended,
    racesOnLease: num(l?.races),
    sharesToOwners: num(l?.owner),
    sharesToLessees: num(l?.lessee),
    linkedBlocked: num(f?.linked),
    reciprocalFlags: num(f?.recip),
    club: { lots: num(cl?.lots), offers: num(o?.club), sales: num(tr?.club), leases: num(l?.club) },
    playerSales: num(tr?.player),
  };
}

export interface ClaimingTotals {
  /** Claiming races that ran (settled), and those called off with no player runner. */
  racesRun: number;
  calledOff: number;
  /** Claim-priced runners that ran. */
  horsesEntered: number;
  claimsLodged: number;
  /** Claims decided by the draw (horses with more than one claim). */
  drawnFromSeveral: number;
  horsesClaimed: number;
  /** Credits paid for claimed horses, and the fee burned out of them. */
  creditsMoved: number;
  feesBurned: number;
  /** Claims voided after the race (fatal injury, no stall) and refunded (scratch, abandoned). */
  voided: number;
  refunded: number;
}

/** Claiming races over the run (packages/db claiming.ts), from the race and claim tables. */
export async function claimingTotals(world: World): Promise<ClaimingTotals> {
  const db = world.db;
  const [r] = await q<{ run: number; off: number }>(
    db,
    `select count(*) filter (where status = 'settled')::int run, count(*) filter (where status = 'cancelled')::int off from races where (conditions->>'claiming')::boolean is true`,
  );
  const [e] = await q<{ n: number }>(
    db,
    `select count(*)::int n from race_entries e join races r on r.id = e.race_id where e.claim_price is not null and e.status = 'entered' and r.status = 'settled'`,
  );
  const [c] = await q<{ n: number; claimed: number; moved: string; fees: string; voided: number; refunded: number }>(
    db,
    `select count(*)::int n, count(*) filter (where status = 'claimed')::int claimed, coalesce(sum(price) filter (where status = 'claimed'), 0)::bigint moved,
            coalesce(sum(fee), 0)::bigint fees, count(*) filter (where status = 'void')::int voided, count(*) filter (where status = 'refunded')::int refunded from race_claims`,
  );
  const [d] = await q<{ n: number }>(db, `select count(*)::int n from (select race_id, horse_id from race_claims group by 1, 2 having count(*) > 1) x`);
  return {
    racesRun: num(r?.run),
    calledOff: num(r?.off),
    horsesEntered: num(e?.n),
    claimsLodged: num(c?.n),
    drawnFromSeveral: num(d?.n),
    horsesClaimed: num(c?.claimed),
    creditsMoved: num(c?.moved),
    feesBurned: num(c?.fees),
    voided: num(c?.voided),
    refunded: num(c?.refunded),
  };
}

/** Refused actions by cohort and code, plus attempted actions (for the activity table). */
export function activity(world: World): { attempted: Record<string, number>; refused: ByCohort<Record<string, number>>; counters: ByCohort<Partial<AgentStats>> } {
  const refused = zeroCohorts<Record<string, number>>(() => ({}));
  const counters = zeroCohorts<Partial<AgentStats>>(() => ({}));
  for (const a of world.agents) {
    for (const [k, n] of Object.entries(a.stats.refused)) refused[a.cohort][k] = (refused[a.cohort][k] ?? 0) + n;
    for (const [k, v] of Object.entries(a.stats)) {
      if (typeof v !== "number") continue;
      const c = counters[a.cohort] as Record<string, number>;
      c[k] = (c[k] ?? 0) + v;
    }
  }
  return { attempted: { ...world.actions }, refused, counters };
}
