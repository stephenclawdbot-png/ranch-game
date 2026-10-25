"use client";
/**
 * <RaceViewer> — plays back a stored RaceReplay as an HD 2.5D race.
 *
 * Pixi is imported dynamically inside an effect, so this module is safe to import
 * from server components / SSR (it renders an empty stage until the client mounts).
 * The viewer never decides anything: positions come from replay frames, the
 * winner and finishing order from replay.result.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { RaceEvent, RaceReplay } from "@thoroughbred/shared";
import type { AssetManifest } from "@thoroughbred/art-pipeline";
import { PlaybackClock } from "./playback";
import { replayTiming } from "./sampleReplay";
import { commentaryAt, distanceToGoM, standingsAt, type StandingRow } from "./timeline";
import type { CameraMode, QualitySetting, RenderQuality } from "./types";
import { Controls, Countdown, PhotoStamp, ResultsCard, Ticker, TopHud } from "./hud/Hud";
import { injectViewerCss } from "./hud/styles";
import type { RaceScene } from "./scene/RaceScene";

export interface RaceViewerProps {
  replay: RaceReplay;
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
  /** Asset manifest: approved sprite sheets replace the procedural art. */
  manifest?: AssetManifest;
}

interface HudState {
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

export function RaceViewer(props: RaceViewerProps) {
  const {
    replay,
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
    manifest,
  } = props;

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RaceScene | null>(null);
  const clockRef = useRef<PlaybackClock | null>(null);
  const hasHighlight = !!highlightHorseId && replay.horses.some((h) => h.horseId === highlightHorseId);
  const [camera, setCamera] = useState<CameraMode>(initialCamera ?? (hasHighlight ? "leader" : "leader"));
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const finishedFired = useRef(false);
  const scrubbing = useRef<{ wasPlaying: boolean } | null>(null);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [hud, setHud] = useState<HudState | null>(null);
  const [debugText, setDebugText] = useState("");
  const qualityRef = useRef<RenderQuality>("high");
  const frameFlags = useRef({ frozen: false, slowmo: false });
  const duration = useMemo(() => replayTiming(replay).duration, [replay]);

  useEffect(() => injectViewerCss(), []);

  // Playback clock: rebuilt when the replay or its timing inputs change.
  useEffect(() => {
    clockRef.current = new PlaybackClock(replay, { startAtMs, autoplay, initialTimeSec });
    finishedFired.current = false;
    setDismissed(false);
  }, [replay, startAtMs, autoplay, initialTimeSec]);

  const publish = useCallback(() => {
    const clock = clockRef.current;
    const scene = sceneRef.current;
    if (!clock) return;
    const samples = scene ? [...scene.lastSamples] : [];
    const t = clock.time;
    setHud({
      time: t,
      playing: clock.playing || clock.live,
      live: clock.live,
      rate: clock.rate,
      ended: clock.ended,
      frozen: frameFlags.current.frozen,
      slowmo: frameFlags.current.slowmo,
      canGoLive: clock.canGoLive(),
      toGoM: samples.length ? distanceToGoM(replay, samples) : replay.trackLengthMm / 1000,
      standings: samples.length ? standingsAt(replay, samples) : [],
      commentary: t >= 0 ? (commentaryAt(replay, Math.min(t, duration + 4), 6, 1)[0] ?? null) : null,
    });
  }, [replay, duration]);

  // Pixi app + scene. StrictMode-safe: the async init checks `disposed` after every await.
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const [PIXI, { RaceScene }] = await Promise.all([import("pixi.js"), import("./scene/RaceScene")]);
      const stage = stageRef.current;
      const host = canvasHostRef.current;
      if (disposed || !stage || !host) return;
      const w0 = Math.max(1, stage.clientWidth);
      const h0 = Math.max(1, stage.clientHeight);
      const q: RenderQuality = quality === "auto" ? autoQuality(w0) : quality;
      qualityRef.current = q;
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const app = new PIXI.Application();
      await app.init({
        width: w0,
        height: h0,
        antialias: q === "high",
        resolution: q === "high" ? Math.min(dpr, 2) : Math.min(dpr, 1.5),
        autoDensity: true,
        background: "#0f1d15",
        preference: "webgl",
        powerPreference: "high-performance",
      });
      if (disposed) {
        app.destroy(true, { children: true });
        return;
      }
      host.appendChild(app.canvas);
      const scene = new RaceScene(app, replay, { quality: q, highlightHorseId, manifest });
      scene.resize(w0, h0);
      sceneRef.current = scene;

      let hudAcc = 1;
      let dbgAcc = 0;
      let frames = 0;
      let workMs = 0;
      let dtSum = 0;
      let warm = 0;
      let slowFrames = 0;
      const onTick = (tk: { deltaMS: number }) => {
        const clock = clockRef.current;
        if (!clock) return;
        const t0 = performance.now();
        const dt = tk.deltaMS / 1000;
        const fr = clock.tick(dt);
        scene.render({ time: fr.time, realDt: dt, camera: cameraRef.current, frozen: fr.frozen, flash: fr.flash });
        const work = performance.now() - t0;

        if (clock.ended && !finishedFired.current) {
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
        dtSum += tk.deltaMS;
        warm += dt;
        if (quality === "auto" && qualityRef.current === "high" && warm > 2) {
          slowFrames = tk.deltaMS > 25 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
          if (slowFrames > 90) {
            qualityRef.current = "low";
            scene.setQuality("low");
            app.renderer.resolution = 1;
            app.renderer.resize(stage.clientWidth, stage.clientHeight, 1);
          }
        }
        dbgAcc += dt;
        if (debug && dbgAcc >= 0.5) {
          const cam = scene.cameraInfo;
          setDebugText(
            `${Math.round((1000 * frames) / dtSum)} fps  ${(workMs / frames).toFixed(1)} ms js  ${(renderMs / frames).toFixed(1)} ms draw\n` +
              `${qualityRef.current} @${app.renderer.resolution.toFixed(2)}x  t=${fr.time.toFixed(2)}s\n` +
              `cam ${cam.x.toFixed(1)}m  z${cam.zoom.toFixed(2)}`,
          );
          dbgAcc = 0;
          frames = 0;
          workMs = 0;
          renderMs = 0;
          dtSum = 0;
        }
      };
      app.ticker.add(onTick);
      // Bracket Pixi's own render (UPDATE_PRIORITY.LOW = -25) to measure GPU-submit time.
      let renderStart = 0;
      let renderMs = 0;
      const preRender = () => {
        renderStart = performance.now();
      };
      const postRender = () => {
        renderMs += performance.now() - renderStart;
      };
      app.ticker.add(preRender, undefined, -24);
      app.ticker.add(postRender, undefined, -26);

      const ro = new ResizeObserver(() => {
        const w = Math.max(1, stage.clientWidth);
        const h = Math.max(1, stage.clientHeight);
        app.renderer.resize(w, h);
        scene.resize(w, h);
        setWidth(w);
      });
      ro.observe(stage);
      setWidth(w0);
      setReady(true);

      cleanup = () => {
        ro.disconnect();
        app.ticker.remove(onTick);
        app.ticker.remove(preRender);
        app.ticker.remove(postRender);
        sceneRef.current = null;
        scene.destroy();
        app.destroy(true, { children: true });
      };
    })().catch((err) => {
      console.error("[RaceViewer] failed to start renderer", err);
    });
    return () => {
      disposed = true;
      cleanup();
      setReady(false);
    };
    // quality changes are applied live below; debug only gates the overlay text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay, highlightHorseId, manifest]);

