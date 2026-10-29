/**
 * A season run: HARNESS_* env (see README.md) → tools/season-harness/out/<tag>/
 * (metrics.json, summary.md, report.html).
 */
import { it } from "vitest";
import { configFromEnv } from "./src/config";
import { runSeason } from "./src/run";
import { writeOutputs } from "./src/report";

it("season", async () => {
  const cfg = configFromEnv();
  const dir = await writeOutputs(cfg, cfg.reportOnly ? null : await runSeason(cfg, (l) => cfg.verbose && console.log(l)));
  console.log(`season harness: wrote ${dir}`);
});
