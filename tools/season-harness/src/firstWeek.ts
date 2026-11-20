/**
 * First-week scenario (2026-11-20): brand-new stables play their first days through the real
 * server code, and every day is measured. Week-one data (112 testers): 1 tester ever bred a
 * horse, and players sat on their credits. This answers, with the game's own rules:
 *   - when can a new stable first breed, when is the foal born, when does a home-bred horse race;
 *   - what does it earn and spend each day, and what is left;
 *   - when does it first win, finish Story chapter 1, and what do its Live starts look like.
 *
 * Two new players, both doing what the game points at (Home, the first-week list, the Story
 * screen, Quick Pick), never anything a route doesn't offer:
 *   - casual:  one short visit a day (about 5 minutes): the results waiting, care, the Daily Cup,
 *              one Story race, one Live Quick Pick, the free pack, the foal that is due;
 *   - engaged: two visits a day (15-20 minutes in all): the same, plus up to three Story races a
 *              visit (the second and third on rested horses), up to three Live entries a day, a training session a day
 *              for each fresh horse that didn't race, the first-week jobs (plan, pick, target,
 *              stallion finder), one Paddock Pack and the first vet upgrade once they have the
 *              credits.
 * Both cover a mare as soon as the barn allows it and they can pay (their own stallion when one
 * may breed, else the cheapest Club stud), foal and name, and run a home-bred horse in a Story
 * race the day it reaches racing age.
 *
 * The clock steps one card slot at a time and drives the Live card exactly as the cron does
 * (the season harness's loop, run.ts). Credits are read from the ledger (cumulative per account
 * and kind, diffed per simulated day), milestones from what the server returned.
 */
import * as gc from "@thoroughbred/game-core";
import { createDb, DomainError, RULES, stableOf, type Db } from "@thoroughbred/db";
import { cupView, runCup } from "@/server/competition";
import { breedingPreview, breedingView, coverMare, foalAndName, packsView, pull } from "@/server/economy";
import { foundStable } from "@/server/founding";
import { createStoryRace, driveCard, myRaceResult, playerView, quickPickLive, raceCard, raceList } from "@/server/game";
import { onboardingAction } from "@/server/guide";
import { careAction, facilitiesView, facilityAction, graduateAction, horseLifeView, nurseryView, savePlanAction, trainAction } from "@/server/horseLife";
import { pickRunner } from "@/server/picks";
import type { Session } from "@/server/session";
import { pinTarget, planCandidates } from "@/server/social";
import { createChapterRace, storyView } from "@/server/story";
import { q } from "./metrics";

const MIN = 60_000;
const DAY = 86_400_000;

export type PersonaKey = "casual" | "engaged";

interface Persona {
  key: PersonaKey;
  /** Visit times, UTC hours (the Live card's meetings are at 07:00, 13:00 and 19:00). */
  visits: number[];
  storyPerVisit: number;
  livePerDay: number;
  trains: boolean;
  guide: boolean;
  spends: boolean;
}

const PERSONAS: Record<PersonaKey, Persona> = {
  casual: { key: "casual", visits: [20], storyPerVisit: 1, livePerDay: 1, trains: false, guide: false, spends: false },
  engaged: { key: "engaged", visits: [12.5, 19.5], storyPerVisit: 3, livePerDay: 3, trains: true, guide: true, spends: true },
};

/** The first day (1 = founding day) each thing happened; null = not within the run. */
export interface Milestones {
  firstWin: number | null;
  firstLiveWin: number | null;
  chapter1: number | null;
  /** A mare the barn would let breed (and, separately, a stallion of the stable's own). */
  mareCanBreed: number | null;
  ownStallionCanBreed: number | null;
  covered: number | null;
  coverCost: number | null;
  coverSire: "own" | "club" | null;
  foalBorn: number | null;
  homeBredRacingAge: number | null;
  homeBredRaced: number | null;
  giftFoalRacingAge: number | null;
  paddockPackBought: number | null;
  vetBought: number | null;
}

export interface DayRow {
  day: number;
  /** Credits in and out that day, by ledger kind. */
  earned: Record<string, number>;
  spent: Record<string, number>;
  balance: number;
  horses: number;
  storyRaces: number;
  liveEntries: number;
  /** Starts of the stable's most-raced filly or mare, and of its most-raced colt, so far. */
  mareStarts: number;
  coltStarts: number;
  /** Horses of the stable injured at the end of the day. */
  injured: number;
}

