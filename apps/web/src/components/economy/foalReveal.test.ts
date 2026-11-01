/**
 * The foal reveal (V-06, V-21): a bred foal's dam and sire beside the stall, family-likeness
 * lines from the three looks (no genes or odds), the end state without the light stripes.
 */
import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HorseAppearance, HorseColour } from "@thoroughbred/shared";
import type { EcoHorse } from "@/lib/economyTypes";
import { FoalReveal } from "./FoalReveal";

const SILKS = { primary: "#111111", secondary: "#ffffff", pattern: "solid", cap: "#111111" } as const;
const look = (c: Partial<HorseColour> = {}, a: Partial<HorseAppearance> = {}): HorseAppearance =>
  ({ coat: "bay", face: "none", legs: ["none", "none", "none", "none"], silks: SILKS, colour: { base: "bay", cream: 0, dun: false, roan: false, grey: "none", sabino: 0, ...c }, ...a }) as HorseAppearance;
const foal = (a: HorseAppearance): EcoHorse =>
  ({ id: "f1", horse: { id: "f1", name: "Little Ember", sex: "filly", appearance: a }, geneticsLine: "chestnut · 100% TB", stage: "foal", careerStatus: "racing", starts: 0, rating: 0 }) as unknown as EcoHorse;

describe("foal reveal", () => {
  it("shows the dam and sire and which looks came from whom (in words, no genes or odds)", () => {
    const html = renderToStaticMarkup(
      React.createElement(FoalReveal, {
        foal: foal(look({ base: "chestnut" }, { face: "blaze" })),
        eyebrow: "Fair Wind has foaled",
        parents: { dam: { name: "Fair Wind", appearance: look({ base: "chestnut" }) }, sire: { name: "Copper Arrow", appearance: look({}, { face: "blaze" }) } },
        startDone: true,
        onClose: () => undefined,
      }),
    );
    expect(html).toContain('data-testid="reveal-dam"');
    expect(html).toContain('data-testid="reveal-sire"');
    expect(html).toContain("Fair Wind");
    expect(html).toContain("Copper Arrow");
    expect(html).toContain("Chestnut coat from her dam, Fair Wind");
    expect(html).toContain("Blaze from her sire, Copper Arrow");
    expect(html).not.toMatch(/\b(odds|%|allele|carrier|E\/e)\b/i);
  });

  it("a pack foal (no parents) has no parent portraits and no likeness lines; before the doors open there are no lines either", () => {
    const pack = renderToStaticMarkup(React.createElement(FoalReveal, { foal: foal(look()), eyebrow: "Paddock pack", startDone: true, onClose: () => undefined }));
    expect(pack).not.toContain("reveal-dam");
    expect(pack).not.toContain("family-likeness");
    const opening = renderToStaticMarkup(
      React.createElement(FoalReveal, { foal: foal(look()), eyebrow: "x", parents: { dam: { name: "A", appearance: look() }, sire: null }, onClose: () => undefined }),
    );
    expect(opening).not.toContain("family-likeness");
    expect(opening).toContain("Skip");
  });

  it("the end state reads clean: the light stripes fade out and sit behind the foal (V-21)", () => {
    const css = readFileSync(new URL("./reveal.module.css", import.meta.url), "utf8");
    const doneBeam = /\.done \.beam \{[^}]*\}/.exec(css)![0];
    expect(doneBeam).toMatch(/opacity: 0;/);
    const keyframes = /@keyframes beam \{[\s\S]*?\n\}/.exec(css)![0];
    expect(keyframes).toMatch(/to \{\s*opacity: 0;/);
    expect(/\.beam \{[^}]*z-index: 0/.test(css) && /\.foal \{[^}]*z-index: 1/.test(css)).toBe(true);
  });
});
