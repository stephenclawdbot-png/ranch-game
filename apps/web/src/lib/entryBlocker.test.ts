import { describe, expect, it } from "vitest";
import { entryBlocker } from "./entryBlocker";

const LICENCE = "Needs a National: earn it in Story mode";
const base = { entriesLeft: 10, entryCost: 2 };

describe("entryBlocker", () => {
  it("waits for the options", () => {
    expect(entryBlocker({ ...base, options: null, selected: null })).toBeNull();
  });
  it("names the shared reason when no horse can enter (a missing licence)", () => {
    const b = entryBlocker({ ...base, options: [{ horseId: "a", reason: LICENCE }, { horseId: "b", reason: LICENCE }], selected: null });
    expect(b?.title).toBe("None of your horses can enter this race");
    expect(b?.detail).toBe(LICENCE);
  });
  it("points at the per-horse reasons when they differ", () => {
    const b = entryBlocker({ ...base, options: [{ horseId: "a", reason: LICENCE }, { horseId: "b", reason: "Rating too high" }], selected: null });
    expect(b?.detail).toMatch(/under its name/);
  });
  it("blocks a selected ineligible horse while another could run", () => {
    const b = entryBlocker({ ...base, options: [{ horseId: "a", reason: "Rating too high" }, { horseId: "b", reason: null }], selected: { id: "a", name: "Comet" } });
    expect(b?.title).toBe("Comet can't enter this race");
    expect(b?.detail).toBe("Rating too high. Pick another horse.");
  });
  it("blocks when the stable is out of entries, and is null when all is well", () => {
    const options = [{ horseId: "b", reason: null }];
    expect(entryBlocker({ options, selected: { id: "b", name: "B" }, entriesLeft: 1, entryCost: 2 })?.title).toBe("Not enough stable entries");
    expect(entryBlocker({ ...base, options, selected: { id: "b", name: "B" } })).toBeNull();
  });
});
