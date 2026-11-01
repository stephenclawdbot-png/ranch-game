/**
 * The precomputed horse sheets (apps/web/public/art/race/sheets): the browser decodes them
 * instead of building the derived data on every page load. This test keeps them honest: the
 * files must hold exactly what a fresh build from the sheet files gives today, byte for byte.
 *
 * Rebuild them after changing a sheet, the palette keys or the strip code:
 *
 *   cd packages/race-viewer && BAKE_SHEETS=1 npx vitest run src/trackside/sheets.bake.test.ts
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readPng } from "../../../art-pipeline/src/testPng";
import { parseKeyPalette } from "../three/recolor";
import { downsampleFrames } from "./strips";
import { buildAllSheets, decodeSheet, paletteFrom, encodeSheet, sheetFrame, SHEET_FORMAT, SHEET_ORDER, type SheetEntry, type SheetId, type SheetIndex, type SheetSource, type StripSet } from "./sheets";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../../apps/web/public/art");
const DIR = join(ART, "race/sheets");
const has = existsSync(join(ART, "race/horse-gallop.png")) && existsSync(join(ART, "manifest.json"));
const BAKE = process.env.BAKE_SHEETS === "1";

interface Asset {
  status: string;
  src?: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  anchor: { x: number; y: number };
}

/** The sources the browser would load (approved manifest entries only), and the hash of every input. */
function sources(): { srcs: Partial<Record<SheetId, SheetSource>>; entries: Partial<Record<SheetId, SheetEntry>>; key: string; paletteJson: string } {
  const manifest = JSON.parse(readFileSync(join(ART, "manifest.json"), "utf8")) as { assets: Asset[] };
  const approved = (file: string) => manifest.assets.find((a) => a.status === "approved" && a.src && (a.src === file || a.src.endsWith(`/${file}`)));
  const paletteJson = readFileSync(join(ART, "race/palette.json"), "utf8");
  const hash = createHash("sha256");
  hash.update(`format ${SHEET_FORMAT}\n`);
  hash.update(paletteJson);
  const srcs: Partial<Record<SheetId, SheetSource>> = {};
  const entries: Partial<Record<SheetId, SheetEntry>> = {};
  for (const s of SHEET_ORDER) {
    const e = approved(`${s.stem}.png`);
    if (!e?.src) continue;
    const file = (src: string) => join(ART, src);
    const img = readPng(file(e.src));
    const n = approved(`${s.stem}-normal.png`);
    const nImg = n?.src && n.frameWidth === e.frameWidth ? readPng(file(n.src)) : null;
    const f = approved(`${s.stem}-f.png`);
    const fImg = f?.src ? readPng(file(f.src)) : null;
    const entry: SheetEntry = { frameWidth: e.frameWidth, frameHeight: e.frameHeight, frameCount: e.frameCount, anchor: { x: e.anchor.x, y: e.anchor.y } };
    entries[s.id] = entry;
    srcs[s.id] = {
      entry,
      rgba: img.data,
      width: img.w,
      height: img.h,
      normal: nImg && nImg.w === img.w && nImg.h === img.h ? nImg.data : null,
      woman: fImg && fImg.w === img.w && fImg.h === img.h ? fImg.data : null,
    };
    hash.update(`${s.id} ${JSON.stringify(entry)}\n`);
    for (const src of [e.src, nImg ? n!.src! : "", fImg ? f!.src! : ""]) hash.update(src ? readFileSync(file(src)) : "-");
  }
  return { srcs, entries, key: hash.digest("hex"), paletteJson };
}

function sameSheet(a: StripSet, b: StripSet) {
  expect(b.pxPerM).toBe(a.pxPerM);
  expect(b.geoH).toBe(a.geoH);
  expect(b.warp).toEqual(a.warp);
  expect(Array.from(b.silk)).toEqual(Array.from(a.silk));
  expect(b.lods.length).toBe(a.lods.length);
  a.lods.forEach((l, i) => {
    const m = b.lods[i]!;
    expect({ ...m, index: null, normal: null }).toEqual({ ...l, index: null, normal: null });
    expect(Buffer.compare(Buffer.from(m.index), Buffer.from(l.index))).toBe(0);
    expect(!!m.normal).toBe(!!l.normal);
    if (l.normal) expect(Buffer.compare(Buffer.from(m.normal!), Buffer.from(l.normal))).toBe(0);
  });
  for (const k of ["mask", "maskUv", "maskPq"] as const) expect(Buffer.compare(Buffer.from(b[k]), Buffer.from(a[k]))).toBe(0);
}

