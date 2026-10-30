/**
 * Client side of the live broadcast: a `LiveRaceFeed` that polls
 * GET /api/races/:id/live?w=<window> and only ever grows.
 *
 *   const feed = await openLiveRaceFeed(raceId, { signal });
 *   const off = feed.subscribe(() => render(feed));
 *   ...
 *   feed.close();
 *
 * or, in React: `const { feed, error } = useLiveRaceFeed(raceId)`.
 *
 * Windows: frames come in fixed 50-frame windows (lib/liveWindow.ts) so every viewer of a
 * race requests the same URLs and the CDN can answer them from one origin response. The
 * feed asks for the window holding its cursor (the next frame it lacks), drops frames it
 * already has, and moves straight on to the next window once one is complete.
 *
 * Clock skew: every response carries serverNowMs, but a CDN copy may have been generated
 * up to ~2 s before it reaches us. Each sample bounds offset = server - local:
 *   lower: serverNowMs + Age - t1 (the server clock had at least reached that on arrival)
 *   upper: serverNowMs - t0 for a response fresh from the origin (plus a little slack: it
 *          may be shared with a concurrent request), widened by the possible staleness for a
 *          CDN copy (Age, x-vercel-cache).
 * The feed intersects the bounds of recent samples and uses the middle, then exposes
 * `broadcastStartMs` already converted to THIS browser's clock, so consumers can compare
 * it with Date.now() directly (`serverBroadcastStartMs` is the raw server value).
 * Complete windows are immutable (possibly from the browser cache, hours old), so they only
 * give a lower bound; until an upper bound arrives the feed uses the highest lower bound.
 */
import { useEffect, useState } from "react";
import type { LiveRaceFeed, RaceBroadcastChunk, RaceBroadcastHeader, RaceEvent, RaceReplay } from "@thoroughbred/shared";
import { isWindowComplete, liveWindowOf } from "./liveWindow";

export interface LiveRaceFeedOptions {
  signal?: AbortSignal;
  /** Poll interval while live and visible. Default 1200 ms. */
  pollMs?: number;
  /** Poll interval while the tab is hidden. Default 10 s. */
  hiddenPollMs?: number;
  /** Injection points for tests. */
  fetch?: typeof fetch;
  now?: () => number;
  isHidden?: () => boolean;
}

export class LiveFeedHttpError extends Error {
  constructor(public readonly status: number) {
    super(status === 404 ? "race not found" : `HTTP ${status}`);
    this.name = "LiveFeedHttpError";
  }
}

const MAX_BACKOFF_MS = 15_000;
/** Ignore smaller corrections once playing so the picture doesn't jump. */
const MIN_OFFSET_CHANGE_MS = 150;
/** Never poll more often than this while live (the server edge only moves 10 frames/s). */
const MIN_POLL_GAP_MS = 250;
/** Clock samples kept for the offset estimate. */
const CLOCK_SAMPLES = 16;
/** Worst staleness assumed for a CDN copy that carries no Age header (s-maxage 1 + stale 1). */
const CACHED_MAX_AGE_MS = 2500;
/** An origin response may have been generated for an earlier concurrent request (route single-flight). */
const ORIGIN_SLACK_MS = 100;

/** One response's timing, for the clock estimate. */
export interface ChunkTiming {
  /** Local time the request started / the body arrived. */
  t0: number;
  t1: number;
  /** `Age` header in ms (null when absent). */
  ageMs: number | null;
  /** "fresh": generated for this request; "cached": a CDN copy; "immutable": of unknown age (lower bound only). */
  source: "fresh" | "cached" | "immutable";
}

interface FetchedChunk extends ChunkTiming {
  chunk: RaceBroadcastChunk;
  window: number;
}

function eventKey(e: RaceEvent): string {
  return `${e.tick}|${e.type}|${e.horseId ?? ""}|${e.text}`;
}

export function liveWindowUrl(raceId: string, w: number): string {
  return `/api/races/${encodeURIComponent(raceId)}/live?w=${w}`;
}

