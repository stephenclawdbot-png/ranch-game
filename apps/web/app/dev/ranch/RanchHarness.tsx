"use client";

import { useMemo } from "react";
import * as gc from "@thoroughbred/game-core";
import { RanchStage } from "@/components/stable/RanchStage";
import type { StableHorse } from "@/lib/types";

const SILKS = { primary: "#1f4d8a", secondary: "#f2d64b", cap: "#f2d64b", pattern: "hoops" } as const;
const LONG = ["Fair Wind Over Kestrel", "Copper Arrow of the Downs", "Lantern Sparrow", "Midnight Harbour Song"];

/** Made-up stable horses (deterministic) for the Ranch harness. */
export function RanchHarness({ n, longNames }: { n: number; longNames: boolean }) {
  const horses = useMemo(
    () =>
      Array.from({ length: Math.max(0, Math.min(24, n)) }, (_, i) => {
        const genome = gc.generateFoundationGenome(gc.seedFrom("ranch-harness", i), { season: 1, rarity: "common" });
        const young = i % 4 === 3;
        const appearance = gc.appearanceOf(genome, { racingAge: !young, starts: 3, retired: false, young: young ? "foal" : null }, SILKS as never);
        const name = longNames ? LONG[i % LONG.length]! : gc.clubHorseName(new gc.Rng(`ranch-name-${i}`));
        return {
          id: `h${i}`,
          stage: young ? "foal" : "prime",
          regNo: `G0-${String(i + 1).padStart(5, "0")}`,
          rating: 50 + i,
          risk: { label: "low", permille: 12, factors: [] },
          condition: "ready",
          block: young ? "Not yet of racing age" : null,
          lockedRaceId: null,
          geneticsLine: null,
          horse: { id: `h${i}`, name, sex: i % 2 ? "female" : "male", age: young ? 0 : 3, appearance },
        } as unknown as StableHorse;
      }),
    [n, longNames],
  );
  return (
    <main>
      <RanchStage horses={horses} eyebrow="Your yard" title="Stable" onRace={() => undefined} />
    </main>
  );
}
