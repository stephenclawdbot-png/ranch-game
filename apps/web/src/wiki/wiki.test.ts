/**
 * The wiki stays whole: every registered page has a body and vice versa, every page renders
 * with real content, every in-wiki link points at a page that exists, and search finds pages.
 */
import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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

  it("search finds pages by title and keyword", () => {
    expect(searchWiki("foal").map((p) => p.slug)).toContain("breeding-basics");
    expect(searchWiki("fragile")[0]?.slug).toBe("fragile-legs");
    expect(searchWiki("lease").map((p) => p.slug)).toContain("leasing");
    expect(searchWiki("zzzz")).toEqual([]);
  });
});
