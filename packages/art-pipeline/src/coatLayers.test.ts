/**
 * Coat layers (coat audit): the atlas has every drawn variant, every coat x animation x view is
 * painted from it, patterns stay in place frame to frame, and the one pattern definition is what
 * every view (portrait included) draws.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HorseAppearance, HorseColour } from "@thoroughbred/shared";
import {
  ATLAS_CELL,
  ATLAS_COLS,
  BODY,
  CELL_COUNT,
  COAT_LAYERS,
  FACE,
  GEO_REGION,
  HORSE_SHEETS,
  LAYER_CELL,
  LEGS,
  atlasFromRgba,
  atlasSize,
  buildCoatGeometry,
  coatPatternOf,
  paintCoatStrip,
  portraitCoatGeometry,
  portraitLookOf,
  rgbaRoleGrid,
  type CoatAtlas,
} from "./index";
import { readPng } from "./testPng";
import { drawLongHair, sheetSpeed } from "./index";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/art");
const has = existsSync(join(ART, "race/coat-layers.png"));
const KEYS = has ? (JSON.parse(readFileSync(join(ART, "race/palette.json"), "utf8")) as { coat: string[]; mane: string[]; points: string[]; cap: string[] }) : null;

const SILKS = { primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#c0392b", pattern: "solid" } as const;
const look = (c: Partial<HorseColour>, a: Partial<HorseAppearance> = {}): HorseAppearance =>
  ({ coat: "bay", face: "none", legs: ["none", "none", "none", "none"], silks: SILKS, colour: { base: "bay", cream: 0, dun: false, roan: false, grey: "none", sabino: 0, seed: 77, ...c }, ...a }) as HorseAppearance;

/** Every phenotype the genetics produce, each with the layers it must draw. */
export const PHENOTYPES: [string, HorseAppearance, string[]][] = [
  ["bay", look({}), []],
  ["chestnut", look({ base: "chestnut" }), []],
  ["liver chestnut", look({ base: "liver" }), []],
  ["seal brown", look({ base: "seal_brown" }), []],
  ["black", look({ base: "black" }), []],
  ["palomino", look({ base: "chestnut", cream: 1 }), []],
  ["buckskin", look({ cream: 1 }), []],
  ["smoky black", look({ base: "black", cream: 1 }), []],
  ["cremello", look({ base: "chestnut", cream: 2 }), ["skin"]],
  ["perlino", look({ cream: 2 }), ["skin"]],
  ["smoky cream", look({ base: "black", cream: 2 }), ["skin"]],
  ["red dun", look({ base: "chestnut", dun: true }, { dun: true }), ["dun"]],
  ["bay dun", look({ dun: true }, { dun: true }), ["dun"]],
  ["grullo", look({ base: "black", dun: true }, { dun: true }), ["dun"]],
  ["dunskin", look({ cream: 1, dun: true }, { dun: true }), ["dun"]],
  ["strawberry roan", look({ base: "chestnut", roan: true }), ["roan"]],
  ["bay roan", look({ roan: true }), ["roan"]],
  ["blue roan", look({ base: "black", roan: true }), ["roan"]],
  ["grey (born coloured)", look({ grey: "greying" }), ["greying"]],
  ["dapple grey", look({ grey: "dapple" }), ["dapple"]],
  ["grey", look({ grey: "white" }), []],
  ["champagne", look({ champagne: true }), ["skin"]],
  ["silver", look({ base: "black", silver: true }), []],
  ["pearl", look({ base: "chestnut", pearl: true, cream: 1 }), ["skin"]],
  ["tobiano", look({ tobiano: 1 }), ["tobiano"]],
  ["tobiano (TO/TO)", look({ tobiano: 2 }), ["tobiano-ink"]],
  ["leopard", look({ leopard: "leopard", seed: 1 }), ["leopard|blanket"]],
  ["few-spot", look({ leopard: "fewspot" }), ["fewspot"]],
  ["varnish roan", look({ leopard: "varnish" }), ["varnish"]],
  ["splash", look({ splash: 1 }), ["splash"]],
  ["splash (SW/SW)", look({ splash: 2 }), ["splash2"]],
  ["sabino", look({ sabino: 1 }), ["sabino1"]],
  ["max sabino", look({ sabino: 2 }), ["sabino2"]],
  ["sooty", look({ sooty: 2 }), ["sooty"]],
  ["flaxen", look({ base: "chestnut", flaxen: true }), []],
  ["pangaré", look({ pangare: true }), ["pangare"]],
  ["mushroom", look({ base: "chestnut", mushroom: true }), []],
  ["rabicano", look({ rabicano: true }), ["rabicano"]],
  ["brindle", look({ brindle: true }), ["brindle"]],
  ["dominant white", look({ dominantWhite: true }), []],
  ["Bend Or spots", look({ base: "chestnut", bendOr: true }), ["bendor"]],
  ["Birdcatcher spots", look({ birdcatcher: true }), ["birdcatcher"]],
];
const MARKINGS: HorseAppearance[] = [
  look({}, { face: "star", legs: ["coronet", "none", "none", "none"] }),
  look({}, { face: "snip", legs: ["sock", "sock", "none", "none"] }),
  look({}, { face: "stripe", legs: ["none", "none", "stocking", "sock"] }),
  look({}, { face: "blaze", legs: ["stocking", "stocking", "stocking", "stocking"] }),
  look({}, { face: "bald", legs: ["sock", "coronet", "stocking", "none"] }),
];

