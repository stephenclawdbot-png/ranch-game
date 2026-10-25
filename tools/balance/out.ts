import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
