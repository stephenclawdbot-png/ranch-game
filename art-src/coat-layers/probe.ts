// Print the geometry of a few texels: node <tsx> probe.ts <stem> <frames> <frame> x,y x,y ...
import { buildCoatGeometry, rgbaRoleGrid } from "../../packages/art-pipeline/src/coatGeometry";
import { ART, readJson, readPng } from "./png";

const [stem, framesArg, frameArg, ...pts] = process.argv.slice(2);
const img = readPng(`${ART}/${stem}.png`);
const frames = Number(framesArg);
const fw = Math.floor(img.width / frames);
const keys = readJson<{ coat: string[]; mane: string[]; points: string[]; cap: string[] }>(`${ART}/race/palette.json`);
const geo = buildCoatGeometry(rgbaRoleGrid(img.data, img.width, img.height, fw, keys));
const f = Number(frameArg);
console.log("H", geo.H, "anchor", geo.anchors[f]);
for (const p of pts) {
  const [x, y] = p.split(",").map(Number) as [number, number];
  const i = (f * img.height + y) * fw + x;
  console.log(p, "region", geo.region[i], "out", geo.outside[i], "u/H", (geo.u[i]! / geo.H).toFixed(2), "v/H", (geo.v[i]! / geo.H).toFixed(2), "p1", geo.p1[i]!.toFixed(2), "p2", geo.p2[i]!.toFixed(1));
}
