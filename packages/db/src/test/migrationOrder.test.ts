import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../migrations.generated";

/**
 * The runtime migrator (migrate.ts) skips any migration whose `when` is not later than the last
 * one applied. Branches that generate migrations in parallel can end up out of order after a
 * merge, and the late one would then be skipped silently on databases that already ran the
 * others (preview builds share the production database). Regenerate the late one if this fails.
 */
describe("bundled migrations", () => {
  it("are numbered in order with strictly increasing timestamps", () => {
    for (let i = 1; i < MIGRATIONS.length; i++) {
      const prev = MIGRATIONS[i - 1]!;
      const cur = MIGRATIONS[i]!;
      expect(cur.tag > prev.tag, `${cur.tag} sorts after ${prev.tag}`).toBe(true);
      expect(cur.when, `${cur.tag} must be later than ${prev.tag}`).toBeGreaterThan(prev.when);
    }
  });
});
