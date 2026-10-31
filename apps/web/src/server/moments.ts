/**
 * Moments for the web app: stable news on Home (moments and the Sunday League recap), the
 * horse-page highlight, the Legacy Farm page. Reads only: moments are written by the server
 * paths where they happen (packages/db moments.ts), never on page view. A moment from a race
 * stays hidden until its result has been watched (listMoments).
 */
import * as gc from "@thoroughbred/game-core";
import { MOMENT_KIND, dismissMoment, legacyFarm, listMoments, listWeekRecaps, schema, type Db, type Moment } from "@thoroughbred/db";
import type { LegacyFarmView, MomentView } from "@/lib/types";
import { horseFromRow, parseSilks } from "./horseView";
import type { Session } from "./session";

export function momentView(m: Moment): MomentView {
  return {
    id: m.id,
    kind: m.kind,
    horseId: m.horseId,
    horseName: m.horseName,
    title: m.title,
    body: m.body,
    href: m.href,
    raceId: m.raceId,
    tribute: m.tribute,
    createdAtMs: m.createdAt.getTime(),
    fresh: !m.dismissed,
  };
}

const WEEK_RECAP = "week_recap";

/** The Sunday recap (packages/db leagues.ts) as a news line: the week's numbers and the League link. */
function recapView(i: typeof schema.inboxItems.$inferSelect): MomentView {
  const d = (i.data ?? {}) as { points?: number; wins?: number; runs?: number };
  const runs = d.runs ?? 0;
  return {
    id: i.id,
    kind: WEEK_RECAP,
    horseId: null,
    horseName: null,
    title: i.title,
    body: `${d.points ?? 0} points from ${runs} ${runs === 1 ? "run" : "runs"}${d.wins ? `, ${d.wins} ${d.wins === 1 ? "win" : "wins"}` : ""}. Only your best runs count, and a week away never relegates.`,
    href: "/league",
    raceId: null,
    tribute: null,
    createdAtMs: i.createdAt.getTime(),
    fresh: !i.readAt,
  };
}

/** Home's stable news: the latest moments and League recaps, newest first. */
export async function stableNews(db: Db, accountId: string, limit = 8): Promise<MomentView[]> {
  const moments = (await listMoments(db, accountId, { limit })).map(momentView);
  const recaps = (await listWeekRecaps(db, accountId, 2)).map(recapView);
  return [...moments, ...recaps].sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, limit);
}

/** The horse page's one-time highlights: this horse's moments not dismissed yet (owner only). */
export async function horseHighlights(db: Db, session: Session | null, horseId: string): Promise<MomentView[]> {
  if (!session) return [];
  return (await listMoments(db, session.accountId, { horseId, undismissed: true, limit: 3 })).map(momentView);
}

/** Dismisses a highlight (only the owner's own moments). */
export async function dismissHighlight(db: Db, session: Session, id: string, now: Date): Promise<boolean> {
  return dismissMoment(db, { accountId: session.accountId, id, now });
}

/** /legacy: every horse the stable has retired for good, with its tribute (or memorial). */
export async function legacyFarmView(db: Db, session: Session, now: Date): Promise<LegacyFarmView> {
  const silks = parseSilks(session.stable.silks);
  const farm = await legacyFarm(db, session.stable.id);
  return {
    stableName: session.stable.name,
    horses: farm.map(({ row, tribute, died }) => {
      const h = horseFromRow(row, silks, now.getTime());
      return {
        id: row.id,
        name: row.name,
        regNo: gc.registrationNumber(row.generation, row.regNo),
        appearance: h.appearance,
        sex: h.sex,
        tribute,
        // the cause, named from the catalogue when the stored injury has a kind (game-core injuries.ts)
        died: died ? { ...died, cause: (row.injury as { severity?: string } | null)?.severity === "fatal" ? (gc.injuryKindOf((row.injury as { kind?: string }).kind)?.name ?? null) : null } : null,
        retiredAtMs: (row.pasturedAt ?? row.retiredAt)?.getTime() ?? null,
      };
    }),
  };
}

export { MOMENT_KIND };
