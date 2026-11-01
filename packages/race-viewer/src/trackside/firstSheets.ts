/**
 * Which horse sheets the opening picture needs (no imports: the viewer shell decides this
 * before it loads any scene code). The gallop always comes first; the rest load after the
 * first picture and the views draw the gallop in their place meanwhile.
 */
export type FirstSheet = "idle" | "break" | "easeup" | "celebrate";

/**
 * Sheets to load before the first picture when it opens at race time `t` (s) of a race
 * lasting `duration` (Infinity while live): the build-up walks (easeup) and stands (idle) the
 * field into the stalls, the off breaks, a finished replay opens on the run-out.
 */
export function firstSheetsAt(t: number, duration: number): FirstSheet[] {
  if (t < 0) return ["easeup", "idle", "break"];
  if (t < 1.5) return ["break"];
  if (t >= duration) return ["easeup", "idle", "celebrate"];
  return [];
}
