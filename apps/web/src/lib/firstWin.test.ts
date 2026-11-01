/** The first-win owner's moment (V-08): once per horse, fresh results only; it renders the portrait, rosette and share action. */
import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HorseAppearance } from "@thoroughbred/shared";
import { FirstWinMoment } from "@/components/moments/FirstWinMoment";
import { claimFirstWinMoment, firstWinWords, FIRST_WIN_SEEN_KEY } from "./firstWin";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("first-win moment", () => {
  it("shows once per horse, only on a fresh first win", () => {
    const s = memory();
    expect(claimFirstWinMoment({ horseId: "a", firstWinOf: "stable", fresh: true }, s)).toBe(true);
    expect(claimFirstWinMoment({ horseId: "a", firstWinOf: "stable", fresh: true }, s)).toBe(false);
    expect(claimFirstWinMoment({ horseId: "b", firstWinOf: "horse", fresh: false }, s)).toBe(false);
    expect(claimFirstWinMoment({ horseId: "b", firstWinOf: null, fresh: true }, s)).toBe(false);
    expect(claimFirstWinMoment({ horseId: "b", firstWinOf: "horse", fresh: true }, s)).toBe(true);
    expect(JSON.parse(s.m.get(FIRST_WIN_SEEN_KEY)!)).toEqual(["a", "b"]);
    // a broken store never blocks the moment from showing, and never throws
    const broken = {
      getItem: () => "{bad",
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(claimFirstWinMoment({ horseId: "c", firstWinOf: "horse", fresh: true }, broken)).toBe(true);
  });

  it("says whose first win it is", () => {
    expect(firstWinWords("stable", "Lamplighter", "Moss Lane").eyebrow).toBe("Your stable's first winner");
    expect(firstWinWords("horse", "Lamplighter", null).line).toContain("Lamplighter's first win");
  });

  it("renders the portrait in a vignette, the rosette, the race and the share action", () => {
    const appearance = { coat: "bay", face: "star", legs: ["none", "none", "none", "none"], silks: { primary: "#1f4d8a", secondary: "#f2d64b", cap: "#f2d64b", pattern: "hoops" } } as HorseAppearance;
    const html = renderToStaticMarkup(
      React.createElement(FirstWinMoment, { of: "stable", horseId: "h1", horseName: "Lamplighter", appearance, stableName: "Moss Lane", raceName: "Ashcombe Maiden", onShare: () => undefined, onClose: () => undefined }),
    );
    expect(html).toContain('data-testid="first-win-moment"');
    expect(html).toContain("Lamplighter is led in");
    expect(html).toContain("Ashcombe Maiden");
    expect(html).toContain('data-testid="first-win-share"');
    expect(html).toContain("rosette");
  });
});