describe("sheet codec", () => {
  it("round-trips a sheet exactly", () => {
    const palette = paletteFrom([0, 0x102030, 0x405060, 0xa0b0c0, 0xffeedd]);
    const index = Uint8Array.from({ length: 12 }, (_, i) => (i * 7) % 5);
    const normal = Uint8Array.from({ length: 48 }, (_, i) => (i % 4 === 3 ? (index[i >> 2] ? 255 : 0) : index[i >> 2] ? (i * 31) & 255 : 0));
    const l1 = { frames: 2, fw: 3, fh: 2, cols: 2, width: 6, height: 2, index, normal, anchor: { x: 2.5, y: 2 }, s: 1 };
    const st: StripSet = { lods: [l1, downsampleFrames(l1, 2, palette), downsampleFrames(l1, 3, palette), downsampleFrames(l1, 4, palette)], silk: Float32Array.from([1, 2, 3, 4, 0, 0, 1, 1]), mask: Uint8Array.from({ length: 48 }, (_, i) => (i * 13) & 255), maskUv: new Uint8Array(48).fill(9), maskPq: new Uint8Array(48), geoH: 17, pxPerM: 96, warp: { H: 17, frames: [], headUp: 3, headDown: 4 } };
    const back = decodeSheet(encodeSheet(st), palette)!;
    sameSheet(st, back);
    expect(decodeSheet(encodeSheet(st).subarray(0, 40), palette)).toBeNull();
  });
});

describe.skipIf(!has)("precomputed horse sheets", () => {
  it("hold exactly what a fresh build gives (rebuild: BAKE_SHEETS=1)", { timeout: 400_000 }, () => {
    const { srcs, entries, key, paletteJson } = sources();
    const keys = parseKeyPalette(JSON.parse(paletteJson))!;
    const built = buildAllSheets(srcs, keys)!;
    expect(built).not.toBeNull();
    const files = new Map<SheetId, { name: string; gz: Buffer; raw: Uint8Array }>();
    for (const s of SHEET_ORDER) {
      const st = built.sheets[s.id];
      if (!st) continue;
      const raw = encodeSheet(st);
      const name = `${s.stem}.${createHash("sha256").update(raw).digest("hex").slice(0, 12)}.bin`;
      files.set(s.id, { name, raw, gz: gzipSync(raw, { level: 9 }) });
    }
    const index: SheetIndex = {
      format: SHEET_FORMAT,
      key,
      palette: built.palette.colours.slice(),
      sheets: SHEET_ORDER.filter((s) => files.has(s.id)).map((s) => ({ id: s.id, stem: s.stem, file: files.get(s.id)!.name, bytes: files.get(s.id)!.gz.length, entry: entries[s.id]!, pxPerM: s.pxPerM })),
    };
    if (BAKE) {
      mkdirSync(DIR, { recursive: true });
      for (const f of readdirSync(DIR)) rmSync(join(DIR, f));
      for (const f of files.values()) writeFileSync(join(DIR, f.name), f.gz);
      writeFileSync(join(DIR, "index.json"), JSON.stringify(index, null, 1) + "\n");
    }
    // What is on disk is today's build.
    const disk = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8")) as SheetIndex;
    expect(disk.key, "the sheet files changed: rebake (BAKE_SHEETS=1)").toBe(key);
    expect(disk).toEqual(index);
    const palette = paletteFrom(disk.palette);
    expect(palette).toEqual(built.palette);
    for (const s of disk.sheets) {
      const gz = readFileSync(join(DIR, s.file));
      expect(gz.length).toBe(s.bytes);
      const raw = new Uint8Array(gunzipSync(gz));
      expect(Buffer.compare(Buffer.from(raw), Buffer.from(files.get(s.id)!.raw)), `${s.file} is stale: rebake (BAKE_SHEETS=1)`).toBe(0);
      sameSheet(built.sheets[s.id]!, decodeSheet(raw, palette)!);
      // the extents the views lay out with before the pixels arrive are the decoded ones
      const l0 = built.sheets[s.id]!.lods[0]!;
      const fr = sheetFrame(s.entry, Number.POSITIVE_INFINITY);
      expect({ fw: fr.fw, fh: fr.fh, anchor: fr.anchor }).toEqual({ fw: l0.fw, fh: l0.fh, anchor: l0.anchor });
    }
    // nothing else lingers in the folder (old hashes)
    expect(readdirSync(DIR).sort()).toEqual(["index.json", ...disk.sheets.map((s) => s.file)].sort());
  });
});
