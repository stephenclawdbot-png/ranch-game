import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as gc from "@thoroughbred/game-core";
import { describe, expect, it } from "vitest";
import { JOCKEY_BUST, JOCKEY_FACE, KNOWN_FIRST_NAMES, MOMENT_VIGNETTE, NEWS_VIGNETTE, jockeyPortrait, presentsAs, trainerPortrait, vignetteSrc } from "./cast";

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

  it("is deterministic, stays in the jockey's stage and matches the name", () => {
    for (const stage of gc.JOCKEY_STAGES) {
      for (let i = 0; i < 300; i++) {
        const j = { id: `j-${stage}-${i}`, name: gc.jockeyName(`n-${i}`), stage };
        const a = jockeyPortrait(j);
        expect(jockeyPortrait(j)).toEqual(a);
        expect(exists(a.src), a.src).toBe(true);
        const prefix = { apprentice: "a-", prime: "j-", veteran: "v-" }[stage];
        expect(a.id.startsWith(prefix), `${stage} -> ${a.id}`).toBe(true);
        const who = presentsAs(j.name);
        if (who === "f") expect(a.id, j.name).toMatch(/woman|girl/);
        if (who === "m") expect(a.id, j.name).not.toMatch(/woman|girl/);
        expect(a.face[0]).toBeGreaterThanOrEqual(0);
        expect(a.face[1] + JOCKEY_FACE).toBeLessThanOrEqual(JOCKEY_BUST);
      }
    }
  });

  it("spreads jockeys over the whole cast (no face stands in for everyone)", () => {
    const used = new Set<string>();
    for (const stage of gc.JOCKEY_STAGES) for (let i = 0; i < 400; i++) used.add(jockeyPortrait({ id: `x-${stage}-${i}`, name: gc.jockeyName(`m-${i}`), stage }).id);
    const all = readdirSync(join(PUBLIC, "art/portraits/jockeys")).filter((f) => f.endsWith(".png"));
    expect(all.length).toBeGreaterThanOrEqual(24);
    expect(used.size).toBe(all.length);
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
