import { defineConfig } from "vitest/config";

// Balance and property suites simulate hundreds of races; give them room on a busy CI box.
export default defineConfig({
  test: { testTimeout: 60_000 },
});
