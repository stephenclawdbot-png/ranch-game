/**
 * Jockeys on the server (docs/design/jockeys.md, Phase 1): the Racing → Jockeys list and
 * leaderboard, a page per jockey, the stable's own jockeys and the entry sheet's jockey picker.
 * Rules come from game-core jockeys.ts; state from packages/db services/jockeys.ts.
 */
import * as gc from "@thoroughbred/game-core";
import {
  ensureJockeyBackfill,
  getJockey,
  handicapWeightsFor,
  jockeyCareer,
  jockeyLeaderboard,
  jockeyRecentRides,
  jockeyWinsBetween,
  jockeyBusyTx,
  jockeyMarketInfo,
  jockeyView,
  contractsOfStable,
  listJockeys,
  transferWindow,
  seasonBounds,
  seasonNumberAt,
  stableJockeys,
  type Db,
  type ContractView,
  type JockeyFilter,
  type JockeyMarketInfo,
  type JockeyView,
  type WindowResult,
  type PublicRace,
} from "@thoroughbred/db";
import type { RiderOption } from "@/lib/types";
import type { Silks } from "@thoroughbred/shared";
import { parseSilks } from "./horseView";
import type { Session } from "./session";

export type { JockeyFilter };

/** A jockey as the pages show it (no seed, no hidden potential). */
export interface JockeyCard {
  id: string;
  name: string;
  cardName: string;
  stage: gc.JockeyStage;
  personality: { key: gc.JockeyPersonality; label: string; blurb: string };
  grade: gc.JockeyGrade;
  overall: number;
  skills: { key: gc.JockeySkill; label: string; effect: string; value: number; grade: gc.JockeyGrade; potential: string; lo: number; hi: number }[];
  potential: string;
  rides: number;
  wins: number;
  winsThisSeason: number;
  claimLb: number;
  stableId: string | null;
  stableName: string | null;
  silks: Silks | null;
  retireAt: string;
  retiring: boolean;
  retired: boolean;
  mine: boolean;
}

function card(v: JockeyView, viewerStableId: string | null, winsThisSeason = 0): JockeyCard {
  const p = gc.JOCKEY_PERSONALITY_LABELS[v.personality];
  return {
    id: v.id,
    name: v.name,
    cardName: gc.jockeyCardName(v.name, v.claimLb),
    stage: v.stage,
    personality: { key: v.personality, ...p },
    grade: v.grade,
    overall: v.overall,
    skills: gc.JOCKEY_SKILLS.map((k) => ({
      key: k,
      ...gc.JOCKEY_SKILL_LABELS[k],
      value: v.skills[k],
      grade: gc.jockeyGradeOf(v.skills[k]),
      potential: v.potential[k].label,
      lo: v.potential[k].lo,
      hi: v.potential[k].hi,
    })),
    potential: v.potential.overall.label,
    rides: v.rides,
    wins: v.wins,
    winsThisSeason,
    claimLb: v.claimLb,
    stableId: v.stableId,
    stableName: v.stableName,
    silks: v.silks ? parseSilks(v.silks) : null,
    retireAt: v.retireAt,
    retiring: v.retirementAnnounced,
    retired: v.retired,
    mine: !!viewerStableId && v.stableId === viewerStableId,
  };
}

function season(now: Date) {
  const n = seasonNumberAt(now);
  return { number: n, ...seasonBounds(n) };
}

export interface JockeysPageView {
  filter: JockeyFilter;
  season: number;
  jockeys: JockeyCard[];
  leaderboard: { jockey: JockeyCard; wins: number; rides: number }[];
  signedIn: boolean;
  held: number;
  max: number;
}

