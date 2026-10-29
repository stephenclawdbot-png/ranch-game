/**
 * Horse life on the server: views for the horse tabs (care, condition, training, career),
 * the nursery and facilities, and the actions behind them. Every action calls a
 * @thoroughbred/db service (transactional, idempotent, ledgered), which calls game-core.
 * Clients send choices (feed, plan, which facility level to buy), never outcomes.
 */
import * as gc from "@thoroughbred/game-core";
import {
  DomainError,
  RULES,
  STABLE_HAND_COST,
  awaitingGraduation,
  buyFacility,
  careDayOf,
  careForAll,
  careForHorse,
  currentTrainingPlan,
  facilityLevels,
  facilityOffers,
  getBalance,
  getHorse,
  graduateFoal,
  isCarrying,
  isGenome,
  lastCareDays,
  listStableHorses,
  moveToLegacyFarm,
  occupancy,
  releaseToClub,
  renameHorse,
  retireHorse,
  runTrainingSession,
  saveTrainingPlan,
  scanPedigree,
  stableOf,
  toHorseState,
  treatHorseInjury,
  vetTreatedOn,
  buyInsurance,
  type FacilityKey,
  type HorseRow,
  type StableRow,
} from "@thoroughbred/db";
import type { Db } from "./db";
import type { Session } from "./session";
import { geneticsLineOf, horseFromRow, parseSilks, stableHorseView } from "./horseView";
import type {
  CareView,
  CareerView,
  ConditionView,
  FacilitiesView,
  FacilityItem,
  GrowthView,
  HorseLifeView,
  NurseryFoal,
  NurseryView,
  RangeView,
  StatKey,
  TrainingView,
} from "@/lib/horseLife";
import { STAT_NAMES } from "@/lib/horseLife";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATS = gc.STAT_KEYS as readonly StatKey[];
const HOUR = 3_600_000;

const FEED_TEXT: Record<gc.Feed, [string, string]> = {
  growth_mix: ["Growth mix", "For foals, weanlings and yearlings"],
  performance: ["Performance", "For horses in work and racing"],
  recovery: ["Recovery", "For tired or injured horses"],
  maintenance: ["Maintenance", "A safe all-rounder"],
};

const STAGE_TEXT: Record<string, string> = {
  foal: "Foal",
  weanling: "Weanling",
  yearling: "Yearling",
  juvenile: "Juvenile",
  prime: "Prime",
  veteran: "Veteran",
  stud: "At stud",
  pasture: "Legacy Farm",
};

const MATURITY_TEXT: Record<"early" | "normal" | "late", [string, string]> = {
  early: ["Early peaker", "Comes to hand quickly and is at its best in the first half of its career."],
  normal: ["Normal maturity", "Peaks through the middle of its career."],
  late: ["Late developer", "Keeps improving and is at its best later in its career."],
};

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function growthOf(careSessions: number): GrowthView | null {
  const s = careSessions;
  if (s >= gc.CARE_TO_RACING) return null;
  const bounds: [GrowthView["stage"], number, number, string][] = [
    ["foal", 0, gc.CARE_TO_WEAN, "Weanling"],
    ["weanling", gc.CARE_TO_WEAN, gc.CARE_TO_YEARLING, "Yearling"],
    ["yearling", gc.CARE_TO_YEARLING, gc.CARE_TO_RACING, "Racing age"],
  ];
  const [stage, from, to, nextLabel] = bounds.find(([, , to]) => s < to)!;
  return {
    stage,
    stageLabel: STAGE_TEXT[stage]!,
    sessions: s,
    inStage: s - from,
    stageLength: to - from,
    nextLabel,
    toNext: to - s,
    toRacing: gc.CARE_TO_RACING - s,
    racingAt: gc.CARE_TO_RACING,
  };
}

function careView(row: HorseRow, day: string, lastDay: string | null, nowMs: number): CareView {
  const state = isGenome(row.genome) ? toHorseState(row) : null;
  const rec = state ? gc.recommendedFeed(state, nowMs) : "maintenance";
  return {
    caredToday: !!lastDay && lastDay >= day,
    day,
    lastCareDay: lastDay,
    sessions: row.careSessions,
    growth: growthOf(row.careSessions),
    feeds: gc.FEEDS.map((f) => ({ key: f, label: FEED_TEXT[f][0], hint: FEED_TEXT[f][1], recommended: f === rec })),
    bond: row.bond,
    careQuality: row.careQuality,
    canCare: row.careerStatus !== "pasture",
  };
}

