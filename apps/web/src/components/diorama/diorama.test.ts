import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import PALETTE from "../../../public/art/race/palette.json";
import { DIORAMA_ATLAS } from "./atlas.generated";
import { applyRecolor, hexToRgb, recolorMap } from "./recolor";
import { DIORAMA_SCENES, SCENES, paddockScene, sceneFiles, type AnimItem } from "./scenes";

const ART = join(process.cwd(), "public", "art");
const pngSize = (f: string) => {
  const b = readFileSync(f);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

describe("diorama scenes", () => {
  it("defines all six scenes with a poster", () => {
    expect([...DIORAMA_SCENES].sort()).toEqual(["barn", "grandstand", "paddock", "pasture", "track-dusk", "yard"]);
    for (const id of DIORAMA_SCENES) {
      const s = SCENES[id];
      expect(s.id).toBe(id);
      expect(existsSync(join(ART, s.poster)), s.poster).toBe(true);
      const p = pngSize(join(ART, s.poster));
      expect(p).toEqual({ w: s.width, h: s.height });
      expect(s.layers.length).toBeGreaterThanOrEqual(4);
      expect(s.layers.length).toBeLessThanOrEqual(8);
    }
  });

  it("references only art that exists, and sprite strips match their frame layout", () => {
    for (const id of DIORAMA_SCENES) {
      const s = SCENES[id];
      for (const f of sceneFiles(s)) expect(existsSync(join(ART, f)), `${id}: ${f}`).toBe(true);
      const anims: AnimItem[] = [];
      const add = (a: AnimItem) => {
        anims.push(a);
        a.with?.forEach(add);
      };
      s.layers.forEach((l) => l.anims?.forEach(add));
      for (const a of anims) {
        const { w, h } = pngSize(join(ART, a.src));
        expect(w, `${id}: ${a.src} width`).toBe(a.fw * a.frames);
        expect(h, `${id}: ${a.src} height`).toBe(a.fh);
      }
    }
  });

  it("orders layers back to front with the focal plane sharp", () => {
    for (const id of DIORAMA_SCENES) {
      const ls = SCENES[id].layers;
      for (let i = 1; i < ls.length; i++) expect(ls[i]!.depth, `${id} ${ls[i]!.id}`).toBeGreaterThanOrEqual(ls[i - 1]!.depth);
      const focal = ls.find((l) => l.depth === 1);
      expect(focal?.blur ?? 0, id).toBe(0);
    }
  });

  it("atlas matches the served files", () => {
    for (const [name, f] of Object.entries(DIORAMA_ATLAS.files)) {
      expect(pngSize(join(ART, "diorama", `${name}.png`)), name).toEqual({ w: f.w, h: f.h });
    }
  });
});

describe("diorama recolour", () => {
  it("maps every coat and silks key colour and leaves others alone", () => {
    const map = recolorMap({ coat: "grey", silks: ["#1f4e9c", "#f3e7c9", "#d9a441"] });
    const keys = [...PALETTE.coat, ...PALETTE.mane, ...PALETTE.points, ...PALETTE.silksPrimary, ...PALETTE.silksSecondary, ...PALETTE.cap];
    const data = new Uint8ClampedArray((keys.length + 1) * 4);
    keys.forEach((h, i) => data.set([...hexToRgb(h), 255], i * 4));
    data.set([1, 2, 3, 255], keys.length * 4);
    applyRecolor(data, map);
    expect([...data.slice(keys.length * 4)]).toEqual([1, 2, 3, 255]);
    // a grey coat is never the bay's warm orange
    const [r, g, b] = [...data.slice(PALETTE.coat.length * 4 - 4, PALETTE.coat.length * 4 - 1)];
    expect(Math.abs(r! - b!)).toBeLessThan(60);
    expect(g).toBeGreaterThan(80);
  });

  it("the paddock parades the race's own runners (coat looks), Club string when there are none", () => {
    expect(paddockScene([])).toBe(SCENES.paddock);
    const looks = (["grey", "black", "palomino", "roan"] as const).map((coat) => ({ coat }));
    const s = paddockScene(looks);
    const focal = s.layers.find((l) => l.id === "focal")!.anims!;
    const lawn = s.layers.find((l) => l.id === "lawn")!.anims!;
    expect(focal.map((a) => a.look?.coat)).toEqual(["grey", "black", "palomino"]);
    expect(lawn.map((a) => a.look?.coat)).toEqual(["roan"]);
  });
});
