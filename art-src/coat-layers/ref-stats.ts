// Prints where the head, mane and neck sit in body space on the reference (portrait calibration).
import { GEO_REGION } from "../../packages/art-pipeline/src/coatGeometry";
import { referenceGeometry } from "./reference";

const { geo } = referenceGeometry();
const stat = (r: number, outside = 0) => {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, n = 0;
  for (let i = 0; i < geo.region.length; i++) {
    if (geo.region[i] !== r || geo.outside[i] !== outside) continue;
    n++;
    u0 = Math.min(u0, geo.u[i]!);
    u1 = Math.max(u1, geo.u[i]!);
    v0 = Math.min(v0, geo.v[i]!);
    v1 = Math.max(v1, geo.v[i]!);
  }
  return { n, u: [u0 / geo.H, u1 / geo.H].map((x) => x.toFixed(2)), v: [v0 / geo.H, v1 / geo.H].map((x) => x.toFixed(2)) };
};
console.log("H", geo.H, "face", stat(GEO_REGION.face), "mane", stat(GEO_REGION.mane), "body", stat(GEO_REGION.body), "tail", stat(GEO_REGION.tail));
let e1 = 0;
for (let i = 0; i < geo.region.length; i++) if (geo.region[i] === GEO_REGION.face) e1 = Math.max(e1, geo.p2[i]!);
console.log("face e max/H", (e1 / geo.H).toFixed(2));