export async function jockeysPage(db: Db, session: Session | null, filter: JockeyFilter, now: Date): Promise<JockeysPageView> {
  // The maintenance tick backfills within a minute of a deploy; a fresh database gets its pool here.
  await ensureJockeyBackfill(db, now);
  const s = season(now);
  const viewer = session?.stable.id ?? null;
  const wins = await jockeyWinsBetween(db, s.startsAt, s.endsAt);
  const list = await listJockeys(db, { filter, stableId: viewer });
  const board = await jockeyLeaderboard(db, { from: s.startsAt, to: s.endsAt, limit: 10 });
  const held = viewer ? (await stableJockeys(db, viewer)).length : 0;
  return {
    filter,
    season: s.number,
    jockeys: list.map((v) => card(v, viewer, wins.get(v.id) ?? 0)),
    leaderboard: board.map((b) => ({ jockey: card(b.jockey, viewer, b.wins), wins: b.wins, rides: b.rides })),
    signedIn: !!session,
    held,
    max: gc.JOCKEYS_PER_STABLE_MAX,
  };
}

export interface JockeyPageView {
  jockey: JockeyCard;
  career: { kind: string; at: string; stableName: string | null; text: string }[];
  rides: { raceId: string; raceName: string; horseName: string; stableName: string | null; position: number | null; claimLb: number; postTime: string }[];
  actions: { canSign: boolean; signFee: number; canRelease: boolean; signBlock: string | null; held: number; max: number };
  /** Phase 2: contract, morale, wants, developed at, the window and the viewer's offer. */
  market: JockeyMarketInfo;
  signedIn: boolean;
}

const CAREER_TEXT: Record<string, (stable: string | null) => string> = {
  debut: (s) => (s ? `Started riding as ${s}'s apprentice` : "Started riding for the Club"),
  signed: (s) => `Signed by ${s ?? "a stable"}`,
  released: (s) => `Left ${s ?? "a stable"} for the Club pool`,
  retirement_announced: () => "Announced retirement",
  retired: () => "Retired",
};

export async function jockeyPage(db: Db, session: Session | null, id: string, now: Date): Promise<JockeyPageView | null> {
  const v = await getJockey(db, id);
  if (!v) return null;
  const market = await jockeyMarketInfo(db, v.id, session ? { stableId: session.stable.id, accountId: session.accountId } : null, now);
  if (!market) return null;
  const s = season(now);
  const viewer = session?.stable.id ?? null;
  const wins = await jockeyWinsBetween(db, s.startsAt, s.endsAt);
  const career = await jockeyCareer(db, id);
  const rides = (await jockeyRecentRides(db, id, 20)).filter((r) => r.raceStatus === "settled" || r.raceStatus === "locked");
  const held = viewer ? (await stableJockeys(db, viewer)).length : 0;
  const signBlock = !viewer
    ? "Start a stable to sign jockeys"
    : v.retired || v.retirementAnnounced
      ? "Retiring"
      : v.stableId === viewer
        ? null
        : v.stableId
          ? `Rides for ${v.stableName ?? "another stable"}`
          : market.freeAgent
            ? null
            : held >= gc.JOCKEYS_PER_STABLE_MAX
              ? `You have ${gc.JOCKEYS_PER_STABLE_MAX} jockeys already`
              : null;
  return {
    jockey: card(v, viewer, wins.get(v.id) ?? 0),
    career: career.map((e) => ({ kind: e.kind, at: e.at.toISOString(), stableName: e.stableName, text: (CAREER_TEXT[e.kind] ?? (() => e.kind))(e.stableName) })),
    rides: rides.map((r) => ({ raceId: r.raceId, raceName: r.raceName, horseName: r.horseName, stableName: r.stableName, position: r.raceStatus === "settled" ? r.position : null, claimLb: r.claimLb, postTime: r.postTime })),
    actions: {
      canSign: !!viewer && !signBlock && v.stableId === null && !market.freeAgent,
      signFee: gc.signingFee(v.grade),
      canRelease: !!viewer && v.stableId === viewer && !v.retired,
      signBlock: v.stableId === viewer ? null : signBlock,
      held,
      max: gc.JOCKEYS_PER_STABLE_MAX,
    },
    market,
    signedIn: !!viewer,
  };
}

export type MyJockey = JockeyCard & { contract: ContractView | null; freeAgent: boolean };

