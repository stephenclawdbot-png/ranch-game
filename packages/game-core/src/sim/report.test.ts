/**
 * Population Monte Carlo. The default run is reduced (fast, part of `pnpm test`) and asserts
 * the invariants and the early trend; `SIM_REPORT=1` (pnpm sim) runs the full 400-player,
 * 10-season model whose results are recorded in the README.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SIM, formatReport, populationSteps, type SimReport } from "./population";
import { MAX_STALLS } from "../economy";

const FULL = process.env.SIM_REPORT === "1";

describe("population Monte Carlo", () => {
  it(
    FULL ? "full report (400 players, 10 seasons)" : "reduced run: bounded population, rising top end",
    async () => {
      const cfg = FULL ? DEFAULT_SIM : { ...DEFAULT_SIM, players: 120, seasons: 5 };
      // Drive the generator, yielding to the event loop each simulated day so the test worker stays responsive.
      const steps = populationSteps(cfg);
      let r: SimReport | undefined;
      while (!r) {
        const n = steps.next();
        if (n.done) r = n.value;
        else await new Promise((res) => setTimeout(res, 0));
      }
      console.log(formatReport(r));
      expect(r.rows.length).toBe(cfg.seasons);
      // Stall cap + one nursery overflow bounds every stable.
      for (const row of r.rows) expect(row.maxActive).toBeLessThanOrEqual(MAX_STALLS + 1);
      // Selective breeding lifts the top end well above the launch ceiling (600) within a few generations.
      expect(r.firsts.B).toBeDefined();
      expect(r.firsts.B!.generation).toBeLessThanOrEqual(5);
      expect(r.rows[r.rows.length - 1]!.top1Mean).toBeGreaterThan(r.rows[0]!.top1Mean);
      if (FULL) {
        expect(r.firsts.A).toBeDefined();
        expect(r.firsts.A!.generation).toBeGreaterThanOrEqual(3);
        expect(r.firsts.A!.generation).toBeLessThanOrEqual(8);
        expect(r.firsts.S).toBeUndefined();
      }
    },
    900_000,
  );
});