/** How a response may be used as a clock sample (see the header comment). */
function chunkSource(res: Response, w: number, chunk: RaceBroadcastChunk): ChunkTiming["source"] {
  if (chunk.final || isWindowComplete(w, chunk.fromFrame, chunk.frames.length)) return "immutable";
  const cache = res.headers.get("x-vercel-cache")?.toUpperCase();
  if (cache === "MISS" || cache === "BYPASS" || cache === "REVALIDATED") return "fresh";
  if (cache || res.headers.has("age")) return "cached";
  return "fresh"; // straight from the origin (local dev, tests)
}

async function fetchChunk(doFetch: typeof fetch, now: () => number, raceId: string, w: number, signal: AbortSignal): Promise<FetchedChunk> {
  const t0 = now();
  // Default cache mode: "no-store" would send Pragma/Cache-Control: no-cache and push past
  // the shared CDN copy. The server's headers already keep live windows out of the browser cache.
  const res = await doFetch(liveWindowUrl(raceId, w), { signal });
  if (!res.ok) throw new LiveFeedHttpError(res.status);
  const chunk = (await res.json()) as RaceBroadcastChunk;
  const t1 = now();
  if (!chunk || chunk.raceId === undefined || !chunk.header || !Array.isArray(chunk.frames)) throw new Error("malformed live chunk");
  const ageHeader = res.headers.get("age");
  const age = ageHeader === null ? NaN : Number(ageHeader);
  const ageMs = Number.isFinite(age) && age >= 0 ? age * 1000 : null;
  return { chunk, window: w, t0, t1, ageMs, source: chunkSource(res, w, chunk) };
}

/**
 * Offset (server - local) bounds from one sample. The server clock had reached serverNowMs
 * (+ Age) when the response arrived, whatever its age. A CDN copy was generated between Age
 * and Age + 1 s (Age is whole seconds) before it left the CDN; without Age assume the worst
 * the cache headers allow; an immutable window may be any age (no upper bound).
 */
export function offsetBounds(serverNowMs: number, t: ChunkTiming): { lo: number; hi: number } {
  const lo = serverNowMs + (t.ageMs ?? 0) - t.t1;
  if (t.source === "immutable") return { lo, hi: Infinity };
  const staleness = t.source === "fresh" ? ORIGIN_SLACK_MS : t.ageMs !== null ? t.ageMs + 1000 : CACHED_MAX_AGE_MS;
  return { lo, hi: Math.max(lo, serverNowMs + staleness - t.t0) };
}

export class PollingLiveRaceFeed implements LiveRaceFeed {
  readonly raceId: string;
  readonly header: RaceBroadcastHeader;
  /** Server clock value at which frame 0 is shown. */
  readonly serverBroadcastStartMs: number;
  /** server - local, ms. */
  clockOffsetMs = 0;
  frames: ReadonlyArray<ReadonlyArray<number>> = [];
  events: ReadonlyArray<RaceEvent> = [];
  liveEdgeFrame = -1;
  final: RaceReplay | null = null;
  /** Last polling error (cleared on success). */
  error: string | null = null;
  /** Increments on every change; handy as a React snapshot. */
  version = 0;

  private listeners = new Set<() => void>();
  private eventKeys = new Set<string>();
  private clockSamples: Array<{ lo: number; hi: number }> = [];
  private hasOffset = false;
  /** The last response held every frame of its window: go straight on to the next one. */
  private windowComplete = false;
  /** Latest edge the server reported (may be ahead of `frames` while catching up). */
  private serverEdge = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: AbortController | null = null;
  private closed = false;
  private failures = 0;
  /** Local time the last poll request started (cadence is measured from here, not from the response). */
  private lastRequestAt = 0;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly isHidden: () => boolean;
  private readonly pollMs: number;
  private readonly hiddenPollMs: number;
  private readonly onVisibility = () => {
    if (!this.isHidden() && !this.final && !this.closed) this.schedule(0);
  };

