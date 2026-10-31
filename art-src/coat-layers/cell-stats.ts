// Non-zero pixels per atlas cell and space (a quick check that every drawn variant read back).
import { ATLAS_CELL, ATLAS_COLS, BODY, COAT_LAYERS, FACE, LAYER_CELL, LEGS, TAIL } from "../../packages/art-pipeline/src/coatLayers";
import { ART, readPng } from "./png";

const img = readPng(`${ART}/race/coat-layers.png`);
const count = (cell: number, x: number, y: number, w: number, h: number) => {
  const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w;
  const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h;
  let n = 0;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (img.data[((cy + y + yy) * img.width + cx + x + xx) * 4]! > 0) n++;
  return n;
};
for (const [id, , n] of COAT_LAYERS)
  for (let v = 0; v < n; v++) {
    const c = LAYER_CELL[id] + v;
    console.log(
      `${id}#${v}`.padEnd(16),
      "body",
      String(count(c, BODY.x, BODY.y, 202, 139)).padStart(6),
      "face",
      String(count(c, FACE.x, FACE.y, FACE.w, FACE.h)).padStart(5),
      "tail",
      String(count(c, TAIL.x, TAIL.y, TAIL.w, TAIL.h)).padStart(5),
      "legs",
      [0, 1, 2, 3].map((k) => String(count(c, LEGS.x + k * LEGS.w, LEGS.y, LEGS.w, LEGS.h)).padStart(5)).join(""),
    );
  }
