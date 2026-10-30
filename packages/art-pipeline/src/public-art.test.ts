/**
 * Validates the generated art drop (apps/web/public/art/manifest.json) against
 * AssetManifestSchema and checks every src exists with the declared frame layout.
 */
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AssetManifestSchema } from "./index";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/art");
const MANIFEST = join(ART, "manifest.json");

function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe.skipIf(!existsSync(MANIFEST))("public art manifest", () => {
  const raw = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { version: 1, assets: [] };

  it("validates against AssetManifestSchema", () => {
    const parsed = AssetManifestSchema.safeParse(raw);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 5), null, 1));
    expect(parsed.data.assets.every((a) => a.origin === "pixellab" && a.status === "approved")).toBe(true);
  });

  it("every src exists and matches its frame layout", () => {
    for (const a of raw.assets as Array<{ id: string; src: string; frameCount: number; frameWidth: number; frameHeight: number }>) {
      const file = join(ART, a.src);
      expect(existsSync(file), `${a.id}: ${a.src} missing`).toBe(true);
      const { w, h } = pngSize(file);
      expect(w, `${a.id} width`).toBe(a.frameWidth * a.frameCount);
      expect(h, `${a.id} height`).toBe(a.frameHeight);
    }
  });

  it("every normal map matches its sprite's size", () => {
    for (const a of raw.assets as Array<{ id: string; src: string }>) {
      if (!a.src.endsWith("-normal.png")) continue;
      const base = join(ART, a.src.replace(/-normal\.png$/, ".png"));
      if (!existsSync(base)) continue;
      expect(pngSize(join(ART, a.src)), `${a.id}`).toEqual(pngSize(base));
    }
  });
});

/** Minimal decoder for the 8-bit RGBA/RGB, non-interlaced PNGs the art scripts write. */
function decodePng(file: string): { w: number; h: number; px: Uint8Array } {
  const b = readFileSync(file);
  let o = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat: Buffer[] = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString("ascii", o + 4, o + 8);
    const d = b.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      if (d[8] !== 8 || d[12] !== 0) throw new Error(`${file}: unsupported PNG (bit depth ${d[8]}, interlace ${d[12]})`);
      ct = d[9]!;
    } else if (type === "IDAT") idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`${file}: colour type ${ct} not supported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8Array(w * h * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const up = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let v = row[i]!;
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      out.set([cur[x * bpp]!, cur[x * bpp + 1]!, cur[x * bpp + 2]!, bpp === 4 ? cur[x * bpp + 3]! : 255], (y * w + x) * 4);
    }
    prev.set(cur);
  }
  return { w, h, px: out };
}

const hex = (px: Uint8Array, i: number) =>
  "#" + [px[i]!, px[i + 1]!, px[i + 2]!].map((v) => v.toString(16).padStart(2, "0")).join("");

const RACE_DAY = { break: [6, 8], drive: [12, 12], lunge: [4, 6], easeup: [10, 14], celebrate: [8, 12], pullup: [8, 10] } as const;

describe.skipIf(!existsSync(join(ART, "race/horse-drive.png")))("race-day animations", () => {
  const raw = JSON.parse(readFileSync(MANIFEST, "utf8")) as { assets: Array<{ id: string; src: string; frameCount: number; frameWidth: number; frameHeight: number; fps: number; palette: string[] }> };
  const byId = new Map(raw.assets.map((a) => [a.id, a]));
  const pal = JSON.parse(readFileSync(join(ART, "race/palette.json"), "utf8"));
  const keys = new Set<string>([
    ...pal.coat, ...pal.mane, ...pal.points, ...pal.silksPrimary, ...pal.silksSecondary, ...pal.cap,
    ...Object.values(pal.fixed as Record<string, string[]>).flat(),
  ]);

  for (const [name, [lo, hi]] of Object.entries(RACE_DAY)) {
    it(`horse-${name}: 256x192 frames, keyed to palette.json, binary alpha, on the ground line, with normals`, () => {
      const a = byId.get(`horse.body.${name}`);
      expect(a, `horse.body.${name} in manifest`).toBeTruthy();
      expect(byId.get(`horse.body.${name}.normal`), `horse.body.${name}.normal in manifest`).toBeTruthy();
      expect([a!.frameWidth, a!.frameHeight]).toEqual([256, 192]);
      expect(a!.frameCount).toBeGreaterThanOrEqual(lo);
      expect(a!.frameCount).toBeLessThanOrEqual(hi);
      expect(a!.fps).toBeGreaterThan(0);
      expect(a!.palette.length).toBeGreaterThan(0);
      const { w, h, px } = decodePng(join(ART, a!.src));
      const stray = new Set<string>();
      let lowest = 0;
      let partial = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const al = px[i + 3]!;
          if (al !== 0 && al !== 255) partial++;
          if (!al) continue;
          if (!keys.has(hex(px, i))) stray.add(hex(px, i));
          lowest = Math.max(lowest, y);
        }
      expect(partial, "semi-transparent pixels").toBe(0);
      expect([...stray].slice(0, 5), "colours outside palette.json").toEqual([]);
      expect(lowest, "hooves on the common ground row").toBe(191);
    }, 30_000);
  }

  it("fx strips use only their fx-palette.json keys; every surface ramp matches its key length", () => {
    const fx = JSON.parse(readFileSync(join(ART, "race/fx-palette.json"), "utf8"));
    for (const s of ["fx-mud", "fx-dust", "fx-divot"]) {
      const a = byId.get(`race.${s}`)!;
      expect(a, s).toBeTruthy();
      expect(byId.get(`race.${s}.normal`), `${s} normal`).toBeTruthy();
      const allowed = new Set(Object.values(fx.keys[s] as Record<string, string[]>).flat());
      const { w, h, px } = decodePng(join(ART, a.src));
      const bad = new Set<string>();
      for (let i = 0; i < w * h * 4; i += 4) if (px[i + 3] && !allowed.has(hex(px, i))) bad.add(hex(px, i));
      expect([...bad], `${s} colours outside its keys`).toEqual([]);
    }
    for (const [surf, strips] of Object.entries(fx.emit as Record<string, string[]>))
      for (const s of strips)
        for (const [role, src] of Object.entries(fx.keys[s] as Record<string, string[]>))
          expect(fx.surfaces[surf][s][role]?.length, `${surf} ${s} ${role}`).toBe(src.length);
  });

  it("crowd-cheer frame 0 is the static crowd strip (drop-in)", () => {
    const a = byId.get("race.crowd-cheer")!;
    const c = decodePng(join(ART, "race/crowd.png"));
    const s = decodePng(join(ART, a.src));
    expect([a.frameWidth, a.frameHeight]).toEqual([c.w, c.h]);
    let diff = 0;
    for (let y = 0; y < c.h; y++)
      for (let x = 0; x < c.w; x++) {
        const i = (y * c.w + x) * 4;
        const j = (y * s.w + x) * 4;
        if (c.px[i + 3]! < 128 && s.px[j + 3] === 0) continue;
        if (hex(s.px, j) !== hex(c.px, i) || (c.px[i + 3]! >= 128) !== (s.px[j + 3]! > 0)) diff++;
      }
    expect(diff, "pixels differing from crowd.png in frame 0").toBe(0);
  }, 30_000);
});
