import { defineConfig } from "vitest/config";

// Each test file boots its own in-memory PGlite (WASM Postgres) and applies migrations;
// under parallel load that can take several seconds.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
