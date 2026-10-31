/**
 * Pick the winner and the tipster table for the web app (packages/db services/picks.ts). Points
 * only: nothing is staked or paid, and points can never be exchanged for anything. Outcomes are
 * scored only once a race's result is public, so nothing here can run ahead of the broadcast.
 */
import * as gc from "@thoroughbred/game-core";
import { makePick, racePickView, tipsterAllTime, tipsterProfile, tipsterWeek, todaysPicks, type Db, type RacePickView } from "@thoroughbred/db";
import type { Session } from "./session";

export type { RacePickView };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function racePick(db: Db, session: Session | null, raceId: string, now: Date): Promise<RacePickView | null> {
  if (!UUID_RE.test(raceId)) return null;
  return racePickView(db, { raceId, stableId: session?.stable.id ?? null, now });
}

export async function pickRunner(db: Db, session: Session, raceId: string, horseId: string, now: Date): Promise<RacePickView | null> {
  await makePick(db, { accountId: session.accountId, raceId, horseId, now });
  return racePick(db, session, raceId, now);
}

export interface TipstersView {
  weekStartMs: number;
  week: { position: number; stableId: string; stableName: string; points: number; wins: number; picks: number; badge: boolean }[];
  lastWeek: { weekStartMs: number; top: { position: number; stableId: string; stableName: string; points: number; badge: boolean }[] };
  allTime: { stableId: string; stableName: string; points: number; weekStartMs: number }[];
  me: Awaited<ReturnType<typeof tipsterProfile>> | null;
  myStableId: string | null;
  rules: { top: number; outsider: number; badgeTop: number };
}

/** The Tipsters page: this week's table, last week's top 10, best weeks ever, and your line. */
export async function tipsters(db: Db, session: Session | null, now: Date): Promise<TipstersView> {
  const week = await tipsterWeek(db, { now });
  const lastStart = week.weekStartMs - gc.WEEK_MS;
  const [last, allTime, me] = await Promise.all([
    tipsterWeek(db, { now, weekStartMs: lastStart, limit: gc.TIPSTER_BADGE_TOP }),
    tipsterAllTime(db, { limit: 10 }),
    session ? tipsterProfile(db, { stableId: session.stable.id, now }) : Promise.resolve(null),
  ]);
  return {
    weekStartMs: week.weekStartMs,
    week: week.rows.map((r) => ({ position: r.position, stableId: r.stableId, stableName: r.stableName, points: r.points, wins: r.wins, picks: r.picks, badge: r.badge })),
    lastWeek: { weekStartMs: lastStart, top: last.rows.map((r) => ({ position: r.position, stableId: r.stableId, stableName: r.stableName, points: r.points, badge: r.badge })) },
    allTime,
    me,
    myStableId: session?.stable.id ?? null,
    rules: { top: gc.PICK_POINTS_TOP, outsider: gc.PICK_POINTS_OUTSIDER, badgeTop: gc.TIPSTER_BADGE_TOP },
  };
}

export async function homePicks(db: Db, session: Session, now: Date) {
  const [today, me] = await Promise.all([todaysPicks(db, { stableId: session.stable.id, now }), tipsterProfile(db, { stableId: session.stable.id, now })]);
  return { ...today, week: me.week };
}
