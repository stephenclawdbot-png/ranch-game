/**
 * Practice mode helpers (USDG_MODE=practice, docs/usdg-market.md "Practice mode"): the one-off
 * T-USDG grant on wallet sign-in, and the player-facing wording ("T-USDG", never plain "USDG" or
 * a dollar sign, while practice mode is on). Server only.
 */
import { grantPracticeUsdg, verifiedWalletOf, type Db } from "@thoroughbred/db";
import { practiceUsdgText } from "@thoroughbred/game-core";
import { isPracticeEnv } from "./config";

type Env = Record<string, string | undefined>;

/** Practice mode on? (A malformed USDG_MODE reads as off here; the market itself refuses to start with it.) */
export function practiceOn(env: Env = process.env): boolean {
  try {
    return isPracticeEnv(env);
  } catch {
    return false;
  }
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
 * Grants the practice T-USDG once (PRACTICE_USDG_GRANT) when practice mode is on and the account
 * has a verified wallet. Called on wallet sign-in / link and lazily by the USDG views (accounts
 * that linked a wallet before practice mode was switched on). Never fails a sign-in.
 */
export async function ensurePracticeGrant(db: Db, accountId: string, now: Date, env: Env = process.env): Promise<{ granted: boolean; balance: number } | null> {
  if (!practiceOn(env)) return null;
  try {
    if (!(await verifiedWalletOf(db, accountId))) return null;
    return await grantPracticeUsdg(db, { accountId, now });
  } catch (err) {
    console.error("practice grant", accountId, err);
    return null;
  }
}
