/** Pixi-free shared types (safe to import from server components and the main entry). */
/** "director" = auto-cut broadcast (default); "mine"/"leader" = locked close tracking; "wide" = whole field. */
export type CameraMode = "director" | "mine" | "leader" | "wide";
export type RenderQuality = "high" | "low";
export type QualitySetting = "auto" | RenderQuality;

/** Picture-in-picture inset (CSS px from the stage's bottom-right), or null when it doesn't fit. */
export function pipRect(stageW: number, stageH: number): { right: number; bottom: number; w: number; h: number } | null {
  if (stageW < 700 || stageH < 380) return null;
  const w = Math.round(Math.min(stageW * 0.24, 320));
  return { right: 12, bottom: 100, w, h: Math.round((w * 9) / 16) };
}
