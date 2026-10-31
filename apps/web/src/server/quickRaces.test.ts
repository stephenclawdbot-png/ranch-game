/** Quick races' wording: margins, the result line and the ghost race line. */
import { describe, expect, it } from "vitest";
import { ghostLine } from "@/lib/quickRaces";
import { headlineOf, marginWords } from "./quickRaces";
import { fixtureReplay } from "./testing";

describe("quick race wording", () => {
  it("says margins in words a pixel font can print", () => {
    expect(marginWords("neck")).toBe("a neck");
    expect(marginWords("3/4")).toBe("three-quarters of a length");
    expect(marginWords("1")).toBe("a length");
    expect(marginWords("2 1/4")).toBe("2 1/4 lengths");
  });

  it("heads a result with the winner, and your horse when it lost", () => {
    const r = fixtureReplay("quick-headline", 0, { runners: 4 });
    const order = [...r.result.finishOrder].sort((a, b) => a.position - b.position);
    const name = (id: string) => r.horses.find((h) => h.horseId === id)!.name;
    expect(headlineOf(r, order[0]!.horseId)).toMatch(new RegExp(`^${name(order[0]!.horseId)} won by `));
    expect(headlineOf(r, order[2]!.horseId)).toMatch(new RegExp(`; ${name(order[2]!.horseId)} 3rd$`));
  });

  it("reads a ghost race as where you'd have finished", () => {
    expect(ghostLine(2, 3)).toBe("You'd have finished 2nd");
    expect(ghostLine(4, 3)).toBe("You'd have finished outside the first three");
  });
});
