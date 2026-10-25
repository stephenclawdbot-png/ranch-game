"use client";
/**
 * <RaceViewer> — plays back a stored RaceReplay as an HD 2.5D race.
 *
 * Three.js is imported dynamically inside an effect, so this module is safe to import
 * from server components / SSR (it renders an empty stage until the client mounts).
 * The viewer never decides anything: positions come from replay frames, the
 * winner and finishing order from replay.result.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { LiveRaceFeed, RaceEvent, RaceReplay } from "@thoroughbred/shared";
import { LiveClock, PlaybackClock, timeLeaderReaches } from "./playback";
import { replayTiming } from "./sampleReplay";
import { commentaryAt, distanceToGoM, standingsAt, type StandingRow, type TimelineSource } from "./timeline";
import { pipRect, type CameraMode, type QualitySetting, type RenderQuality } from "./types";
import { FURLONG_MM } from "@thoroughbred/shared";
import { Controls, Countdown, Minimap, PhotoStamp, ResultsCard, Ticker, TopHud, type MinimapDot } from "./hud/Hud";
import { injectViewerCss } from "./hud/styles";
import type { HD2DScene as HD2DSceneT, SceneRaceData } from "./three/HD2DScene";

export interface RaceViewerProps {
  /** A finished race (full controls). Provide exactly one of `replay` or `feed`. */
  replay?: RaceReplay;
  /**
   * A live broadcast. While live the viewer only knows the header and the frames/events
   * received so far: pause and rewind work, but nothing can move past the live edge.
   * When `feed.final` arrives and the playhead reaches the end, it runs the
   * photo-finish/results flow and switches to full replay controls.
   * `feed.broadcastStartMs` must already be in this browser's clock (server skew removed).
   */
  feed?: LiveRaceFeed;
  /**
   * Wall-clock post time (ms since epoch). Playback syncs to it:
   * elapsed = (Date.now() - startAtMs) / 1000. Before it: gate-loading countdown.
   * Already over: opens on the result with replay controls.
   */
  startAtMs?: number;
  /** Default true. */
  autoplay?: boolean;
  /** The player's horse: marker above it, "My horse" camera, highlighted rows. */
  highlightHorseId?: string;
  /** Called once when playback first reaches the end of the race. */
  onFinished?: () => void;
  className?: string;
  /** Stage height in px. Default: responsive 16:9, at least 320px. */
  height?: number;
  quality?: QualitySetting;
  /** fps / frame-time overlay. */
  debug?: boolean;
  /** Optional extras (dev / art swap); not required by the page contract. */
  initialTimeSec?: number;
  initialCamera?: CameraMode;
  /**
   * Public art root holding manifest.json (default "/art"). Missing / 404 art falls
   * back to code-drawn pixel art. Pass null to skip the fetch.
   */
  artBaseUrl?: string | null;
  /** Render at a low internal resolution, upscaled with nearest filtering. */
  pixelated?: boolean;
}

interface HudState {
  mode: "live" | "replay";
  /** Furthest scrubbable time (live: the live edge; replay: duration). */
  scrubMax: number;
  buffering: boolean;
  dots: MinimapDot[];
  pip: boolean;
  time: number;
  playing: boolean;
  live: boolean;
  rate: number;
  ended: boolean;
  frozen: boolean;
  slowmo: boolean;
  canGoLive: boolean;
  toGoM: number;
  standings: StandingRow[];
  commentary: RaceEvent | null;
}

const NARROW_PX = 560;

function autoQuality(width: number): RenderQuality {
  if (typeof navigator === "undefined") return "high";
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 8;
  const mem = nav.deviceMemory ?? 8;
  const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  if (width < NARROW_PX || cores <= 4 || mem <= 4 || (coarse && width < 900)) return "low";
  return "high";
}

type Clock = PlaybackClock | LiveClock;

