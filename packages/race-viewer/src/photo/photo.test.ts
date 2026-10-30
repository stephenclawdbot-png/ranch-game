import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
// The game's margin vocabulary lives in the engine; tests build results the engine's way.
import { marginLabel } from "../../../racing-engine/src/results";
import { parseKeyPalette } from "../three/recolor";
import { craftPhotoReplay, type CraftedRunner } from "./fixture";
import { fitScale, formatPhotoTime, photoLayout } from "./layout";
import { DEAD_HEAT, marginPhrase, photoFinishModel } from "./model";
import { rasterPhotoFinish, type PhotoArt } from "./raster";

const V = 16_500; // mm/s at the line
/** Crossing gap (us) that gives `mm` behind at speed V. */
const gapFor = (mm: number) => Math.ceil((mm * 1_000_000) / V);
const T0 = 72_345_678;

function race(gapsMm: number[], extra: Partial<CraftedRunner>[] = []) {
  const names = ["Silver Bramble", "Golden Mile", "Quiet Riot", "Harbour Light", "Paper Moon", "Kestrel Bay"];
  let t = T0;
  const runners: CraftedRunner[] = [{ name: names[0]!, crossingUs: t, ...extra[0] }];
  gapsMm.forEach((mm, i) => {
    t += mm === 0 ? 0 : gapFor(mm);
    runners.push({ name: names[i + 1]!, crossingUs: t, ...extra[i + 1] });
  });
  return craftPhotoReplay({ runners, marginLabel });
}

describe("photoFinishModel", () => {
  it.each([
    [100, "nose"],
    [300, "short head"],
    [600, "head"],
    [1000, "neck"],
  ])("a %i mm gap is a %s", (mm, label) => {
    const m = photoFinishModel(race([mm]));
    expect(m.runners[1]!.marginLabel).toBe(label);
    expect(m.runners[1]!.deadHeat).toBe(false);
    expect(m.runners[1]!.position).toBe(2);
    expect(m.judge).toMatchObject({ fromUs: T0, toUs: T0 + gapFor(mm), label });
  });

  it("calls a dead heat when the crossing times are equal at the timing resolution", () => {
    const m = photoFinishModel(race([0, 1000]));
    expect(m.runners.map((r) => [r.position, r.marginLabel, r.deadHeat])).toEqual([
      [1, "", false],
      [1, DEAD_HEAT, true],
      [3, "neck", false],
    ]);
    expect(m.judge.label).toBe(DEAD_HEAT);
    expect(m.verdict).toBe("Dead heat for 1st: Silver Bramble and Golden Mile; a neck back to Quiet Riot");
  });

  it("a single microsecond is not a dead heat", () => {
    const r = race([100]);
    r.result.finishOrder[1]!.finishTimeUs = T0 + 1;
    const m = photoFinishModel(r);
    expect(m.runners[1]!.deadHeat).toBe(false);
    expect(m.runners[1]!.position).toBe(2);
  });

  it("writes the verdict line", () => {
    expect(photoFinishModel(race([300, 1000])).verdict).toBe("1st Silver Bramble by a short head from Golden Mile; a neck back to Quiet Riot");
    expect(photoFinishModel(race([1200, 1800])).verdict).toBe("1st Silver Bramble by half a length from Golden Mile; three-quarters of a length back to Quiet Riot");
  });

  it("names dead heats for second", () => {
    expect(photoFinishModel(race([300, 0])).verdict).toBe("1st Silver Bramble by a short head from Golden Mile and Quiet Riot (dead heat for 2nd)");
  });

  it("orders by crossing time, not by array order", () => {
    const r = race([600, 300]);
    r.result.finishOrder.reverse();
    const m = photoFinishModel(r);
    expect(m.runners.map((x) => x.name)).toEqual(["Silver Bramble", "Golden Mile", "Quiet Riot"]);
    expect(m.runners.map((x) => x.crossingUs)).toEqual([...m.runners.map((x) => x.crossingUs)].sort((a, b) => a - b));
  });

  it("shows four by default, more when they are within 1.5 lengths", () => {
    expect(photoFinishModel(race([2400, 2400, 2400, 2400])).runners).toHaveLength(4);
    expect(photoFinishModel(race([300, 300, 300, 300, 300])).runners).toHaveLength(6);
    expect(photoFinishModel(race([300, 300, 300, 300, 300]), { count: 2, withinMm: 700 }).runners).toHaveLength(3);
  });

  it("reads speed and lane at the line from the frames", () => {
    const m = photoFinishModel(race([300], [{ speedMmS: 17_200, laneMilli: 2400 }, { speedMmS: 15_900, laneMilli: 600 }]));
    expect(m.runners.map((r) => [r.speedMmS, r.laneMilli])).toEqual([
      [17_200, 2400],
      [15_900, 600],
    ]);
  });

  it("is deterministic", () => {
    const a = JSON.stringify(photoFinishModel(race([300, 1000])));
    const b = JSON.stringify(photoFinishModel(race([300, 1000])));
    expect(a).toBe(b);
  });

  it("phrases margins", () => {
    expect(["nose", "short head", "1/2", "3/4", "1", "1 1/4", "dist", DEAD_HEAT].map(marginPhrase)).toEqual([
      "a nose",
      "a short head",
      "half a length",
      "three-quarters of a length",
      "a length",
      "1 1/4 lengths",
      "a distance",
      "a dead heat",
    ]);
  });
});

const SPRITE = { frameW: 256, frameH: 192, noseX: 240, tailX: 20, top: 40, bottom: 191 };

