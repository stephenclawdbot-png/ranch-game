import { describe, expect, it } from "vitest";
import {
  QUIRK_EFFECT,
  QUIRK_KEYS,
  exactMoment,
  improverShows,
  momentKey,
  quirkCatalogue,
  quirkMoment,
  revealWidth,
  scanMoment,
  settlementMoments,
  type HorseState,
  type SettlementMomentInput,
  type Tribute,
} from "./index";
import { makeHorse } from "./test-helpers";

const race = { id: "race-1", name: "Saltmarsh Maiden Stakes", feature: false, rated: true };
const tribute: Tribute = { starts: 40, wins: 6, places: 5, shows: 4, earnings: 54_321, peakOr: 88, bestWin: { raceId: "race-9", raceName: "Ashcombe Listed", purse: 6000, atMs: 0 } };
const withStarts = (h: HorseState, starts: number): HorseState => ({ ...h, career: { ...h.career, starts } });

function input(over: Partial<SettlementMomentInput> = {}): SettlementMomentInput {
  return {
    horse: { id: "h1", name: "Sea Lavender", sex: "filly" },
    race,
    position: 4,
    fieldSize: 10,
    before: null,
    after: null,
    newQuirks: [],
    winsBefore: 0,
    startsAfter: 3,
    firstFeature: false,
    retired: null,
    fatal: false,
    tribute,
    ...over,
  };
}

