// Counts of long-hair texels per kind and frame of a sheet (debugging the hair generator).
import { buildCoatGeometry, drawLongHair, rgbaRoleGrid, sheetSpeed } from "../../packages/art-pipeline/src/index";
import { ART, readJson, readPng } from "./png";

const [stem, framesArg] = process.argv.slice(2);
const img = readPng(`${ART}/${stem}.png`);
const frames = Number(framesArg);
const fw = Math.floor(img.width / frames);
const keys = readJson<{ coat: string[]; mane: string[]; points: string[]; cap: string[] }>(`${ART}/race/palette.json`);
const geo = buildCoatGeometry(rgbaRoleGrid(img.data, img.width, img.height, fw, keys));
const keyed = new Uint8ClampedArray(img.data);
const kind = drawLongHair(keyed, img.width, fw, geo, keys, sheetSpeed(stem!));
let cand = 0;
for (let i = 0; i < geo.outside.length; i++) if (geo.outside[i] && geo.region[i]! <= 4) cand++;
const c = [0, 0, 0];
for (const k of kind) c[k]!++;
console.log("kinds", c, "leg candidates", cand);