/** Stable → Your jockeys: each with its contract (wage, promised vs actual rides, morale). */
export async function myJockeys(db: Db, session: Session, now: Date): Promise<MyJockey[]> {
  const s = season(now);
  const wins = await jockeyWinsBetween(db, s.startsAt, s.endsAt);
  const contracts = await contractsOfStable(db, session.stable.id, now);
  const list = await stableJockeys(db, session.stable.id);
  const rows = new Map((await Promise.all(list.map(async (v) => [v.id, await jockeyMarketInfo(db, v.id, null, now)] as const))).map(([id, m]) => [id, m]));
  return list.map((v) => ({ ...card(v, session.stable.id, wins.get(v.id) ?? 0), contract: contracts.get(v.id) ?? null, freeAgent: !!rows.get(v.id)?.freeAgent }));
}

export interface TransferWindowPageView {
  signedIn: boolean;
  deadlineMs: number;
  commitment: string | null;
  freeAgents: { jockey: JockeyCard; from: string | null; offers: number; why: string; wage: number }[];
  myOffers: { jockeyId: string; jockeyName: string; wage: number; length: string; promisedRides: number; fee: number; status: string; thisWeek: boolean }[];
  openOffers: number;
  maxOffers: number;
  last: WindowResult | null;
}

/** Racing → Jockeys → Transfer window: free agents this week, your offers, last week's results. */
export async function transferWindowPage(db: Db, session: Session | null, now: Date): Promise<TransferWindowPageView> {
  await ensureJockeyBackfill(db, now);
  const viewer = session?.stable.id ?? null;
  const v = await transferWindow(db, { stableId: viewer, now });
  return {
    signedIn: !!session,
    deadlineMs: v.deadlineMs,
    commitment: v.commitment,
    freeAgents: v.freeAgents
      .map((f) => ({ jockey: card(jockeyView(f.jockey, f.fromStableName ? { name: f.fromStableName, silks: null } : null), viewer), from: f.fromStableName, offers: f.offers, why: f.why, wage: gc.jockeyWage(jockeyView(f.jockey).grade) }))
      .sort((a, b) => b.jockey.overall - a.jockey.overall || a.jockey.name.localeCompare(b.jockey.name)),
    myOffers: v.myOffers.map((o) => ({ jockeyId: o.jockeyId, jockeyName: o.jockeyName, wage: o.wage, length: gc.JOCKEY_CONTRACT_LENGTH_LABELS[o.length as gc.JockeyContractLength] ?? o.length, promisedRides: o.promisedRides, fee: o.fee, status: o.status, thisWeek: o.week === v.week })),
    openOffers: v.myOffers.filter((o) => o.status === "open").length,
    maxOffers: gc.JOCKEY_OPEN_OFFERS_PER_STABLE,
    last: v.last,
  };
}

/** The entry sheet's jockeys for a Live race: own first (best first), then free Club freelancers (best first, a short list). */
export async function riderOptions(db: Db, session: Session, race: PublicRace & { postTime: Date | string }): Promise<{ own: RiderOption[]; freelancers: RiderOption[]; defaultId: string | null }> {
  const post = new Date(race.postTime);
  // The claim comes off a handicap weight only, so only a handicap's sheet shows it.
  const weighted = handicapWeightsFor(race);
  const opt = async (v: JockeyView, own: boolean): Promise<RiderOption> => ({
    id: v.id,
    name: v.name,
    cardName: gc.jockeyCardName(v.name, weighted ? v.claimLb : 0),
    grade: v.grade,
    stage: v.stage,
    own,
    fee: own ? 0 : gc.freelanceFee(v.grade, race.purse),
    busy: (await jockeyBusyTx(db, v.id, post, race.id)) ? `Booked within ${gc.JOCKEY_CLASH_MS / 60_000} minutes` : null,
  });
  const own = await Promise.all((await stableJockeys(db, session.stable.id)).map((v) => opt(v, true)));
  const free = await listJockeys(db, { filter: "freelancers", limit: 200 });
  const freelancers = (await Promise.all(free.map((v) => opt(v, false)))).filter((o) => !o.busy).slice(0, 8);
  const defaultId = own.find((o) => !o.busy)?.id ?? null;
  return { own, freelancers, defaultId };
}
