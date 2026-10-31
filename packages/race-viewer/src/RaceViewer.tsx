"use client";
/**
 * <RaceViewer> — plays back a stored RaceReplay as an HD 2.5D race.
 *
 * Three.js is imported dynamically inside an effect, so this module is safe to import
 * from server components / SSR (it renders an empty stage until the client mounts).
 * The viewer never decides anything: positions come from replay frames, the
 * winner and finishing order from replay.result.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { LiveRaceFeed, RaceReplay } from "@thoroughbred/shared";
import { LiveClock, PlaybackClock, PRE_ROLL_SEC, timeLeaderReaches } from "./playback";
import { PRE_OFF_SEC, loadingAt, preOffPlan, preOffStep } from "./stage/preoff";
import { PreOffOverlay, type PreOffHud } from "./hud/PreOff";
import { Director } from "./director";
import { buildRaceStage } from "./stage/buildRaceStage";
import { injuredFromEvents } from "./stage/motion";
import { perfReport, type PerfReport } from "./perfReport";
import { replayTiming } from "./sampleReplay";
import { distanceToGoM, standingsAt, type StandingRow, type TimelineSource } from "./timeline";
import { pipRect, type CameraMode, type QualitySetting, type RenderQuality, type ViewMode } from "./types";
import { FRAME_FIELD, FRAME_STRIDE, FURLONG_MM } from "@thoroughbred/shared";
import { BattleGraphic, CallTicker, Controls, Countdown, Minimap, PhotoStamp, ResultsCard, TopHud, type MinimapDot } from "./hud/Hud";
import { battleAt, distanceMarker, type Battle, type DistanceMarker } from "./hud/battle";
import { RaceCallFeed, callLineAt } from "./call/ticker";
import { whatIfBadge, whatIfCall, whatIfFlags } from "./whatIf";
import type { CallLine } from "./call/buildRaceCall";
import { finalePlan, REPLAY_FROM_M, type FinalePlan, type FinaleStepKind } from "./finale/plan";
import { FinaleRunner, type FinaleState } from "./finale/runner";
import { officialHandoff } from "./finale/live";
import { FinaleOverlay, checkSeal, type PortraitRenderer, type RunnerConnections, type SealState } from "./finale/FinaleOverlay";
import type { PhotoArt } from "./photo/raster";
import type { CourseMapRunner } from "./hud/CourseMap";
import { CourseMapPanel } from "./hud/CourseMapPanel";
import { injectViewerCss } from "./hud/styles";
import { ClipShareButton } from "./clip/ClipShareButton";
import { canShareClip } from "./clip/plan";
import type { CourseInfo } from "./course/geometry";
import type { HD2DScene as HD2DSceneT, SceneRaceData } from "./three/HD2DScene";
import type { TracksideScene as TracksideSceneT } from "./trackside/TracksideScene";

type AnyScene = HD2DSceneT | TracksideSceneT;
const VIEW_KEY = "rv:view";
const FOLLOW_KEY = "rv:follow";
/** "skip": this viewer skips the build-up before the off (remembered per browser). */
const PREOFF_KEY = "rv:preoff";

