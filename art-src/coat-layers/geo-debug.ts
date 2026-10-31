// Debug view of the coat geometry: regions coloured, body-space grid lines, hair candidates.
//   node <tsx> art-src/coat-layers/geo-debug.ts <strip stem> <frames> <out.png>
import { buildCoatGeometry, rgbaRoleGrid } from "../../packages/art-pipeline/src/coatGeometry";
import { ART, blank, paste, readJson, readPng, writePng } from "./png";

const [stem, framesArg, out] = process.argv.slice(2);
const img = readPng(`${ART}/${stem}.png`);
const frames = Number(framesArg);
const fw = Math.floor(img.width / frames);
const keys = readJson<{ coat: string[]; mane: string[]; points: string[] }>(`${ART}/race/palette.json`);
const geo = buildCoatGeometry(rgbaRoleGrid(img.data, img.width, img.height, fw, keys));
console.log(stem, "H", geo.H, geo.anchors.map((a) => [Math.round(a.rumpX), Math.round(a.back), Math.round(a.belly)].join(",")).join(" "));
const COL: Record<number, [number, number, number]> = { 1: [230, 60, 60], 2: [150, 30, 30], 3: [60, 60, 230], 4: [30, 30, 150], 5: [240, 220, 40], 6: [120, 170, 120], 7: [200, 80, 200], 8: [80, 200, 220] };
const dbg = blank(img.width, img.height);
for (let f = 0; f < frames; f++)
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < fw; x++) {
      const gi = f * fw * img.height + y * fw + x;
      const di = (y * img.width + f * fw + x) * 4;
      const r = geo.region[gi]!;
      if (!r) {
        if (img.data[di + 3]! > 128) dbg.data.set([img.data[di]! * 0.4, img.data[di + 1]! * 0.4, img.data[di + 2]! * 0.4, 255], di);
        continue;
      }
      let c = COL[r]!.slice() as number[];
      if (geo.outside[gi]) c = c.map((k) => k * 0.5 + 64);
      if (r === 6) {
        const uu = geo.u[gi]! / geo.H;
        const vv = geo.v[gi]! / geo.H;
        if (Math.abs(uu * 4 - Math.round(uu * 4)) < 0.06 || Math.abs(vv * 4 - Math.round(vv * 4)) < 0.06) c = [255, 255, 255];
      }
      if (r <= 4 && !geo.outside[gi]) c = c.map((k) => k * (0.5 + geo.p1[gi]! * 0.5));
      dbg.data.set([...c, 255], di);
    }
const sheet = blank(img.width * 2, img.height * 4, [40, 60, 40, 255]);
paste(sheet, dbg, 0, 0, 2);
paste(sheet, img, 0, img.height * 2, 2);
writePng(out!, sheet);