function atlas1(): CoatAtlas {
  const p = readPng(join(ART, "race/coat-layers.png"));
  return atlasFromRgba(p.data, p.w, p.h, 1);
}

describe.skipIf(!has)("coat-layer atlas", () => {
  const atlas = has ? atlas1() : null!;
  const count = (a: CoatAtlas, cell: number, x: number, y: number, w: number, h: number) => {
    const s = a.scale;
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * s;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * s;
    let n = 0;
    for (let yy = 0; yy < h * s; yy++) for (let xx = 0; xx < w * s; xx++) if (a.data[(cy + y * s + yy) * a.width + cx + x * s + xx]! > 0) n++;
    return n;
  };

  it("has the documented size at 1x and 2x, and the manifest lists both", () => {
    expect([atlas.width, atlas.height]).toEqual([atlasSize(1).width, atlasSize(1).height]);
    const two = readPng(join(ART, "portraits/coat-layers-2x.png"));
    expect([two.w, two.h]).toEqual([atlasSize(2).width, atlasSize(2).height]);
    const manifest = JSON.parse(readFileSync(join(ART, "manifest.json"), "utf8")) as { assets: { src: string }[] };
    const srcs = new Set(manifest.assets.map((a) => a.src));
    expect(srcs.has("race/coat-layers.png") && srcs.has("portraits/coat-layers-2x.png")).toBe(true);
  });

  it("every drawn variant of every layer read back into its horse spaces", () => {
    expect(CELL_COUNT).toBe(COAT_LAYERS.reduce((s, l) => s + l[2], 0));
    for (const [id, , n] of COAT_LAYERS) {
      for (let v = 0; v < n; v++) {
        const cell = LAYER_CELL[id] + v;
        const body = count(atlas, cell, BODY.x, BODY.y, 202, 139);
        const face = count(atlas, cell, FACE.x, FACE.y, FACE.w, FACE.h);
        const legs = count(atlas, cell, LEGS.x, LEGS.y, LEGS.w * 4, LEGS.h);
        const min = id === "birdcatcher" || id === "rabicano" || id === "greying" ? 8 : 12;
        if (id.startsWith("face-")) expect(face, `${id}#${v} face`).toBeGreaterThan(min);
        else if (id.startsWith("leg-")) expect(legs, `${id}#${v} legs`).toBeGreaterThan(min);
        else expect(body + face + legs, `${id}#${v}`).toBeGreaterThan(min);
      }
    }
  });
});