/** The live feed as scene/timeline data: header + growing frames/events, no result. */
function liveData(feed: LiveRaceFeed): SceneRaceData & TimelineSource {
  const h = feed.header;
  return {
    race: h.race,
    horses: h.horses,
    tickHz: h.tickHz,
    sampleEvery: h.sampleEvery,
    trackLengthMm: h.trackLengthMm,
    laneCount: h.laneCount,
    get frames() {
      return feed.frames;
    },
    get events() {
      return feed.events;
    },
    result: null,
  };
}

function liveClockSource(feed: LiveRaceFeed) {
  const frameDt = feed.header.sampleEvery / feed.header.tickHz;
  return {
    get broadcastStartMs() {
      return feed.broadcastStartMs;
    },
    get liveEdgeFrame() {
      return feed.liveEdgeFrame;
    },
    frameDt,
  };
}

export function RaceViewer(props: RaceViewerProps) {
  const {
    replay,
    feed,
    startAtMs,
    autoplay = true,
    highlightHorseId,
    onFinished,
    className,
    height,
    quality = "auto",
    debug = false,
    initialTimeSec,
    initialCamera,
    artBaseUrl = "/art",
    pixelated = false,
  } = props;

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HD2DSceneT | null>(null);
  const clockRef = useRef<Clock | null>(null);
  // A finished race is known up front for `replay` (or a feed that is already final).
  const initialFinal = useMemo(() => replay ?? feed?.final ?? null, [replay, feed]);
  const [final, setFinal] = useState<RaceReplay | null>(initialFinal);
  const finalRef = useRef<RaceReplay | null>(initialFinal);
  const [replayBadge, setReplayBadge] = useState(false);
  const live = useMemo(() => (feed ? liveData(feed) : null), [feed]);
  const info = final ?? live;
  if (!info) throw new Error("RaceViewer needs a `replay` or a `feed`");
  const horses = info.horses;
  const hasHighlight = !!highlightHorseId && horses.some((h) => h.horseId === highlightHorseId);
  const [camera, setCamera] = useState<CameraMode>(initialCamera ?? "director");
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const finishedFired = useRef(false);
  const scrubbing = useRef<{ wasPlaying: boolean } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [hud, setHud] = useState<HudState | null>(null);
  const [debugText, setDebugText] = useState("");
  const qualityRef = useRef<RenderQuality>("high");
  const frameFlags = useRef({ frozen: false, slowmo: false });
  const duration = useMemo(() => (final ? replayTiming(final).duration : 0), [final]);

  useEffect(() => injectViewerCss(), []);

  // Playback clock: rebuilt when the race source or its timing inputs change.
  useEffect(() => {
    finalRef.current = initialFinal;
    setFinal(initialFinal);
    setReplayBadge(false);
    if (initialFinal) {
      const start = feed ? feed.broadcastStartMs : startAtMs;
      clockRef.current = new PlaybackClock(initialFinal, { startAtMs: start, autoplay, initialTimeSec });
    } else if (feed) {
      clockRef.current = new LiveClock(liveClockSource(feed), autoplay);
    }
    finishedFired.current = false;
    setDismissed(false);
  }, [initialFinal, feed, startAtMs, autoplay, initialTimeSec]);

  const publish = useCallback(() => {
    const clock = clockRef.current;
    const scene = sceneRef.current;
    if (!clock) return;
    const samples = scene ? [...scene.lastSamples] : [];
    const t = clock.time;
    const src: TimelineSource | null = finalRef.current ?? live;
    if (!src) return;
    const isLive = clock instanceof LiveClock;
    const laneMax = Math.max(1, ("laneCount" in src ? (src as { laneCount: number }).laneCount : 8) - 1);
    let leadIdx = -1;
    for (const s of samples) if (leadIdx < 0 || s.x > samples[leadIdx]!.x) leadIdx = samples.indexOf(s);
    const dots: MinimapDot[] = samples.map((s, i) => {
      const hz = src.horses[s.index]!;
      return {
        id: s.horseId,
        p: s.x / src.trackLengthMm,
        lane: Math.min(1, Math.max(0, s.lane / laneMax)),
        primary: hz.appearance.silks.primary,
        secondary: hz.appearance.silks.secondary,
        me: s.horseId === highlightHorseId,
        leader: i === leadIdx && t > 0,
      };
    });
    setHud({
      dots,
      pip: !!scene?.pipShown,
      mode: isLive ? "live" : "replay",
      scrubMax: isLive ? Math.max(0, clock.edge()) : clock.duration,
      buffering: isLive ? clock.buffering : false,
      time: t,
      playing: clock.playing || clock.live,
      live: clock.live,
      rate: clock.rate,
      ended: clock.ended,
      frozen: frameFlags.current.frozen,
      slowmo: frameFlags.current.slowmo,
      canGoLive: clock.canGoLive(),
      toGoM: samples.length ? distanceToGoM(src, samples) : src.trackLengthMm / 1000,
      standings: samples.length ? standingsAt(src, samples) : [],
      commentary: t >= 0 ? (commentaryAt(src, isLive ? t : Math.min(t, clock.duration + 4), 6, 1)[0] ?? null) : null,
    });
  }, [live, highlightHorseId]);

  // Three.js HD-2D scene. StrictMode-safe: the async init checks `disposed` after every await.
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const [T, { HD2DScene }, { createRigFactory }, { loadArt }] = await Promise.all([
        import("three"),
        import("./three/HD2DScene"),
        import("./three/horseRig"),
        import("./three/art"),
      ]);
      const stage = stageRef.current;
      const host = canvasHostRef.current;
      if (disposed || !stage || !host) return;
      const art = await loadArt(artBaseUrl);
      if (disposed) return;
      const rigs = await createRigFactory(T, artBaseUrl, art);
      if (disposed) {
        rigs.factory.dispose();
        return;
      }
      const w0 = Math.max(1, stage.clientWidth);
      const h0 = Math.max(1, stage.clientHeight);
      const q: RenderQuality = quality === "auto" ? autoQuality(w0) : quality;
      qualityRef.current = q;
      let scene: HD2DSceneT;
      try {
        scene = new HD2DScene(T, (initialFinal ?? live)!, { quality: q, highlightHorseId, pixelated, art, rigs: rigs.factory, rigKind: rigs.kind });
      } catch (err) {
        rigs.factory.dispose();
        throw err;
      }
      host.appendChild(scene.canvas);
      scene.resize(w0, h0);
      sceneRef.current = scene;
      const artNote = `${rigs.kind}${art.manifest ? ` +${art.images.size} art` : " (code art)"}`;

      let hudAcc = 1;
      let dbgAcc = 0;
      let frames = 0;
      let workMs = 0;
      let dtSum = 0;
      let warm = 0;
      let slowFrames = 0;
      let raf = 0;
      let last = performance.now();
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const deltaMS = Math.min(250, Math.max(0, now - last));
        last = now;
        const clock = clockRef.current;
        if (!clock) return;
        const t0 = performance.now();
        const dt = deltaMS / 1000;
        // Live -> final: once the result exists and the playhead has reached the end of
        // the broadcast, hand the scene the official replay and run the finish flow.
        if (clock instanceof LiveClock && feed?.final && clock.time >= clock.dataEdge() - feed.header.sampleEvery / feed.header.tickHz - 1e-6) {
          const fin = feed.final;
          scene.setFinal(fin);
          finalRef.current = fin;
          setFinal(fin);
          const slowFrom = fin.result.photoFinish ? timeLeaderReaches(fin, 14) : null;
          const t0 = slowFrom !== null ? Math.max(0, slowFrom - 1.5) : clock.time;
          clockRef.current = new PlaybackClock(fin, { autoplay: true, initialTimeSec: t0 });
          setReplayBadge(slowFrom !== null);
          return;
        }
        const fr = clock.tick(dt);
        scene.render({ time: fr.time, realDt: dt, camera: cameraRef.current, frozen: fr.frozen, flash: fr.flash });
        const work = performance.now() - t0;

        if (clock instanceof PlaybackClock && clock.ended && !finishedFired.current) {
          finishedFired.current = true;
          onFinishedRef.current?.();
        }
        hudAcc += dt;
        const flags = frameFlags.current;
        if (hudAcc >= 0.1 || fr.frozen !== flags.frozen || fr.slowmo !== flags.slowmo) {
          hudAcc = 0;
          flags.frozen = fr.frozen;
          flags.slowmo = fr.slowmo;
          publish();
        }

        // Perf: auto-downgrade when the device can't hold ~40 fps.
        frames++;
        workMs += work;
        dtSum += deltaMS;
        warm += dt;
        if (quality === "auto" && qualityRef.current === "high" && warm > 2) {
          slowFrames = deltaMS > 25 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
          if (slowFrames > 90) {
            qualityRef.current = "low";
            scene.setQuality("low");
          }
        }
        dbgAcc += dt;
        if (debug && dbgAcc >= 0.5) {
          const cam = scene.cameraInfo;
          setDebugText(
            `${Math.round((1000 * frames) / Math.max(1, dtSum))} fps  ${(workMs / frames).toFixed(1)} ms cpu\n` +
              `${qualityRef.current}  ${artNote}  t=${fr.time.toFixed(2)}s\n` +
              `cam ${cam.shot} x=${cam.x.toFixed(1)}m`,
          );
          dbgAcc = 0;
          frames = 0;
          workMs = 0;
          dtSum = 0;
        }
      };
      raf = requestAnimationFrame(frame);

      const ro = new ResizeObserver(() => {
        const w = Math.max(1, stage.clientWidth);
        const h = Math.max(1, stage.clientHeight);
        scene.resize(w, h);
        setWidth(w);
      });
      ro.observe(stage);
      setWidth(w0);
      setReady(true);

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        sceneRef.current = null;
        scene.destroy();
        scene.canvas.remove();
      };
    })().catch((err) => {
      console.error("[RaceViewer] failed to start renderer", err);
      setFailed(true);
    });
    return () => {
      disposed = true;
      cleanup();
      setReady(false);
    };
    // quality changes are applied live below; debug only gates the overlay text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFinal, live, highlightHorseId, artBaseUrl, pixelated]);

  // (Live feed updates need no subscription here: the render loop reads the growing
  // frames/events/liveEdgeFrame directly every frame and polls for `final`.)

  // Explicit quality changes after mount.
  useEffect(() => {
    if (quality === "auto" || !sceneRef.current) return;
    qualityRef.current = quality;
    sceneRef.current.setQuality(quality);
  }, [quality, ready]);

  const act = (fn: (c: Clock) => void) => {
    const c = clockRef.current;
    if (!c) return;
    fn(c);
    publish();
  };
  const onToggle = () => act((c) => c.toggle());
  const onRestart = () => {
    setDismissed(false);
    act((c) => c.restart());
  };
  const onSeek = (t: number) => {
    if (!final || t < duration) setDismissed(false);
    act((c) => c.seek(t));
  };
  const onScrubStart = () => {
    const c = clockRef.current;
    if (!c) return;
    scrubbing.current = { wasPlaying: c.playing || c.live };
    c.pause();
  };
  const onScrubEnd = () => {
    const c = clockRef.current;
    const s = scrubbing.current;
    scrubbing.current = null;
    if (c && s?.wasPlaying && !(c instanceof PlaybackClock && c.ended)) {
      c.playing = true;
      publish();
    }
  };
  const onRate = (r: number) => act((c) => c.setRate(r));
  const onLive = () => {
    setDismissed(false);
    act((c) => c.goLive());
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT" && e.key !== " ") return;
    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      onToggle();
    } else if (e.key === "ArrowRight") act((c) => c.seek(c.time + 5));
    else if (e.key === "ArrowLeft") act((c) => c.seek(c.time - 5));
  };

  const narrow = width > 0 && width < NARROW_PX;
  const stageStyle: CSSProperties = height !== undefined ? { height } : { aspectRatio: "16 / 9", minHeight: 320 };
  const h = hud;
  const showResults = !!h && !!final && h.mode === "replay" && h.ended && !dismissed && !h.frozen;
  const isLive = h?.mode === "live";
  const pip = pipRect(width, stageRef.current?.clientHeight ?? 0);
  const furlongs = useMemo(() => {
    const L = info.trackLengthMm;
    const out: number[] = [];
    for (let i = 1; L - i * FURLONG_MM > 0; i++) out.push((L - i * FURLONG_MM) / L);
    return out;
  }, [info.trackLengthMm]);
  const maxStandings = narrow ? 3 : width < 900 ? 6 : 16;

  return (
    <div className={`rv-root${narrow ? " rv-narrow" : ""}${className ? ` ${className}` : ""}`} tabIndex={0} onKeyDown={onKey} data-race-viewer="">
      <div className="rv-stage" ref={stageRef} style={stageStyle}>
        <div className="rv-canvas" ref={canvasHostRef} />
        {!ready && <div className="rv-loading">{failed ? "3D view unavailable on this device" : "Loading race…"}</div>}
        {h && (
          <TopHud
            race={info.race}
            winningTimeUs={final && h.mode === "replay" ? final.result.winningTimeUs : null}
            trackLengthM={info.trackLengthMm / 1000}
            raceTime={h.time}
            toGoM={h.toGoM}
            standings={h.standings}
            maxStandings={maxStandings}
            commentary={h.frozen || showResults || narrow ? null : h.commentary}
            highlightHorseId={hasHighlight ? highlightHorseId : undefined}
          />
        )}
        {h && narrow && h.commentary && !h.frozen && !showResults && (
          <div className="rv-ticker-low">
            <Ticker key={`${h.commentary.tick}-${h.commentary.type}`} event={h.commentary} />
          </div>
        )}
        {h && h.time < 0 && <Countdown seconds={-h.time} live={h.live} />}
        {h?.frozen && <PhotoStamp />}
        {h && !showResults && h.dots.length > 0 && <Minimap dots={h.dots} furlongs={furlongs} />}
        {h?.pip && pip && (
          <div className="rv-pip" style={{ right: pip.right, bottom: pip.bottom, width: pip.w, height: pip.h }}>
            <span>My horse</span>
          </div>
        )}
        {h?.slowmo && !h.frozen && <div className="rv-badge">SLOW-MO</div>}
        {h && replayBadge && h.mode === "replay" && !h.ended && !h.slowmo && !h.frozen && <div className="rv-badge">PHOTO REPLAY</div>}
        {h?.buffering && <div className="rv-badge rv-badge-buffer">BUFFERING</div>}
        {debug && debugText && (
          <div className="rv-debug" data-rv-debug="">
            {debugText}
          </div>
        )}
        {showResults && final && <ResultsCard replay={final} highlightHorseId={highlightHorseId} onClose={() => setDismissed(true)} onReplay={onRestart} />}
        {h && (
          <Controls
            narrow={narrow}
            playing={h.playing}
            rate={h.rate}
            time={h.time}
            duration={h.scrubMax}
            liveMode={isLive}
            camera={camera}
            hasHighlight={hasHighlight}
            showLive={startAtMs !== undefined || isLive}
            live={h.live}
            canGoLive={h.canGoLive}
            onToggle={onToggle}
            onRestart={onRestart}
            onRate={onRate}
            onSeek={onSeek}
            onScrubStart={onScrubStart}
            onScrubEnd={onScrubEnd}
            onCamera={setCamera}
            onLive={onLive}
          />
        )}
      </div>
    </div>
  );
}
