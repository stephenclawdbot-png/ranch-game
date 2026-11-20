/**
 * First-week scenario: brand-new stables (a casual and an engaged player) play their first days
 * through the real server code (src/firstWeek.ts). Credits earned and spent per day, when a first
 * covering is possible and paid for, when the foal is born and a home-bred horse races.
 *
 *   npx vitest run --config tools/season-harness/vitest.config.ts firstWeek
 *   env: FW_STABLES (per persona, default 10), FW_DAYS (12), FW_SEED ("first-week-1"),
 *        FW_OUT (a folder: result.json and report.md)
 *
 * Kept out of the default suites (a *.harness.ts file).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { installDeterministicRandom } from "./src/determinism";
import { defaultStartMs } from "./src/config";

it("first week", async () => {
  const seed = process.env.FW_SEED ?? "first-week-1";
  installDeterministicRandom(seed);
  const { runFirstWeek, firstWeekReport } = await import("./src/firstWeek");
  const res = await runFirstWeek({
    seed,
    days: Number(process.env.FW_DAYS ?? 12),
    perPersona: Number(process.env.FW_STABLES ?? 10),
    startMs: defaultStartMs(),
    log: (l) => console.log(l),
  });
  const report = firstWeekReport(res);
  console.log(report);
  if (process.env.FW_OUT) {
    mkdirSync(process.env.FW_OUT, { recursive: true });
    writeFileSync(`${process.env.FW_OUT}/result.json`, JSON.stringify({ seed, ...res }, null, 1));
    writeFileSync(`${process.env.FW_OUT}/report.md`, report + "\n");
  }
});