describe.skipIf(!has)("every coat x animation x view is painted from the layers", () => {
  const atlas = has ? atlas1() : null!;
  const sheets = has ? HORSE_SHEETS.map((s) => ({ ...s, img: readPng(join(ART, `${s.stem}.png`)) })) : [];

  it("every sheet the game draws exists, and its geometry finds the horse in (almost) every frame", { timeout: 120_000 }, () => {
    for (const s of sheets) {
      const fw = Math.floor(s.img.w / s.frames);
      const geo = buildCoatGeometry(rgbaRoleGrid(s.img.data, s.img.w, s.img.h, fw, KEYS!));
      let ok = 0;
      for (let f = 0; f < s.frames; f++) {
        const seen = new Set<number>();
        for (let i = f * fw * s.img.h; i < (f + 1) * fw * s.img.h; i++) if (geo.region[i]) seen.add(geo.region[i]!);
        if (seen.has(GEO_REGION.body) && seen.has(GEO_REGION.face) && [1, 2, 3, 4].some((r) => seen.has(r)) && seen.has(GEO_REGION.tail)) ok++;
      }
      expect(ok / s.frames, s.stem).toBeGreaterThanOrEqual(0.75);
    }
  });

  it("every phenotype's pattern definition names art that exists; its layers change the sprite", { timeout: 120_000 }, () => {
    const gallop = sheets[0]!;
    const fw = Math.floor(gallop.img.w / gallop.frames);
    const geo = buildCoatGeometry(rgbaRoleGrid(gallop.img.data, gallop.img.w, gallop.img.h, fw, KEYS!));
    const plain = (d: Uint8ClampedArray) => void d; // keyed colours stay: only the layers change
    for (const [name, a, want] of PHENOTYPES) {
      const p = coatPatternOf(a);
      for (const w of want) expect(p.layers.some((l) => w.split("|").includes(l.id)), `${name}: ${w}`).toBe(true);
      for (const l of p.layers) expect(l.cell).toBeLessThan(CELL_COUNT);
      if (!p.layers.some((l) => l.id !== "skin")) continue;
      const out = paintCoatStrip(gallop.img.data, gallop.img.w, fw, geo, a, atlas, KEYS!, plain);
      let changed = 0;
      for (let i = 0; i < out.length; i += 4) if (out[i] !== gallop.img.data[i] || out[i + 1] !== gallop.img.data[i + 1]) changed++;
      expect(changed, `${name} changes the gallop strip`).toBeGreaterThan(20);
    }
    for (const m of MARKINGS) {
      const p = coatPatternOf(m);
      expect(p.faceCell).toBeGreaterThanOrEqual(0);
      expect(p.legs.filter((c) => c >= 0).length).toBe(m.legs.filter((l) => l !== "none").length);
    }
  });

  it("the feathered long hair grows on every sheet, every frame, and stays above the ground line", { timeout: 120_000 }, () => {
    const fe = look({ base: "black" }, { feather: true });
    for (const s of sheets) {
      const fw = Math.floor(s.img.w / s.frames);
      const geo = buildCoatGeometry(rgbaRoleGrid(s.img.data, s.img.w, s.img.h, fw, KEYS!));
      const out = paintCoatStrip(s.img.data, s.img.w, fw, geo, fe, atlas, KEYS!, () => undefined, sheetSpeed(s.stem));
      let framesWithHair = 0;
      for (let f = 0; f < s.frames; f++) {
        let grown = 0;
        let lowestSrc = 0;
        let lowestOut = 0;
        for (let y = 0; y < s.img.h; y++)
          for (let x = 0; x < fw; x++) {
            const i = (y * s.img.w + f * fw + x) * 4;
            if (s.img.data[i + 3]! >= 128) lowestSrc = Math.max(lowestSrc, y);
            if (out[i + 3]! >= 128) lowestOut = Math.max(lowestOut, y);
            if (s.img.data[i + 3]! < 128 && out[i + 3]! >= 128) grown++;
          }
        if (grown > 4) framesWithHair++;
        expect(lowestOut, `${s.stem} frame ${f}: hair below the hooves`).toBeLessThanOrEqual(lowestSrc);
      }
      expect(framesWithHair / s.frames, s.stem).toBeGreaterThanOrEqual(0.75);
    }
  });

  it("white patterns stay in place frame to frame (no swimming)", { timeout: 120_000 }, () => {
    for (const s of sheets.filter((q) => q.stem.includes("gallop") || q.stem.includes("loose-walk") || q.stem.includes("celebrate"))) {
      const fw = Math.floor(s.img.w / s.frames);
      const geo = buildCoatGeometry(rgbaRoleGrid(s.img.data, s.img.w, s.img.h, fw, KEYS!));
      const a = look({ tobiano: 1 });
      const out = paintCoatStrip(s.img.data, s.img.w, fw, geo, a, atlas, KEYS!, () => undefined);
      const cent: number[] = [];
      for (let f = 0; f < s.frames; f++) {
        let su = 0;
        let n = 0;
        for (let y = 0; y < s.img.h; y++)
          for (let x = 0; x < fw; x++) {
            const gi = (f * s.img.h + y) * fw + x;
            if (geo.region[gi] !== GEO_REGION.body) continue;
            const i = (y * s.img.w + f * fw + x) * 4;
            if (out[i]! > 200 && out[i + 1]! > 200 && out[i + 2]! > 190 && !(s.img.data[i]! > 200 && s.img.data[i + 1]! > 200)) {
              su += geo.u[gi]! / geo.H;
              n++;
            }
          }
        if (n > 20) cent.push(su / n);
      }
      expect(cent.length).toBeGreaterThan(s.frames / 2);
      const mean = cent.reduce((p, q) => p + q, 0) / cent.length;
      const sd = Math.sqrt(cent.reduce((p, q) => p + (q - mean) ** 2, 0) / cent.length);
      expect(sd, `${s.stem}: white patches drift along the body`).toBeLessThan(0.2);
    }
  });
});

