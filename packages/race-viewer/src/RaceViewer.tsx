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
import type { RaceEvent, RaceReplay } from "@thoroughbred/shared";
import { PlaybackClock } from "./playback";
import { replayTiming } from "./sampleReplay";
import { commentaryAt, distanceToGoM, standingsAt, type StandingRow } from "./timeline";
import type { CameraMode, QualitySetting, RenderQuality } from "./types";
import { Controls, Countdown, PhotoStamp, ResultsCard, Ticker, TopHud } from "./hud/Hud";
import { injectViewerCss } from "./hud/styles";
import type { HD2DScene as HD2DSceneT } from "./three/HD2DScene";

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
  /**
   * Public art root holding manifest.json (default "/art"). Missing / 404 art falls
   * back to code-drawn pixel art. Pass null to skip the fetch.
   */
  artBaseUrl?: string | null;
  /** Render at a low internal resolution, upscaled with nearest filtering. */
  pixelated?: boolean;
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
    artBaseUrl = "/art",
    pixelated = false,
  } = props;

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HD2DSceneT | null>(null);
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
  const [failed, setFailed] = useState(false);
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
        scene = new HD2DScene(T, replay, { quality: q, highlightHorseId, pixelated, art, rigs: rigs.factory, rigKind: rigs.kind });
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
  }, [replay, highlightHorseId, artBaseUrl, pixelated]);

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
        {!ready && <div className="rv-loading">{failed ? "3D view unavailable on this device" : "Loading race…"}</div>}
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
