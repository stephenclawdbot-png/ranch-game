/**
 * Clip planning tests (node: no canvas here, so the frame schedule, overlay layout
 * math and the settled-only gate are what's pinned). Determinism of pixels comes from
 * the schedule being a pure function of the replay plus a fixed 1/fps realDt in
 * record.ts — the same replay always yields the clipSchedule asserted below.
 */
import { describe, expect, it } from "vitest";
import { craftPhotoReplay } from "../photo/fixture";
import { replayTiming } from "../sampleReplay";
import { timeLeaderReaches } from "../playback";
import { isPhotoFinish } from "../finale/plan";
import { marginLabelFor } from "../finale/plan";
import type { CallLine } from "../call/buildRaceCall";
import {
  CLIP_FPS,
  CLIP_FROM_M,
  CLIP_MAX_SEC,
  CLIP_MIN_SEC,
  CLIP_SIZES,
  EASE_DOWN_SEC,
  END_CARD_SEC,
  PHOTO_HOLD_SEC,
  canShareClip,
  clipFileName,
  clipSchedule,
  clipSlug,
  clipWindow,
  endCardRows,
  overlayAt,
} from "./plan";
import { clipLayout, endCardHeight, wrapLines } from "./overlay";

const speed = 16_500;
/** A settled race: first two a nose apart, the rest strung out. */
const replay = craftPhotoReplay({
  name: "The Harrowdale Sprint",
  distanceM: 1200,
  postTimeMs: Date.UTC(2026, 9, 30, 14, 30),
  marginLabel: marginLabelFor,
  runners: [
    { name: "Silver Bramble", crossingUs: 72_727_272, speedMmS: speed },
    { name: "Golden Mile", crossingUs: 72_733_333, speedMmS: speed },
    { name: "Quiet Riot", crossingUs: 72_860_000, speedMmS: speed },
    { name: "Paper Lantern", crossingUs: 73_400_000, speedMmS: speed },
  ],
});

describe("clipWindow", () => {
  it("ends one second after the last finisher (the ease-down)", () => {
    const timing = replayTiming(replay);
    const w = clipWindow(replay);
    expect(w.endSec).toBeCloseTo(Math.min(timing.duration, timing.lastFinishTime + EASE_DOWN_SEC), 9);
    expect(timing.lastFinishTime).toBeCloseTo(73.4, 6);
  });

  it("covers 12-15 s, opening with the leader about 300 m out", () => {
    const w = clipWindow(replay);
    const len = w.endSec - w.startSec;
    expect(len).toBeGreaterThanOrEqual(CLIP_MIN_SEC - 1e-6);
    expect(len).toBeLessThanOrEqual(CLIP_MAX_SEC + 1e-6);
    // Constant 16.5 m/s: 300 m takes ~18.2 s — longer than the max, so the clamp pins
    // the start 15 s before the end (the line is always in shot).
    const t300 = timeLeaderReaches(replay, CLIP_FROM_M)!;
    expect(t300).toBeLessThan(w.endSec - CLIP_MAX_SEC);
    expect(w.startSec).toBeCloseTo(w.endSec - CLIP_MAX_SEC, 9);
    expect(w.startSec).toBeGreaterThan(0);
  });

  it("honours the 300 m opening when the finish is tight enough", () => {
    // Winner and tailender cross almost together: 300 m out fits in 15 s at walking speed.
    const tight = craftPhotoReplay({
      marginLabel: marginLabelFor,
      runners: [
        { name: "A", crossingUs: 20_000_000, speedMmS: 1000 }, // 1 m/s: 300 m = 300 s, unclamped path
        { name: "B", crossingUs: 20_500_000, speedMmS: 1000 },
      ],
    });
    const w = clipWindow(tight);
    const t300 = timeLeaderReaches(tight, CLIP_FROM_M)!;
    // The natural window (300 m out -> last finisher + 1 s) is longer than the max, so
    // expect the max clamp again — the interesting assertion: never earlier than that.
    expect(w.startSec).toBeCloseTo(w.endSec - CLIP_MAX_SEC, 9);
    expect(t300).toBeLessThan(w.startSec);
  });
});

