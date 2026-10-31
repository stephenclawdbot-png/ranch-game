import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Radio commentary tooling (docs/commentary.md), run through vitest like tools/balance:
 *   npx vitest run --config tools/commentary/vitest.config.ts export    # tools/commentary/phrases.json
 *   npx vitest run --config tools/commentary/vitest.config.ts samples   # out/samples/*.json (sample race plans)
 * The audio itself is rendered by the Python scripts beside this file.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@thoroughbred/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
      zod: fileURLToPath(new URL("../../apps/web/node_modules/zod", import.meta.url)),
    },
  },
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["*.report.ts"],
    environment: "node",
    testTimeout: 600_000,
    pool: "forks",
  },
});
