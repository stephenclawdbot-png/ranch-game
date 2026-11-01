/**
 * Radio commentary, app side: the shipped phrase library matches the race viewer's vocabulary
 * (every phrase x caster x intensity has a clip), the casters / recipe / courses / name keys agree
 * between the viewer, the database and game-core, and every race mode's viewer has the
 * "Radio commentary" toggle.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CASTER_IDS, COURSE_NAMES, INTENSITIES, RadioToggle, VOCABULARY, nameKey, pickCaster, type CommentaryManifest } from "@thoroughbred/race-viewer";
import { COMMENTARY_CASTERS, COMMENTARY_INTENSITIES, COMMENTARY_RECIPE, commentaryNameKey } from "@thoroughbred/db";
import { COURSES } from "@thoroughbred/game-core";

const web = fileURLToPath(new URL("../../../", import.meta.url));
const repo = join(web, "../../");
const lib = join(web, "public/audio/commentary");

describe("commentary library", () => {
  const manifest = JSON.parse(readFileSync(join(lib, "manifest.json"), "utf8")) as CommentaryManifest;

  it("tools/commentary/phrases.json is the viewer's vocabulary (re-export it after editing the spoken templates)", () => {
    const spec = JSON.parse(readFileSync(join(repo, "tools/commentary/phrases.json"), "utf8")) as { casters: string[]; intensities: string[]; phrases: Record<string, string> };
    expect(spec.phrases).toEqual(Object.fromEntries(VOCABULARY));
    expect(spec.casters).toEqual([...CASTER_IDS]);
    expect(spec.intensities).toEqual([...INTENSITIES]);
  });

  it("has a clip for every phrase, caster and intensity", () => {
    expect(manifest.casters).toEqual([...CASTER_IDS]);
    expect(manifest.intensities).toEqual([...INTENSITIES]);
    const missing: string[] = [];
    for (const caster of CASTER_IDS) {
      for (const i of INTENSITIES) {
        for (const id of VOCABULARY.keys()) {
          const entry = manifest.clips[caster]?.[i]?.[id];
          const file = join(lib, caster, i, `${id}.mp3`);
          if (!entry || !(entry.d > 0.1 && entry.d < 12) || !existsSync(file) || statSync(file).size < 300) missing.push(`${caster}/${i}/${id}`);
        }
      }
    }
    expect(missing).toEqual([]);
    for (const bed of ["murmur", "building", "roar", "hush", "cheer", "static"] as const) expect(existsSync(join(lib, "beds", manifest.beds[bed].file)), bed).toBe(true);
  });

  it("stays well under 20 MB", () => {
    let bytes = 0;
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else bytes += statSync(p).size;
      }
    };
    walk(lib);
    expect(bytes).toBeLessThan(15 * 1024 * 1024);
  });

  it("agrees with the database on casters, intensities, recipe and name keys, and with game-core on courses", () => {
    expect([...COMMENTARY_CASTERS]).toEqual([...CASTER_IDS]);
    expect([...COMMENTARY_INTENSITIES]).toEqual([...INTENSITIES]);
    expect(manifest.recipe).toBe(COMMENTARY_RECIPE);
    for (const n of ["Silver Bramble", "  Quiet   Riot ", "Éclair d'Or", "ＦＵＬＬ Width"]) expect(nameKey(n)).toBe(commentaryNameKey(n));
    expect([...COURSE_NAMES].sort()).toEqual(COURSES.map((c) => c.name).sort());
  });
});

describe("the Radio commentary toggle in every race mode", () => {
  it("renders off by default and on with the caster", () => {
    const off = renderToStaticMarkup(React.createElement(RadioToggle, { on: false, narrow: false, onRadio: () => undefined }));
    expect(off).toContain('data-testid="radio-commentary"');
    expect(off).toContain('aria-pressed="false"');
    const on = renderToStaticMarkup(React.createElement(RadioToggle, { on: true, narrow: true, caster: pickCaster("race-1").name, onRadio: () => undefined }));
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain(`${pickCaster("race-1").name} calling`);
  });

  it("the viewer always shows it (no prop turns it off), and every mode mounts that viewer", () => {
    const viewer = readFileSync(join(repo, "packages/race-viewer/src/RaceViewer.tsx"), "utf8");
    expect(viewer).toMatch(/onRadio(=\{|: )setRadio/);
    expect(viewer).toMatch(/pickCaster\(stageData\.race\.id\)/);
    const hud = readFileSync(join(repo, "packages/race-viewer/src/hud/Hud.tsx"), "utf8");
    expect(hud).toMatch(/\{p\.onRadio && <RadioToggle/);
    // Live / Story / career / Cup / feature / claiming races and their replays (RaceExperience),
    // quick races: match, ghost and the daily challenge (QuickReplay), what-if re-runs, Cup runs.
    const modes = ["src/components/race/RaceExperience.tsx", "src/components/quick/QuickReplay.tsx", "src/components/whatIf/WhatIfReplay.tsx", "src/components/competition/CupRunScreen.tsx"];
    for (const m of modes) {
      const src = readFileSync(join(web, m), "utf8");
      expect(src, m).toMatch(/<RaceViewerClient\b/);
      expect(src, m).not.toMatch(/onRadio|radio=\{false\}/);
    }
    // Every mount of the viewer in the app is one of those (a new mode gets added here).
    const mounts: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(f) && /<RaceViewer(Client)?\b/.test(readFileSync(p, "utf8"))) mounts.push(p.slice(web.length));
      }
    };
    walk(join(web, "src"));
    expect(mounts.filter((m) => m !== "src/components/RaceViewerClient.tsx").sort()).toEqual([...modes].sort());
    // RaceViewerClient passes every prop through to the viewer.
    expect(readFileSync(join(web, "src/components/RaceViewerClient.tsx"), "utf8")).toMatch(/<m\.RaceViewer [^>]*\{\.\.\.props\}/);
  });
});