function rangesOf(state: gc.HorseState): RangeView[] {
  const r = gc.revealedRanges(state);
  return STATS.map((k) => ({ key: k, label: STAT_NAMES[k], lo: r[k].lo, hi: r[k].hi, loGrade: r[k].loGrade, hiGrade: r[k].hiGrade, exact: r[k].exact }));
}

function peakOf(lastHardWorkMs: number | null, nowMs: number): ConditionView["peak"] {
  const bonus = gc.freshnessBonus(lastHardWorkMs, nowMs);
  if (lastHardWorkMs === null) return { phase: "none", fromMs: null, toMs: null, bonus };
  const fromMs = lastHardWorkMs + 72 * HOUR;
  const toMs = lastHardWorkMs + 120 * HOUR;
  const h = (nowMs - lastHardWorkMs) / HOUR;
  const phase = h < 72 ? "building" : h <= 120 ? "peak" : h < 192 ? "fading" : "none";
  return { phase, fromMs, toMs, bonus };
}

async function conditionView(db: Db, row: HorseRow, state: gc.HorseState, horse: ReturnType<typeof horseFromRow>, day: string, nowMs: number): Promise<ConditionView> {
  const stage = gc.stageOf(state);
  const inj = state.injury && !gc.isHealed(state.injury, nowMs) ? state.injury : null;
  const risks = (["conservative", "normal", "all_out"] as const).map((intensity) => {
    const r = gc.injuryRisk(state, { nowMs, going: "good", distanceM: horse.preferredDistanceM, intensity, stage });
    return { intensity, label: r.label, permille: r.permille, careerEndingShare: r.careerEndingShare, factors: r.factors.map((f) => f.text) };
  });
  // The quote for the insurance panel: the normal-ride risk in the same context as the horse
  // page's risk badge (stableHorseView), so the two always agree.
  const careerEndingPerRace = (risks[1]!.permille * risks[1]!.careerEndingShare) / 1000;
  return {
    fatigue: gc.fatigueAt(state, nowMs),
    freshness: gc.freshnessBar(state, nowMs),
    fitness: state.condition.fitness,
    morale: gc.morale(state),
    peak: peakOf(state.condition.lastHardWorkMs, nowMs),
    injury: inj
      ? {
          severity: inj.severity,
          label: inj.severity === "career_ending" ? "Career-ending injury" : inj.severity === "moderate" ? "Moderate injury" : "Minor injury",
          hoursLeft: gc.hoursToHeal(inj, nowMs),
          untilMs: nowMs + gc.hoursToHeal(inj, nowMs) * HOUR,
          careerEnding: inj.severity === "career_ending",
          vetCost: gc.VET_TREATMENT_COST,
          treatedToday: await vetTreatedOn(db, row.id, inj.atMs, day),
        }
      : null,
    risks,
    insurance: {
      insured: row.insured,
      premium: gc.insurancePremium(state),
      payout: gc.insurancePayout(state),
      available: row.careerStatus === "racing" && !row.insured,
      careerEndingPerRace,
    },
  };
}

async function trainingView(db: Db, row: HorseRow, state: gc.HorseState, horse: ReturnType<typeof horseFromRow>, stable: StableRow, nowMs: number, credits: number): Promise<TrainingView> {
  const lv = facilityLevels(stable);
  const slots = gc.slotsFor(lv.trainer);
  const saved = await currentTrainingPlan(db, row.id);
  const allowed = new Set(gc.allowedWorkouts(state));
  const fallback = gc.DEFAULT_PLAN.slots.map((w) => (allowed.has(w) ? w : "rest"));
  let plan: string[] = saved?.slots ?? fallback;
  if (plan.length < slots) plan = [...plan, ...Array(slots - plan.length).fill("rest")];
  if (plan.length > slots) plan = plan.slice(0, slots);
  const week = gc.weekIndex(nowMs);
  const used = state.training.week === week ? state.training.sessionsThisWeek : 0;
  const stage = gc.stageOf(state);
  let blockedReason: string | null = null;
  if (row.careerStatus !== "racing") blockedReason = "Retired horses don't train.";
  else if (stage === "foal" || stage === "weanling") blockedReason = `Training opens at yearling (${gc.CARE_TO_YEARLING} care sessions; ${row.careSessions} so far).`;
  else if (row.lockKind === "race") blockedReason = "Entered in a race: training resumes after it.";
  else if (row.lockKind === "market") blockedReason = "Listed on the market.";
  return {
    available: blockedReason === null,
    blockedReason,
    slots,
    plan,
    sessionsUsed: used,
    nextWorkout: used < slots ? (plan[used] ?? null) : null,
    weekResetsMs: gc.weekStartMs(week + 1),
    workouts: (Object.keys(gc.WORKOUTS) as gc.Workout[]).map((w) => {
      const spec = gc.WORKOUTS[w];
      return { key: w, label: spec.label, cost: spec.cost, fatigue: spec.fatigue, hard: spec.hard, allowed: allowed.has(w), trains: Object.keys(spec.gains) as StatKey[] };
    }),
    realisation: STATS.map((k) => {
      const r = state.training.realisation[k];
      return { key: k, label: STAT_NAMES[k], permille: r, nearCeiling: r >= 920, current: horse.stats[k] };
    }),
    trainerLevel: lv.trainer,
    lightOnly: stage === "yearling",
    // the trade-off board: what the next session would do for each workout, before committing
    previews: used < slots
      ? (Object.keys(gc.WORKOUTS) as gc.Workout[]).map((w) => {
          const p = gc.previewTraining(state, w, { nowMs, trainerLevel: lv.trainer, vetLevel: lv.vet, credits });
          return { key: w, block: p.block, gains: p.gains, fatigueBefore: p.fatigueBefore, fatigueAfter: p.fatigueAfter, overworked: p.overworked, injuryPermille: p.injuryPermille, setsUpPeak: p.setsUpPeak };
        })
      : [],
  };
}

