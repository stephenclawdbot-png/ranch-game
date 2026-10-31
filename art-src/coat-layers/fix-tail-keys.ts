// Source fix (coat audit): some frames draw the tail in the lower-leg (points) keys, so a chestnut
// or flaxen horse's tail flipped to the leg colour in those frames. Points-keyed components that
// start high behind the rump (a tail, never a leg: legs leave the body at the belly) are re-keyed
// to the mane ramp at the nearest lightness. Writes the sheet (and its -f copy) in place.
//   node <tsx> art-src/coat-layers/fix-tail-keys.ts [--dry]
import { existsSync } from "node:fs";
import { buildCoatGeometry, rgbaRoleGrid } from "../../packages/art-pipeline/src/coatGeometry";
import { ART, readJson, readPng, writePng } from "./png";
import { BASE_SHEETS } from "./sheets";

const dry = process.argv.includes("--dry");
const pal = readJson<{ coat: string[]; mane: string[]; points: string[] }>(`${ART}/race/palette.json`);
const hex = (h: string) => Number.parseInt(h.slice(1), 16);
const lum = (n: number) => ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
const points = new Set(pal.points.map(hex));
const mane = pal.mane.map(hex);
const toMane = (n: number) => mane.reduce((b, m) => (Math.abs(lum(m) - lum(n)) < Math.abs(lum(b) - lum(n)) ? m : b), mane[0]!);

for (const [stem, frames] of Object.entries(BASE_SHEETS)) {
  for (const file of [stem, `${stem}-f`]) {
    const path = `${ART}/${file}.png`;
    if (!existsSync(path)) continue;
    const img = readPng(path);
    const fw = Math.floor(img.width / frames);
    const geo = buildCoatGeometry(rgbaRoleGrid(img.data, img.width, img.height, fw, pal));
    let changed = 0;
    for (let f = 0; f < frames; f++) {
      const { rumpX, back, belly } = geo.anchors[f]!;
      if (!belly) continue;
      const seen = new Uint8Array(fw * img.height);
      const keyAt = (x: number, y: number) => {
        const i = (y * img.width + f * fw + x) * 4;
        return img.data[i + 3]! < 128 ? -1 : (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!;
      };
      for (let y0 = 0; y0 < img.height; y0++)
        for (let x0 = 0; x0 < fw; x0++) {
          if (seen[y0 * fw + x0] || !points.has(keyAt(x0, y0))) continue;
          const comp: [number, number][] = [];
          const stack: [number, number][] = [[x0, y0]];
          seen[y0 * fw + x0] = 1;
          while (stack.length) {
            const [x, y] = stack.pop()!;
            comp.push([x, y]);
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= fw || ny >= img.height || seen[ny * fw + nx] || !points.has(keyAt(nx, ny))) continue;
                seen[ny * fw + nx] = 1;
                stack.push([nx, ny]);
              }
          }
          const top = Math.min(...comp.map((p) => p[1]));
          const left = Math.min(...comp.map((p) => p[0]));
          const right = Math.max(...comp.map((p) => p[0]));
          const H = belly - back;
          if (top < belly - 0.35 * H && left < rumpX + 0.15 * H && right < rumpX + 0.6 * H && comp.length >= 6) {
            for (const [x, y] of comp) {
              const i = (y * img.width + f * fw + x) * 4;
              const m = toMane(keyAt(x, y));
              img.data[i] = (m >> 16) & 255;
              img.data[i + 1] = (m >> 8) & 255;
              img.data[i + 2] = m & 255;
            }
            changed += comp.length;
          }
        }
    }
    console.log(file, "re-keyed", changed);
    if (changed && !dry) writePng(path, img);
  }
}
