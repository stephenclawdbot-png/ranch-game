import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Season harness (tools/season-harness): simulated stables play a whole season through the
 * real server code (apps/web/src/server) on an in-memory PGlite database.
 *
 *   npx vitest run --config tools/season-harness/vitest.config.ts season   # a full run (env HARNESS_*)
 *   npx vitest run --config tools/season-harness/vitest.config.ts smoke    # the smoke test
 *
 * Kept out of every default test run: the files are `*.harness.ts` under tools/, which no
 * package's vitest include matches. See README.md for the knobs.
 *
 * Resolution: files under apps/web resolve their own imports (next, zod, the workspace
 * packages) from apps/web/node_modules as usual. Only the harness's own imports need the
 * aliases below, and they point at the same source files the web app loads, so the harness
 * and game.ts share one module instance of each package.
 */
const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@thoroughbred/db": pkg("db"),
      "@thoroughbred/game-core": pkg("game-core"),
      "@thoroughbred/shared": pkg("shared"),
      "@thoroughbred/racing-engine": pkg("racing-engine"),
      "@": fileURLToPath(new URL("../../apps/web/src", import.meta.url)),
    },
  },
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["*.harness.ts"],
    environment: "node",
    testTimeout: 6 * 3_600_000,
    hookTimeout: 600_000,
    // A process per file: the server keeps per-instance caches on globalThis, and the
    // harness swaps the process's random sources for a seeded stream.
    pool: "forks",
  },
});
