/**
 * Client side of the live broadcast: a `LiveRaceFeed` that polls
 * GET /api/races/:id/live?from=<n> and only ever grows.
 *
 *   const feed = await openLiveRaceFeed(raceId, { signal });
 *   const off = feed.subscribe(() => render(feed));
 *   ...
 *   feed.close();
 *
 * or, in React: `const { feed, error } = useLiveRaceFeed(raceId)`.
 *
 * Clock skew: every response carries serverNowMs. The feed estimates
 * offset = server - local from the lowest-latency sample and exposes
 * `broadcastStartMs` already converted to THIS browser's clock, so consumers can compare
 * it with Date.now() directly (`serverBroadcastStartMs` is the raw server value).
 */
import { useEffect, useState } from "react";
import type { LiveRaceFeed, RaceBroadcastChunk, RaceBroadcastHeader, RaceEvent, RaceReplay } from "@thoroughbred/shared";

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

function eventKey(e: RaceEvent): string {
  return `${e.tick}|${e.type}|${e.horseId ?? ""}|${e.text}`;
}

function liveUrl(raceId: string, from: number): string {
  return `/api/races/${encodeURIComponent(raceId)}/live?from=${from}`;
}

async function fetchChunk(
  doFetch: typeof fetch,
  now: () => number,
  raceId: string,
  from: number,
  signal: AbortSignal,
): Promise<{ chunk: RaceBroadcastChunk; t0: number; t1: number }> {
  const t0 = now();
  const res = await doFetch(liveUrl(raceId, from), { signal, cache: "no-store" });
  if (!res.ok) throw new LiveFeedHttpError(res.status);
  const chunk = (await res.json()) as RaceBroadcastChunk;
  const t1 = now();
  if (!chunk || chunk.raceId === undefined || !chunk.header || !Array.isArray(chunk.frames)) throw new Error("malformed live chunk");
  return { chunk, t0, t1 };
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
  private bestRttMs = Infinity;
  private hasOffset = false;
  /** Latest edge the server reported (may be ahead of `frames` while catching up). */
  private serverEdge = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: AbortController | null = null;
  private closed = false;
  private failures = 0;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly isHidden: () => boolean;
  private readonly pollMs: number;
  private readonly hiddenPollMs: number;
  private readonly onVisibility = () => {
    if (!this.isHidden() && !this.final && !this.closed) this.schedule(0);
  };

  constructor(first: { chunk: RaceBroadcastChunk; t0: number; t1: number }, opts: LiveRaceFeedOptions = {}) {
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
  private apply({ chunk, t0, t1 }: { chunk: RaceBroadcastChunk; t0: number; t1: number }): boolean {
    let changed = false;

    // Clock offset from the lowest-latency sample.
    const rtt = Math.max(0, t1 - t0);
    if (rtt < this.bestRttMs) {
      this.bestRttMs = rtt;
      const offset = Math.round(chunk.serverNowMs - (t0 + t1) / 2);
      if (!this.hasOffset || Math.abs(offset - this.clockOffsetMs) >= MIN_OFFSET_CHANGE_MS) {
        changed = this.hasOffset && offset !== this.clockOffsetMs;
        this.clockOffsetMs = offset;
        this.hasOffset = true;
      }
    }

    if (chunk.final) {
      this.final = chunk.final;
      this.frames = chunk.final.frames;
      this.events = chunk.final.events;
      this.liveEdgeFrame = chunk.final.frames.length - 1;
      return true;
    }

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
    this.serverEdge = chunk.liveEdgeFrame;
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
    // Behind the server (chunk was capped): fetch the rest straight away.
    if (this.frames.length - 1 < this.serverEdge) return 0;
    if (this.liveEdgeFrame < 0) {
      // Before the off: sleep until post time (re-checking at least every 10 s).
      const untilPost = this.header.race.postTimeMs - this.serverNow();
      return Math.max(250, Math.min(10_000, untilPost > this.pollMs ? untilPost : this.pollMs));
    }
    return this.pollMs;
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
    try {
      const res = await fetchChunk(this.doFetch, this.now, this.raceId, this.frames.length, ctrl.signal);
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
