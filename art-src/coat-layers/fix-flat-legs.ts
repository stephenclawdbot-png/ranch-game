// Source fix (identity review): some frames paint a whole leg, thigh and forearm included, in the
// single darkest lower-leg (points) key, with ink rings for the joints. Recoloured, that leg came
// out as one flat plate with bolt-like joints: no coat colour above the knee or hock, no shading,
// no markings. Such a leg is repainted in keys: above the knee or hock the coat ramp, below it the
// points ramp, each shaded across the leg (dark edges, a lit band), and the ink rings inside it are
// painted over. Legs drawn with their own shading are left as they are. Writes the sheet and its
// -f copy in place (the -sN copies are rebuilt by art-src/coat-layers/lods.py).
//   node <tsx> art-src/coat-layers/fix-flat-legs.ts [--dry]
import { existsSync } from "node:fs";
import { GEO_REGION, buildCoatGeometry, rgbaRoleGrid } from "../../packages/art-pipeline/src/coatGeometry";
import { KNEE, flatLegTexels } from "../../packages/art-pipeline/src/flatLegs";
import { ART, readJson, readPng, writePng } from "./png";
import { BASE_SHEETS } from "./sheets";

const dry = process.argv.includes("--dry");
const pal = readJson<{ coat: string[]; mane: string[]; points: string[]; fixed: { ink: string[] } }>(`${ART}/race/palette.json`);
const hex = (h: string) => Number.parseInt(h.slice(1), 16);
// shadow-side ramps, dark -> light (the far legs one step darker than the near ones)
const COAT = [pal.coat[0]!, pal.coat[1]!, pal.coat[2]!, pal.coat[3]!].map(hex);
const POINTS = [pal.points[0]!, pal.points[1]!, pal.points[2]!, pal.points[3]!].map(hex);

/** Repaint the flat legs of a strip in place; returns the texels changed. */
export function fixFlatLegs(data: Uint8Array | Buffer, width: number, height: number, frames: number): number {
  const fw = Math.floor(width / frames);
  const geo = buildCoatGeometry(rgbaRoleGrid(data, width, height, fw, pal));
  let changed = 0;
  for (const { frame: f, texels } of flatLegTexels(data, width, height, frames, pal)) {
    const set = new Set(texels);
    for (const p of texels) {
      const x = p % fw;
      const y = (p / fw) | 0;
      // across the leg: distance to the repainted run's edges on this row
      let l = 0;
      while (set.has(y * fw + x - l - 1)) l++;
      let r = 0;
      while (set.has(y * fw + x + r + 1)) r++;
      const u = (l + 0.5) / (l + r + 1);
      // the nearest leg texel's height and side (a ring texel carries its neighbour's)
      let i = (f * height + y) * fw + x;
      const isLeg = (j: number) => geo.region[j]! >= GEO_REGION.frontNear && geo.region[j]! <= GEO_REGION.hindFar && !geo.outside[j];
      for (let d = 1; d <= 4 && !isLeg(i); d++)
        for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]] as const) {
          const qx = x + dx;
          const qy = y + dy;
          if (qx < 0 || qy < 0 || qx >= fw || qy >= height) continue;
          const j = (f * height + qy) * fw + qx;
          if (isLeg(j)) {
            i = j;
            break;
          }
        }
      const g = geo.p1[i]!;
      const far = geo.region[i] === GEO_REGION.frontFar || geo.region[i] === GEO_REGION.hindFar;
      // dark rims, a lit band a little in front of the middle (the light comes from the front)
      const lit = Math.max(0, 1 - Math.abs(u - 0.6) / 0.32);
      let s = l === 0 || r === 0 ? 0 : lit > 0.66 ? 2 : 1;
      if (!far && s > 0) s++;
      // a two-row dithered seam where the coat meets the points
      const upper = g > KNEE + (((x + y) & 1) * 2 - 1) * 0.02;
      const k = (upper ? COAT : POINTS)[Math.min(3, s)]!;
      const o = (y * width + f * fw + x) * 4;
      data[o] = (k >> 16) & 255;
      data[o + 1] = (k >> 8) & 255;
      data[o + 2] = k & 255;
      data[o + 3] = 255;
      changed++;
    }
    // a thigh or forearm drawn as a box: its free square corners are cut back to a taper (the
    // outline follows), so the limb leaves the body like a limb
    const px = (x: number, y: number) => (y * width + f * fw + x) * 4;
    const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < fw && y < height && data[px(x, y) + 3]! >= 128;
    const upper = (x: number, y: number) => {
      const i = (f * height + y) * fw + x;
      return geo.p1[i]! > KNEE + 0.1;
    };
    const near = (x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (set.has((y + dy) * fw + x + dx)) return true;
      return false;
    };
    const cut = new Set<number>();
    for (let it = 0; it < Math.round(geo.H * 0.2); it++) {
      const drop: [number, number][] = [];
      for (const p of set) {
        const x0 = p % fw;
        const y0 = (p / fw) | 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const x = x0 + dx;
            const y = y0 + dy;
            if (!opaque(x, y) || !near(x, y) || !upper(Math.max(0, Math.min(fw - 1, x0)), y0)) continue;
            const up = !opaque(x, y - 1);
            if (up && (!opaque(x - 1, y) || !opaque(x + 1, y)) && opaque(x, y + 1)) drop.push([x, y]);
          }
      }
      if (!drop.length) break;
      for (const [x, y] of drop) {
        data[px(x, y) + 3] = 0;
        cut.add(y * fw + x);
      }
    }
    // the new edge gets the outline ink
    const ink = hex(pal.fixed.ink[0]!);
    for (const p of set) {
      const x = p % fw;
      const y = (p / fw) | 0;
      if (!opaque(x, y)) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => cut.has((y + dy!) * fw + x + dx!))) {
        const o = px(x, y);
        data[o] = (ink >> 16) & 255;
        data[o + 1] = (ink >> 8) & 255;
        data[o + 2] = ink & 255;
      }
    }
  }
  return changed;
}

if (process.argv[1]?.endsWith("fix-flat-legs.ts")) {
  for (const [stem, frames] of Object.entries(BASE_SHEETS)) {
    for (const file of [stem, `${stem}-f`]) {
      const path = `${ART}/${file}.png`;
      if (!existsSync(path)) continue;
      const img = readPng(path);
      const found = flatLegTexels(img.data, img.width, img.height, frames, pal);
      const n = found.reduce((s, f) => s + f.texels.length, 0);
      console.log(file.padEnd(32), "flat-leg texels", n, found.map((f) => `f${f.frame}:${f.texels.length}`).join(" "));
      if (dry || !n) continue;
      fixFlatLegs(img.data, img.width, img.height, frames);
      writePng(path, img);
    }
  }
}
