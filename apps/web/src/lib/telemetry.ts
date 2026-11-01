/**
 * First-party telemetry from the browser: session start, page views (route only),
 * watched races and race-viewer perf reports. Goes to our own database via /api/events;
 * no third parties, no query strings, no identifiers beyond the session cookie the game
 * already uses.
 */
import type { PerfReport } from "@thoroughbred/race-viewer";

/**
 * The device context sent with a perf report (no new identifiers): the real-device performance
 * baseline (visual research V-00; docs/perf-baseline.md reads it on the admin page).
 */
interface RacePerfEvent {
  name: "race_perf";
  fps: number;
  fpsLow: number;
  /** 1000 / p99 frame ms. */
  fps99: number;
  /** The viewer's JS work per frame, median and p99 (ms). */
  workMs: number;
  workP99: number;
  /** % of frames over this device class's frame budget (33.4 ms phone/tablet, 16.8 ms desktop). */
  slowPct: number;
  quality: PerfReport["quality"];
  downgraded: boolean;
  /** Seconds of playback when the auto-downgrade fired (-1: never). */
  downgradeSec: number;
  view: PerfReport["view"];
  layout: PerfReport["layout"];
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
  const device = perfDevice();
  trackClient({
    name: "race_perf",
    fps: r.fps,
    fpsLow: r.fpsLow,
    fps99: r.fps99,
    workMs: r.workMs,
    workP99: r.workP99,
    slowPct: device === "desktop" ? r.over17 : r.over33,
    quality: r.quality,
    downgraded: r.downgraded,
    downgradeSec: r.downgradeSec,
    view: r.view,
    layout: r.layout,
    device,
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