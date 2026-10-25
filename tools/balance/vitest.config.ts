import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Balance reports: Monte Carlo runs through the real demo data, race generation and engine.
 *   npx vitest run --config tools/balance/vitest.config.ts            # all reports
 *   npx vitest run --config tools/balance/vitest.config.ts player     # one report
 * Output: console tables + tools/balance/out/<report>.json
 *
 * legacy/: the pre-database stateless demo (deterministic rival pool, signed quick-race ids,
 * the 3-minute schedule as a pure function) that the reports and their regression bands were
 * built on. The web app no longer uses it (races live in Postgres via @thoroughbred/db).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@thoroughbred/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
      "@": fileURLToPath(new URL("../../apps/web/src", import.meta.url)),
      zod: fileURLToPath(new URL("../../apps/web/node_modules/zod", import.meta.url)),
    },
  },
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["*.report.ts", "legacy/*.test.ts"],
    environment: "node",
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    pool: "forks",
  },
});
