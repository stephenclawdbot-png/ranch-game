/**
 * Practice mode helpers (USDG_MODE=practice, docs/usdg-market.md "Practice mode"): the one-off
 * T-USDG grant on wallet sign-in, and the player-facing wording ("T-USDG", never plain "USDG" or
 * a dollar sign, while practice mode is on). Server only.
 */
import { grantPracticeUsdg, marketIdentityOf, marketWalletOf, type Db, type Executor } from "@thoroughbred/db";
import { isUsdgPracticeMode, practiceUsdgText } from "@thoroughbred/game-core";
import "./practiceIdentity"; // registers the practice identity with @thoroughbred/db

type Env = Record<string, string | undefined>;

/** Practice mode on? (USDG_MODE=practice exactly; a near miss reads as off here and the market refuses to start with it.) */
export function practiceOn(env: Env = process.env): boolean {
  return isUsdgPracticeMode(env);
}

/** A player-facing sentence, in T-USDG wording while practice mode is on. */
export function usdgText(s: string, env: Env = process.env): string {
  return practiceOn(env) ? practiceUsdgText(s) : s;
}

/** Every string inside a JSON-able value, in T-USDG wording (practice mode only; keys and numbers untouched). */
export function practiceWording<T>(v: T, env: Env = process.env): T {
  if (!practiceOn(env)) return v;
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") return x.includes("USDG") || x.includes("$") ? practiceUsdgText(x) : x;
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype) return Object.fromEntries(Object.entries(x).map(([k, val]) => [k, walk(val)]));
    return x;
  };
  return walk(v) as T;
}

/**
 * Grants the practice T-USDG once per ACCOUNT (PRACTICE_USDG_GRANT) when practice mode is on and the
 * account has a market identity: a verified wallet or, without one, its practice identity
 * (practiceIdentity.ts). Called when a stable is founded, on wallet sign-in / link and lazily by the
 * T-USDG views. Linking a wallet later grants nothing more (idempotent per account). Never fails a
 * sign-in.
 */
export async function ensurePracticeGrant(db: Db, accountId: string, now: Date, env: Env = process.env): Promise<{ granted: boolean; balance: number } | null> {
  if (!practiceOn(env)) return null;
  try {
    if (!(await marketWalletOf(db, accountId, env))) return null;
    return await grantPracticeUsdg(db, { accountId, now, env });
  } catch (err) {
    console.error("practice grant", accountId, err);
    return null;
  }
}

/**
 * How the player trades T-USDG, for the views: "wallet" (a verified wallet; its address may be
 * shown), "practice" (no wallet: the server-held practice identity; show the stable name, NEVER the
 * address), or null (no identity: link a wallet). Outside practice mode only "wallet" or null.
 */
export async function marketIdentityKind(ex: Executor, accountId: string, env: Env = process.env): Promise<"wallet" | "practice" | null> {
  return (await marketIdentityOf(ex, accountId, env))?.kind ?? null;
}
