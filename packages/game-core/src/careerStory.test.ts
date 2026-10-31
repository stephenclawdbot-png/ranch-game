import { describe, expect, it } from "vitest";
import { careerStory, marginPhrase, STORY_HIGHLIGHTS, type CareerStoryInput, type StoryRun, type StoryRunner } from "./index";

const DAY = 86_400_000;
const ME = "h-me";
const MY_STABLE = "s-me";

const baseHorse: CareerStoryInput["horse"] = {
  id: ME,
  name: "Sea Lavender",
  sex: "female",
  gelded: false,
  careerStatus: "racing",
  retirementReason: null,
  retiredAtMs: null,
  pasturedAtMs: null,
  diedAtMs: null,
  diedAtRaceId: null,
};

const runner = (horseId: string, position: number, o: Partial<StoryRunner> = {}): StoryRunner => ({
  horseId,
  name: o.name ?? `Horse ${horseId}`,
  sex: o.sex ?? "male",
  stableId: o.stableId === undefined ? `s-${horseId}` : o.stableId,
  position,
  ratingBefore: o.ratingBefore ?? 50,
});

let seq = 0;
/** A race where this horse finished `pos` of `field` (Club runners fill the rest). */
function run(day: number, pos: number, o: Partial<StoryRun> & { field?: number; myRating?: number; others?: StoryRunner[] } = {}): StoryRun {
  seq++;
  const field = o.field ?? 6;
  const others = o.others ?? [];
  const runners: StoryRunner[] = [runner(ME, pos, { name: baseHorse.name, sex: "female", stableId: MY_STABLE, ratingBefore: o.myRating ?? 50 }), ...others];
  for (let p = 1; runners.length < field; p++) {
    if (runners.some((r) => r.position === p)) continue;
    runners.push(runner(`club-${seq}-${p}`, p, { stableId: null }));
  }
  return {
    raceId: o.raceId ?? `r${seq}`,
    raceName: o.raceName ?? `Saltmarsh Maiden ${seq}`,
    atMs: day * DAY,
    kind: o.kind ?? "scheduled",
    raceClass: o.raceClass ?? "maiden",
    purse: o.purse ?? 1_000,
    photoFinish: o.photoFinish ?? false,
    wonBy: o.wonBy === undefined ? "2" : o.wonBy,
    ratingAfter: o.ratingAfter ?? null,
    runners,
  };
}

const story = (runs: StoryRun[], extra: Partial<CareerStoryInput> = {}, horse: Partial<CareerStoryInput["horse"]> = {}) => careerStory({ horse: { ...baseHorse, ...horse }, runs, ...extra });

