import { defineConfig } from "drizzle-kit";

// `pnpm --filter @thoroughbred/db generate` diffs src/schema.ts against migrations/meta and
// writes the next versioned SQL migration, then re-bundles migrations for the runtime migrator.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