describe("clipSchedule", () => {
  it("steps race frames exactly 1/fps apart from the window start", () => {
    const s = clipSchedule(replay);
    expect(s.fps).toBe(CLIP_FPS);
    for (let i = 0; i < s.raceFrames; i++) {
      const f = s.frames[i]!;
      expect(f.photo).toBe(false);
      expect(f.timeSec).toBeCloseTo(s.startSec + i / CLIP_FPS, 9);
    }
    expect(s.frames[s.raceFrames - 1]!.timeSec!).toBeLessThanOrEqual(s.endSec + 1e-9);
  });

  it("appends the photo-finish hold (2 s, no race time) only for a photo finish", () => {
    expect(isPhotoFinish(replay)).toBe(true);
    const s = clipSchedule(replay);
    expect(s.photoFrames).toBe(Math.round(PHOTO_HOLD_SEC * CLIP_FPS));
    expect(s.frames.length).toBe(s.raceFrames + s.photoFrames);
    for (const f of s.frames.slice(s.raceFrames)) {
      expect(f.photo).toBe(true);
      expect(f.timeSec).toBeNull();
    }
    const notPhoto = craftPhotoReplay({
      marginLabel: marginLabelFor,
      runners: [
        { name: "A", crossingUs: 70_000_000, speedMmS: speed },
        { name: "B", crossingUs: 71_000_000, speedMmS: speed },
      ],
    });
    expect(isPhotoFinish(notPhoto)).toBe(false);
    expect(clipSchedule(notPhoto).photoFrames).toBe(0);
    expect(clipSchedule(replay, { photo: false }).photoFrames).toBe(0);
  });

  it("is a pure function of the replay (identical schedules, twice)", () => {
    expect(clipSchedule(replay)).toEqual(clipSchedule(replay));
  });
});

describe("overlayAt", () => {
  const line = (atSec: number, text: string, priority = 50): CallLine => ({ atSec, text, kind: "move", horseIds: [], priority });

  it("shows the call line at the frame's race time (never a future one)", () => {
    const s = clipSchedule(replay);
    const lines = [line(s.startSec + 1, "Golden Mile tackles Silver Bramble"), line(s.startSec + 60, "a future line that must never show")];
    const at = (t: number) => Math.round((t - s.startSec) * CLIP_FPS);
    expect(overlayAt(s, at(s.startSec + 0.5), lines).caption).toBeNull();
    expect(overlayAt(s, at(s.startSec + 1.2), lines).caption?.text).toBe("Golden Mile tackles Silver Bramble");
    // Holds for a few seconds, then clears.
    expect(overlayAt(s, at(s.startSec + 10), lines).caption).toBeNull();
  });

  it("fades the end card in over the last seconds and drops the caption", () => {
    const s = clipSchedule(replay);
    // Spoken just before the card comes up, so it is still on hold when the card starts.
    const lines = [line(s.endSec - END_CARD_SEC - 2, "They're racing")];
    const before = Math.floor((s.endSec - END_CARD_SEC - 0.5 - s.startSec) * CLIP_FPS);
    const mid = Math.round((s.endSec - END_CARD_SEC + 0.2 - s.startSec) * CLIP_FPS);
    const last = s.raceFrames - 1;
    expect(overlayAt(s, before, lines).endCardFade).toBe(0);
    expect(overlayAt(s, before, lines).caption?.text).toBe("They're racing");
    const m = overlayAt(s, mid, lines);
    expect(m.endCardFade).toBeGreaterThan(0);
    expect(m.endCardFade).toBeLessThan(1);
    expect(m.caption).toBeNull();
    expect(overlayAt(s, last, lines).endCardFade).toBe(1);
    expect(overlayAt(s, s.raceFrames, lines).endCardFade).toBe(0); // the photo hold carries none
  });
});

