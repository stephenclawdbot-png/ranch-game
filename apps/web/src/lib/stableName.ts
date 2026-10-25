import { z } from "zod";

/** Stable names: 2-32 letters, numbers, spaces and ' & . - (shared by the form and the API). */
export const STABLE_NAME_RE = /^[\p{L}\p{N} '&.\-]{2,32}$/u;

export const StableNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[\p{L}\p{N} '&.\-]+$/u, "letters, numbers, spaces and ' & . - only");
