/**
 * Founding a stable, in one place: the closed-playtest invite (seat reserved first), the
 * anonymous account + starter horses + credits, and the tester / referral links. Both
 * founding paths share it — POST /api/account and wallet sign-in's { create } — so the
 * rules can't drift. Callers add their own session (cookie) and telemetry.
 */
import { acceptRivalInvite, createAccount, DomainError, linkTester, recordAccountSignal, recordReferral, redeemInvite, type Db, type RivalInviteResult } from "@thoroughbred/db";
import { SilksSchema } from "@thoroughbred/shared";
import { playtestConfig } from "./playtest";
import { StableNameSchema } from "@/lib/stableName";

export interface FoundStableInput {
  stableName: unknown;
  silks: unknown;
  /** IANA timezone from the device: the daily entry allowance lands at local midnight. */
  timezone?: string;
  /** Closed playtest: the invite code. Outside the playtest: an optional referral code. */
  inviteCode: string | null;
  /** "Bring a rival": the invite code came from a rival invite link (the inviter's personal code). */
  rival?: boolean;
  /** This browser's random id (localStorage), recorded as a device signal for the anti-alt check. */
  deviceId?: string | null;
  now: Date;
}

export interface FoundedStable {
  accountId: string;
  stableId: string;
  /** Raw device token for the httpOnly cookie; only its hash is stored. */
  token: string;
  stableName: string;
  playtest: boolean;
  /** The rival invite's outcome, when founded through one. */
  rival: RivalInviteResult | null;
}

/**
 * Validates the form and founds the stable. Throws INVALID_INPUT for a bad name or colours,
 * NOT_ELIGIBLE when the playtest invite is missing/used/full. `db` may be an open
 * transaction (the wallet path runs this under a per-wallet advisory lock).
 */
export async function foundStable(db: Db, input: FoundStableInput): Promise<FoundedStable> {
  const name = StableNameSchema.safeParse(input.stableName);
  const silks = SilksSchema.safeParse(input.silks);
  if (!name.success || !silks.success) throw new DomainError("INVALID_INPUT", "Check the stable name and colours.");
  // Closed playtest: reserve a tester for the invite code first (re-links a tester after a reset).
  const playtest = playtestConfig();
  let testerId: string | null = null;
  if (playtest.enabled) {
    if (!input.inviteCode?.trim()) throw new DomainError("NOT_ELIGIBLE", "The playtest is invite only. Enter your invite code.");
    testerId = (await redeemInvite(db, { code: input.inviteCode, cap: playtest.testerCap, now: input.now })).testerId;
  }
  const acc = await createAccount(db, { stableName: name.data, silks: silks.data, timezone: input.timezone, now: input.now });
  if (testerId) await linkTester(db, { testerId, accountId: acc.accountId, stableName: name.data, now: input.now });
  // Affiliate tree (beta money): inviter = the code's owner (root/admin codes -> the owner account).
  if (input.inviteCode?.trim()) {
    try {
      await recordReferral(db, { accountId: acc.accountId, code: input.inviteCode, now: input.now });
    } catch (err) {
      console.error("referral", err);
    }
  }
  if (input.deviceId) await recordAccountSignal(db, { accountId: acc.accountId, kind: "device", value: input.deviceId });
  // Bring a rival: the two stables become declared rivals; both get the welcome once, unless linked.
  let rival: RivalInviteResult | null = null;
  if (input.rival && input.inviteCode?.trim()) rival = await acceptRivalInvite(db, { inviteeAccountId: acc.accountId, code: input.inviteCode, now: input.now });
  return { accountId: acc.accountId, stableId: acc.stableId, token: acc.token, stableName: name.data, playtest: playtest.enabled, rival };
}