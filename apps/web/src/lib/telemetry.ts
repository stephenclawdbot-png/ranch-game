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

/** Events wait this long for company, so a page view is one request (and one insert), not several. */
export const TELEMETRY_FLUSH_MS = 8_000;
/** The server takes at most this many events per request. */
const MAX_BATCH = 10;

const queue: ClientEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
/** Set by lib/player once the server has said whether this browser has a stable. */
let signedIn: boolean | null = null;

/** Tells telemetry whether this browser has a stable (lib/player.ts, on every /api/me answer). */
export function setTelemetrySignedIn(value: boolean): void {
  signedIn = value;
}

function send(events: ClientEvent[]): void {
  if (events.length === 0) return;
  try {
    const body = JSON.stringify({ events });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    // Telemetry never breaks the game.
  }
}

/** Sends everything waiting (also on the way out of the page, so nothing is lost). */
export function flushTelemetry(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  // A visitor without a stable: page views are not recorded at all (the server would drop
  // them), so a visitor's or crawler's page view costs no request beyond the session start.
  const events = signedIn === false ? queue.filter((e) => e.name !== "page_view") : queue.slice();
  queue.length = 0;
  for (let i = 0; i < events.length; i += MAX_BATCH) send(events.slice(i, i + MAX_BATCH));
}

/**
 * Queues an event; the queue goes out as one request after TELEMETRY_FLUSH_MS, when it is full,
 * or when the page is hidden or left.
 */
export function trackClient(event: ClientEvent): void {
  if (typeof window === "undefined") return;
  try {
    if (!listening) {
      listening = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushTelemetry();
      });
      window.addEventListener("pagehide", flushTelemetry);
    }
    queue.push(event);
    if (queue.length >= MAX_BATCH) flushTelemetry();
    else flushTimer ??= setTimeout(flushTelemetry, TELEMETRY_FLUSH_MS);
  } catch {
    // Telemetry never breaks the game.
  }
}