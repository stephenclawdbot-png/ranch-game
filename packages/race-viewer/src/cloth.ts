/**
 * Saddle cloths in the gate colours (visual research 2026-11-01, V-03 / Prototype A): on by
 * default in every view (Trackside, 3D, photo finish, paddock and post parade). `?cloth=0` on the
 * page URL shows the old plain white cloths, for comparison.
 */
export { SADDLE_CLOTHS, saddleClothOf, type SaddleClothLook } from "@thoroughbred/art-pipeline";

/** Has the page asked for the old white cloths (`?cloth=0`)? */
export function clothOffByUrl(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = new URLSearchParams(window.location.search).get("cloth");
    return v === "0" || v === "off" || v === "white";
  } catch {
    return false;
  }
}