async function careerView(db: Db, row: HorseRow, state: gc.HorseState): Promise<CareerView> {
  const stage = gc.stageOf(state);
  const type = gc.maturityType(state.genome) as "early" | "normal" | "late";
  const [peakFrom, peakTo] = gc.PEAK_WINDOW[type];
  const carrying = await isCarrying(db, row.id);
  const lockReason = row.lockKind === "race" ? "Entered in a race" : row.lockKind === "market" ? "Listed on the market" : carrying ? "In foal" : null;
  const racingStage = row.careSessions >= gc.CARE_TO_RACING;
  const starts = row.starts;
  const current = (from: number, to: number) => row.careerStatus === "racing" && racingStage && starts >= from && starts <= to;
  return {
    starts,
    maxStarts: gc.CAREER_MAX_STARTS,
    stage,
    stageLabel: STAGE_TEXT[stage] ?? stage,
    careerStatus: row.careerStatus,
    retirementReason: row.retirementReason,
    stages: [
      { key: "juvenile", label: "Juvenile", from: 0, to: gc.JUVENILE_MAX_STARTS, current: current(0, gc.JUVENILE_MAX_STARTS) },
      { key: "prime", label: "Prime", from: gc.JUVENILE_MAX_STARTS + 1, to: gc.PRIME_MAX_STARTS, current: current(gc.JUVENILE_MAX_STARTS + 1, gc.PRIME_MAX_STARTS) },
      { key: "veteran", label: "Veteran", from: gc.PRIME_MAX_STARTS + 1, to: gc.CAREER_MAX_STARTS, current: current(gc.PRIME_MAX_STARTS + 1, gc.CAREER_MAX_STARTS) },
    ],
    maturity: { type, label: MATURITY_TEXT[type][0], peakFrom, peakTo, blurb: MATURITY_TEXT[type][1] },
    ranges: rangesOf(state),
    scanned: row.scanned,
    scanCost: gc.PEDIGREE_SCAN_COST,
    canRename: row.starts === 0,
    canRetire: row.careerStatus === "racing" && racingStage && row.lockKind !== "race",
    canLegacy: row.careerStatus !== "pasture" && !lockReason,
    canRelease: !lockReason,
    releasePayout: RULES.releasePayout,
    bound: row.bound,
    lockReason,
    breedingsLeft: Math.max(0, gc.BREEDINGS_LIFETIME - row.breedingCount),
    racingAge: racingStage,
  };
}

async function ownedRow(db: Db, session: Session, horseId: string): Promise<HorseRow | null> {
  if (!UUID_RE.test(horseId)) return null;
  const row = await getHorse(db, horseId);
  if (!row || row.ownerStableId !== session.stable.id || !isGenome(row.genome)) return null;
  return row;
}

/** Everything the owner's horse tabs show. Null when the horse isn't the viewer's. */
export async function horseLifeView(db: Db, session: Session, horseId: string, now: Date): Promise<HorseLifeView | null> {
  const row = await ownedRow(db, session, horseId);
  if (!row) return null;
  const nowMs = now.getTime();
  const stable = await stableOf(db, session.accountId);
  const silks = parseSilks(stable.silks);
  const state = toHorseState(row);
  const horse = horseFromRow(row, silks, nowMs);
  const day = await careDayOf(db, session.accountId, now);
  const last = (await lastCareDays(db, [row.id])).get(row.id) ?? null;
  const balance = await getBalance(db, session.accountId);
  return {
    id: row.id,
    name: row.name,
    horse,
    status: stableHorseView(row, silks, nowMs),
    care: careView(row, day, last, nowMs),
    condition: await conditionView(db, row, state, horse, day, nowMs),
    training: await trainingView(db, row, state, horse, stable, nowMs, balance),
    career: await careerView(db, row, state),
    credits: balance,
    stableHand: facilityLevels(stable).stableHand > 0,
    serverNowMs: nowMs,
  };
}

