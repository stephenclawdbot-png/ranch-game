/**
 * Testing phase only (PLAYTEST_MODE): a tester's permanent login code, for players without a
 * wallet. The code is derived from the account id with a server secret (LOGIN_CODE_SECRET), so
 * it never changes, can be shown again on Profile, and can't be produced without the secret:
 * 20 characters from a 31-letter alphabet (about 99 bits), shown as PT-XXXXX-XXXXX-XXXXX-XXXXX.
 * The database keeps only its hash (lookup at sign-in). Off when the playtest ends or the secret
 * is unset.
 */
import { createHmac } from "node:crypto";
import { hashToken, playtestConfig, saveLoginCodeHash, type Executor } from "@thoroughbred/db";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I/L, like every code in the game
export const LOGIN_CODE_CHARS = 20;

function secret(env: Record<string, string | undefined>): string | null {
  const s = env.LOGIN_CODE_SECRET?.trim();
  return s && s.length >= 32 ? s : null;
}

/** Whether tester login codes are on (closed playtest + a secret set). */
export function loginCodesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return playtestConfig(env).enabled && secret(env) !== null;
}

/** The account's permanent code, display form; null when the feature is off. */
export function loginCodeFor(accountId: string, env: Record<string, string | undefined> = process.env): string | null {
  const key = secret(env);
  if (!key || !playtestConfig(env).enabled) return null;
  let n = BigInt(`0x${createHmac("sha256", key).update(`post-time-login:${accountId}`).digest("hex")}`);
  let raw = "";
  for (let i = 0; i < LOGIN_CODE_CHARS; i++) {
    raw += ALPHABET[Number(n % 31n)];
    n /= 31n;
  }
  return `PT-${raw.match(/.{5}/g)!.join("-")}`;
}

/** Normal form of a typed code (case, spaces, dashes and the PT- prefix forgiven), or null when it can't be one. */
export function normalizeLoginCode(input: string): string | null {
  let c = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length === LOGIN_CODE_CHARS + 2 && c.startsWith("PT")) c = c.slice(2);
  if (c.length !== LOGIN_CODE_CHARS || [...c].some((ch) => !ALPHABET.includes(ch))) return null;
  return `PT-${c.match(/.{5}/g)!.join("-")}`;
}

/** The hash stored for a code (display form in, so every typed variant hashes the same). */
export function loginCodeHash(code: string): string {
  return hashToken(code);
}

/** Records the account's code hash (idempotent) and returns the code; null when the feature is off. */
export async function ensureLoginCode(ex: Executor, accountId: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const code = loginCodeFor(accountId, env);
  if (!code) return null;
  await saveLoginCodeHash(ex, { accountId, codeHash: loginCodeHash(code) });
  return code;
}