describe("photoLayout", () => {
  it("puts time on x: later crossings further left, by the time gap", () => {
    const m = photoFinishModel(race([300, 1000]));
    const l = photoLayout(m, SPRITE);
    const [a, b, c] = l.placements;
    expect(a!.noseX).toBe(l.winnerX);
    expect(b!.noseX).toBeLessThan(a!.noseX);
    expect(c!.noseX).toBeLessThan(b!.noseX);
    expect(l.winnerX - b!.noseX).toBe(Math.round(gapFor(300) / l.usPerColumn));
    // At the winner's speed one column is about a sprite pixel (~10.5 mm).
    expect(Math.abs((a!.noseX - b!.noseX) * 10.5 - 300)).toBeLessThan(15);
  });

  it("dead heaters share a nose column", () => {
    const l = photoLayout(photoFinishModel(race([0])), SPRITE);
    expect(l.placements[0]!.noseX).toBe(l.placements[1]!.noseX);
  });

  it("draws a slower horse wider, as the line-scan sees it", () => {
    const l = photoLayout(photoFinishModel(race([300], [{ speedMmS: 17_000 }, { speedMmS: 15_000 }])), SPRITE);
    expect(l.placements[0]!.width).toBe(221);
    expect(l.placements[1]!.width).toBe(Math.ceil(221 / (15 / 17)));
  });

  it("puts nearer (wider) lanes lower and in front", () => {
    const l = photoLayout(photoFinishModel(race([300], [{ laneMilli: 0 }, { laneMilli: 3000 }])), SPRITE);
    expect(l.placements[1]!.y).toBeGreaterThan(l.placements[0]!.y);
    expect(l.placements[1]!.depth).toBeGreaterThan(l.placements[0]!.depth);
    expect(l.placements[1]!.mirrorY).toBeLessThan(l.placements[0]!.mirrorY);
  });

  it("keeps every horse inside the image with a time scale", () => {
    const l = photoLayout(photoFinishModel(race([300, 1000, 2000])), SPRITE);
    for (const p of l.placements) {
      expect(p.noseX - p.width + 1).toBeGreaterThanOrEqual(0);
      expect(p.noseX).toBeLessThan(l.width);
    }
    expect(l.ticks.filter((t) => t.major).length).toBeGreaterThan(0);
    for (const t of l.ticks) expect(t.us % 10_000).toBe(0);
  });

  it("formats race time and fits whole-pixel scales", () => {
    expect(formatPhotoTime(72_345_678)).toBe("1:12.34");
    expect(fitScale(400, 358, 3)).toEqual({ scale: 3, cssWidth: 400 });
    expect(fitScale(555, 358, 3)).toEqual({ scale: 2, cssWidth: 370 });
    expect(fitScale(555, 1068, 1)).toEqual({ scale: 2, cssWidth: 1110 });
    expect(fitScale(900, 358, 1)).toEqual({ scale: 1, cssWidth: 900 });
  });
});

// --- raster on the real lunge strip ---------------------------------------------------

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../../apps/web/public/art/race");

function decodePng(file: string): { w: number; h: number; px: Uint8ClampedArray } {
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
      ct = d[9]!;
    } else if (type === "IDAT") idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8ClampedArray(w * h * 4);
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
    for (let x = 0; x < w; x++) out.set([cur[x * bpp]!, cur[x * bpp + 1]!, cur[x * bpp + 2]!, bpp === 4 ? cur[x * bpp + 3]! : 255], (y * w + x) * 4);
    prev.set(cur);
  }
  return { w, h, px: out };
}

function encodePng(w: number, h: number, px: Uint8ClampedArray): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, px.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

describe.skipIf(!existsSync(join(ART, "horse-lunge.png")))("rasterPhotoFinish (real lunge strip)", () => {
  const png = decodePng(join(ART, "horse-lunge.png"));
  const keys = parseKeyPalette(JSON.parse(readFileSync(join(ART, "palette.json"), "utf8")))!;
  const art: PhotoArt = { strip: { data: png.px, width: png.w, height: png.h, frameW: 256 }, frame: 5, keys };

  it("renders the photograph deterministically", () => {
    const m = photoFinishModel(race([300, 1000]));
    const a = rasterPhotoFinish(m, art);
    const b = rasterPhotoFinish(m, art);
    expect(a.data.length).toBe(a.width * a.height * 4);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    // The lunge frame's nose sits near the strip's anchor (x 0.879 of 256 = 225).
    expect(Math.abs(a.sprite.noseX - 225)).toBeLessThan(16);
  });

  it("the winner's nose column has horse pixels and the column ahead is background", () => {
    const m = photoFinishModel(race([300]));
    const r = rasterPhotoFinish(m, art, { colour: 1 });
    const { winnerX, mainTop, groundY } = r.layout;
    const isBg = (x: number) => {
      for (let y = mainTop + 2; y < groundY; y++) {
        const i = (y * r.width + x) * 4;
        if (r.data[i]! < 200) return false;
      }
      return true;
    };
    expect(isBg(winnerX)).toBe(false);
    expect(isBg(winnerX + 1)).toBe(true);
  });

  it("writes preview PNGs when PHOTO_OUT is set", () => {
    const dir = process.env.PHOTO_OUT;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    for (const [name, gaps] of [
      ["raster-dead-heat", [0, 1000]],
      ["raster-short-head", [300, 1000]],
      ["raster-neck", [1000, 600]],
    ] as const) {
      const r = rasterPhotoFinish(photoFinishModel(race([...gaps], [{ laneMilli: 1000 }, { laneMilli: 3000 }, { laneMilli: 200 }])), art);
      writeFileSync(join(dir, `${name}.png`), encodePng(r.width, r.height, r.data));
    }
  });
});