  // Explicit quality changes after mount.
  useEffect(() => {
    if (quality === "auto" || !sceneRef.current) return;
    qualityRef.current = quality;
    sceneRef.current.setQuality(quality);
  }, [quality, ready]);

  const act = (fn: (c: PlaybackClock) => void) => {
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
    if (t < duration) setDismissed(false);
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
    if (c && s?.wasPlaying && !c.ended) {
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
  const showResults = !!h && h.ended && !dismissed && !h.frozen;
  const maxStandings = narrow ? 3 : width < 900 ? 6 : 16;

  return (
    <div className={`rv-root${narrow ? " rv-narrow" : ""}${className ? ` ${className}` : ""}`} tabIndex={0} onKeyDown={onKey} data-race-viewer="">
      <div className="rv-stage" ref={stageRef} style={stageStyle}>
        <div className="rv-canvas" ref={canvasHostRef} />
        {!ready && <div className="rv-loading">Loading race…</div>}
        {h && (
          <TopHud
            replay={replay}
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
        {h?.slowmo && !h.frozen && <div className="rv-badge">SLOW-MO</div>}
        {debug && debugText && (
          <div className="rv-debug" data-rv-debug="">
            {debugText}
          </div>
        )}
        {showResults && <ResultsCard replay={replay} highlightHorseId={highlightHorseId} onClose={() => setDismissed(true)} onReplay={onRestart} />}
        {h && (
          <Controls
            narrow={narrow}
            playing={h.playing}
            rate={h.rate}
            time={h.time}
            duration={duration}
            camera={camera}
            hasHighlight={hasHighlight}
            showLive={startAtMs !== undefined}
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
