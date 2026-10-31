import { describe, expect, it } from "vitest";
import type { VoicedCallLine } from "../buildRaceCall";
import { makeResolver, nameClipKey, nameKey, nameUrl, phraseKey } from "./library";
import { cheersBetween, crowdAt, crowdCues, dueLines, joinAt, planSpeech, SPEECH, type ClipRef } from "./schedule";
import type { Intensity, Speech } from "./speech";

const C = "bm_george";
/** Every clip lasts 1 s; names exist unless listed as missing. */
function resolver(missing: string[] = [], loading: string[] = []) {
  return makeResolver(C, (key) => {
    if (loading.some((n) => key === nameClipKey(C, "calm", n) || key === nameClipKey(C, "building", n) || key === nameClipKey(C, "climax", n))) return undefined;
    if (missing.some((n) => key.startsWith("n|") && key.endsWith(`|${nameKey(n)}`))) return "missing";
    return 1;
  });
}

function line(atSec: number, kind: VoicedCallLine["kind"], speech: Speech | null, priority = 50): VoicedCallLine {
  return { atSec, kind, text: kind, horseIds: [], priority, speech };
}
const sp = (intensity: Intensity, ...ids: string[]): Speech => ({ intensity, tokens: ids.map((id) => (id.startsWith("@") ? { k: "name" as const, name: id.slice(1), num: 6 } : { k: "p" as const, id })) });

describe("planSpeech", () => {
  it("starts each line at its call time and lays its clips end to end", () => {
    const plan = planSpeech([line(0.6, "off", sp("building", "and_theyre_off")), line(9, "order", sp("calm", "@Quiet Riot", "leads_from", "@Golden Mile"))], resolver());
    expect(plan.lines.map((l) => [l.start, l.end])).toEqual([
      [0.6, 1.6],
      [9, 9 + 3 + 2 * SPEECH.wordGapSec],
    ]);
    expect(plan.lines[1]!.clips.map((c) => c.at)).toEqual([0, 1 + SPEECH.wordGapSec, 2 + 2 * SPEECH.wordGapSec]);
    expect(plan.waitingFrom).toBe(-1);
  });

  it("says the saddle-cloth number until the name has a clip", () => {
    const plan = planSpeech([line(5, "move", sp("calm", "@Silver Bramble", "quickens"))], resolver(["Silver Bramble"]));
    expect(plan.lines[0]!.clips.map((c) => c.key)).toEqual([phraseKey(C, "calm", "num_6"), phraseKey(C, "calm", "quickens")]);
  });

  it("delays a line behind one still talking, drops a routine line that would be too late, lets a key call cut in", () => {
    const long = sp("calm", "a", "b", "c", "d"); // ~4.1 s
    const plan = planSpeech(
      [line(10, "position", long), line(12.5, "move", sp("calm", "e")), line(20, "position", long), line(21, "home", sp("climax", "f"), 85)],
      resolver(),
    );
    const [a, b, c, d] = plan.lines;
    expect(plan.lines.length).toBe(3);
    expect(a!.start).toBe(10);
    // 12.5 would start after 14.09 + gap: more than maxDelaySec late -> dropped.
    expect(b!.start).toBe(20);
    expect(b!.cut).toBeCloseTo(20.95, 6);
    expect(b!.end).toBeCloseTo(20.95, 6);
    expect(c!.start).toBe(21);
    expect(c!.kind).toBe("home");
    expect(d).toBeUndefined();
  });

  it("delays a line by up to maxDelaySec", () => {
    const plan = planSpeech([line(10, "position", sp("calm", "a", "b")), line(11.5, "move", sp("calm", "c"))], resolver());
    expect(plan.lines[1]!.start).toBeCloseTo(10 + 2.03 + SPEECH.lineGapSec, 6);
  });

  it("waits for clips still loading, but never holds the call up past a line's latest start", () => {
    const lines = [line(5, "move", sp("calm", "@Slow Name", "quickens")), line(9, "move", sp("calm", "x"))];
    const waiting = planSpeech(lines, resolver([], ["Slow Name"]), 5.5);
    expect(waiting.lines).toEqual([]);
    expect(waiting.waitingFrom).toBe(0);
    const skipped = planSpeech(lines, resolver([], ["Slow Name"]), 5 + SPEECH.maxDelaySec + 0.1);
    expect(skipped.lines.map((l) => l.start)).toEqual([9]);
  });

  it("is deterministic", () => {
    const lines = [line(1, "off", sp("building", "a")), line(4, "order", sp("calm", "@A", "b", "@B"))];
    expect(planSpeech(lines, resolver())).toEqual(planSpeech(lines, resolver()));
  });
});