/** Does this viewer skip the build-up (their remembered choice, or reduced motion)? */
function preOffSkipped(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return true;
  } catch {
    /* no matchMedia */
  }
  try {
    return window.localStorage.getItem(PREOFF_KEY) === "skip";
  } catch {
    return false;
  }
}

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
  /**
   * Real-device frame timings, at most once per mounted viewer: after 20 s of playback
   * with ≥ 300 frames, or on unmount if ≥ 150 frames were drawn. Never depends on `debug`.
   */
  onPerfReport?: (r: PerfReport) => void;
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
  /** Show the race name / chips inside the stage (default true). */
  hudTitle?: boolean;
  /**
   * Show the in-canvas results card after the finish (default true). When false the
   * viewer holds the finish shot and unlocks replay controls; onFinished still fires.
   */
  resultsCard?: boolean;
  /**
   * "trackside" (default): the side-on HD-2D diorama view (whole-field camera keeps every
   * runner in frame; "Follow mine" locks the close-up on your horse — rv:follow).
   * "classic": the 3D broadcast with the TV director. When omitted, `?view=classic` /
   * `?view=trackside` on the page URL, then the viewer's last choice (localStorage), decide.
   */
  view?: ViewMode;
  /**
   * The racecourse (`courseByName(conditions.track)` from @thoroughbred/game-core): its
   * scenery, finish gradient and the overhead course map in the HUD. Omitted or null:
   * the default scenery and no course map.
   */
  course?: CourseInfo | null;
  /**
   * Horses that suffered an injury in the race: after the line they are pulled up (pull-up
   * strip) instead of easing down. Default: the replay's injury events. Only pass what the
   * broadcast may already show (never before the race is over on a live broadcast).
   */
  injuredHorseIds?: readonly string[];
  /**
   * The viewer's own horses (the race call says "your X"; each gets its own card in the
   * finale even outside the places). Default: `highlightHorseId`.
   */
  mineHorseIds?: readonly string[];
  /** Stable name / photo and jockey line per horseId, for the finale's cards (from the racecard). */
  connections?: Readonly<Record<string, RunnerConnections>>;
  /** The public site host burned into "Share clip" videos as the wordmark URL (from the app's PUBLIC_BASE_URL). */
  siteHost?: string | null;
  /** Draws a horse's genetic 3/4 portrait for the finale's cards (loaded only when a card shows). */
  renderPortrait?: PortraitRenderer;
  /**
   * The finish as an event after the line (default true): photograph and verdict, slow-motion
   * replay, weighed in, the placed horses' cards. Only ever from the official result.
   */
  finale?: boolean;
  /** The finale started ("running") or ended / was skipped ("done"). */
  onFinale?: (state: "running" | "done") => void;
  /**
   * The build-up before the off (stage/preoff.ts): the paddock, going down to post, loading the
   * stalls one by one, then the off; ~24 s, from the locked field and the clock only. Default: on
   * for a live broadcast (it fits the time before the off; a late arrival joins where the clock
   * is), off for a replay. Skippable with one tap (remembered per viewer); reduced motion skips it.
   */
  preOff?: boolean;
  /** The paddock scene shown during the parade (the host's own); default: a runner list. */
  paddock?: ReactNode;
  /**
   * "What if" mode (whatIf.ts): the replay is a counterfactual re-run, never a result. A "WHAT IF"
   * badge stays on the stage; no finale, no results card, and no photograph or result call.
   */
  whatIf?: boolean;
  /** The stage badge in what-if mode, for other unofficial races ("Match race · unofficial"); default "What if · not official". */
  whatIfBadge?: string;
}

/** The finale's step as the overlay renders it. */
interface FinaleView {
  index: number;
  kind: FinaleStepKind;
}

/** Minimap dots as course-map runners (distance covered from each dot's share of the race). */
function mapRunners(dots: readonly MinimapDot[], distanceM: number): CourseMapRunner[] {
  return dots.map((d) => ({ id: d.id, coveredM: d.p * distanceM, color: d.primary, me: d.me, leader: d.leader }));
}

/** The pixel rig is opt-in (`?rig=1` / NEXT_PUBLIC_PIXEL_RIG=1, three/horseRig.ts). */
function rigOptIn(): boolean {
  if (process.env.NEXT_PUBLIC_PIXEL_RIG === "1") return true;
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("rig") === "1";
  } catch {
    return false;
  }
}