describe("one pattern definition for every view", () => {
  it("the portrait draws exactly the pattern definition the sprites draw", () => {
    for (const [, a] of PHENOTYPES) for (const ap of [a, ...MARKINGS, { ...a, feather: true as const }]) expect(portraitLookOf(ap).pattern).toEqual(coatPatternOf(ap));
  });

  it("is deterministic from the appearance, and different horses get their own drawn variants", () => {
    const a = look({ tobiano: 1, seed: 1 });
    expect(coatPatternOf(a)).toEqual(coatPatternOf(structuredClone(a)));
    const cells = new Set<number>();
    for (let s = 0; s < 40; s++) cells.add(coatPatternOf(look({ tobiano: 1, seed: s })).layers[0]!.cell);
    expect(cells.size).toBe(3);
  });

  it.skipIf(!existsSync(join(ART, "portraits/roles.png")))("the portrait still maps its head to face space and its neck and mane to body space", () => {
    const roles = readPng(join(ART, "portraits/roles.png")).data;
    const geo = portraitCoatGeometry(roles);
    const n = (r: number) => geo.region.reduce((s, x) => s + (x === r ? 1 : 0), 0);
    expect(n(GEO_REGION.face)).toBeGreaterThan(1500);
    expect(n(GEO_REGION.body)).toBeGreaterThan(1500);
    expect(n(GEO_REGION.mane)).toBeGreaterThan(500);
  });
});

describe.skipIf(!has)("patterns and markings move with the horse in every frame", () => {
  const atlas = has ? atlas1() : null!;
  const sheets = has ? HORSE_SHEETS.map((s) => ({ ...s, img: readPng(join(ART, `${s.stem}.png`)) })) : [];
  const LOOKS: [string, HorseAppearance][] = [
    ["tobiano", look({ tobiano: 1 })],
    ["leopard", look({ base: "chestnut", leopard: "leopard" })],
    ["roan", look({ roan: true })],
    ["blaze + stockings", look({ base: "chestnut" }, { face: "blaze", legs: ["stocking", "stocking", "stocking", "stocking"] })],
    ["star + socks", look({}, { face: "star", legs: ["sock", "sock", "sock", "sock"] })],
    ["sabino", look({ sabino: 2 })],
  ];

  it("every painted pixel is inside that frame's horse (nothing below the hooves, between the legs or on the rider)", { timeout: 180_000 }, () => {
    for (const s of sheets) {
      const fw = Math.floor(s.img.w / s.frames);
      const geo = buildCoatGeometry(rgbaRoleGrid(s.img.data, s.img.w, s.img.h, fw, KEYS!));
      for (const [name, a] of LOOKS) {
        const out = paintCoatStrip(s.img.data, s.img.w, fw, geo, a, atlas, KEYS!, () => undefined, sheetSpeed(s.stem));
        for (let f = 0; f < s.frames; f++)
          for (let y = 0; y < s.img.h; y++)
            for (let x = 0; x < fw; x++) {
              const i = (y * s.img.w + f * fw + x) * 4;
              if (out[i] === s.img.data[i] && out[i + 1] === s.img.data[i + 1] && out[i + 2] === s.img.data[i + 2] && out[i + 3] === s.img.data[i + 3]) continue;
              const gi = (f * s.img.h + y) * fw + x;
              const inside = s.img.data[i + 3]! >= 128 && geo.region[gi]! > 0 && !geo.outside[gi];
              if (!inside) expect(inside, `${s.stem} ${name} frame ${f} (${x},${y}) painted outside the horse`).toBe(true);
            }
      }
    }
  });

  it("face and leg markings sit at the same place on their body part in every frame", { timeout: 120_000 }, () => {
    const blaze = LOOKS[3]![1];
    for (const s of sheets) {
      const fw = Math.floor(s.img.w / s.frames);
      const geo = buildCoatGeometry(rgbaRoleGrid(s.img.data, s.img.w, s.img.h, fw, KEYS!));
      const out = paintCoatStrip(s.img.data, s.img.w, fw, geo, blaze, atlas, KEYS!, () => undefined);
      const faceT: number[] = [];
      const legG: number[] = [];
      for (let f = 0; f < s.frames; f++) {
        let ft = 0, fn = 0, lg = 0, ln = 0;
        for (let y = 0; y < s.img.h; y++)
          for (let x = 0; x < fw; x++) {
            const gi = (f * s.img.h + y) * fw + x;
            const i = (y * s.img.w + f * fw + x) * 4;
            const white = out[i]! > 200 && out[i + 1]! > 200 && out[i + 2]! > 190 && !(s.img.data[i]! > 200 && s.img.data[i + 1]! > 200);
            if (!white) continue;
            const r = geo.region[gi]!;
            if (r === GEO_REGION.face) {
              ft += geo.p1[gi]!;
              fn++;
            } else if (r >= 1 && r <= 4 && !geo.outside[gi]) {
              lg = Math.max(lg, geo.p1[gi]!);
              ln++;
            }
          }
        if (fn > 3) faceT.push(ft / fn);
        if (ln > 3) legG.push(lg);
      }
      const sd = (a: number[]) => {
        const m = a.reduce((p, q) => p + q, 0) / Math.max(1, a.length);
        return Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, a.length));
      };
      expect(faceT.length, `${s.stem}: blaze drawn`).toBeGreaterThan(s.frames / 2);
      expect(sd(faceT), `${s.stem}: the blaze slides along the face`).toBeLessThan(0.12);
      expect(sd(legG), `${s.stem}: the stocking tops jump`).toBeLessThan(0.12);
    }
  });
});