  constructor(first: FetchedChunk, opts: LiveRaceFeedOptions = {}) {
    const { chunk } = first;
    this.raceId = chunk.raceId;
    this.header = chunk.header;
    this.serverBroadcastStartMs = chunk.broadcastStartMs;
    this.doFetch = opts.fetch ?? ((...a) => fetch(...a));
    this.now = opts.now ?? Date.now;
    this.isHidden = opts.isHidden ?? (() => typeof document !== "undefined" && document.visibilityState === "hidden");
    this.pollMs = opts.pollMs ?? 1200;
    this.hiddenPollMs = opts.hiddenPollMs ?? 10_000;
    this.apply(first);
    if (opts.signal) {
      if (opts.signal.aborted) this.close();
      else opts.signal.addEventListener("abort", () => this.close(), { once: true });
    }
    if (!this.final && !this.closed) {
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibility);
      this.schedule(this.nextDelay());
    }
  }

  /** Wall-clock ms (this browser's clock) at which frame 0 is shown. */
  get broadcastStartMs(): number {
    return this.serverBroadcastStartMs - this.clockOffsetMs;
  }

  /** Current time on the server clock. */
  serverNow(): number {
    return this.now() + this.clockOffsetMs;
  }

  /** Post time converted to this browser's clock. */
  get localPostTimeMs(): number {
    return this.header.race.postTimeMs - this.clockOffsetMs;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stops polling and aborts any request in flight. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.inflight?.abort();
    this.inflight = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Merge a response. Returns true when anything visible changed. */
  private apply(res: FetchedChunk): boolean {
    const { chunk } = res;
    let changed = this.updateClock(chunk.serverNowMs, res);

    if (chunk.final) {
      this.final = chunk.final;
      this.frames = chunk.final.frames;
      this.events = chunk.final.events;
      this.liveEdgeFrame = chunk.final.frames.length - 1;
      return true;
    }

    this.windowComplete = isWindowComplete(res.window, chunk.fromFrame, chunk.frames.length);
    // Frames: append [fromFrame, ...] where it continues what we have (drop overlap, ignore gaps).
    const have = this.frames.length;
    if (chunk.frames.length > 0 && chunk.fromFrame <= have) {
      const fresh = chunk.frames.slice(have - chunk.fromFrame);
      if (fresh.length > 0) {
        this.frames = this.frames.concat(fresh);
        changed = true;
      }
    }

    const newEvents = chunk.events.filter((e) => !this.eventKeys.has(eventKey(e)));
    if (newEvents.length > 0) {
      for (const e of newEvents) this.eventKeys.add(eventKey(e));
      this.events = [...this.events, ...newEvents].sort((a, b) => a.tick - b.tick);
      changed = true;
    }

    // Only advertise frames we actually hold.
    const edge = Math.min(chunk.liveEdgeFrame, this.frames.length - 1);
    if (edge > this.liveEdgeFrame) {
      this.liveEdgeFrame = edge;
      changed = true;
    }
    // A CDN copy can be older than one we already had: the edge we know of never goes back.
    this.serverEdge = Math.max(this.serverEdge, chunk.liveEdgeFrame);
    return changed;
  }

  /**
   * Folds one sample into the offset estimate: the middle of the intersection of recent
   * samples' bounds. If they disagree (the local clock jumped), the older ones are dropped.
   * Returns true when the offset moved after the first estimate.
   */
  private updateClock(serverNowMs: number, timing: ChunkTiming): boolean {
    this.clockSamples.push(offsetBounds(serverNowMs, timing));
    if (this.clockSamples.length > CLOCK_SAMPLES) this.clockSamples.shift();
    let lo = -Infinity;
    let hi = Infinity;
    for (let i = this.clockSamples.length - 1; i >= 0; i--) {
      const s = this.clockSamples[i]!;
      if (Math.max(lo, s.lo) > Math.min(hi, s.hi)) {
        this.clockSamples = this.clockSamples.slice(i + 1);
        break;
      }
      lo = Math.max(lo, s.lo);
      hi = Math.min(hi, s.hi);
    }
    const offset = Math.round(hi === Infinity ? lo : (lo + hi) / 2);
    if (this.hasOffset && Math.abs(offset - this.clockOffsetMs) < MIN_OFFSET_CHANGE_MS) return false;
    const changed = this.hasOffset && offset !== this.clockOffsetMs;
    this.clockOffsetMs = offset;
    this.hasOffset = true;
    return changed;
  }

  private notify(): void {
    this.version++;
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (err) {
        console.error("[liveRaceFeed] listener failed", err);
      }
    }
  }

  private nextDelay(): number {
    if (this.failures > 0) return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.failures, 4));
    if (this.isHidden()) return this.hiddenPollMs;
    // Behind the server (joined mid-race, or a window just filled up): fetch on straight away.
    if (this.windowComplete || this.frames.length - 1 < this.serverEdge) return 0;
    if (this.liveEdgeFrame < 0) {
      // Before the off: sleep until post time (re-checking at least every 10 s).
      const untilPost = this.header.race.postTimeMs - this.serverNow();
      return Math.max(250, Math.min(10_000, untilPost > this.pollMs ? untilPost : this.pollMs));
    }
    // Steady cadence from the previous request start, and earlier still if the buffered
    // frames will run out on the broadcast clock within ~1 s (slow network / busy tab).
    const sinceRequest = this.now() - this.lastRequestAt;
    const frameMs = (this.header.sampleEvery * 1000) / this.header.tickHz;
    const dataRunsOutIn = this.broadcastStartMs + (this.liveEdgeFrame + 1) * frameMs - this.now();
    return Math.max(MIN_POLL_GAP_MS, Math.min(this.pollMs - sinceRequest, dataRunsOutIn - 1000));
  }

  private schedule(delayMs: number): void {
    if (this.closed || this.final) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, delayMs);
  }

  private async poll(): Promise<void> {
    if (this.closed || this.final || this.inflight) return;
    const ctrl = new AbortController();
    this.inflight = ctrl;
    this.lastRequestAt = this.now();
    try {
      const res = await fetchChunk(this.doFetch, this.now, this.raceId, liveWindowOf(this.frames.length), ctrl.signal);
      if (this.closed) return;
      this.failures = 0;
      const hadError = this.error !== null;
      this.error = null;
      if (this.apply(res) || hadError) this.notify();
    } catch (err) {
      if (this.closed || (err as Error).name === "AbortError") return;
      this.failures++;
      this.error = (err as Error).message;
      this.notify();
      if (err instanceof LiveFeedHttpError && (err.status === 404 || err.status === 400)) {
        this.close();
        return;
      }
    } finally {
      if (this.inflight === ctrl) this.inflight = null;
    }
    if (this.final) {
      this.close();
      return;
    }
    this.schedule(this.nextDelay());
  }
}

