import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Balance reports: Monte Carlo runs through the real demo data, race generation and engine.
 *   npx vitest run --config tools/balance/vitest.config.ts            # all reports
 *   npx vitest run --config tools/balance/vitest.config.ts player     # one report
 * Output: console tables + tools/balance/out/<report>.json
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../apps/web/src", import.meta.url)) } },
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["*.report.ts"],
    environment: "node",
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    pool: "forks",
  },
});