/** The nursery: foals growing through care, graduates ready to race, the overflow slot. */
export async function nurseryView(db: Db, session: Session, now: Date): Promise<NurseryView> {
  const nowMs = now.getTime();
  const stable = await stableOf(db, session.accountId);
  const silks = parseSilks(stable.silks);
  const rows = (await listStableHorses(db, stable.id)).filter((r) => r.careerStatus !== "pasture" && isGenome(r.genome));
  const day = await careDayOf(db, session.accountId, now);
  const last = await lastCareDays(db, rows.map((r) => r.id));
  const foal = (r: HorseRow): NurseryFoal => ({
    id: r.id,
    name: r.name,
    horse: horseFromRow(r, silks, nowMs),
    geneticsLine: geneticsLineOf(r),
    care: careView(r, day, last.get(r.id) ?? null, nowMs),
    ranges: rangesOf(toHorseState(r)),
    scanned: r.scanned,
    awaitingGraduation: awaitingGraduation(r),
  });
  const occ = await occupancy(db, stable);
  return {
    foals: rows.filter((r) => r.careSessions < gc.CARE_TO_RACING).map(foal),
    graduates: rows.filter((r) => awaitingGraduation(r)).map(foal),
    stalls: { slots: occ.slots, used: occ.used, free: occ.free, overflow: occ.overflow, overflowSlots: RULES.nurseryOverflowSlots },
    stableHand: facilityLevels(stable).stableHand > 0,
    scanCost: gc.PEDIGREE_SCAN_COST,
    credits: await getBalance(db, session.accountId),
    uncared: rows.filter((r) => !((last.get(r.id) ?? "") >= day)).length,
  };
}

const credits = (n: number) => n.toLocaleString("en-GB");

/** Stable facilities with their game-core prices. */
export async function facilitiesView(db: Db, session: Session): Promise<FacilitiesView> {
  const stable = await stableOf(db, session.accountId);
  const occ = await occupancy(db, stable);
  const items: FacilityItem[] = facilityOffers(stable).map((o) => {
    switch (o.key) {
      case "stalls":
        return {
          key: o.key,
          name: "Stalls",
          blurb: "Room for more horses. A full stable never loses a foal: it waits in the nursery overflow slot.",
          level: o.level,
          maxLevel: o.maxLevel,
          levelLabel: `${o.level} of ${o.maxLevel} stalls`,
          now: `${o.level} stalls (${occ.used} in use)`,
          next: o.nextCost === null ? null : `${o.level + 1} stalls`,
          nextCost: o.nextCost,
        };
      case "entries":
        return {
          key: o.key,
          name: "Entry office",
          blurb: "More Live race entries each day, and a bigger bank for the days you play more.",
          level: o.level,
          maxLevel: o.maxLevel,
          levelLabel: `Tier ${o.level} of ${o.maxLevel}`,
          now: `+${gc.dailyAllowance(o.level)} a day, bank up to ${gc.bankCap(o.level)}`,
          next: o.nextCost === null ? null : `+${gc.dailyAllowance(o.level + 1)} a day, bank up to ${gc.bankCap(o.level + 1)}`,
          nextCost: o.nextCost,
        };
      case "trainer":
        return {
          key: o.key,
          name: "Trainer",
          blurb: "Better training: a fourth weekly session and more from every workout.",
          level: o.level,
          maxLevel: o.maxLevel,
          levelLabel: `Level ${o.level} of ${o.maxLevel}`,
          now: o.level === 0 ? `${gc.slotsFor(0)} sessions a week` : `${gc.slotsFor(o.level)} sessions a week, +${o.level * 10}% gains`,
          next: o.nextCost === null ? null : `${gc.slotsFor(o.level + 1)} sessions a week, +${(o.level + 1) * 10}% gains`,
          nextCost: o.nextCost,
        };
      case "vet":
        return {
          key: o.key,
          name: "Vet",
          blurb: "Injuries heal faster. Healing always carries on while you're away.",
          level: o.level,
          maxLevel: o.maxLevel,
          levelLabel: `Level ${o.level} of ${o.maxLevel}`,
          now: o.level === 0 ? "Normal healing" : `Heals ${o.level * 25}% faster`,
          next: o.nextCost === null ? null : `Heals ${(o.level + 1) * 25}% faster`,
          nextCost: o.nextCost,
        };
      default:
        return {
          key: o.key,
          name: "Stable hand",
          blurb: "Cares for every horse in one tap with the right feed. Each horse still counts once a day.",
          level: o.level,
          maxLevel: o.maxLevel,
          levelLabel: o.level ? "Hired" : "Not hired",
          now: o.level ? "Care for all in one tap" : "Care for each horse yourself",
          next: o.nextCost === null ? null : "Care for all in one tap",
          nextCost: o.nextCost,
        };
    }
  });
  return { credits: await getBalance(db, session.accountId), items, stalls: { slots: occ.slots, used: occ.used } };
}

