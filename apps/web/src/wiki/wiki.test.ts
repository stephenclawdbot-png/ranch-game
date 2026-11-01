/**
 * The wiki stays whole: every registered page has a body and vice versa, every page renders
 * with real content, every in-wiki link points at a page that exists, and search finds pages.
 */
import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { CASTERS } from "@thoroughbred/race-viewer";
import { STABLE_NAME_MAX, STABLE_NAME_MIN } from "@/lib/stableName";
import { WIKI_CONTENT } from "./content";
import { WIKI_PAGES, WIKI_SECTIONS, pagesIn } from "./registry";
import { searchWiki } from "./WikiNav";

const html = new Map(WIKI_PAGES.map((p) => [p.slug, renderToStaticMarkup(React.createElement(WIKI_CONTENT[p.slug]!))]));

describe("wiki", () => {
  it("registry and bodies match; every section has pages", () => {
    expect(Object.keys(WIKI_CONTENT).sort()).toEqual(WIKI_PAGES.map((p) => p.slug).sort());
    expect(new Set(WIKI_PAGES.map((p) => p.slug)).size).toBe(WIKI_PAGES.length);
    for (const s of WIKI_SECTIONS) expect(pagesIn(s.key).length).toBeGreaterThan(0);
  });

  it("every page renders real content with sections", () => {
    for (const [slug, h] of html) {
      expect(h, slug).not.toContain("This page is being written");
      expect(h.replace(/<[^>]+>/g, "").length, slug).toBeGreaterThan(1200);
      expect((h.match(/<h2 id="/g) ?? []).length, slug).toBeGreaterThanOrEqual(2);
      expect(h, slug).not.toMatch(/NaN|undefined/);
    }
  });

  it("in-wiki links point at real pages and heading ids are unique per page", () => {
    const slugs = new Set(WIKI_PAGES.map((p) => p.slug));
    for (const [slug, h] of html) {
      for (const m of h.matchAll(/href="\/wiki\/([a-z0-9-]+)/g)) expect(slugs.has(m[1]!), `${slug} -> ${m[1]}`).toBe(true);
      const ids = [...h.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size, slug).toBe(ids.length);
    }
  });

  it("recent features are written up, in words that match the rules", () => {
    const text = (slug: string) => html.get(slug)!.replace(/<[^>]+>/g, "").replace(/&#x27;|&rsquo;|’/g, "'");
    // Radio commentary: the page says three casters, and there are three.
    expect(CASTERS.length).toBe(3);
    expect(text("how-races-are-run")).toContain("Three casters.");
    // The first-week list: every job in the game's order, and the stable name rules.
    const qs = text("quick-start");
    expect(qs).toContain("Your first week");
    expect(qs).toContain("Read a career story");
    expect(qs).toContain(`${STABLE_NAME_MIN} to ${STABLE_NAME_MAX} characters`);
    expect(qs).not.toMatch(/suggests a stable name/);
    // Jockeys start at E; career tables never run past the last start.
    expect(text("jockeys")).toContain("Every jockey starts at grade E");
    const career = html.get("racing-career")!;
    for (const m of career.matchAll(/<th scope="row">(\d+)<\/th>/g)) expect(Number(m[1])).toBeLessThanOrEqual(gc.CAREER_MAX_STARTS);
    // Prize money: the winner gets what rounding and empty places leave.
    expect(text("credits-and-entries")).toContain("How a purse is split");
  });

  it("practice mode: T-USDG needs no wallet (you trade as your stable)", () => {
    const before = process.env.USDG_MODE;
    process.env.USDG_MODE = "practice";
    try {
      const page = (slug: string) => renderToStaticMarkup(React.createElement(WIKI_CONTENT[slug]!)).replace(/<[^>]+>/g, "").replace(/&#x27;|&rsquo;|’/g, "'");
      const usdg = page("usdg-market");
      expect(usdg).toContain("No wallet? You trade as your stable.");
      expect(usdg).toContain("no wallet needed during the beta");
      expect(usdg).not.toContain("the first time its wallet signs in");
      expect(page("tote")).toContain("without one you bet as your stable");
    } finally {
      if (before === undefined) delete process.env.USDG_MODE;
      else process.env.USDG_MODE = before;
    }
    expect(html.get("usdg-market")).not.toContain("No wallet? You trade as your stable.");
  });

  it("search finds pages by title and keyword", () => {
    expect(searchWiki("radio").map((p) => p.slug)).toContain("how-races-are-run");
    expect(searchWiki("login code").map((p) => p.slug)).toContain("quick-start");
    expect(searchWiki("notifications").map((p) => p.slug)).toContain("the-estate");
    expect(searchWiki("foal").map((p) => p.slug)).toContain("breeding-basics");
    expect(searchWiki("fragile")[0]?.slug).toBe("fragile-legs");
    expect(searchWiki("lease").map((p) => p.slug)).toContain("leasing");
    expect(searchWiki("zzzz")).toEqual([]);
  });
});