/** `?view=` on the page URL, then the remembered choice, then the default (trackside). */
function resolveView(): ViewMode {
  if (typeof window === "undefined") return "trackside";
  try {
    const q = new URLSearchParams(window.location.search).get("view");
    if (q === "classic" || q === "broadcast" || q === "3d") return "classic";
    if (q === "trackside") return "trackside";
  } catch {
    /* no URL */
  }
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    if (v === "classic" || v === "trackside") return v;
  } catch {
    /* storage blocked */
  }
  return "trackside";
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
  /** The run-out (horses easing down after the line) is over. */
  settled: boolean;
  frozen: boolean;
  slowmo: boolean;
  canGoLive: boolean;
  toGoM: number;
  standings: StandingRow[];
  /** The race call line at the playhead. */
  call: CallLine | null;
  marker: DistanceMarker | null;
  battle: Battle | null;
  /** Inside the final furlong: the HUD clears down to essentials. */
  ff: boolean;
  /** The build-up before the off, while it plays. */
  pre: PreOffHud | null;
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
  const L = feed.header.trackLengthMm;
  const n = feed.header.horses.length;
  return {
    get broadcastStartMs() {
      return feed.broadcastStartMs;
    },
    get liveEdgeFrame() {
      return feed.liveEdgeFrame;
    },
    frameDt,
    /** Every runner is home in the frames received: the clock may run on (run-out). */
    get allFinished() {
      const last = feed.frames[feed.frames.length - 1];
      if (!last || n === 0) return false;
      for (let h = 0; h < n; h++) if ((last[h * FRAME_STRIDE + FRAME_FIELD.distanceMm] ?? 0) < L) return false;
      return true;
    },
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
    onPerfReport,
    className,
    height,
    quality = "auto",
    debug = false,
    initialTimeSec,
    initialCamera,
    artBaseUrl = "/art",
    pixelated = false,
    hudTitle = true,
    resultsCard: resultsCardWanted = true,
    course = null,
    injuredHorseIds,
    mineHorseIds,
    connections,
    siteHost = null,
    renderPortrait,
    finale: finaleWanted = true,
    onFinale,
    paddock,
    whatIf = false,
  } = props;
  const { finale: finaleOn, resultsCard } = whatIfFlags(whatIf, { finale: finaleWanted, resultsCard: resultsCardWanted });
  const preOffWanted = props.preOff ?? !!feed;
  // Resolved on the client only (URL / localStorage), so SSR and hydration agree.
  const [view, setViewState] = useState<ViewMode | null>(props.view ?? null);
  useEffect(() => {
    setViewState(props.view ?? resolveView());
  }, [props.view]);
  const setView = useCallback((v: ViewMode) => {
    setViewState(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
  }, []);

  // Trackside "Follow mine" camera. Default whole field; the remembered choice is applied
  // on the client only so SSR and hydration agree.
  const [follow, setFollowState] = useState(false);
  useEffect(() => {
    try {
      setFollowState(window.localStorage.getItem(FOLLOW_KEY) === "1");
    } catch {
      /* storage blocked */
    }
  }, []);
  const setFollow = useCallback((f: boolean) => {
    setFollowState(f);
    try {
      window.localStorage.setItem(FOLLOW_KEY, f ? "1" : "0");
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
  }, []);
  const followRef = useRef(follow);
  followRef.current = follow;

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<AnyScene | null>(null);
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
  const narrowRef = useRef(false);
  const viewRef = useRef<ViewMode | null>(props.view ?? null);
  viewRef.current = view;
  const onPerfReportRef = useRef(onPerfReport);
  onPerfReportRef.current = onPerfReport;
  // Perf samples live across scene rebuilds (view switch, art change): one report per mount.
  const downgradedRef = useRef(false);
  const perfRef = useRef({ ft: new Float32Array(240), n: 0, playedMs: 0, reported: false });
  const duration = useMemo(() => (final ? replayTiming(final).duration : 0), [final]);
  // ONE stage (course, light, landmarks) and ONE director for both views: switching views
  // keeps the same picture and the same shot subject.
  const stageData = initialFinal ?? live!;
  const raceStage = useMemo(() => buildRaceStage(course, stageData), [course, stageData]);
  const injuredKey = injuredHorseIds?.join(",") ?? "";
  const injured = useMemo(() => (injuredHorseIds ? new Set(injuredHorseIds) : injuredFromEvents(stageData.events)), [injuredKey, stageData]); // eslint-disable-line react-hooks/exhaustive-deps
  // The build-up before the off: from the locked field (stalls) and the clock alone.
  const preOffPlanned = useMemo(() => preOffPlan(stageData.horses, stageData.trackLengthMm / 1000, stageData.laneCount), [stageData]);
  const [preSkip, setPreSkip] = useState(false);
  useEffect(() => setPreSkip(preOffSkipped()), []);
  const preOffOn = preOffWanted && !preSkip;
  const preOffRef = useRef(preOffOn ? preOffPlanned : null);
  preOffRef.current = preOffOn ? preOffPlanned : null;
  useEffect(() => {
    const sc = sceneRef.current;
    if (sc) sc.setPreOff(preOffOn ? preOffPlanned : null);
  }, [preOffOn, preOffPlanned, ready]);
  const skipPreOff = useCallback(() => {
    setPreSkip(true);
    try {
      window.localStorage.setItem(PREOFF_KEY, "skip");
    } catch {
      /* storage blocked: skipped for this page only */
    }
    // A replay jumps to the stalls; a live broadcast waits for the real off at the stalls.
    const c = clockRef.current;
    if (c instanceof PlaybackClock && c.time < -PRE_ROLL_SEC) c.time = -PRE_ROLL_SEC;
  }, []);
  const watchPreOff = useCallback(() => {
    setPreSkip(false);
    try {
      window.localStorage.removeItem(PREOFF_KEY);
    } catch {
      /* storage blocked */
    }
  }, []);
  const directorRef = useRef<Director>(new Director());
  useEffect(() => {
    directorRef.current = new Director();
  }, [stageData]);

  useEffect(() => injectViewerCss(), []);

  // ---- The finale (photograph, replay, weighed in, the placed horses' cards) ---------------
  // Built only from an official result: a finished replay, or a live feed's `final` once the
  // playhead has reached the end of the broadcast (finale/live.ts officialHandoff).
  const mineKey = (mineHorseIds ?? (highlightHorseId ? [highlightHorseId] : [])).join(",");
  const mine = useMemo(() => (mineKey ? mineKey.split(",") : []), [mineKey]);
  const finaleRef = useRef(new FinaleRunner());
  const [finaleView, setFinaleView] = useState<FinaleView | null>(null);
  const [finaleState, setFinaleState] = useState<FinaleState>("idle");
  const [seal, setSeal] = useState<SealState>("checking");
  const [photoArt, setPhotoArt] = useState<PhotoArt | null>(null);
  const onFinaleRef = useRef(onFinale);
  onFinaleRef.current = onFinale;
  const planCache = useRef(new WeakMap<RaceReplay, FinalePlan>());
  const planFor = useCallback(
    (fin: RaceReplay): FinalePlan | null => {
      if (!finaleOn) return null;
      let p = planCache.current.get(fin);
      if (!p) {
        p = finalePlan(fin, { mine, replayFrom: timeLeaderReaches(fin, REPLAY_FROM_M) });
        planCache.current.set(fin, p);
      }
      return p;
    },
    [finaleOn, mine],
  );
  // Seal check for "Weighed in" (the browser hashes the revealed seed itself).
  useEffect(() => {
    if (!final) return;
    let live = true;
    setSeal("checking");
    void checkSeal(final).then((s) => live && setSeal(s));
    return () => {
      live = false;
    };
  }, [final]);
  // The photograph's art loads only when a finale with a photo starts.
  const plan = final ? planFor(final) : null;
  useEffect(() => {
    if (!plan?.photo || finaleState !== "running" || photoArt) return;
    let live = true;
    void import("./photo/render").then(({ loadPhotoFinishArt }) =>
      loadPhotoFinishArt(artBaseUrl ?? "/art").then(
        (a) => live && setPhotoArt(a),
        () => undefined,
      ),
    );
    return () => {
      live = false;
    };
  }, [plan, finaleState, photoArt, artBaseUrl]);

  // Race call (the commentary ticker): the whole call for a finished race, or rebuilt from the
  // live frames up to the data edge. Shown only up to the playhead.
  const callFeed = useMemo(
    () =>
      new RaceCallFeed({
        names: Object.fromEntries(stageData.horses.map((h) => [h.horseId, h.name])),
        mine,
        distanceM: stageData.race.distanceM,
        course: course ? { name: course.name, homeStraightM: course.homeStraightM, finishGradientPermille: course.finishGradientPermille } : null,
        going: stageData.race.going,
        seed: stageData.race.id,
      }),
    [stageData, mine, course],
  );
  const markers = useMemo(() => [...raceStage.landmarks.poles, ...raceStage.landmarks.boards], [raceStage]);

  // Playback clock: rebuilt when the race source or its timing inputs change.
  useEffect(() => {
    finalRef.current = initialFinal;
    setFinal(initialFinal);
    setReplayBadge(false);
    if (initialFinal) {
      const start = feed ? feed.broadcastStartMs : startAtMs;
      // A replay with the build-up opens at its start (a viewer who skips it gets the stalls).
      const preStart = props.preOff && start === undefined && initialTimeSec === undefined && autoplay && !preOffSkipped() ? -PRE_OFF_SEC : undefined;
      clockRef.current = new PlaybackClock(initialFinal, { startAtMs: start, autoplay, initialTimeSec: initialTimeSec ?? preStart });
    } else if (feed) {
      clockRef.current = new LiveClock(liveClockSource(feed), autoplay);
    }
    finaleRef.current.setPlan(initialFinal ? planFor(initialFinal) : null, clockRef.current?.time ?? 0);
    finaleViewRef.current = null;
    setFinaleView(null);
    finaleStateRef.current = finaleRef.current.state;
    setFinaleState(finaleRef.current.state);
    finishedFired.current = false;
    setDismissed(false);
  }, [initialFinal, feed, startAtMs, autoplay, initialTimeSec, planFor]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const fin = finalRef.current;
    if (fin) callFeed.update(fin, true, Number.POSITIVE_INFINITY);
    else if (feed) callFeed.update(live!, false, clock instanceof LiveClock ? clock.dataEdge() : t);
    const rate = clock.rate || 1;
    const call = t >= 0 ? callLineAt(whatIf ? whatIfCall(callFeed.lines) : callFeed.lines, t, { minShowSec: (narrowRef.current ? 3 : 2.5) * rate, holdSec: 6 * Math.max(1, rate) }) : null;
    let leadM = 0;
    for (const s of samples) leadM = Math.max(leadM, s.x / 1000);
    const marker = samples.length && t >= 0 ? distanceMarker(markers, leadM, src.trackLengthMm / 1000) : null;
    const finaleOnNow = finaleRef.current.running;
    const plan = preOffRef.current;
    let pre: PreOffHud | null = null;
    if (plan && t < 0) {
      const st = preOffStep(t);
      const ld = loadingAt(plan, t);
      pre = { kind: st.kind, toOff: -t, loaded: ld.loaded, total: ld.total, walking: st.kind === "loading" ? ld.walking : -1 };
    }
    setHud({
      pre,
      call,
      marker,
      battle: finaleOnNow ? null : battleAt(samples, src.trackLengthMm),
      ff: !!marker?.finalFurlong && !finaleOnNow,
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
      settled: clock instanceof PlaybackClock ? clock.time >= clock.runoutEnd - 1e-6 : false,
      frozen: frameFlags.current.frozen,
      slowmo: frameFlags.current.slowmo,
      canGoLive: clock.canGoLive(),
      toGoM: samples.length ? distanceToGoM(src, samples) : src.trackLengthMm / 1000,
      standings: samples.length ? standingsAt(src, samples) : [],
    });
  }, [live, feed, highlightHorseId, callFeed, markers, whatIf]);
  // The render loop outlives a publish/plan rebuild (e.g. the viewer's horses change): it reads these refs.
  const publishRef = useRef(publish);
  publishRef.current = publish;
  const planForRef = useRef(planFor);
  planForRef.current = planFor;
  const finaleViewRef = useRef<FinaleView | null>(null);
  const finaleStateRef = useRef<FinaleState>("idle");

  /** Sends the perf report once (20 s in, or on unmount); only the send allocates. */
  const sendPerfReport = useCallback(() => {
    const perf = perfRef.current;
    const cb = onPerfReportRef.current;
    if (perf.reported || !cb || perf.n === 0) return;
    perf.reported = true;
    cb(perfReport(perf.ft.subarray(0, Math.min(perf.n, perf.ft.length)), qualityRef.current, downgradedRef.current, viewRef.current ?? "trackside"));
  }, []);

  // Three.js HD-2D scene. StrictMode-safe: the async init checks `disposed` after every await.
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    if (!view) return;
    (async () => {
      const [T, { loadArt }] = await Promise.all([import("three"), import("./three/art")]);
      const stage = stageRef.current;
      const host = canvasHostRef.current;
      if (disposed || !stage || !host) return;
      const art = await loadArt(artBaseUrl);
      if (disposed) return;
      const w0 = Math.max(1, stage.clientWidth);
      const h0 = Math.max(1, stage.clientHeight);
      const q: RenderQuality = quality === "auto" ? autoQuality(w0) : quality;
      qualityRef.current = q;
      const data = (initialFinal ?? live)!;
      let scene: AnyScene | null = null;
      let artNote = "";
      if (view === "trackside") {
        try {
          const { TracksideScene } = await import("./trackside/TracksideScene");
          scene = await TracksideScene.create(T, data, { quality: q, highlightHorseId, art, course, stage: raceStage, injured, preOff: preOffRef.current });
          artNote = "trackside";
        } catch (err) {
          console.warn("[RaceViewer] Trackside view unavailable, using the classic view", err);
        }
        if (disposed) {
          scene?.destroy();
          return;
        }
      }
      if (!scene) {
        const [{ HD2DScene }, { createRigFactory }, { loadStageArt, loadTracksideArt, loadFxPalette }] = await Promise.all([
          import("./three/HD2DScene"),
          import("./three/horseRig"),
          import("./trackside/art"),
        ]);
        const [rigs, stageArt, strips, fx] = await Promise.all([
          createRigFactory(T, artBaseUrl, art),
          loadStageArt(art, raceStage),
          // The same palette-index strips as Trackside (same frames, same colours); the
          // pixel rig (?rig=1) keeps its own path.
          rigOptIn() ? Promise.resolve(null) : loadTracksideArt(art).catch(() => null),
          loadFxPalette(art),
        ]);
        if (disposed) {
          rigs.factory.dispose();
          return;
        }
        try {
          scene = new HD2DScene(T, data, { quality: q, highlightHorseId, pixelated, art, rigs: rigs.factory, rigKind: rigs.kind, stage: raceStage, stageArt, strips, fxPalette: fx, injured, preOff: preOffRef.current });
        } catch (err) {
          rigs.factory.dispose();
          throw err;
        }
        artNote = `${strips ? "strips" : rigs.kind}${art.manifest ? ` +${art.images.size} art` : " (code art)"}`;
      }
      const sc: AnyScene = scene;
      host.appendChild(sc.canvas);
      sc.resize(w0, h0);
      // Compile/upload everything now so the race itself never stalls.
      sc.warmup();
      sceneRef.current = sc;
      const hook = debug || (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("rvdebug"));
      if (hook && "debugRects" in sc) {
        // Dev hook: drawn horse rects (stage CSS px) for the all-runners-visible check.
        (window as unknown as { __rvTrackside?: unknown }).__rvTrackside = {
          rects: () => sc.debugRects(),
          stage: () => ({ w: stage.clientWidth, h: stage.clientHeight }),
          camera: () => sc.cameraInfo,
          time: () => clockRef.current?.time ?? 0,
          maxCamStep: () => sc.maxCamStep,
          // Gap markers on screen (true-length chips in squeezed gaps).
          gaps: () => sc.debugGapMarks(),
        };
      }
      if (hook) (window as unknown as { __rvScene?: unknown }).__rvScene = sc;
      if (hook) {
        // Dev hook: put the playhead anywhere, the build-up before the off included (contact sheets).
        (window as unknown as { __rvClock?: unknown }).__rvClock = {
          time: () => clockRef.current?.time ?? 0,
          seek: (t: number) => {
            const c = clockRef.current;
            if (c) c.time = t;
          },
        };
      }
      if (hook) {
        // Dev hook: step through the finale (contact sheets). goto(i, s, pause) shows step i, s seconds in.
        (window as unknown as { __rvFinale?: unknown }).__rvFinale = {
          state: () => finaleRef.current.state,
          steps: () => finaleRef.current.plan?.steps.map((s) => (s.kind === "slide" ? `slide-${s.slide!.position <= 3 ? s.slide!.position : "mine"}` : s.kind)) ?? [],
          goto: (i: number, s = 0, pause = true) => {
            finaleRef.current.goto(i, s);
            finaleRef.current.paused = pause;
          },
          resume: () => {
            finaleRef.current.paused = false;
          },
        };
      }

      let hudAcc = 1;
      let dbgAcc = 0;
      let frames = 0;
      let workMs = 0;
      let dtSum = 0;
      let warm = 0;
      let slowFrames = 0;
      // Frame-time monitor: rolling window of frame intervals (shared with the perf report).
      const perf = perfRef.current;
      const wk = new Float32Array(2000);
      let wkN = 0;
      const spikes: string[] = [];
      let ftMax = 0;
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
        // the broadcast, hand the scene the official replay and carry on from the same
        // moment (no jump back: the run-out keeps playing), and the finale starts.
        const official = clock instanceof LiveClock && feed ? officialHandoff(feed, clock.time) : null;
        if (clock instanceof LiveClock && official) {
          sc.setFinal(official);
          finalRef.current = official;
          setFinal(official);
          const pc = new PlaybackClock(official, { autoplay: clock.playing || clock.live, initialTimeSec: clock.time });
          clockRef.current = pc;
          finaleRef.current.setPlan(planForRef.current(official), pc.time, true);
          setReplayBadge(false);
          return;
        }
        const prevT = clock.time;
        const fr = clock.tick(dt);
        // The finale runs in real seconds over the scene; during its replay the scene shows the
        // replay window (both views: the director holds a side-on replay shot on the winner).
        const fin = finaleRef.current;
        if (clock instanceof PlaybackClock) fin.update(prevT, fr.time, dt);
        const cur = fin.current();
        const replaying = cur.step?.kind === "replay";
        const winnerId = finalRef.current?.result.finishOrder[0]?.horseId ?? null;
        directorRef.current.force(replaying ? { type: "replay", subject: winnerId } : null);
        const sceneT = fin.sceneTime() ?? fr.time;
        sc.render({
          time: sceneT,
          realDt: dt,
          camera: fin.running && fin.plan?.replay ? "director" : cameraRef.current,
          follow: fin.running ? false : followRef.current,
          frozen: fr.frozen,
          flash: fr.flash,
          director: directorRef.current,
        });
        const view = finaleViewRef.current;
        const nextKind = cur.step?.kind ?? null;
        if ((view?.index ?? -1) !== cur.index || (view?.kind ?? null) !== nextKind) {
          const nv = cur.step ? { index: cur.index, kind: cur.step.kind } : null;
          finaleViewRef.current = nv;
          setFinaleView(nv);
        }
        if (fin.state !== finaleStateRef.current) {
          const was = finaleStateRef.current;
          finaleStateRef.current = fin.state;
          setFinaleState(fin.state);
          if (fin.state === "running") onFinaleRef.current?.("running");
          else if (was === "running" && fin.state === "done") onFinaleRef.current?.("done");
        }
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
          publishRef.current();
        }

        // Perf: auto-downgrade when the device can't hold ~40 fps.
        frames++;
        workMs += work;
        dtSum += deltaMS;
        perf.ft[perf.n++ % perf.ft.length] = deltaMS;
        wk[wkN++ % wk.length] = work;
        if (debug && work > 8 && spikes.length < 30) spikes.push(`${fr.time.toFixed(1)}s:${work.toFixed(0)}ms`);
        if (perf.n > 30) ftMax = Math.max(ftMax, deltaMS);
        warm += dt;
        if (quality === "auto" && qualityRef.current === "high" && warm > 2) {
          slowFrames = deltaMS > 25 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
          if (slowFrames > 90) {
            qualityRef.current = "low";
            downgradedRef.current = true;
            sc.setQuality("low");
          }
        }
        // Real-device perf report: once, after 20 s of playback with enough frames.
        if (clock.playing || clock.live) perf.playedMs += deltaMS;
        if (!perf.reported && perf.playedMs >= 20_000 && perf.n >= 300) sendPerfReport();
        dbgAcc += dt;
        if (debug && dbgAcc >= 0.5) {
          const cam = sc.cameraInfo;
          const win = Array.from(perf.ft.subarray(0, Math.min(perf.n, perf.ft.length))).sort((a, b) => a - b);
          const median = win[win.length >> 1] ?? 0;
          const p99 = win[Math.floor(win.length * 0.99)] ?? 0;
          (window as unknown as { __rvFrameStats?: unknown }).__rvFrameStats = { median, p99, max: ftMax, frames: perf.n, camMaxStep: sc.maxCamStep, ...(() => {
            const w = Array.from(wk.subarray(0, Math.min(wkN, wk.length))).sort((a, b) => a - b);
            return { workMedian: w[w.length >> 1] ?? 0, workP99: w[Math.floor(w.length * 0.99)] ?? 0, workMax: w[w.length - 1] ?? 0, over2x: w.filter((x) => x > 2 * (w[w.length >> 1] ?? 0)).length, spikes };
          })() };
          setDebugText(
            `frame med ${median.toFixed(1)} p99 ${p99.toFixed(1)} max ${ftMax.toFixed(1)} ms\n` +
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
        sc.resize(w, h);
        setWidth(w);
      });
      ro.observe(stage);
      setWidth(w0);
      setReady(true);

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        sceneRef.current = null;
        sc.destroy();
        sc.canvas.remove();
        if (hook) delete (window as unknown as { __rvTrackside?: unknown }).__rvTrackside;
        if (hook) delete (window as unknown as { __rvFinale?: unknown }).__rvFinale;
        if (hook) delete (window as unknown as { __rvScene?: unknown }).__rvScene;
        if (hook) delete (window as unknown as { __rvClock?: unknown }).__rvClock;
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
  }, [initialFinal, live, highlightHorseId, artBaseUrl, pixelated, view, course, raceStage, injured]);

  // Unmount: send a report for viewers that left before the 20 s mark (>= 150 frames drawn).
  useEffect(() => () => sendPerfReport(), [sendPerfReport]);

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
  /** A seek / restart re-arms the finale (it plays again when the playhead next crosses it). */
  const rearm = () => {
    const c = clockRef.current;
    if (c) finaleRef.current.rearm(c.time);
  };
  const onToggle = () => {
    const fin = finaleRef.current;
    if (fin.running) {
      fin.paused = !fin.paused;
      return;
    }
    act((c) => c.toggle());
  };
  const onRestart = () => {
    setDismissed(false);
    act((c) => c.restart());
    rearm();
  };
  const onSeek = (t: number) => {
    if (!final || t < duration) setDismissed(false);
    act((c) => c.seek(t));
    rearm();
  };
  const onFinaleSkip = () => finaleRef.current.skip();
  const onFinaleSkipAll = () => finaleRef.current.skipAll();
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
    if (e.key === "Escape" && finaleRef.current.running) {
      e.preventDefault();
      onFinaleSkipAll();
    } else if (e.key === "Escape" && hud?.pre) {
      e.preventDefault();
      skipPreOff();
    } else if (e.key === " " || e.key === "k") {
      e.preventDefault();
      onToggle();
    } else if (e.key === "ArrowRight") {
      act((c) => c.seek(c.time + 5));
      rearm();
    } else if (e.key === "ArrowLeft") {
      act((c) => c.seek(c.time - 5));
      rearm();
    }
  };

  const narrow = width > 0 && width < NARROW_PX;
  narrowRef.current = narrow;
  // "Share clip" (in the finale's strip panel): only from the official result — a live
  // broadcast has `final` set only once the broadcast is over (officialHandoff).
  const clipButton = useMemo(
    () =>
      canShareClip(final, whatIf) ? (
        <ClipShareButton replay={final} view={view ?? "trackside"} follow={follow} highlightHorseId={hasHighlight ? highlightHorseId : undefined} mine={mine} artBaseUrl={artBaseUrl} course={course} connections={connections} meta={{ courseName: course?.name ?? null, url: siteHost ?? undefined }} />
      ) : null,
    [final, whatIf, view, follow, hasHighlight, highlightHorseId, mine, artBaseUrl, course, connections, siteHost],
  );
  const stageStyle: CSSProperties = height !== undefined ? { height } : { aspectRatio: "16 / 9", minHeight: 320 };
  const h = hud;
  // The finale runs first; then the results card (after a finale, or once the horses have
  // eased down when there was none to play).
  const finaleRunning = finaleState === "running" && !!finaleView && !!final && !!plan;
  const showResults = resultsCard && !!h && !!final && h.mode === "replay" && !dismissed && !h.frozen && !finaleRunning && (finaleState === "done" || h.settled);
  const preHud = h?.pre ?? null;
  const quiet = finaleRunning || showResults || !!preHud;
  const isLive = h?.mode === "live";
  const pip = pipRect(width, stageRef.current?.clientHeight ?? 0);
  const furlongs = useMemo(() => {
    const L = info.trackLengthMm;
    const out: number[] = [];
    for (let i = 1; L - i * FURLONG_MM > 0; i++) out.push((L - i * FURLONG_MM) / L);
    return out;
  }, [info.trackLengthMm]);
  // Final furlong: the HUD clears down to the leaders (and your horse) and the readout.
  const maxStandings = narrow || h?.ff ? 3 : width < 900 ? 6 : 16;

  return (
    <div
      className={`rv-root${narrow ? " rv-narrow" : ""}${course ? " rv-has-cmap" : ""}${h?.ff ? " rv-ff" : ""}${className ? ` ${className}` : ""}`}
      style={{ ["--rv-cmap-top" as string]: `${hudTitle ? (narrow ? 88 : 104) : narrow ? 80 : 96}px` }}
      tabIndex={0}
      onKeyDown={onKey}
      data-race-viewer=""
    >
      <div className="rv-stage" ref={stageRef} style={stageStyle}>
        <div className="rv-canvas" ref={canvasHostRef} />
        {!ready && <div className="rv-loading">{failed ? "3D view unavailable on this device" : "Loading race…"}</div>}
        {h && !finaleRunning && !preHud && (
          <TopHud
            race={info.race}
            showTitle={hudTitle}
            winningTimeUs={final && h.mode === "replay" ? final.result.winningTimeUs : null}
            trackLengthM={info.trackLengthMm / 1000}
            raceTime={h.time}
            toGoM={h.toGoM}
            standings={h.standings}
            maxStandings={maxStandings}
            commentary={h.frozen || quiet || narrow ? null : h.call}
            highlightHorseId={hasHighlight ? highlightHorseId : undefined}
            marker={h.marker}
          />
        )}
        {h && narrow && h.call && !h.frozen && !quiet && (
          <div className="rv-ticker-low" style={h.battle ? { bottom: 96 } : h.ff ? { bottom: 52 } : undefined}>
            <CallTicker key={`${h.call.atSec}-${h.call.kind}`} line={h.call} mine={hasHighlight && h.call.horseIds.includes(highlightHorseId!)} />
          </div>
        )}
        {h && h.time < 0 && !preHud && <Countdown seconds={-h.time} live={h.live} />}
        {preHud && (
          <PreOffOverlay pre={preHud} horses={info.horses} raceName={info.race.name} paddock={paddock} highlightHorseId={hasHighlight ? highlightHorseId : undefined} onSkip={skipPreOff} />
        )}
        {h && !preHud && preOffWanted && preSkip && h.time < -3 && (
          <button type="button" className="rv-btn rv-pre-on" onClick={watchPreOff}>
            Watch the build-up
          </button>
        )}
        {h?.frozen && <PhotoStamp />}
        {h && !quiet && !h.ff && h.dots.length > 0 && <Minimap dots={h.dots} furlongs={furlongs} trackLengthM={info.trackLengthMm / 1000} />}
        {h?.battle && !quiet && <BattleGraphic battle={h.battle} horses={info.horses} highlightHorseId={hasHighlight ? highlightHorseId : undefined} />}
        {course && h && !quiet && !h.ff && !h.frozen && (
          <CourseMapPanel
            course={course}
            distanceM={info.trackLengthMm / 1000}
            runners={mapRunners(h.dots, info.trackLengthMm / 1000)}
            narrow={narrow}
            onSlope={h.time > 0 && h.toGoM > 0 && h.toGoM <= course.homeStraightM}
          />
        )}
        {h?.pip && pip && !finaleRunning && (
          <div className="rv-pip" style={{ right: pip.right, bottom: pip.bottom, width: pip.w, height: pip.h }}>
            <span>My horse</span>
          </div>
        )}
        {h?.slowmo && !h.frozen && <div className="rv-badge">SLOW-MO</div>}
        {h && replayBadge && h.mode === "replay" && !h.ended && !h.slowmo && !h.frozen && <div className="rv-badge">PHOTO REPLAY</div>}
        {h?.buffering && <div className="rv-badge rv-badge-buffer">BUFFERING</div>}
        {whatIf && !preHud && (
          <div className="rv-whatif" data-testid="what-if-badge" role="note">
            {whatIfBadge(props.whatIfBadge)}
          </div>
        )}
        {debug && debugText && (
          <div className="rv-debug" data-rv-debug="">
            {debugText}
          </div>
        )}
        {finaleRunning && finaleView && plan && final && plan.steps[finaleView.index] && (
          <FinaleOverlay
            replay={final}
            plan={plan}
            step={plan.steps[finaleView.index]!}
            stepIndex={finaleView.index}
            narrow={narrow}
            connections={connections}
            renderPortrait={renderPortrait}
            courseName={course?.name ?? null}
            photoArt={photoArt}
            artBase={artBaseUrl ?? "/art"}
            seal={seal}
            onSkip={onFinaleSkip}
            onSkipAll={onFinaleSkipAll}
            clipButton={clipButton ?? undefined}
          />
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
            view={view ?? "trackside"}
            onView={setView}
            follow={follow}
            onFollow={setFollow}
          />
        )}
      </div>
    </div>
  );
}
