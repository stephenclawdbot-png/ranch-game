import { createHash, randomBytes } from "node:crypto";

/** Opaque device token for the auth cookie (256 bits, base64url). Only its hash is stored. */
export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A fresh 64-hex seed. */
export function newSeed(): string {
  return randomBytes(32).toString("hex");
}

/** sha256 over the seed *bytes* (same convention as racing-engine `commitSeed`). */
export function commitSeed(seedHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(seedHex)) throw new Error("seed must be 64 lowercase hex chars");
  return createHash("sha256").update(Buffer.from(seedHex, "hex")).digest("hex");
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Deterministic uniform stream from a seed and label: sha256(seed | label | counter).
 * Used by the default (fallback) game hooks; game-core has its own PRNG.
 */
export function seededUniform(seedHex: string, label: string): () => number {
  let counter = 0;
  return () => {
    const h = createHash("sha256").update(`${seedHex}|${label}|${counter++}`).digest();
    return h.readUInt32BE(0) / 0x1_0000_0000;
  };
}

/** UTC calendar day, "YYYY-MM-DD". */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Monday (UTC) of the week containing `at`, "YYYY-MM-DD". */
export function utcWeekStart(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return utcDay(d);
}
