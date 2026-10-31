// Contact sheets of painted strips through the shared CPU painter (the 3D view, ranch and paddock
// sprites, gallop sprite and share cards draw exactly this; Trackside draws it on the GPU).
//   node <tsx> art-src/coat-layers/sheet.ts <out.png> <sheet stem> <frames> <frame list|all> <scale> <look,...>
// Looks are preset names (see LOOKS below).
import { atlasFromRgba, buildCoatGeometry, coatPatternOf, paintCoatStrip, rgbaRoleGrid, type CoatAtlas } from "../../packages/art-pipeline/src/index";
import { applyRecolor, buildRecolorPlan, parseKeyPalette } from "../../packages/race-viewer/src/three/recolor";
import type { HorseAppearance, HorseColour } from "../../packages/shared/src/index";
import { ART, blank, crop, paste, readJson, readPng, writePng, type Img } from "./png";

const SILKS = { primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#c0392b", pattern: "hoops" } as const;
type L = [Partial<HorseColour>, Partial<HorseAppearance>?];
const C = (c: Partial<HorseColour>, a: Partial<HorseAppearance> = {}): L => [c, a];
export const LOOKS: Record<string, L> = {
  bay: C({}),
  chestnut: C({ base: "chestnut" }),
  liver: C({ base: "liver" }),
  sealbrown: C({ base: "seal_brown" }),
  black: C({ base: "black" }),
  palomino: C({ base: "chestnut", cream: 1 }),
  buckskin: C({ cream: 1 }),
  smokyblack: C({ base: "black", cream: 1 }),
  cremello: C({ base: "chestnut", cream: 2 }),
  perlino: C({ cream: 2 }),
  smokycream: C({ base: "black", cream: 2 }),
  reddun: C({ base: "chestnut", dun: true }, { dun: true }),
  baydun: C({ dun: true }, { dun: true }),
  grullo: C({ base: "black", dun: true }, { dun: true }),
  strawberryroan: C({ base: "chestnut", roan: true }),
  bayroan: C({ roan: true }),
  blueroan: C({ base: "black", roan: true }),
  greying: C({ grey: "greying" }),
  dapplegrey: C({ grey: "dapple" }),
  grey: C({ grey: "white" }),
  champagne: C({ champagne: true }),
  goldchampagne: C({ base: "chestnut", champagne: true }),
  silver: C({ base: "black", silver: true }),
  pearl: C({ base: "chestnut", pearl: true }),
  tobiano: C({ tobiano: 1 }),
  tobiano2: C({ base: "black", tobiano: 2 }),
  leopard: C({ base: "chestnut", leopard: "leopard" }),
  fewspot: C({ base: "black", leopard: "fewspot" }),
  varnish: C({ leopard: "varnish" }),
  splash: C({ splash: 1 }),
  splash2: C({ base: "chestnut", splash: 2 }),
  sabino1: C({ sabino: 1 }, { face: "star" }),
  sabino2: C({ base: "chestnut", sabino: 2 }),
  sooty: C({ cream: 1, sooty: 2 }),
  flaxen: C({ base: "chestnut", flaxen: true }),
  pangare: C({ pangare: true }),
  mushroom: C({ base: "chestnut", mushroom: true }),
  rabicano: C({ rabicano: true }),
  brindle: C({ brindle: true }),
  dominantwhite: C({ dominantWhite: true }),
  bendor: C({ base: "chestnut", bendOr: true }),
  birdcatcher: C({ birdcatcher: true }),
  star: C({}, { face: "star", legs: ["coronet", "none", "none", "coronet"] }),
  snip: C({ base: "chestnut" }, { face: "snip", legs: ["sock", "sock", "none", "none"] }),
  stripe: C({ base: "black" }, { face: "stripe", legs: ["none", "none", "sock", "sock"] }),
  blaze: C({ base: "chestnut" }, { face: "blaze", legs: ["stocking", "stocking", "stocking", "stocking"] }),
  bald: C({}, { face: "bald", legs: ["sock", "stocking", "coronet", "sock"] }),
  feather: C({ base: "black" }, { feather: true }),
  "feather-tobiano-blaze": C({ tobiano: 1 }, { feather: true, face: "blaze", legs: ["stocking", "none", "stocking", "none"] }),
  "feather-leopard-snip": C({ base: "chestnut", leopard: "leopard" }, { feather: true, face: "snip" }),
  "feather-roan-star": C({ roan: true }, { feather: true, face: "star", legs: ["sock", "sock", "none", "none"] }),
  "feather-brindle": C({ brindle: true }, { feather: true }),
  "feather-cremello": C({ base: "chestnut", cream: 2 }, { feather: true }),
  "feather-flaxen": C({ base: "chestnut", flaxen: true }, { feather: true, face: "blaze" }),
  "feather-greying": C({ base: "black", grey: "greying" }, { feather: true }),
  "feather-dapple": C({ base: "black", grey: "dapple" }, { feather: true }),
  "feather-grey": C({ base: "black", grey: "white" }, { feather: true }),
};

export function lookOf(name: string, seed = 12345): HorseAppearance {
  const [c, a] = LOOKS[name] ?? LOOKS.bay!;
  return {
    coat: "bay",
    face: "none",
    legs: ["none", "none", "none", "none"],
    silks: SILKS,
    colour: { base: "bay", cream: 0, dun: false, roan: false, grey: "none", sabino: 0, seed, ...c },
    ...a,
  } as HorseAppearance;
}

let atlasCache: CoatAtlas | null = null;
export function loadAtlas(): CoatAtlas {
  if (atlasCache) return atlasCache;
  const img = readPng(`${ART}/race/coat-layers.png`);
  atlasCache = atlasFromRgba(img.data, img.width, img.height, 1);
  return atlasCache;
}

const geoCache = new Map<string, ReturnType<typeof buildCoatGeometry>>();
export function paintSheet(stem: string, frames: number, look: HorseAppearance): Img {
  const src = readPng(`${ART}/${stem}.png`);
  const fw = Math.floor(src.width / frames);
  const keys = parseKeyPalette(readJson(`${ART}/race/palette.json`))!;
  let geo = geoCache.get(stem);
  if (!geo) {
    geo = buildCoatGeometry(rgbaRoleGrid(src.data, src.width, src.height, fw, keys));
    geoCache.set(stem, geo);
  }
  const plan = buildRecolorPlan(keys, look);
  const data = paintCoatStrip(src.data, src.width, fw, geo, look, loadAtlas(), keys, (d) => applyRecolor(d, src.width, src.height, fw, plan));
  return { width: src.width, height: src.height, data };
}

if (process.argv[1]?.endsWith("sheet.ts")) {
  const [out, stem, framesArg, which, scaleArg, looksArg] = process.argv.slice(2);
  const frames = Number(framesArg);
  const scale = Number(scaleArg ?? 1);
  const looks = (looksArg ?? "bay").split(",");
  const pick = which === "all" ? Array.from({ length: frames }, (_, i) => i) : which!.split(",").map(Number);
  const rows: Img[] = [];
  for (const name of looks) {
    const img = paintSheet(stem!, frames, lookOf(name));
    const fw = Math.floor(img.width / frames);
    const row = blank(fw * pick.length, img.height);
    pick.forEach((f, k) => paste(row, crop(img, f * fw, 0, fw, img.height), k * fw, 0));
    rows.push(row);
    void coatPatternOf;
  }
  const W = Math.max(...rows.map((r) => r.width)) * scale;
  const sheet = blank(W, rows.reduce((s, r) => s + r.height, 0) * scale, [96, 132, 92, 255]);
  let y = 0;
  for (const r of rows) {
    paste(sheet, r, 0, y, scale);
    y += r.height * scale;
  }
  writePng(out!, sheet);
  console.log(out, sheet.width, sheet.height);
}