/** Fetches the first chunk (header + whatever is live) and starts polling. */
export async function openLiveRaceFeed(raceId: string, opts: LiveRaceFeedOptions = {}): Promise<PollingLiveRaceFeed> {
  const doFetch = opts.fetch ?? ((...a) => fetch(...a));
  const now = opts.now ?? Date.now;
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", abort, { once: true });
  try {
    const first = await fetchChunk(doFetch, now, raceId, 0, ctrl.signal);
    return new PollingLiveRaceFeed(first, opts);
  } finally {
    opts.signal?.removeEventListener("abort", abort);
  }
}

/**
 * React hook: the live feed for a race (null until the first chunk arrives). Re-renders on
 * every change; retries the initial request with backoff; closes on unmount.
 */
export function useLiveRaceFeed(raceId: string, enabled = true): { feed: PollingLiveRaceFeed | null; error: string | null; version: number } {
  const [feed, setFeed] = useState<PollingLiveRaceFeed | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    let current: PollingLiveRaceFeed | null = null;
    const attempt = (n: number) => {
      openLiveRaceFeed(raceId, { signal: ctrl.signal })
        .then((f) => {
          if (ctrl.signal.aborted) return f.close();
          current = f;
          setOpenError(null);
          setFeed(f);
          setVersion(f.version);
          unsubscribe = f.subscribe(() => setVersion(f.version));
        })
        .catch((err: Error) => {
          if (ctrl.signal.aborted || err.name === "AbortError") return;
          setOpenError(err.message);
          if (err instanceof LiveFeedHttpError && err.status === 404) return;
          retry = setTimeout(() => attempt(n + 1), Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(n, 4)));
        });
    };
    attempt(0);
    return () => {
      ctrl.abort();
      if (retry) clearTimeout(retry);
      unsubscribe?.();
      current?.close();
      setFeed(null);
    };
  }, [raceId, enabled]);

  return { feed, error: feed?.error ?? openError, version };
}
