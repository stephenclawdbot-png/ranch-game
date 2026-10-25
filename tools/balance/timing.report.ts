import { it } from "vitest";
import { createQuickRace, getRaceInput } from "../../apps/web/src/server/races";
import { simulateRace } from "../../apps/web/src/server/engine";
it("timing", () => {
  const t0 = performance.now();
  let n = 0;
  for (let k = 0; k < 100; k++) {
    const { raceId } = createQuickRace({ playerId: "abcdefghij" + String(k).padStart(4, "0"), horseIndex: k % 6, tactic: "front" }, 0 + 1e12, "nonce" + k + "x");
    simulateRace(getRaceInput(raceId));
    n++;
  }
  console.log("ms/race", (performance.now() - t0) / n);
});