describe("joining and the lookahead", () => {
  const plan = planSpeech([line(10, "position", sp("calm", "a", "b", "c")), line(20, "finish", sp("climax", "d"), 100)], resolver());

  it("joins a line part-way at the right clip and offset (seek, joining mid-race)", () => {
    const l = plan.lines[0]!;
    expect(joinAt(l, 9)).toEqual({ clip: 0, offset: 0 });
    expect(joinAt(l, 10.5)).toEqual({ clip: 0, offset: 0.5 });
    const j = joinAt(l, 11.5)!;
    expect(j.clip).toBe(1);
    expect(j.offset).toBeCloseTo(0.47, 6);
    expect(joinAt(l, l.end)).toBeNull();
  });

  it("starts lines playing now or due within the lookahead", () => {
    expect(dueLines(plan, 9.7, 0.25).map((l) => l.kind)).toEqual([]);
    expect(dueLines(plan, 9.8, 0.25).map((l) => l.kind)).toEqual(["position"]);
    expect(dueLines(plan, 11, 0.25).map((l) => l.kind)).toEqual(["position"]);
    expect(dueLines(plan, 13.5, 0.25).map((l) => l.kind)).toEqual([]);
  });

  it("at 2x / 4x / 0.5x only the key calls are spoken, from their start", () => {
    expect(dueLines(plan, 9.9, 0.25, 2).map((l) => l.kind)).toEqual([]);
    expect(dueLines(plan, 19.6, 0.25, 2).map((l) => l.kind)).toEqual(["finish"]);
    expect(dueLines(plan, 20.2, 0.25, 4).map((l) => l.kind)).toEqual([]);
  });
});

describe("the crowd", () => {
  it("follows the intensity, hushes for a photograph and cheers the verdict, then settles", () => {
    const plan = planSpeech(
      [
        line(0.6, "off", sp("building", "a")),
        line(9, "order", sp("calm", "a")),
        line(60, "home", sp("climax", "a")),
        line(70, "photo", sp("climax", "a", "b"), 100),
        line(76, "result", sp("climax", "a", "b", "c", "d", "e"), 95),
      ],
      resolver(),
    );
    const cues = crowdCues(plan);
    expect(crowdAt(cues, -5)).toBe("murmur");
    expect(crowdAt(cues, 1)).toBe("building");
    expect(crowdAt(cues, 20)).toBe("murmur");
    expect(crowdAt(cues, 61)).toBe("roar");
    expect(crowdAt(cues, 71)).toBe("roar");
    expect(crowdAt(cues, 73)).toBe("hush");
    expect(crowdAt(cues, 76.5)).toBe("hush");
    expect(crowdAt(cues, 80)).toBe("roar");
    expect(cheersBetween(cues, 70, 80).map((c) => c.at)).toEqual([79.2]);
    expect(crowdAt(cues, 200)).toBe("murmur");
  });

  it("cheers the winner at the line when there is no photograph", () => {
    const plan = planSpeech([line(50, "finish", sp("building", "a"), 100), line(53, "result", sp("calm", "a", "b"), 95)], resolver());
    const cues = crowdCues(plan);
    expect(cheersBetween(cues, 49, 51).map((c) => c.at)).toEqual([50]);
    expect(crowdAt(cues, 54)).toBe("building");
  });
});

describe("clip urls", () => {
  it("keys names the way the server does", () => {
    expect(nameKey("  Silver   Bramble ")).toBe("silver bramble");
    expect(nameUrl(1, C, "climax", "Silver Bramble")).toBe("/api/commentary/names/1/bm_george/climax/silver%20bramble");
    const r: ClipRef[] | null = makeResolver(C, () => 1.2)({ k: "name", name: "X", num: 3, your: true }, "calm");
    expect(r!.map((c) => c.key)).toEqual([phraseKey(C, "calm", "your"), nameClipKey(C, "calm", "X")]);
  });
});
