/**
 * Harness configuration: environment variables (HARNESS_*) with defaults, plus the quick and
 * smoke presets. Every number about the game itself (slot spacing, entries, limits) is read
 * from the game's own RULES / game-core at run time, never set here.
 */
import { RULES } from "@thoroughbred/db";

export type Cohort = "casual" | "grinder" | "breeder" | "farmer";
export const COHORTS: readonly Cohort[] = ["casual", "grinder", "breeder", "farmer"];

export interface HarnessConfig {
  /** Output folder name under tools/season-harness/out/. */
  tag: string;
  /** Seeds every random choice (players' decisions and the game's own CSPRNG draws). */
  seed: string;
  /** Simulated days. */
  days: number;
  /** Start of the simulation (UTC). Defaults to the start of a competition season. */
  startMs: number;
  /** Clock step: one card slot (RULES.slotMs) unless HARNESS_STEP_MIN overrides it. */
  stepMs: number;
  /** Stables per cohort (farmers count every account: mains and alts). */
  cohorts: Record<Cohort, number>;
  /** Alt accounts per farmer main (a group is 1 main + this many alts). */
  altsPerMain: number;
  /**
   * Farmer groups whose accounts share a device signal (account_links), so the game's linked
   * account guard can see them. The rest are undetected (separate devices).
   */
  detectedFarmerGroups: number;
  /** Tag of an earlier run to compare against in report.html (HARNESS_COMPARE). */
  compareTo: string | null;
  /** Re-render the report from out/<tag>/metrics.json without simulating. */
  reportOnly: boolean;
  /** Print progress lines. */
  verbose: boolean;
}

/** The start of the competition season after 2026-11-01 (a Monday 00:00 UTC). */
export function defaultStartMs(): number {
  const after = Date.UTC(2026, 10, 1);
  const n = Math.ceil((after - RULES.seasonEpochMs) / RULES.seasonMs);
  return RULES.seasonEpochMs + n * RULES.seasonMs;
}

/** Splits `total` stables across the cohorts in the default beta-like mix (40/24/20/16 %). */
export function defaultCohorts(total: number, altsPerMain: number): Record<Cohort, number> {
  const group = altsPerMain + 1;
  const farmer = total >= 10 ? Math.max(group, Math.round((total * 0.16) / group) * group) : 0;
  const rest = total - farmer;
  const grinder = Math.round(rest * 0.29);
  const breeder = Math.round(rest * 0.24);
  return { casual: rest - grinder - breeder, grinder, breeder, farmer };
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number (got ${raw})`);
  return Math.floor(n);
}

/**
 * Reads the configuration from the environment:
 *   HARNESS_TAG (default "dev"), HARNESS_SEED, HARNESS_DAYS (28), HARNESS_STABLES (50),
 *   HARNESS_QUICK=1 (3 days, 12 stables), HARNESS_COHORTS="casual=20,grinder=12,...",
 *   HARNESS_ALTS (3), HARNESS_DETECTED_GROUPS (1), HARNESS_START (ISO date),
 *   HARNESS_STEP_MIN (one slot), HARNESS_COMPARE (tag), HARNESS_REPORT_ONLY=1, HARNESS_VERBOSE.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): HarnessConfig {
  const quick = env.HARNESS_QUICK === "1" || env.HARNESS_QUICK === "true";
  const days = int(env, "HARNESS_DAYS", quick ? 3 : 28);
  const stables = int(env, "HARNESS_STABLES", quick ? 12 : 50);
  const altsPerMain = int(env, "HARNESS_ALTS", quick ? 2 : 3);
  const cohorts = defaultCohorts(stables, altsPerMain);
  if (env.HARNESS_COHORTS) {
    for (const part of env.HARNESS_COHORTS.split(",")) {
      const [k, v] = part.split("=").map((s) => s.trim());
      if (!k || !(COHORTS as readonly string[]).includes(k)) throw new Error(`HARNESS_COHORTS: unknown cohort "${k}"`);
      cohorts[k as Cohort] = int({ v }, "v", 0);
    }
  }
  if (cohorts.farmer % (altsPerMain + 1) !== 0) throw new Error(`farmer count ${cohorts.farmer} must be a multiple of ${altsPerMain + 1} (1 main + ${altsPerMain} alts)`);
  const stepMin = env.HARNESS_STEP_MIN ? Number(env.HARNESS_STEP_MIN) : null;
  return {
    tag: (env.HARNESS_TAG ?? (quick ? "quick" : "dev")).replace(/[^A-Za-z0-9_.-]/g, "_"),
    seed: env.HARNESS_SEED ?? "season-harness-1",
    days,
    startMs: env.HARNESS_START ? Date.parse(env.HARNESS_START) : defaultStartMs(),
    stepMs: stepMin ? Math.round(stepMin * 60_000) : RULES.slotMs,
    cohorts,
    altsPerMain,
    detectedFarmerGroups: int(env, "HARNESS_DETECTED_GROUPS", 1),
    compareTo: env.HARNESS_COMPARE?.trim() || null,
    reportOnly: env.HARNESS_REPORT_ONLY === "1",
    verbose: env.HARNESS_VERBOSE !== "0",
  };
}
