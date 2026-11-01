/**
 * Flat legs (identity review): a leg painted in one flat key from the hoof up the thigh.
 */
import { GEO_REGION, buildCoatGeometry, rgbaRoleGrid } from "./coatGeometry";

export interface FlatLegKeys {
  coat: readonly string[];
  points: readonly string[];
  mane?: readonly string[];
  cap?: readonly string[];
  fixed?: { ink?: readonly string[] };
}

/** Where a leg's coat gives way to its points, as a share of the leg's height (the knee / hock). */
export const KNEE = 0.5;
const hex = (h: string) => Number.parseInt(h.slice(1), 16);

/**
 * The texels of every leg painted as one flat plate (a check, and what art-src's fix-flat-legs
 * repaints): per frame, a leg drawn from the lower leg well up the thigh or forearm in the single
 * darkest points key, plus the marks drawn inside it (a joint as an ink ring round a dot).
 * Recoloured, such a leg is one flat plate: no coat colour above the knee or hock, no shading, no
 * markings. `keys` is the sheet's key palette (points dark -> light, fixed ink).
 */
export function flatLegTexels(data: ArrayLike<number>, width: number, height: number, frames: number, keys: FlatLegKeys): { frame: number; texels: number[] }[] {
  const fw = Math.floor(width / frames);
  const geo = buildCoatGeometry(rgbaRoleGrid(data, width, height, fw, keys));
  const FLAT = hex(keys.points[0]!);
  const INK = new Set((keys.fixed?.ink ?? []).map(hex));
  const out: { frame: number; texels: number[] }[] = [];
  for (let f = 0; f < frames; f++) {
    const at = (x: number, y: number) => (f * height + y) * fw + x;
    const key = (x: number, y: number) => {
      const o = (y * width + f * fw + x) * 4;
      return data[o + 3]! < 128 ? -1 : (data[o]! << 16) | (data[o + 1]! << 8) | data[o + 2]!;
    };
    const legOf = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= fw || y >= height) return 0;
      const r = geo.region[at(x, y)]!;
      return r >= GEO_REGION.frontNear && r <= GEO_REGION.hindFar && !geo.outside[at(x, y)] ? r : 0;
    };
    const seen = new Uint8Array(fw * height);
    const texels: number[] = [];
    for (let y0 = 0; y0 < height; y0++)
      for (let x0 = 0; x0 < fw; x0++) {
        if (seen[y0 * fw + x0] || !legOf(x0, y0) || key(x0, y0) !== FLAT) continue;
        const reg = legOf(x0, y0);
        const comp: number[] = [];
        const stack = [y0 * fw + x0];
        seen[y0 * fw + x0] = 1;
        while (stack.length) {
          const p = stack.pop()!;
          comp.push(p);
          const x = p % fw;
          const y = (p / fw) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const qx = x + dx;
            const qy = y + dy;
            if (legOf(qx, qy) !== reg || seen[qy * fw + qx] || key(qx, qy) !== FLAT) continue;
            seen[qy * fw + qx] = 1;
            stack.push(qy * fw + qx);
          }
        }
        // a flat leg: one key running from the lower leg well up the thigh or forearm
        const high = comp.filter((p) => geo.p1[at(p % fw, (p / fw) | 0)]! > KNEE + 0.08).length;
        if (comp.length < geo.H * geo.H * 0.04 || high < geo.H * 0.5) continue;
        texels.push(...comp);
        // and the marks drawn inside it (a joint as an ink ring round a lighter dot): texels with
        // the flat leg on three sides within a few texels
        const inComp = new Set(comp);
        let x0b = fw;
        let x1b = 0;
        let y0b = height;
        let y1b = 0;
        for (const p of comp) {
          x0b = Math.min(x0b, p % fw);
          x1b = Math.max(x1b, p % fw);
          y0b = Math.min(y0b, (p / fw) | 0);
          y1b = Math.max(y1b, (p / fw) | 0);
        }
        const reach = (x: number, y: number, dx: number, dy: number) => {
          for (let d = 1; d <= 4; d++) if (inComp.has((y + dy * d) * fw + x + dx * d)) return 1;
          return 0;
        };
        for (let y = y0b; y <= y1b; y++)
          for (let x = x0b; x <= x1b; x++) {
            if (inComp.has(y * fw + x) || key(x, y) < 0) continue;
            if (legOf(x, y) && legOf(x, y) !== reg) continue;
            if (reach(x, y, 1, 0) + reach(x, y, -1, 0) + reach(x, y, 0, 1) + reach(x, y, 0, -1) >= 3) texels.push(y * fw + x);
          }
      }
    // the ink rings drawn inside such a leg (both sides of the ring are that leg)
    const mark = new Set(texels);
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < fw - 1; x++) {
        if (!INK.has(key(x, y))) continue;
        const h = mark.has(y * fw + x - 1) && mark.has(y * fw + x + 1);
        const v = mark.has((y - 1) * fw + x) && mark.has((y + 1) * fw + x);
        if (h || v) texels.push(y * fw + x);
      }
    if (texels.length) out.push({ frame: f, texels });
  }
  return out;
}

