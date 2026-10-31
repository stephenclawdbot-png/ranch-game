import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as gc from "@thoroughbred/game-core";
import { describe, expect, it } from "vitest";
import { JOCKEY_BUST, JOCKEY_FACE, KNOWN_FIRST_NAMES, MOMENT_VIGNETTE, NEWS_VIGNETTE, jockeyPortrait, presentsAs, trainerPortrait, vignetteSrc } from "./cast";
import { BUST_INDEX } from "./jockeyBust";

const PUBLIC = join(__dirname, "../../public");
const exists = (url: string) => existsSync(join(PUBLIC, url));

describe("jockey cast", () => {
  it("knows every first name the jockey generator can draw", () => {
    const unknown = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const first = gc.jockeyName(`seed-${i}`).split(" ")[0]!;
      if (!KNOWN_FIRST_NAMES.has(first)) unknown.add(first);
    }
    expect([...unknown]).toEqual([]);
  });

  it("has a keyed bust and anchors for every face the game assigns, and nothing else", () => {
    const files = readdirSync(join(PUBLIC, "art/portraits/jockeys")).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4));
    const ids = gc.JOCKEY_FACES.map((f) => f.id);
    expect(new Set(files)).toEqual(new Set(ids));
    expect(new Set(Object.keys(BUST_INDEX.faces))).toEqual(new Set(ids));
    expect(ids.length).toBeGreaterThanOrEqual(100);
    for (const stage of gc.JOCKEY_STAGES) for (const who of ["f", "m"] as const) expect(gc.JOCKEY_FACES.filter((f) => f.stage === stage && f.presents === who).length).toBeGreaterThanOrEqual(20);
    for (const f of gc.JOCKEY_FACES) {
      const a = BUST_INDEX.faces[f.id]!;
      expect(a.face[0]).toBeGreaterThanOrEqual(0);
      expect(a.face[1] + JOCKEY_FACE).toBeLessThanOrEqual(JOCKEY_BUST);
      expect(!!a.eyes, f.id).toBe(f.eyes);
      expect(!!a.mouth, f.id).toBe(f.mouth);
    }
  });

  it("draws the stored look; jockeys from before looks get a deterministic face of their stage", () => {
    const look = gc.pickJockeyLook({ seed: "x", stage: "veteran", gender: "f" }, []);
    const p = jockeyPortrait({ id: "j1", name: "Amy Ashby", stage: "apprentice", look });
    expect(p.look).toEqual(look);
    expect(p.id).toBe(look.face);
    expect(exists(p.src)).toBe(true);
    for (const stage of gc.JOCKEY_STAGES) {
      for (let i = 0; i < 100; i++) {
        const j = { id: `j-${stage}-${i}`, name: gc.jockeyName(`n-${i}`), stage };
        const a = jockeyPortrait(j);
        expect(jockeyPortrait(j)).toEqual(a);
        expect(gc.jockeyFace(a.id)!.stage).toBe(stage);
        expect(gc.jockeyFace(a.id)!.presents).toBe(gc.jockeyGender(j.name));
        const who = presentsAs(j.name);
        if (who) expect(who).toBe(gc.jockeyGender(j.name));
      }
    }
  });
});

describe("cast art files", () => {
  it("every rival trainer has a portrait", () => {
    for (const r of gc.RIVAL_STABLES) {
      const src = trainerPortrait(r.id);
      expect(src, r.id).not.toBeNull();
      expect(exists(src!), src!).toBe(true);
    }
  });

  it("every vignette a news or moment kind uses exists, all at 64x64", () => {
    for (const v of [...Object.values(NEWS_VIGNETTE), ...Object.values(MOMENT_VIGNETTE)]) expect(exists(vignetteSrc(v)), v).toBe(true);
    const files = readdirSync(join(PUBLIC, "art/vignettes"));
    const sizes = files.map((f) => {
      const b = readFileSync(join(PUBLIC, "art/vignettes", f));
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    });
    expect(new Set(sizes.map((s) => s.join("x")))).toEqual(new Set(["64x64"]));
  });
});
