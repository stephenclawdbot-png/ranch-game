// Share of each horse sheet's opaque pixels that are race/palette.json keys (keyed = recolourable).
import { existsSync } from "node:fs";
import { HORSE_SHEETS } from "../../packages/art-pipeline/src/coatSheets";
import { ART, readJson, readPng } from "./png";

const pal = readJson<Record<string, unknown>>(`${ART}/race/palette.json`);
const keys = new Set<number>();
for (const v of Object.values(pal)) if (Array.isArray(v)) for (const h of v) keys.add(Number.parseInt(String(h).slice(1), 16));
for (const s of HORSE_SHEETS)
  for (const suffix of ["", "-s2", "-s3", "-s4", "-f"]) {
    const f = `${ART}/${s.stem}${suffix}.png`;
    if (!existsSync(f)) continue;
    const img = readPng(f);
    let o = 0;
    let k = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3]! < 128) continue;
      o++;
      if (keys.has((img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!)) k++;
    }
    console.log(`${s.stem}${suffix}`.padEnd(36), (k / Math.max(1, o)).toFixed(2));
  }
