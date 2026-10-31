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
// (the -sN copies are rebuilt from the fixed sheets by art-src/coat-layers/lods.ts)
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
    // Second pass: dark leg pixels keyed as mane (the source keying put near-black lower-leg pixels
    // on the mane ramp, so a horse with a pale mane got pale patches on its legs). Mane-keyed
    // components below the belly that sit on a leg (a leg texel within 2 px on the same row, for
    // most of the component) are re-keyed to the points ramp at the nearest lightness.
    const pointsKeys = pal.points.map(hex);
    const toPoints = (n: number) => pointsKeys.reduce((b, m) => (Math.abs(lum(m) - lum(n)) < Math.abs(lum(b) - lum(n)) ? m : b), pointsKeys[0]!);
    const maneSet = new Set(mane);
    let legFixed = 0;
    for (let f = 0; f < frames; f++) {
      const { back, belly } = geo.anchors[f]!;
      if (!belly) continue;
      const H = belly - back;
      const keyAt = (x: number, y: number) => {
        const i = (y * img.width + f * fw + x) * 4;
        return img.data[i + 3]! < 128 ? -1 : (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!;
      };
      const legNear = (x: number, y: number) => {
        for (let d = -2; d <= 2; d++) {
          const xx = x + d;
          if (xx < 0 || xx >= fw) continue;
          const r = geo.region[(f * img.height + y) * fw + xx]!;
          if (r >= 1 && r <= 4 && !geo.outside[(f * img.height + y) * fw + xx]) return true;
        }
        return false;
      };
      const seen = new Uint8Array(fw * img.height);
      for (let y0 = 0; y0 < img.height; y0++)
        for (let x0 = 0; x0 < fw; x0++) {
          if (seen[y0 * fw + x0] || !maneSet.has(keyAt(x0, y0))) continue;
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
                if (nx < 0 || ny < 0 || nx >= fw || ny >= img.height || seen[ny * fw + nx] || !maneSet.has(keyAt(nx, ny))) continue;
                seen[ny * fw + nx] = 1;
                stack.push([nx, ny]);
              }
          }
          const top = Math.min(...comp.map((p) => p[1]));
          if (top < belly - 0.1 * H) continue;
          const onLeg = comp.filter(([x, y]) => legNear(x, y)).length;
          if (onLeg < comp.length * 0.6) continue;
          for (const [x, y] of comp) {
            const i = (y * img.width + f * fw + x) * 4;
            const m = toPoints(keyAt(x, y));
            img.data[i] = (m >> 16) & 255;
            img.data[i + 1] = (m >> 8) & 255;
            img.data[i + 2] = m & 255;
          }
          legFixed += comp.length;
        }
    }
    changed += legFixed;
    // Third pass: mane-keyed texels that are neither the mane nor the tail (geometry region 0):
    // on a ridden sheet, above the belly, they are the rider's boots and the reins (re-keyed to
    // the fixed tack ramp, never recoloured); elsewhere they are deep shadows on the body and
    // between the legs (re-keyed to the darkest coat keys), so a pale mane never paints them.
    const pf = readJson<{ fixed: { tack: string[] }; cap: string[] }>(`${ART}/race/palette.json`);
    const tack = pf.fixed.tack.map(hex);
    const capSet = new Set(pf.cap.map(hex));
    const coatDark = pal.coat.slice(0, 3).map(hex);
    const nearest = (list: number[], n: number) => list.reduce((b, m) => (Math.abs(lum(m) - lum(n)) < Math.abs(lum(b) - lum(n)) ? m : b), list[0]!);
    let other = 0;
    for (let f = 0; f < frames; f++) {
      const { belly } = geo.anchors[f]!;
      if (!belly) continue;
      let ridden = false;
      for (let y = 0; y < img.height && !ridden; y++)
        for (let x = 0; x < fw; x++) {
          const i = (y * img.width + f * fw + x) * 4;
          if (img.data[i + 3]! >= 128 && capSet.has((img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!)) {
            ridden = true;
            break;
          }
        }
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < fw; x++) {
          const i = (y * img.width + f * fw + x) * 4;
          if (img.data[i + 3]! < 128) continue;
          const k = (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!;
          if (!mane.includes(k) || geo.region[(f * img.height + y) * fw + x]) continue;
          const m = ridden && y <= belly + 2 ? nearest(tack, k) : nearest(coatDark, k);
          img.data[i] = (m >> 16) & 255;
          img.data[i + 1] = (m >> 8) & 255;
          img.data[i + 2] = m & 255;
          other++;
        }
    }
    changed += other;
    console.log(file, "re-keyed", changed, "(legs", legFixed, "other", other, ")");
    if (changed && !dry) writePng(path, img);
  }
}