describe("career story", () => {
  it("is empty for an unraced horse", () => {
    expect(story([])).toEqual([]);
  });

  it("debut: a line for the first run, and none for ordinary races", () => {
    const s = story([run(1, 4, { raceName: "Saltmarsh Maiden Stakes" }), run(2, 5), run(3, 3)]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "debut", raceId: expect.any(String), highlight: true });
    expect(s[0]!.text).toBe("Made her debut in the Saltmarsh Maiden Stakes, 4th of 6.");
  });

  it("a debut win is one line: debut and first win together", () => {
    const s = story([run(1, 1, { raceName: "Kestrel Downs Maiden Stakes", wonBy: "neck" })]);
    expect(s).toHaveLength(1);
    expect(s[0]!.tags).toEqual(expect.arrayContaining(["debut", "first_win"]));
    expect(s[0]!.kind).toBe("first_win");
    expect(s[0]!.text).toBe("Won on her debut in the Kestrel Downs Maiden Stakes by a neck.");
  });

  it("first win names the start it came at", () => {
    const s = story([run(1, 3), run(2, 2), run(3, 1, { raceName: "Ashcombe Novice Stakes", wonBy: "1 1/2" })]);
    const first = s.find((e) => e.kind === "first_win")!;
    expect(first.text).toBe("Won the Ashcombe Novice Stakes by 1 1/2 lengths, her first win at start 3.");
  });

  it("biggest win: by race standing first, then purse (only with two or more wins)", () => {
    const s = story([
      run(1, 1, { raceName: "Maiden A" }),
      run(2, 1, { raceName: "Big Handicap", raceClass: "handicap", purse: 9_000 }),
      run(3, 1, { raceName: "Saltmarsh Listed Stakes", raceClass: "listed", purse: 4_000 }),
    ]);
    const biggest = s.find((e) => e.tags.includes("biggest_win"))!;
    expect(biggest.text).toMatch(/^Won the Saltmarsh Listed Stakes by 2 lengths, the biggest win of her career\.$/);
    // a lone win is the first win, never also "the biggest"
    expect(story([run(1, 1, { raceClass: "listed" })])[0]!.tags).not.toContain("biggest_win");
  });

  it("big wins (Features, Finals, Listed and Group races) each get a line", () => {
    const s = story([run(1, 1), run(5, 1, { kind: "final", raceName: "Season Final" }), run(9, 1, { kind: "feature", raceName: "Weekend Feature" })]);
    expect(s.find((e) => e.raceId && e.text.includes("Weekend Feature"))!.kind).toBe("big_win");
    expect(s.find((e) => e.text.includes("Season Final"))!.tags).toContain("biggest_win");
  });

  it("upset: won while rated in the bottom half of the field", () => {
    const others = [runner("a", 2, { ratingBefore: 80 }), runner("b", 3, { ratingBefore: 75 }), runner("c", 4, { ratingBefore: 70 }), runner("d", 5, { ratingBefore: 40 })];
    const s = story([run(1, 3), run(2, 1, { myRating: 55, others, field: 5, raceName: "Glenmorrow Handicap" })]);
    const e = s.find((x) => x.tags.includes("upset"))!;
    expect(e.text).toContain("Only 4th of 5 on ratings beforehand.");
    // the top-rated winner is no upset, nor an unrated one
    expect(story([run(1, 1, { myRating: 90, others, field: 5 })])[0]!.tags).not.toContain("upset");
    expect(story([run(1, 1, { myRating: 0, others, field: 5 })])[0]!.tags).not.toContain("upset");
  });

  it("photo finishes won and lost name the other horse and the margin", () => {
    const quiet = (pos: number) => runner("qr", pos, { name: "Quiet Riot", stableId: "s-qr" });
    const s = story([
      run(1, 5),
      run(2, 2, { photoFinish: true, wonBy: "nose", others: [quiet(1)], raceName: "Bellmont Sprint" }),
      run(3, 1, { wonBy: "short head", others: [quiet(2)], raceName: "Bellmont Mile" }),
    ]);
    expect(s.find((e) => e.kind === "photo_loss")!.text).toBe("Beaten a nose by Quiet Riot in the Bellmont Sprint.");
    const win = s.find((e) => e.tags.includes("photo_win"))!;
    expect(win.text).toMatch(/^Won the Bellmont Mile by a short head from Quiet Riot, her first win at start 3/);
    expect(win.horseId).toBe("qr");
  });

  it("the rival: the owned horse met most often, with the record; photo lines count the meetings", () => {
    const qr = (pos: number) => runner("qr", pos, { name: "Quiet Riot", stableId: "s-qr" });
    const runs = [
      run(1, 1, { others: [qr(2)] }),
      run(2, 2, { others: [qr(1)] }),
      run(3, 1, { others: [qr(3)] }),
      run(4, 1, { others: [qr(2)], wonBy: "nose", photoFinish: true, raceName: "Bellmont Mile" }),
      run(5, 3, { others: [qr(1)] }),
    ];
    const s = story(runs);
    const rival = s.find((e) => e.kind === "rival")!;
    expect(rival.text).toBe("Quiet Riot became her rival: five meetings, more than any other horse, and 3–2 against him.");
    expect(rival.raceId).toBe(runs[4]!.raceId);
    expect(s.find((e) => e.tags.includes("photo_win"))!.text).toBe("Won the Bellmont Mile by a nose from Quiet Riot, her fourth meeting with him.");
    // Club runners and stablemates are never the rival
    const club = (pos: number) => runner("club", pos, { stableId: null });
    const mate = (pos: number) => runner("mate", pos, { stableId: MY_STABLE });
    expect(story([run(1, 2, { others: [club(1), mate(3)] }), run(2, 2, { others: [club(1), mate(3)] }), run(3, 2, { others: [club(1), mate(3)] })]).some((e) => e.kind === "rival")).toBe(false);
  });

  it("rating peak: the first run that reached the career-high rating", () => {
    const s = story([run(1, 4, { ratingAfter: 40 }), run(2, 2, { ratingAfter: 52 }), run(3, 3, { ratingAfter: 61, raceName: "Peak Handicap" }), run(4, 5, { ratingAfter: 58 })]);
    const peak = s.find((e) => e.tags.includes("rating_peak"))!;
    expect(peak.text).toBe("3rd of 6 in the Peak Handicap. Rated 61 afterwards, her career high.");
  });

  it("quirks discovered in a race", () => {
    const r2 = run(2, 6, { raceName: "Soft Ground Handicap" });
    const s = story([run(1, 3), r2], { quirks: [{ raceId: r2.raceId, atMs: r2.atMs, quirks: ["mudlark", "notAQuirk"] }] });
    expect(s.find((e) => e.kind === "quirk")!.text).toBe("6th of 6 in the Soft Ground Handicap. The race showed she is a mudlark.");
  });

  it("injury, layoff and the comeback win", () => {
    const hurt = run(10, 4, { raceName: "Firm Ground Sprint" });
    const back = run(19, 6);
    const won = run(25, 1, { raceName: "Comeback Handicap" });
    const s = story([run(1, 3), hurt, back, won], { injuries: [{ raceId: hurt.raceId, atMs: hurt.atMs, severity: "minor", kind: "sore_shins" }] });
    expect(s.find((e) => e.kind === "injury")!.text).toBe("4th of 6 in the Firm Ground Sprint. Came home injured: sore shins, nine days off.");
    expect(s.find((e) => e.tags.includes("comeback"))!.text).toBe("Won the Comeback Handicap by 2 lengths, her first win at start 4. Her first win since sore shins in the Firm Ground Sprint.");
    // won first time back
    const s2 = story([hurt, run(16, 1)], { injuries: [{ raceId: hurt.raceId, atMs: hurt.atMs, severity: "moderate", kind: null }] });
    expect(s2.find((e) => e.tags.includes("comeback"))!.text).toMatch(/First time back, six days after an injury in the Firm Ground Sprint\.$/);
    // injuries from races not in the story (not yet public) are ignored
    expect(story([run(1, 3)], { injuries: [{ raceId: "elsewhere", atMs: 0, severity: "minor", kind: null }] })).toHaveLength(1);
  });

  it("retirement: to stud, the broodmare band, or the Legacy Farm", () => {
    const runs = [run(1, 1), run(2, 2)];
    const mare = story(runs, {}, { careerStatus: "retired", retirementReason: "choice", retiredAtMs: 3 * DAY });
    expect(mare.at(-1)!.text).toBe("Retired to the broodmare band after two starts and one win.");
    const stud = story(runs, {}, { sex: "male", careerStatus: "retired", retirementReason: "max_starts", retiredAtMs: 3 * DAY });
    expect(stud.at(-1)!.text).toBe("Retired to stud after a full career: two starts and one win.");
    const gelding = story(runs, {}, { sex: "male", gelded: true, careerStatus: "retired", retirementReason: "choice", retiredAtMs: 3 * DAY });
    expect(gelding.at(-1)!.text).toMatch(/^Retired from racing after/);
    const farm = story(runs, {}, { careerStatus: "pasture", retirementReason: "choice", retiredAtMs: 3 * DAY, pasturedAtMs: 3 * DAY });
    expect(farm.at(-1)).toMatchObject({ kind: "legacy", text: "Retired to the Legacy Farm after two starts and one win." });
    const later = story(runs, {}, { careerStatus: "pasture", retirementReason: "choice", retiredAtMs: 3 * DAY, pasturedAtMs: 30 * DAY });
    expect(later.slice(-2).map((e) => e.kind)).toEqual(["retired", "legacy"]);
  });

  it("a fatal injury is a quiet memorial, with no retirement line", () => {
    const last = run(2, 7, { raceName: "Heavy Ground Chase" });
    const s = story([run(1, 1), last], {}, { careerStatus: "pasture", retirementReason: "injury", retiredAtMs: 2 * DAY, pasturedAtMs: 2 * DAY, diedAtMs: 2 * DAY, diedAtRaceId: last.raceId });
    expect(s.at(-1)).toMatchObject({ kind: "memorial", text: "Fatally injured in the Heavy Ground Chase. She ran two times and won one race; her memory stays on the Legacy Farm." });
    expect(s.some((e) => e.kind === "retired" || e.kind === "legacy")).toBe(false);
  });

  it("foals: each one's first win and its big wins", () => {
    const s = story([run(1, 1)], {
      foalWins: [
        { foalId: "f1", foalName: "Copper Kettle", foalSex: "male", raceId: "x1", raceName: "Maiden X", atMs: 50 * DAY, kind: "scheduled", raceClass: "maiden", purse: 1000 },
        { foalId: "f1", foalName: "Copper Kettle", foalSex: "male", raceId: "x2", raceName: "Handicap Y", atMs: 55 * DAY, kind: "scheduled", raceClass: "handicap", purse: 1500 },
        { foalId: "f1", foalName: "Copper Kettle", foalSex: "male", raceId: "x3", raceName: "Saltmarsh Cup", atMs: 60 * DAY, kind: "feature", raceClass: "graded", purse: 9000 },
        { foalId: "f1", foalName: "Copper Kettle", foalSex: "male", raceId: "x3", raceName: "Saltmarsh Cup", atMs: 60 * DAY, kind: "feature", raceClass: "graded", purse: 9000 },
        { foalId: "f2", foalName: "Marsh Light", foalSex: "female", raceId: "x4", raceName: "Ashcombe Listed", atMs: 70 * DAY, kind: "scheduled", raceClass: "listed", purse: 4000 },
      ],
    });
    const foals = s.filter((e) => e.kind.startsWith("foal_"));
    expect(foals.map((e) => e.text)).toEqual([
      "Her son Copper Kettle won for the first time, in the Maiden X.",
      "Her son Copper Kettle won the Saltmarsh Cup.",
      "Her daughter Marsh Light won the Ashcombe Listed, her first win.",
    ]);
    expect(foals.map((e) => e.horseId)).toEqual(["f1", "f1", "f2"]);
  });

  it("Hall of Fame inductions, once each", () => {
    const hon = { key: "horse:x:champion", atMs: 9 * DAY, honour: "Champion" };
    const s = story([run(1, 1)], { honours: [hon, hon] });
    expect(s.filter((e) => e.kind === "hall_of_fame").map((e) => e.text)).toEqual(["Inducted into the Hall of Fame: Champion."]);
  });

  it("oldest first; one line per race (deduped); the best lines are the highlights", () => {
    const r1 = run(1, 1);
    const runs: StoryRun[] = [r1, r1];
    for (let d = 2; d < 30; d++) runs.push(run(d, 1, { raceClass: d % 2 === 0 ? "listed" : "maiden", raceName: `Race ${d}` }));
    const s = story(runs.reverse(), {}, { careerStatus: "retired", retirementReason: "choice", retiredAtMs: 40 * DAY });
    expect(s.filter((e) => e.raceId === r1.raceId && e.key.startsWith("race:"))).toHaveLength(1);
    expect(new Set(s.map((e) => e.key)).size).toBe(s.length);
    expect(s.map((e) => e.atMs)).toEqual([...s.map((e) => e.atMs)].sort((a, b) => a - b));
    expect(s.length).toBeGreaterThan(STORY_HIGHLIGHTS);
    const hl = s.filter((e) => e.highlight);
    expect(hl).toHaveLength(STORY_HIGHLIGHTS);
    // the debut, the retirement and the biggest win always make the cut over plain listed wins
    expect(hl[0]!.raceId).toBe(r1.raceId);
    expect(hl.at(-1)!.kind).toBe("retired");
    expect(hl.some((e) => e.tags.includes("biggest_win"))).toBe(true);
    expect(careerStory({ horse: baseHorse, runs }, { highlights: 3 }).filter((e) => e.highlight)).toHaveLength(3);
  });

  it("margin phrases", () => {
    expect(["nose", "head", "1/2", "3/4", "1", "4 1/2", "dist"].map(marginPhrase)).toEqual(["a nose", "a head", "half a length", "three-quarters of a length", "a length", "4 1/2 lengths", "a distance"]);
  });

  it("a colt's story uses his pronouns", () => {
    const s = story([run(1, 6, { raceName: "Ashcombe Maiden" }), run(2, 1, { raceName: "Colt Stakes" })], {}, { sex: "male", name: "Copper Kettle" });
    expect(s.map((e) => e.text)).toEqual(["Made his debut in the Ashcombe Maiden, 6th of 6.", "Won the Colt Stakes by 2 lengths, his first win at start 2."]);
  });
});