export interface WeekStable {
  index: number;
  persona: PersonaKey;
  accountId: string;
  stableId: string;
  days: DayRow[];
  milestones: Milestones;
  refused: Record<string, number>;
}

export interface FirstWeekOptions {
  seed: string;
  days: number;
  perPersona: number;
  startMs: number;
  log?: (line: string) => void;
}

export interface FirstWeekResult {
  rules: Record<string, number>;
  stables: WeekStable[];
  /** Player runs in Live races over the run: per horse start number. */
  live: { start: number; runs: number; winPct: number; top3Pct: number; lastPct: number; meanRatingDelta: number }[];
  errors: string[];
}

interface Agent extends WeekStable {
  p: Persona;
  /** Minutes after the persona's visit time (stables don't all tap at once). */
  offsetMin: number;
  liveToday: number;
  storyToday: number;
  trainedDay: number;
  prev: Record<string, number>;
}

class Run {
  errors: string[] = [];
  constructor(
    readonly db: Db,
    readonly startMs: number,
  ) {}
  dayOf(now: Date): number {
    return Math.floor((now.getTime() - this.startMs) / DAY) + 1;
  }
  async session(a: Agent): Promise<Session> {
    return { accountId: a.accountId, stable: await stableOf(this.db, a.accountId) };
  }
  /** One player action: a refusal (DomainError) is counted, anything else is an error of the run. */
  async act<T>(a: Agent, action: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DomainError) {
        a.refused[`${action}:${e.code}`] = (a.refused[`${action}:${e.code}`] ?? 0) + 1;
        return null;
      }
      this.errors.push(`${a.persona} ${a.index} ${action}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
}

const first = (cur: number | null, day: number) => cur ?? day;

async function visit(run: Run, a: Agent, now: Date, firstOfDay: boolean): Promise<void> {
  const { db } = run;
  const day = run.dayOf(now);
  const s = await run.session(a);
  const m = a.milestones;
  if (firstOfDay) {
    a.liveToday = 0;
    a.storyToday = 0;
  }
  let view = await run.act(a, "player_view", () => playerView(db, s, now));
  if (!view) return;

  // Results waiting: watch, and read the "why" under it (the first-week jobs).
  for (const item of view.inbox.filter((i) => !i.read && i.raceId && i.kind === "race_result" && i.createdAtMs <= now.getTime() - 15 * MIN).slice(0, 3)) {
    const r = await run.act(a, "watch_result", () => myRaceResult(db, s, item.raceId!, now));
    if (r) await run.act(a, "read_why", () => onboardingAction(db, s, { action: "why", raceId: item.raceId! }, now));
  }

  // The very first thing a new stable does: the race from the starters screen.
  if (!view.hasRaced) {
    const r = await run.act(a, "first_race", () => createStoryRace(db, s, { instant: true }, now));
    if (r) {
      a.storyToday++;
      await run.act(a, "read_why", () => onboardingAction(db, s, { action: "why", raceId: r.raceId }, now));
    }
  }

  // Breeding first: the foal that is due (it is cared for in this same visit), then a covering
  // as soon as the barn allows one.
  await breeding(run, a, s, now, day);
  view = (await run.act(a, "player_view", () => playerView(db, s, now))) ?? view;

  // Care (every horse, once a day), and a youngster that has grown up is welcomed to the yard.
  for (const h of view.horses) await run.act(a, "care", () => careAction(db, s, h.id, {}, now));
  const nursery = await run.act(a, "nursery", () => nurseryView(db, s, now));
  for (const g of nursery?.graduates ?? []) await run.act(a, "graduate", () => graduateAction(db, s, g.id, now));

  // The Daily Cup.
  const cup = await run.act(a, "cup_view", () => cupView(db, s, now));
  const cupHorse = cup && !cup.mine ? cup.horses?.find((h) => !h.block) : undefined;
  if (cupHorse) await run.act(a, "cup_run", () => runCup(db, s, { horseId: cupHorse.id }, now));

  // A home-bred or gift horse that has reached racing age runs in a Story race that day.
  const origins = await q<{ id: string; origin: string; care: number; starts: number }>(db, `select id, origin, care_sessions as care, starts from horses where owner_stable_id = '${a.stableId}' and origin in ('bred', 'gift')`);
  for (const o of origins) {
    // A home-bred foal in the yard: born (whoever delivered it: this visit, or the card's upkeep run).
    if (o.origin === "bred") m.foalBorn = first(m.foalBorn, day);
    if (Number(o.care) < gc.CARE_TO_RACING) continue;
    if (o.origin === "gift") m.giftFoalRacingAge = first(m.giftFoalRacingAge, day);
    else {
      m.homeBredRacingAge = first(m.homeBredRacingAge, day);
      if (Number(o.starts) === 0 && m.homeBredRaced === null) {
        const r = await run.act(a, "home_bred_race", () => createStoryRace(db, s, { horseId: o.id, instant: true }, now));
        if (r) {
          m.homeBredRaced = day;
          a.storyToday++;
        }
      } else if (Number(o.starts) > 0) m.homeBredRaced = first(m.homeBredRaced, day);
    }
  }

  // Story: the race the Story screen suggests. One a visit whatever (the game's own pick, tired
  // or not: Story is what there is to do on demand); more only while a rested horse can run.
  for (let i = 0; i < a.p.storyPerVisit; i++) {
    view = (await run.act(a, "player_view", () => playerView(db, s, now))) ?? view;
    const can = view.horses.filter((h) => h.careerStatus === "racing" && !h.block && !h.lockedRaceId);
    if (!can.length) break;
    if (i > 0 && !can.some((h) => h.condition !== "tired" && h.ranToday < 2)) break;
    const sv = await run.act(a, "story_view", () => storyView(db, s, now));
    const chapter = sv?.chapters.find((ch) => ch.unlocked && !ch.complete);
    const key = (sv?.suggested && chapter?.races.find((r) => r.key === sv.suggested && !r.won)?.key) ?? chapter?.races.find((r) => !r.won && r.bestHorse)?.key;
    const r = key ? await run.act(a, "story_race", () => createChapterRace(db, s, { raceKey: key, instant: true }, now)) : await run.act(a, "story_open", () => createStoryRace(db, s, { instant: true }, now));
    if (!r) break;
    a.storyToday++;
  }

  // Live: Quick Pick finds the soonest race that suits a free horse.
  while (a.liveToday < a.p.livePerDay) {
    const pick = await run.act(a, "live_quick_pick", () => quickPickLive(db, s, now));
    if (!pick) break;
    a.liveToday++;
  }

  // The free Paddock Pack (every third play day), when a stall is free.
  const packs = await run.act(a, "packs_view", () => packsView(db, s, now));
  if (packs?.paddock.freeAvailable && packs.stalls.free > 0) await run.act(a, "pack_free", () => pull(db, s, { packType: "paddock", free: true, key: `fw-${a.index}-free-${now.getTime()}` }, now));

  // The first-week jobs a routine doesn't do by itself (engaged): one a visit.
  if (a.p.guide) await guide(run, a, s, now);

  // Training (engaged), after the racing: one session a day for each fresh horse that hasn't run
  // today (a race or a session each takes about a day's recovery: both would leave it tired).
  if (a.p.trains && a.trainedDay !== day) {
    a.trainedDay = day;
    view = (await run.act(a, "player_view", () => playerView(db, s, now))) ?? view;
    let credits = view.credits;
    for (const h of view.horses) {
      if (h.careerStatus !== "racing" || h.lockedRaceId || h.injury || h.condition !== "fresh" || h.ranToday > 0 || credits < 800) continue;
      if (h.stage === "foal" || h.stage === "weanling" || h.stage === "yearling") continue;
      const life = await run.act(a, "horse_life", () => horseLifeView(db, s, h.id, now));
      if (!life?.training.available || !life.training.nextWorkout || life.training.nextWorkout === "rest") continue;
      const r = await run.act(a, "train", () => trainAction(db, s, h.id, { expectedSession: life.training.sessionsUsed }, now));
      if (r?.ran) credits -= r.cost;
    }
  }

  // Spending beyond the running costs (engaged), once the first covering is paid for.
  if (a.p.spends && m.covered !== null) {
    const credits = (await run.act(a, "player_view", () => playerView(db, s, now)))?.credits ?? 0;
    if (m.paddockPackBought === null && packs?.paddock.enabled && packs.stalls.free > 0 && credits >= gc.PADDOCK_PACK_PRICE + 1_000) {
      if (await run.act(a, "pack_paid", () => pull(db, s, { packType: "paddock", free: false, key: `fw-${a.index}-paid-${now.getTime()}` }, now))) m.paddockPackBought = day;
    } else if (m.paddockPackBought !== null && m.vetBought === null && credits >= gc.FACILITY_COSTS.vet[0] + 1_000) {
      const f = await run.act(a, "facilities_view", () => facilitiesView(db, s));
      const vet = f?.items.find((i) => i.key === "vet");
      if (vet && vet.nextCost !== null && (await run.act(a, "facility", () => facilityAction(db, s, "vet", vet.level + 1, now)))?.bought) m.vetBought = day;
    }
  }
}

async function breeding(run: Run, a: Agent, s: Session, now: Date, day: number): Promise<void> {
  const { db } = run;
  const m = a.milestones;
  const v = await run.act(a, "breeding_view", () => breedingView(db, s, now));
  if (!v) return;
  for (const p of v.pregnancies) {
    if (p.status !== "carrying" || p.dueAtMs > now.getTime()) continue;
    if (await run.act(a, "foal", () => foalAndName(db, s, { pregnancyId: p.id }, now))) m.foalBorn = first(m.foalBorn, day);
  }
  const mare = v.mares.find((x) => x.block === null);
  const own = v.stallions.find((x) => x.block === null);
  if (mare) m.mareCanBreed = first(m.mareCanBreed, day);
  if (own) m.ownStallionCanBreed = first(m.ownStallionCanBreed, day);
  if (!mare || m.covered !== null) return;
  // Their own stallion costs the covering fee only; else the cheapest Club stud standing for credits.
  const club = v.studs.filter((x) => x.block === null && x.club && x.studFeeUsdg === null).sort((x, y) => x.studFee - y.studFee)[0];
  const sire = own ? { id: own.id, fee: 0, kind: "own" as const } : club ? { id: club.id, fee: club.studFee, kind: "club" as const } : null;
  if (!sire || v.credits < v.baseFee + sire.fee) return;
  const r = await run.act(a, "cover", () => coverMare(db, s, { sireId: sire.id, damId: mare.id, key: `fw-${a.index}-cover-${now.getTime()}` }, now));
  if (!r) return;
  m.covered = day;
  m.coverCost = v.baseFee + sire.fee;
  m.coverSire = sire.kind;
}

/** One of the first-week jobs: a training plan, a tip, a target race, a look at the stallion finder. */
async function guide(run: Run, a: Agent, s: Session, now: Date): Promise<void> {
  const { db } = run;
  const view = await run.act(a, "player_view", () => playerView(db, s, now));
  const steps = view?.onboarding?.steps;
  if (!view || !steps || steps.complete) return;
  const todo = new Set(steps.steps.filter((x) => !x.done).map((x) => x.key));
  const racer = view.horses.find((h) => h.careerStatus === "racing" && !h.lockedRaceId && h.stage !== "foal" && h.stage !== "weanling" && h.stage !== "yearling");
  if (todo.has("train_plan") && racer) {
    const life = await run.act(a, "horse_life", () => horseLifeView(db, s, racer.id, now));
    if (life?.training.available) {
      const allowed = life.training.workouts.filter((w) => w.allowed && w.key !== "rest").map((w) => w.key);
      const plan = Array.from({ length: life.training.slots }, (_, i) => (i === life.training.slots - 1 || !allowed.length ? "rest" : allowed[i % allowed.length]!));
      await run.act(a, "training_plan", () => savePlanAction(db, s, racer.id, plan, now));
    }
    return;
  }
  if (todo.has("pick")) {
    const list = await run.act(a, "race_list", () => raceList(db, now, s.stable.id));
    for (const r of (list?.upcoming ?? []).filter((x) => x.kind === "live").slice(0, 4)) {
      const card = await run.act(a, "race_card", () => raceCard(db, r.id, now, s.stable.id));
      const runner = card && card.status === "open" && card.field.every((e) => !e.mine) ? card.field[0] : undefined;
      if (runner) {
        await run.act(a, "pick", () => pickRunner(db, s, r.id, runner.horse.id, now));
        return;
      }
    }
  }
  if (todo.has("pin_target") && racer) {
    const options = await run.act(a, "plan_candidates", () => planCandidates(db, s, racer.id, now));
    const target = options?.find((o) => !o.reason && !o.calendar);
    if (target) {
      await run.act(a, "pin_target", () => pinTarget(db, s, { horseId: racer.id, raceId: target.raceId, slotIndex: target.slotIndex }, now));
      return;
    }
  }
  if (todo.has("breeding_preview")) {
    const v = await run.act(a, "breeding_view", () => breedingView(db, s, now));
    const mare = v?.mares[0];
    const sire = v?.studs[0];
    if (mare && sire) await run.act(a, "breeding_preview", () => breedingPreview(db, s, { sireId: sire.id, damId: mare.id }, now));
  }
}

/** Cumulative credits per ledger kind for one account (positive in, negative out, kept apart). */
async function flows(db: Db, accountId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of await q<{ kind: string; pos: string; neg: string }>(
    db,
    `select t.kind, sum(greatest(p.amount, 0))::bigint pos, sum(greatest(-p.amount, 0))::bigint neg
       from ledger_postings p join ledger_transactions t on t.id = p.transaction_id join ledger_accounts la on la.id = p.ledger_account_id
      where la.kind = 'player' and la.currency = 'CR' and la.owner_account_id = '${accountId}' group by 1`,
  )) {
    out[`+${r.kind}`] = Number(r.pos);
    out[`-${r.kind}`] = Number(r.neg);
  }
  return out;
}

async function sample(run: Run, a: Agent, day: number, dayEndMs: number): Promise<void> {
  const cur = await flows(run.db, a.accountId);
  const earned: Record<string, number> = {};
  const spent: Record<string, number> = {};
  for (const [k, v] of Object.entries(cur)) {
    const d = v - (a.prev[k] ?? 0);
    if (d <= 0) continue;
    (k.startsWith("+") ? earned : spent)[k.slice(1)] = d;
  }
  a.prev = cur;
  const [row] = await q<{ bal: string; horses: number; licence: number; mare: number; colt: number; injured: number }>(
    run.db,
    `select coalesce((select balance from ledger_accounts where owner_account_id = '${a.accountId}' and kind = 'player' and currency = 'CR'), 0)::bigint bal,
            (select count(*)::int from horses where owner_stable_id = '${a.stableId}' and career_status <> 'pasture') horses,
            coalesce((select licence_level from stables where id = '${a.stableId}'), 1) licence,
            coalesce((select max(starts) from horses where owner_stable_id = '${a.stableId}' and sex = 'female'), 0) mare,
            coalesce((select max(starts) from horses where owner_stable_id = '${a.stableId}' and sex = 'male' and not gelded), 0) colt,
            (select count(*)::int from horses where owner_stable_id = '${a.stableId}' and injured_until > '${new Date(dayEndMs).toISOString()}') injured`,
  );
  const wins = await q<{ live: boolean }>(
    run.db,
    `select (r.kind <> 'quick') live from race_entries e join races r on r.id = e.race_id where e.stable_id = '${a.stableId}' and e.finish_position = 1 and r.status = 'settled'`,
  );
  const m = a.milestones;
  if (wins.length) m.firstWin = first(m.firstWin, day);
  if (wins.some((w) => w.live)) m.firstLiveWin = first(m.firstLiveWin, day);
  if (Number(row?.licence ?? 1) >= 2) m.chapter1 = first(m.chapter1, day);
  a.days.push({ day, earned, spent, balance: Number(row?.bal ?? 0), horses: Number(row?.horses ?? 0), storyRaces: a.storyToday, liveEntries: a.liveToday, mareStarts: Number(row?.mare ?? 0), coltStarts: Number(row?.colt ?? 0), injured: Number(row?.injured ?? 0) });
}

export async function runFirstWeek(o: FirstWeekOptions): Promise<FirstWeekResult> {
  const handle = await createDb({ url: null, pglite: "memory" });
  try {
    const run = new Run(handle.db, o.startMs);
    const agents: Agent[] = [];
    let index = 0;
    for (const key of ["casual", "engaged"] as const) {
      for (let i = 0; i < o.perPersona; i++, index++) {
        // Founded just after midnight of day 1 (the founding grant lands before the first sample).
        const acc = await foundStable(handle.db, { stableName: `Week Yard ${index + 1}`, silks: { pattern: "hoops", primary: "#112233", secondary: "#c8a040", cap: "#112233" }, timezone: "Europe/London", inviteCode: null, now: new Date(o.startMs + MIN) });
        agents.push({
          index,
          persona: key,
          p: PERSONAS[key],
          accountId: acc.accountId,
          stableId: acc.stableId,
          offsetMin: (i * 7) % 40,
          days: [],
          refused: {},
          liveToday: 0,
          storyToday: 0,
          trainedDay: 0,
          prev: {},
          milestones: { firstWin: null, firstLiveWin: null, chapter1: null, mareCanBreed: null, ownStallionCanBreed: null, covered: null, coverCost: null, coverSire: null, foalBorn: null, homeBredRacingAge: null, homeBredRaced: null, giftFoalRacingAge: null, paddockPackBought: null, vetBought: null },
        });
      }
    }
    const end = o.startMs + o.days * DAY;
    const visits: { atMs: number; a: Agent; first: boolean }[] = [];
    for (let d = 0; d < o.days; d++) for (const a of agents) a.p.visits.forEach((h, i) => visits.push({ atMs: o.startMs + d * DAY + Math.round(h * 60 + a.offsetMin) * MIN, a, first: i === 0 }));
    visits.sort((x, y) => x.atMs - y.atMs || x.a.index - y.a.index);
    let next = 0;
    let dayStart = o.startMs;
    const wall = Date.now();
    for (let t = o.startMs; ; t = Math.min(t + RULES.slotMs, end)) {
      try {
        await driveCard(handle.db, new Date(t), { force: true, maintenance: true });
      } catch (e) {
        run.errors.push(`driveCard: ${e instanceof Error ? e.message : String(e)}`);
      }
      while (t >= dayStart + DAY) {
        const day = Math.round((dayStart - o.startMs) / DAY) + 1;
        for (const a of agents) await sample(run, a, day, dayStart + DAY);
        o.log?.(`day ${day}: ${Math.round((Date.now() - wall) / 1000)} s, ${run.errors.length} errors`);
        dayStart += DAY;
      }
      if (t >= end) break;
      const until = Math.min(t + RULES.slotMs, end);
      while (next < visits.length && visits[next]!.atMs < until) {
        const v = visits[next++]!;
        await visit(run, v.a, new Date(Math.max(t, v.atMs)), v.first);
      }
    }
    // Live runs by the horse's start number (its first Live start, second ...).
    const liveRows = await q<{ horse_id: string; pos: number; field: number; rb: number; ra: number | null }>(
      handle.db,
      `select e.horse_id, e.finish_position pos, (select count(*)::int from race_entries x where x.race_id = e.race_id and x.finish_position is not null) field, e.rating_before rb, e.rating_after ra
         from race_entries e join races r on r.id = e.race_id
        where e.stable_id is not null and not e.is_house and r.kind <> 'quick' and r.status = 'settled' and e.finish_position is not null order by r.post_time`,
    );
    const nth = new Map<string, number>();
    const byStart = new Map<number, typeof liveRows>();
    for (const r of liveRows) {
      const n = (nth.get(r.horse_id) ?? 0) + 1;
      nth.set(r.horse_id, n);
      byStart.set(n, [...(byStart.get(n) ?? []), r]);
    }
    const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);
    const live = [...byStart.entries()].filter(([n]) => n <= 6).map(([start, rs]) => ({
      start,
      runs: rs.length,
      winPct: pct(rs.filter((r) => Number(r.pos) === 1).length, rs.length),
      top3Pct: pct(rs.filter((r) => Number(r.pos) <= 3).length, rs.length),
      lastPct: pct(rs.filter((r) => Number(r.pos) === Number(r.field)).length, rs.length),
      meanRatingDelta: Math.round((100 * rs.reduce((s, r) => s + (Number(r.ra ?? r.rb) - Number(r.rb)), 0)) / rs.length) / 100,
    }));
    return {
      rules: {
        BREED_FROM_STARTS: gc.BREED_FROM_STARTS,
        CARE_TO_RACING: gc.CARE_TO_RACING,
        PREGNANCY_HOURS: gc.PREGNANCY_MS / 3_600_000,
        BREEDING_BASE_FEE: gc.BREEDING_BASE_FEE,
        STARTER_GRANT: gc.STARTER_GRANT,
        PADDOCK_PACK_PRICE: gc.PADDOCK_PACK_PRICE,
        STALL_7: gc.stallCost(7),
        VET_1: gc.FACILITY_COSTS.vet[0],
        TRAINER_1: gc.FACILITY_COSTS.trainer[0],
        INITIAL_OR: gc.INITIAL_OR,
      },
      stables: agents.map(({ index: i, persona, accountId, stableId, days, milestones, refused }) => ({ index: i, persona, accountId, stableId, days, milestones, refused })),
      live,
      errors: run.errors.slice(0, 50),
    };
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const med = (xs: readonly number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
};
const sumOf = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

/** Plain-text tables: per persona, the day-by-day credits (medians) and the milestones. */
export function firstWeekReport(res: FirstWeekResult): string {
  const lines: string[] = [];
  lines.push(`Rules: ${Object.entries(res.rules).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  for (const key of ["casual", "engaged"] as const) {
    const ss = res.stables.filter((s) => s.persona === key);
    if (!ss.length) continue;
    lines.push("", `## ${key} (${ss.length} stables; medians)`, "", "| Day | Earned | Spent | Balance (min-max) | Horses | Story | Live | Filly starts | Top sources | Top sinks |", "|---:|---:|---:|---:|---:|---:|---:|---:|---|---|");
    const days = ss[0]!.days.length;
    for (let d = 0; d < days; d++) {
      const rows = ss.map((s) => s.days[d]!);
      const top = (pick: (r: DayRow) => Record<string, number>) => {
        const tot: Record<string, number> = {};
        for (const r of rows) for (const [k, v] of Object.entries(pick(r))) tot[k] = (tot[k] ?? 0) + v;
        return Object.entries(tot).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round(v / rows.length)}`).join(", ");
      };
      const bal = rows.map((r) => r.balance);
      lines.push(`| ${d + 1} | ${med(rows.map((r) => sumOf(r.earned)))} | ${med(rows.map((r) => sumOf(r.spent)))} | ${med(bal)} (${Math.min(...bal)}-${Math.max(...bal)}) | ${med(rows.map((r) => r.horses))} | ${med(rows.map((r) => r.storyRaces))} | ${med(rows.map((r) => r.liveEntries))} | ${med(rows.map((r) => r.mareStarts))} | ${top((r) => r.earned)} | ${top((r) => r.spent)} |`);
    }
    lines.push("", "| Milestone | Stables | Median day | Earliest | Latest |", "|---|---:|---:|---:|---:|");
    const keys: (keyof Milestones)[] = ["firstWin", "firstLiveWin", "chapter1", "mareCanBreed", "ownStallionCanBreed", "covered", "foalBorn", "giftFoalRacingAge", "homeBredRacingAge", "homeBredRaced", "paddockPackBought", "vetBought"];
    for (const k of keys) {
      const v = ss.map((s) => s.milestones[k]).filter((x): x is number => typeof x === "number");
      lines.push(`| ${k} | ${v.length}/${ss.length} | ${v.length ? med(v) : "-"} | ${v.length ? Math.min(...v) : "-"} | ${v.length ? Math.max(...v) : "-"} |`);
    }
    const costs = ss.map((s) => s.milestones.coverCost).filter((x): x is number => x !== null);
    lines.push("", `First covering: ${costs.length ? `median cost ${med(costs)}, own stallion ${ss.filter((s) => s.milestones.coverSire === "own").length}, Club stud ${ss.filter((s) => s.milestones.coverSire === "club").length}` : "none"}.`);
    const total = (pick: (r: DayRow) => Record<string, number>, upTo: number) => med(ss.map((s) => s.days.slice(0, upTo).reduce((n, r) => n + sumOf(pick(r)), 0)));
    lines.push(`Days 1-7: earned ${total((r) => r.earned, 7)} (with the ${res.rules.STARTER_GRANT} starter grant), spent ${total((r) => r.spent, 7)}.`);
    lines.push(`A horse injured at the end of a day in days 1-7: ${ss.filter((s) => s.days.slice(0, 7).some((r) => r.injured > 0)).length} of ${ss.length} stables.`);
  }
  lines.push("", "## Live starts of these stables' horses (all personas)", "", "| Horse's Live start | Runs | Win | Top 3 | Last | Mean rating change |", "|---:|---:|---:|---:|---:|---:|");
  for (const l of res.live) lines.push(`| ${l.start} | ${l.runs} | ${l.winPct}% | ${l.top3Pct}% | ${l.lastPct}% | ${l.meanRatingDelta} |`);
  if (res.errors.length) lines.push("", `Errors (${res.errors.length}): ${res.errors.slice(0, 5).join(" | ")}`);
  return lines.join("\n");
}
