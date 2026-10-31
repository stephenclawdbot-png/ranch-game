/**
 * "Bring a rival" (packages/db rivals.ts acceptRivalInvite): your personal invite link with
 * `rival=1`. A friend who founds a stable through it becomes your declared rival at once, and you
 * both get RIVAL_INVITE_CREDITS once (refused for linked accounts). Credits only, never USDG; the
 * affiliate program's rules are unchanged (the same personal code records the referral as before).
 */
import * as gc from "@thoroughbred/game-core";
import { declaredRivalsOf, ensureReferralCode, recordAccountSignal, rivalInviterName, rivalInviteStats, type Db } from "@thoroughbred/db";
import type { Session } from "./session";

export interface RivalInviteView {
  link: string;
  code: string;
  credits: number;
  weeklyWelcomes: number;
  accepted: number;
  thisWeek: number;
  declared: { stableId: string; stableName: string; direction: "invited" | "invited_by"; atMs: number }[];
}

export async function rivalInviteView(db: Db, session: Session, input: { origin: string; now: Date; deviceId?: string | null }): Promise<RivalInviteView> {
  if (input.deviceId) await recordAccountSignal(db, { accountId: session.accountId, kind: "device", value: input.deviceId });
  const code = await ensureReferralCode(db, session.accountId);
  const [stats, declared] = await Promise.all([rivalInviteStats(db, session.stable.id, input.now), declaredRivalsOf(db, session.stable.id)]);
  return {
    link: `${input.origin}/play?invite=${encodeURIComponent(code)}&rival=1`,
    code,
    credits: gc.RIVAL_INVITE_CREDITS,
    weeklyWelcomes: gc.RIVAL_INVITE_WEEKLY_WELCOMES,
    ...stats,
    declared,
  };
}

/** Public: who sent this rival invite (the founding page's banner). Null for an unknown code. */
export async function rivalInviter(db: Db, rawCode: string): Promise<{ stableName: string; credits: number } | null> {
  const name = await rivalInviterName(db, rawCode);
  return name ? { stableName: name, credits: gc.RIVAL_INVITE_CREDITS } : null;
}