describe("moments: race milestones", () => {
  it("a first win is a moment only for the first rated win", () => {
    expect(settlementMoments(input({ position: 1 })).map((m) => m.kind)).toEqual(["first_win"]);
    expect(settlementMoments(input({ position: 1, winsBefore: 1 }))).toEqual([]);
    expect(settlementMoments(input({ position: 2 }))).toEqual([]);
    // Story races don't count on the record: no "first win" there
    expect(settlementMoments(input({ position: 1, race: { ...race, rated: false } }))).toEqual([]);
    const m = settlementMoments(input({ position: 1 }))[0]!;
    expect(m.dedupeKey).toBe(momentKey("first_win", "h1"));
    expect(m.raceId).toBe("race-1");
    expect(m.href).toBe("/race/race-1");
    expect(m.body).toMatch(/^Her first win/);
  });

  it("a first Feature run, with the finish", () => {
    const ms = settlementMoments(input({ race: { ...race, feature: true }, firstFeature: true, position: 5, fieldSize: 12 }));
    expect(ms.map((m) => m.kind)).toEqual(["first_feature"]);
    expect(ms[0]!.body).toContain("5th of 12");
    expect(settlementMoments(input({ race: { ...race, feature: true }, firstFeature: false }))).toEqual([]);
  });

  it("a fatal injury sends only a quiet memorial", () => {
    const ms = settlementMoments(input({ fatal: true, position: 1, race: { ...race, feature: true }, firstFeature: true, newQuirks: ["mudlark"], retired: "injury" }));
    expect(ms.map((m) => m.kind)).toEqual(["memorial"]);
    expect(ms[0]!.title).toBe("In memoriam: Sea Lavender");
    expect(ms[0]!.body).not.toMatch(/!/);
    expect(ms[0]!.href).toBe("/legacy#h-h1");
  });

  it("retirement carries the tribute (record and best win)", () => {
    const ms = settlementMoments(input({ retired: "max_starts" }));
    expect(ms.map((m) => m.kind)).toEqual(["retired"]);
    expect(ms[0]!.tribute).toEqual(tribute);
    expect(ms[0]!.body).toContain("40 starts, 6 wins");
    expect(ms[0]!.body).toContain("54,321 cr");
    expect(ms[0]!.body).toContain("Best win: the Ashcombe Listed");
  });

  it("names the injury: the memorial's cause, and a career-ending one says she can't race again", () => {
    const memo = settlementMoments(input({ fatal: true, retired: "injury", injuryName: "Catastrophic leg fracture" }))[0]!;
    expect(memo.body).toContain("fatally injured in the Saltmarsh Maiden Stakes (catastrophic leg fracture).");
    const ret = settlementMoments(input({ retired: "injury", injuryName: "Bowed tendon" }))[0]!;
    expect(ret.title).toBe("Sea Lavender retires after an injury");
    expect(ret.body).toMatch(/^Bowed tendon: she can't race again\./);
    expect(ret.body).toContain("broodmares or retire to the Legacy Farm");
    // an old injury without a name still reads well
    expect(settlementMoments(input({ retired: "injury" }))[0]!.body).toMatch(/^She can't race again\./);
  });
});

describe("moments: discoveries", () => {
  it("a newly revealed quirk says what it does with the rules' numbers", () => {
    const ms = settlementMoments(input({ newQuirks: ["mudlark"] }));
    expect(ms).toHaveLength(1);
    const m = ms[0]!;
    expect(m.kind).toBe("quirk");
    expect(m.dedupeKey).toBe(momentKey("quirk", "h1", "mudlark"));
    expect(m.body).toContain(`+${QUIRK_EFFECT.mudlark.adaptability} adaptability`);
    expect(m.body).toContain("soft or heavy");
    expect(quirkMoment({ id: "h2", name: "X", sex: "colt" }, "gateShy", race).body).toContain(`−${-QUIRK_EFFECT.gateShy.temperament!} temperament`);
  });

  it("the quirk catalogue covers every quirk", () => {
    const cat = quirkCatalogue();
    expect(cat.map((c) => c.key)).toEqual([...QUIRK_KEYS]);
    for (const c of cat) for (const d of Object.values(QUIRK_EFFECT[c.key])) expect(c.effect).toContain(String(Math.abs(d)));
  });

  it("the improver step is announced when it first shows, never before", () => {
    let found = 0;
    for (let s = 0; s < 400 && found < 3; s++) {
      const h = makeHorse(`improver-${s}`);
      const shows = Array.from({ length: 41 }, (_, k) => improverShows(withStarts(h, k)));
      const first = shows.indexOf(true);
      if (first <= 0) continue;
      found++;
      for (let k = 1; k <= 40; k++) {
        const ms = settlementMoments(input({ horse: { id: h.id, name: h.name, sex: h.sex }, before: withStarts(h, k - 1), after: withStarts(h, k) })).filter((m) => m.kind === "improver");
        expect(ms.length, `start ${k}`).toBe(k === first ? 1 : 0);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("ranges narrowing to exact is announced at the start that closes them", () => {
    const h = makeHorse("exact-1");
    const closes = Array.from({ length: 41 }, (_, k) => revealWidth(withStarts(h, k)) === 0).indexOf(true);
    expect(closes).toBeGreaterThan(0);
    for (let k = 1; k <= 40; k++) {
      const ms = settlementMoments(input({ horse: { id: h.id, name: h.name, sex: h.sex }, before: withStarts(h, k - 1), after: withStarts(h, k) })).filter((m) => m.kind === "exact");
      expect(ms.length, `start ${k}`).toBe(k === closes ? 1 : 0);
    }
    expect(exactMoment(withStarts(h, closes), null).body).not.toContain("–");
  });

  it("a scan lists the narrowed ranges; big heart only when the scan is what reveals it", () => {
    const h = makeHorse("scan-1");
    const after = { ...h, reveal: { ...h.reveal, scanned: true } };
    const m = scanMoment(h, after);
    expect(m.kind).toBe("scan");
    expect(m.body).toContain(`from ${revealWidth(h)} to ${revealWidth(after)} points`);
    expect(m.body).toContain("Big heart");
    const raced = withStarts(h, 3);
    expect(scanMoment(raced, { ...raced, reveal: { ...raced.reveal, scanned: true } }).body).not.toContain("Big heart");
  });
});
