/**
 * The tote in the web app (services/tote.ts in @thoroughbred/db holds the rules): the public
 * board for a race (cache-friendly: the same for everyone), the signed-in player's side, the
 * bet slip, the history and the betting limits.
 *
 * No spoilers: the board carries only stakes and pool maths before settlement, and settlement
 * runs only once the result is public (the broadcast is over), so dividends never appear early.
 */
import {
  acknowledgeToteRealityCheck,
  confirmToteAdult,
  confirmToteLimitRaise,
  endToteSelfExclusion,
  isDomainError,
  myToteBets,
  myToteRace,
  placeToteBet,
  selfExcludeTote,
  setToteLimits,
  settleTote,
  toteBoard,
  toteSettingsView,
  type Db,
  type MyToteHistory,
  type MyToteRace,
  type ToteBoard,
  type ToteSettingsView,
} from "@thoroughbred/db";
import { z } from "zod";
import { cardFrozen } from "./game";
import { isAdmin } from "./playtest";
import type { Session } from "./session";
import { sharedLimiter } from "./rateLimit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The board for a race; settles open bets first when the result has just become public. Null when the race has no tote. */
export async function raceToteBoard(db: Db, raceId: string, now: Date): Promise<ToteBoard | null> {
  if (!UUID_RE.test(raceId)) return null;
  if (!cardFrozen()) {
    try {
      await settleTote(db, raceId, now);
    } catch (e) {
      if (!isDomainError(e)) console.error("[tote] settlement failed", raceId, e);
    }
  }
  return toteBoard(db, raceId, now);
}

/** Cache header for a board: short while bets arrive, longer once settled. */
export function boardCache(board: ToteBoard | null): string {
  if (!board) return "public, s-maxage=60";
  if (board.status === "settled" || board.status === "abandoned") return "public, s-maxage=300, stale-while-revalidate=60";
  return "public, s-maxage=2, stale-while-revalidate=3";
}

/**
 * Staff never bet: a request carrying the admin session, or an account listed in
 * TOTE_STAFF_ACCOUNT_IDS (comma-separated account ids of staff players). System accounts are
 * refused by the db checks too.
 */
export async function isToteStaff(session: Pick<Session, "accountId">, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const listed = (env.TOTE_STAFF_ACCOUNT_IDS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (listed.includes(session.accountId.toLowerCase())) return true;
  try {
    return await isAdmin();
  } catch {
    return false; // outside a request (tests, jobs): no admin cookie
  }
}

export async function myRaceTote(db: Db, session: Session, raceId: string, now: Date): Promise<MyToteRace | null> {
  if (!UUID_RE.test(raceId)) return null;
  return myToteRace(db, session.accountId, raceId, now, undefined, await isToteStaff(session));
}

export const BetSchema = z.object({
  horseId: z.string().regex(UUID_RE),
  pool: z.enum(["win", "place"]),
  currency: z.enum(["CR", "TUSDG"]),
  stake: z.number().int().positive().max(1_000_000_000),
  clientKey: z.string().min(6).max(80),
});

/** 30 bets a minute per account is far more than anyone places by hand. */
const betLimiter = sharedLimiter({ name: "tote-bet", limit: 30, windowMs: 60_000 });

export class TooManyBetsError extends Error {}

export async function placeBet(db: Db, session: Session, raceId: string, body: z.infer<typeof BetSchema>, now: Date): Promise<MyToteRace | null> {
  if (!UUID_RE.test(raceId)) return null;
  if (await betLimiter.hit(db, session.accountId, now.getTime())) throw new TooManyBetsError();
  const staff = await isToteStaff(session);
  await placeToteBet(db, { accountId: session.accountId, raceId, horseId: body.horseId, pool: body.pool, currency: body.currency, stake: body.stake, clientKey: body.clientKey, now, staff });
  return myToteRace(db, session.accountId, raceId, now, undefined, staff);
}

export async function myBetsHistory(db: Db, session: Session, now: Date): Promise<MyToteHistory> {
  return myToteBets(db, session.accountId, { now, limit: 100 });
}

export const SettingsActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm_adult") }),
  z.object({
    action: z.literal("limits"),
    currency: z.enum(["CR", "TUSDG"]),
    perRace: z.number().int().positive().nullable(),
    perDay: z.number().int().positive().nullable(),
  }),
  /** A time-out (24h, 7d, 30d) or a self-exclusion (6m, 1y, 5y, permanent). */
  z.object({ action: z.literal("exclude"), choice: z.enum(["24h", "7d", "30d", "6m", "1y", "5y", "permanent"]) }),
  /** Apply a limit raise once its 24 h are over. */
  z.object({ action: z.literal("confirm_raise") }),
  /** Ask to end a self-exclusion whose minimum is over (betting reopens after a 1-day cooling-off). */
  z.object({ action: z.literal("end_self_exclusion") }),
  /** The hourly reality check was seen. */
  z.object({ action: z.literal("reality_ack") }),
]);

export async function bettingSettings(db: Db, session: Session, now: Date): Promise<ToteSettingsView> {
  return toteSettingsView(db, session.accountId, now);
}

export async function updateBettingSettings(db: Db, session: Session, body: z.infer<typeof SettingsActionSchema>, now: Date): Promise<ToteSettingsView> {
  if (body.action === "confirm_adult") await confirmToteAdult(db, { accountId: session.accountId, now });
  else if (body.action === "limits") await setToteLimits(db, { accountId: session.accountId, currency: body.currency, perRace: body.perRace, perDay: body.perDay, now });
  else if (body.action === "confirm_raise") await confirmToteLimitRaise(db, { accountId: session.accountId, now });
  else if (body.action === "end_self_exclusion") await endToteSelfExclusion(db, { accountId: session.accountId, now });
  else if (body.action === "reality_ack") await acknowledgeToteRealityCheck(db, { accountId: session.accountId, now });
  else await selfExcludeTote(db, { accountId: session.accountId, choice: body.choice, now });
  return toteSettingsView(db, session.accountId, now);
}