// ---------------------------------------------------------------------------
// Actions (thin wrappers: the db services do the work)
// ---------------------------------------------------------------------------

/** Rejects malformed ids early; ownership is checked by the db service under its row lock. */
function assertId(horseId: string): void {
  if (!UUID_RE.test(horseId)) throw new DomainError("NOT_FOUND", "horse not found");
}

export async function careAction(db: Db, session: Session, horseId: string, body: { feed?: string; groom?: boolean; turnout?: boolean }, now: Date) {
  assertId(horseId);
  const r = await careForHorse(db, { accountId: session.accountId, horseId, now, ...body });
  return { counted: r.counted, graduated: r.graduated, stageBefore: r.stageBefore, stageAfter: r.stageAfter, feed: r.feed, quality: r.quality, careSessions: r.horse.careSessions };
}

export async function careAllAction(db: Db, session: Session, now: Date) {
  const res = await careForAll(db, { accountId: session.accountId, now });
  return {
    counted: res.filter((r) => r.counted).length,
    graduated: res.filter((r) => r.graduated).map((r) => ({ id: r.horse.id, name: r.horse.name })),
  };
}

export async function savePlanAction(db: Db, session: Session, horseId: string, slots: string[], now: Date) {
  assertId(horseId);
  return saveTrainingPlan(db, { accountId: session.accountId, horseId, slots, now });
}

export async function trainAction(db: Db, session: Session, horseId: string, body: { expectedSession?: number }, now: Date) {
  assertId(horseId);
  const r = await runTrainingSession(db, { accountId: session.accountId, horseId, now, expectedSession: body.expectedSession });
  return { ran: r.ran, workout: r.workout, cost: r.cost, arrows: r.arrows, injured: r.injured, overworked: r.overworked, sessionsUsed: r.sessionsUsed };
}

export async function vetAction(db: Db, session: Session, horseId: string, now: Date) {
  assertId(horseId);
  const r = await treatHorseInjury(db, { accountId: session.accountId, horseId, now });
  return { treated: r.treated, cost: r.cost, untilMs: r.horse.injuredUntil?.getTime() ?? null };
}

export async function insuranceAction(db: Db, session: Session, horseId: string) {
  assertId(horseId);
  await buyInsurance(db, { accountId: session.accountId, horseId });
  return { insured: true };
}

export async function scanAction(db: Db, session: Session, horseId: string, now: Date) {
  assertId(horseId);
  const r = await scanPedigree(db, { accountId: session.accountId, horseId, now });
  return { scanned: r.horse.scanned, cost: r.cost };
}

export async function graduateAction(db: Db, session: Session, horseId: string, now: Date) {
  assertId(horseId);
  const h = await graduateFoal(db, { accountId: session.accountId, horseId, now });
  return { id: h.id, name: h.name };
}

export async function renameAction(db: Db, session: Session, horseId: string, name: string) {
  assertId(horseId);
  return { name: await renameHorse(db, { accountId: session.accountId, horseId, name }) };
}

export type CareerAction = "retire" | "legacy" | "release";

export async function careerAction(db: Db, session: Session, horseId: string, action: CareerAction, now: Date) {
  assertId(horseId);
  const input = { accountId: session.accountId, horseId, now };
  if (action === "retire") {
    const h = await retireHorse(db, input);
    return { action, careerStatus: h.careerStatus };
  }
  if (action === "legacy") {
    const h = await moveToLegacyFarm(db, input);
    return { action, careerStatus: h.careerStatus };
  }
  const r = await releaseToClub(db, input);
  return { action, payout: r.payout };
}

export async function facilityAction(db: Db, session: Session, facility: FacilityKey, toLevel: number, now: Date) {
  const r = await buyFacility(db, { accountId: session.accountId, facility, toLevel, now });
  return { bought: r.bought, cost: r.cost };
}

export { STABLE_HAND_COST };