describe.skipIf(!has)("the feathered horse's long hair (drawn in code)", () => {
  const sheets = has ? HORSE_SHEETS.map((s) => ({ ...s, img: readPng(join(ART, `${s.stem}.png`)) })) : [];
  it("is deterministic per sheet and frame, never below the ground line and never on the rider", { timeout: 120_000 }, () => {
    for (const s of sheets) {
      const fw = Math.floor(s.img.w / s.frames);
      const geo = buildCoatGeometry(rgbaRoleGrid(s.img.data, s.img.w, s.img.h, fw, KEYS!));
      const a = new Uint8ClampedArray(s.img.data);
      const b = new Uint8ClampedArray(s.img.data);
      const ka = drawLongHair(a, s.img.w, fw, geo, KEYS!, sheetSpeed(s.stem));
      const kb = drawLongHair(b, s.img.w, fw, buildCoatGeometry(rgbaRoleGrid(s.img.data, s.img.w, s.img.h, fw, KEYS!)), KEYS!, sheetSpeed(s.stem));
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
      expect(Buffer.from(ka).equals(Buffer.from(kb))).toBe(true);
      const cap = new Set(KEYS!.cap.map((h) => Number.parseInt(h.slice(1), 16)));
      for (let f = 0; f < s.frames; f++) {
        let ground = 0;
        for (let y = 0; y < s.img.h; y++) for (let x = 0; x < fw; x++) if (s.img.data[(y * s.img.w + f * fw + x) * 4 + 3]! >= 128) ground = Math.max(ground, y);
        for (let y = 0; y < s.img.h; y++)
          for (let x = 0; x < fw; x++) {
            const gi = (f * s.img.h + y) * fw + x;
            if (!ka[gi]) continue;
            if (y > ground) expect(y, `${s.stem} frame ${f}: hair below the ground`).toBeLessThanOrEqual(ground);
            const i = (y * s.img.w + f * fw + x) * 4;
            const k = (s.img.data[i]! << 16) | (s.img.data[i + 1]! << 8) | s.img.data[i + 2]!;
            if (s.img.data[i + 3]! >= 128 && cap.has(k)) expect.fail(`${s.stem} frame ${f}: hair over the cap`);
          }
      }
    }
  });

  it("the feathering takes the leg's colour and its marking: white over a stocking", () => {
    const atlas = atlas1();
    const s = sheets.find((q) => q.stem === "diorama/horse-loose-walk")!;
    const fw = Math.floor(s.img.w / s.frames);
    const geo = buildCoatGeometry(rgbaRoleGrid(s.img.data, s.img.w, s.img.h, fw, KEYS!));
    const white = look({ base: "black" }, { feather: true, legs: ["stocking", "stocking", "stocking", "stocking"] });
    const dark = look({ base: "black" }, { feather: true });
    const count = (a: HorseAppearance) => {
      const out = paintCoatStrip(s.img.data, s.img.w, fw, geo, a, atlas, KEYS!, () => undefined, 0.12);
      let w = 0;
      for (let i = 0; i < out.length; i += 4) if (s.img.data[i + 3]! < 128 && out[i + 3]! >= 128 && out[i]! > 200 && out[i + 1]! > 200) w++;
      return w;
    };
    expect(count(white)).toBeGreaterThan(40);
    expect(count(dark)).toBe(0);
  });
});
