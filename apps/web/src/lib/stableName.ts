import { z } from "zod";

/**
 * Stable names (owner, 2026-10-31: players name their own stable, no name handed to them):
 * 3-24 characters, one to three words, letters, numbers, spaces and ' & . - only, nothing that
 * passes for the house or the staff. Unique across stables (case-insensitive), checked by the
 * server when a stable is founded or renamed. Shared by the forms and the API.
 */
export const STABLE_NAME_MIN = 3;
export const STABLE_NAME_MAX = 24;
export const STABLE_NAME_MAX_WORDS = 3;
const CHARS = /^[\p{L}\p{N} '&.\-]+$/u;
const RESERVED = /\b(the club|club|post ?time|admin|administrator|official|staff|moderator|support)\b/i;

/** Spaces trimmed and runs of spaces collapsed: the form in which a name is stored and compared. */
export function cleanStableName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** What's wrong with a name, in words for the form; null when it's fine. */
export function stableNameProblem(raw: string): string | null {
  const name = cleanStableName(raw);
  if (name.length < STABLE_NAME_MIN) return `At least ${STABLE_NAME_MIN} characters.`;
  if (name.length > STABLE_NAME_MAX) return `At most ${STABLE_NAME_MAX} characters.`;
  if (!CHARS.test(name)) return "Letters, numbers, spaces and ’ & . - only.";
  if (name.split(" ").length > STABLE_NAME_MAX_WORDS) return `At most ${STABLE_NAME_MAX_WORDS} words.`;
  if (!/\p{L}/u.test(name)) return "Use at least one letter.";
  if (RESERVED.test(name)) return "That name is kept for the game itself.";
  return null;
}

export const StableNameSchema = z
  .string()
  .transform(cleanStableName)
  .superRefine((v, ctx) => {
    const problem = stableNameProblem(v);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
