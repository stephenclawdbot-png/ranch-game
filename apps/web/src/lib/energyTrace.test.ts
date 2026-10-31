/**
 * The Why card's energy line (first-hour playtest): read from the engine's replay frames, never
 * invented. Real engine replays check the points match the frames, the field line is the other
 * runners' median, "ran low" matches the tank in the frames, and the chart has a text equivalent.
 */
import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { simulateRace } from "@thoroughbred/racing-engine";
import { FRAME_FIELD, FRAME_STRIDE, type RaceReplay } from "@thoroughbred/shared";
import { fixtureInput } from "@/server/testing";
import { EnergyLine } from "@/components/results/EnergyLine";
import { WhyCard } from "@/components/results/WhyCard";
import { analyseRace } from "./raceAnalysis";
import { ENERGY_LOW, ENERGY_POINTS, energyHeadline, energySummary, energyTrace } from "./energyTrace";

const NOW = Date.UTC(2026, 9, 25, 15, 0, 0);
const inputs = [1000, 1400, 2000, 2400].map((d, k) => fixtureInput(`energy-${k}`, NOW, { distanceM: d, runners: 9 }));
const replays: RaceReplay[] = inputs.map((i) => simulateRace(i));

const energyAt = (r: RaceReplay, f: number, h: number) => r.frames[f]![h * FRAME_STRIDE + FRAME_FIELD.energy]!;
const distAt = (r: RaceReplay, f: number, h: number) => r.frames[f]![h * FRAME_STRIDE + FRAME_FIELD.distanceMm]!;

describe("energyTrace (from the replay frames)", () => {
  it("is the frame energy where the horse reached each point of the trip, full at the off", () => {
    for (const r of replays) {
      for (const [h, horse] of r.horses.entries()) {
        const t = energyTrace(r, horse.horseId)!;
        expect(t.mine.length).toBe(ENERGY_POINTS + 1);
        expect(t.field.length).toBe(ENERGY_POINTS + 1);
        expect(t.distanceM).toBe(r.race.distanceM);
        // Every point is a value that is really in the frames for this horse, at or just past that distance.
        for (let k = 0; k <= ENERGY_POINTS; k++) {
          const mm = Math.floor((k * r.trackLengthMm) / ENERGY_POINTS);
          let f = 0;
          while (f < r.frames.length - 1 && distAt(r, f, h) < mm) f++;
          expect(t.mine[k]).toBe(energyAt(r, f, h));
        }
        expect(t.mine[0]).toBeGreaterThan(900);
        // The tank only drains (or holds) over the trip.
        expect(t.mine[ENERGY_POINTS]).toBeLessThanOrEqual(t.mine[0]!);
        for (const e of [...t.mine, ...t.field]) {
          expect(e).toBeGreaterThanOrEqual(0);
          expect(e).toBeLessThanOrEqual(1000);
        }
      }
    }
  });

  it("marks running low only when the frames show the tank at or under the engine's tiring line before the last metres", () => {
    let lows = 0;
    for (const r of replays) {
      for (const [h, horse] of r.horses.entries()) {
        const t = energyTrace(r, horse.horseId)!;
        const first = r.frames.findIndex((_, f) => distAt(r, f, h) < r.trackLengthMm && energyAt(r, f, h) <= ENERGY_LOW);
        if (t.lowWithM === null) {
          if (first >= 0) expect(Math.round((r.trackLengthMm - distAt(r, first, h)) / 1000)).toBeLessThan(25);
        } else {
          lows++;
          expect(first).toBeGreaterThanOrEqual(0);
          expect(t.lowWithM).toBe(Math.round((r.trackLengthMm - distAt(r, first, h)) / 1000));
          expect(t.lowWithM).toBeLessThanOrEqual(r.race.distanceM);
        }
      }
    }
    // Real races do run horses low: the line has something to show.
    expect(lows).toBeGreaterThan(0);
  });

  it("is null for a horse not in the race", () => {
    expect(energyTrace(replays[0]!, "nobody")).toBeNull();
  });

  it("says it in words: the off, the thirds, the finish and the typical rival", () => {
    const t = { mine: Array.from({ length: ENERGY_POINTS + 1 }, (_, k) => 1000 - k * 40), field: Array.from({ length: ENERGY_POINTS + 1 }, (_, k) => 1000 - k * 39), lowWithM: 300, distanceM: 1400 };
    const s = energySummary(t, "Lucky Penny");
    expect(s).toContain("100% at the off");
    expect(s).toContain("68% a third of the way");
    expect(s).toContain("4% at the finish");
    expect(s).toContain("typical rival");
    expect(energyHeadline(t, "Lucky Penny")).toBe("Lucky Penny ran low on energy with 300 m to go.");
    expect(energyHeadline({ ...t, lowWithM: null, mine: [...t.mine.slice(0, -1), 260] }, "Lucky Penny")).toContain("26% left at the line");
  });
});

describe("EnergyLine on the Why card", () => {
  it("draws the line with the finish, an accessible label and the words", () => {
    const r = replays[2]!;
    const id = r.horses[0]!.horseId;
    const t = energyTrace(r, id)!;
    const html = renderToStaticMarkup(React.createElement(EnergyLine, { trace: t, horseName: "Brave Heart" }));
    expect(html).toContain('data-testid="energy-line"');
    expect(html).toContain('role="img"');
    expect(html).toContain(`aria-label="${energySummary(t, "Brave Heart").replace(/'/g, "&#x27;")}"`);
    expect(html).toContain("Finish");
    expect(html).toContain("<polyline");
    expect(html).toContain("In words");
    if (t.lowWithM !== null) expect(html).toContain('data-testid="energy-low-mark"');
  });

  it("sits in the Why card when the trace is given, and not otherwise", () => {
    const r = replays[1]!;
    const e = r.horses[0]!;
    const entry = inputs[1]!.entries.find((x) => x.horse.id === e.horseId)!;
    const analysis = analyseRace(r, e.horseId, entry.horse, e.tactic)!;
    const withIt = renderToStaticMarkup(React.createElement(WhyCard, { analysis, horseName: e.name, isYours: true, energy: energyTrace(r, e.horseId) }));
    const without = renderToStaticMarkup(React.createElement(WhyCard, { analysis, horseName: e.name, isYours: true }));
    expect(withIt).toContain("Energy over the race");
    expect(without).not.toContain("Energy over the race");
  });
});
