import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LIVE_RACE_MODEL, type RaceModel } from "@thoroughbred/shared";

const OUT_DIR = fileURLToPath(new URL("./out/", import.meta.url));
const TAG = process.env.BAL_TAG ?? "current";

/** Prints the report and saves it as tools/balance/out/<name>.<tag>.{json,txt} (BAL_TAG, default "current"). */
export function writeReport(name: string, data: unknown, lines: string[]): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const text = lines.join("\n");
  writeFileSync(`${OUT_DIR}${name}.${TAG}.json`, JSON.stringify(data, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v), 2));
  writeFileSync(`${OUT_DIR}${name}.${TAG}.txt`, text + "\n");
  console.log(`\n${text}\n`);
}

/** Let vitest's worker RPC breathe during long synchronous Monte Carlo loops. */
export function yieldNow(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

/**
 * What a Live race locked today carries: the race model (engine 1.4.0, close finishes).
 * BAL_MODEL=legacy runs the reports as the engine ran before 1.4.0 (for before/after tables).
 */
export const LEGACY_MODEL = process.env.BAL_MODEL === "legacy";
export const LIVE_MODEL: { model?: RaceModel } = LEGACY_MODEL ? {} : { model: LIVE_RACE_MODEL };