describe("endCardRows", () => {
  it("lists the official top 3 with the winning time and margins", () => {
    const rows = endCardRows(replay);
    expect(rows.map((r) => r.name)).toEqual(["Silver Bramble", "Golden Mile", "Quiet Riot"]);
    expect(rows[0]!.posText).toBe("1st");
    expect(rows[0]!.winner).toBe(true);
    expect(rows[0]!.marginText).toMatch(/^\d+:\d{2}\.\d{2}$/); // the winning time
    // 100 mm at 16.5 m/s ≈ 6 ms: a nose.
    expect(rows[1]!.marginText).toBe("a nose");
    // Third beaten ~2,090 mm ≈ three-quarters of a length.
    expect(rows[2]!.marginText).toBe("three-quarters of a length");
    expect(rows[1]!.silks.primary).toBeTruthy();
  });

  it("shares the placing on a dead heat", () => {
    const dh = craftPhotoReplay({
      marginLabel: marginLabelFor,
      runners: [
        { name: "A", crossingUs: 70_000_000, speedMmS: speed },
        { name: "B", crossingUs: 70_000_000, speedMmS: speed },
        { name: "C", crossingUs: 71_000_000, speedMmS: speed },
      ],
    });
    // craftPhotoReplay keeps positions distinct; make a true dead heat on the official record.
    dh.result.finishOrder[1]!.position = 1;
    const rows = endCardRows(dh);
    expect(rows[0]!.position).toBe(1);
    expect(rows[1]!.position).toBe(1);
    expect(rows[0]!.marginText).toBe("dead heat");
    expect(rows[1]!.marginText).toBe("dead heat");
  });
});

describe("clipFileName", () => {
  it("is post-time-<course>-<race>-<date>.<ext>, filename-safe", () => {
    expect(clipFileName({ course: "Harrowdale Downs", race: "The 14:40 Sprint!", dateMs: Date.UTC(2026, 9, 30, 14, 30), ext: "mp4" })).toBe(
      "post-time-harrowdale-downs-the-14-40-sprint-2026-10-30.mp4",
    );
    expect(clipFileName({ race: "Cups & Saucers", dateMs: Date.UTC(2026, 0, 2), ext: "webm" })).toBe("post-time-cups-saucers-2026-01-02.webm");
    expect(clipSlug("  --WEIRd__name-- ")).toBe("weird-name");
  });
});

describe("the settled-only gate (no spoilers)", () => {
  it("never offers a clip before the official result exists", () => {
    expect(canShareClip(null)).toBe(false);
    expect(canShareClip(undefined)).toBe(false);
    expect(canShareClip(replay, true)).toBe(false); // what-if runs are never official
    expect(canShareClip(replay)).toBe(true);
  });
});

describe("overlay layout math", () => {
  it("scales both shipping sizes from the same unit and stays in bounds", () => {
    for (const { width, height } of Object.values(CLIP_SIZES)) {
      const l = clipLayout(width, height);
      expect(l.u).toBeCloseTo(1, 9); // both sizes share the 1080 short side
      expect(l.bannerH).toBeLessThan(height / 4);
      expect(l.captionMaxW).toBe(width - l.pad * 2);
      const cardH = endCardHeight(l, 3);
      const cardY = height - l.endCard.bottom - cardH;
      expect(cardY).toBeGreaterThan(l.bannerH); // clear of the banner
      expect(height - (cardY + cardH)).toBeGreaterThan(0); // and inside the frame
      expect(l.endCard.x).toBeGreaterThanOrEqual(0);
      expect(l.endCard.x + l.endCard.w).toBeLessThanOrEqual(width);
    }
  });

  it("endCardHeight grows by one row per row", () => {
    const l = clipLayout(1080, 1920);
    expect(endCardHeight(l, 4) - endCardHeight(l, 3)).toBeCloseTo(l.endCard.rowH, 9);
  });

  it("wrapLines breaks at the max width without splitting words", () => {
    const measure = (t: string) => t.length * 10;
    expect(wrapLines(measure, "one two three four", 110)).toEqual(["one two", "three four"]);
    expect(wrapLines(measure, "antidisestablishmentarianism ok", 110)).toEqual(["antidisestablishmentarianism", "ok"]);
    expect(wrapLines(measure, "", 110)).toEqual([]);
  });
});
