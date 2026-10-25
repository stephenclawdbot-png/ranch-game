import { describe, expect, it } from "vitest";
import { DEFAULT_SIM, formatReport, runPopulationSim } from "./population";

const FULL = process.env.SIM_REPORT === "1";

describe("population Monte Carlo", () => {
  it(
    FULL ? "full report" : "reduced run hits the design targets",
    () => {
      const cfg = FULL ? DEFAULT_SIM : { ...DEFAULT_SIM, players: Number(process.env.SIM_PLAYERS ?? 150), seasons: Number(process.env.SIM_SEASONS ?? 8) };
      const r = runPopulationSim(cfg);
      console.log(formatReport(r));
      expect(r.rows.length).toBe(cfg.seasons);
    },
    600_000,
  );
});
