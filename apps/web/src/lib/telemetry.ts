/**
 * First-party telemetry from the browser: session start, page views (route only),
 * watched races and race-viewer perf reports. Goes to our own database via /api/events;
 * no third parties, no query strings, no identifiers beyond the session cookie the game
 * already uses.
 */
import type { PerfReport } from "@thoroughbred/race-viewer";

/** The device context sent with a perf report (no new identifiers). */
interface RacePerfEvent {
  name: "race_perf";
  fps: number;
  fpsLow: number;
  quality: PerfReport["quality"];
  downgraded: boolean;
  view: PerfReport["view"];
  device: "phone" | "tablet" | "desktop";
  dpr: number;
  gpu: string;
}

type ClientEvent =
  | { name: "session_start" | "page_view" | "race_watched"; route?: string; raceId?: string }
  | RacePerfEvent;

/** Phone: coarse pointer on a small screen; tablet: coarse otherwise; else desktop. */
function perfDevice(): RacePerfEvent["device"] {
  try {
    if (matchMedia("(pointer: coarse)").matches) return Math.min(screen.width, screen.height) < 600 ? "phone" : "tablet";
  } catch {
    /* no window / no matchMedia */
  }
  return "desktop";
}

let gpuName: string | null = null;

/** WebGL renderer string, read once per page and cached ("unknown" when hidden). */
function perfGpu(): string {
  if (gpuName === null) {
    gpuName = "unknown";
    try {
      const c = document.createElement("canvas");
      const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      const renderer = ext ? gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
      if (typeof renderer === "string" && renderer.trim()) gpuName = renderer.trim().slice(0, 60);
    } catch {
      /* keep "unknown" */
    }
  }
  return gpuName;
}

/** One real-device perf report per mounted race viewer. */
export function trackRacePerf(r: PerfReport): void {
  trackClient({
    name: "race_perf",
    fps: r.fps,
    fpsLow: r.fpsLow,
    quality: r.quality,
    downgraded: r.downgraded,
    view: r.view,
    device: perfDevice(),
    dpr: Math.round((window.devicePixelRatio || 1) * 10) / 10,
    gpu: perfGpu(),
  });
}

export function trackClient(event: ClientEvent): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({ events: [event] });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    // Telemetry never breaks the game.
  }
}