/**
 * Records the finish as a video, entirely in the browser (never a server render).
 *
 * A second, offscreen copy of the scene the user is watching (Trackside or the 3D
 * broadcast) is stepped through the replay at a fixed 30 fps — frame N is always race
 * time startSec + N/30 with a fixed realDt — then composited with the burned-in
 * overlays and encoded (encode.ts). Stepping, never screen capture: the clip is quick
 * to make and identical every time, and the user's own playback is never touched.
 */
import type { RaceReplay } from "@thoroughbred/shared";
import type { CameraMode, ViewMode } from "../types";
import type { CourseInfo } from "../course/geometry";
import { buildRaceStage } from "../stage/buildRaceStage";
import { injuredFromEvents } from "../stage/motion";
import { Director } from "../director";
import { buildRaceCall } from "../call/buildRaceCall";
import { isPhotoFinish } from "../finale/plan";
import { photoFinishModel } from "../photo/model";
import { loadPhotoFinishArt, renderPhotoShareCard } from "../photo/render";
import type { HD2DScene as HD2DSceneT } from "../three/HD2DScene";
import type { TracksideScene as TracksideSceneT } from "../trackside/TracksideScene";
import { createClipEncoder } from "./encode";
import { clipLayout, drawBanner, drawCaption, drawEndCard, drawPhotoCard, drawWordmark } from "./overlay";
import { CLIP_FPS, CLIP_SIZES, CLIP_WARMUP_SEC, clipFileName, clipSchedule, endCardRows, overlayAt, type ClipOrientation } from "./plan";

type AnyScene = HD2DSceneT | TracksideSceneT;

export class ClipCancelled extends Error {
  constructor() {
    super("clip: cancelled");
    this.name = "ClipCancelled";
  }
}

export interface ClipMeta {
  /** Course name for the banner and filename (e.g. "Harrowdale"). */
  courseName?: string | null;
  /** Display date (e.g. "31 Oct 2026"); defaults to the post time's UTC date. */
  dateLabel?: string;
  /** Wordmark URL (defaults to the page's host). */
  url?: string;
  /** Stable name per horseId, for the photo card. */
  stables?: Record<string, string>;
}

export interface RecordClipOptions {
  replay: RaceReplay;
  /** The view the user is watching: the clip is cut from the same one. */
  view: ViewMode;
  orientation: ClipOrientation;
  /** Trackside "Follow mine" camera state (default whole field). */
  follow?: boolean;
  /** The 3D view's camera (default "director"). */
  camera?: CameraMode;
  highlightHorseId?: string;
  /** The viewer's own horses ("your X" in the call). */
  mine?: readonly string[];
  artBaseUrl?: string | null;
  course?: CourseInfo | null;
  meta?: ClipMeta;
  onProgress?: (done: number, total: number, kind: "mp4" | "recorder") => void;
  signal?: AbortSignal;
}

export interface RecordedClip {
  blob: Blob;
  ext: string;
  fileName: string;
}

/** Creates the offscreen scene for the clip (the same art stack as the viewer). */
async function createClipScene(
  T: typeof import("three"),
  replay: RaceReplay,
  opts: RecordClipOptions,
  art: Awaited<ReturnType<typeof import("../three/art").loadArt>>,
): Promise<AnyScene> {
  const stage = buildRaceStage(opts.course ?? null, replay);
  const injured = injuredFromEvents(replay.events);
  if (opts.view === "trackside") {
    try {
      const { TracksideScene } = await import("../trackside/TracksideScene");
      return await TracksideScene.create(T, replay, { quality: "high", highlightHorseId: opts.highlightHorseId, art, course: opts.course, stage, injured, preOff: null });
    } catch (err) {
      console.warn("[clip] Trackside view unavailable, cutting from the classic view", err);
    }
  }
  const [{ HD2DScene }, { createRigFactory }, { loadStageArt, loadTracksideArt, loadFxPalette }] = await Promise.all([
    import("../three/HD2DScene"),
    import("../three/horseRig"),
    import("../trackside/art"),
  ]);
  const [rigs, stageArt, strips, fx] = await Promise.all([
    createRigFactory(T, opts.artBaseUrl ?? null, art),
    loadStageArt(art, stage),
    loadTracksideArt(art).catch(() => null),
    loadFxPalette(art),
  ]);
  return new HD2DScene(T, replay, {
    quality: "high",
    highlightHorseId: opts.highlightHorseId,
    art,
    rigs: rigs.factory,
    rigKind: rigs.kind,
    stage,
    stageArt,
    strips,
    fxPalette: fx,
    injured,
    preOff: null,
  });
}

/** The display date default: the post time's UTC date, like the photo share card. */
export function clipDateLabel(postTimeMs: number): string {
  return new Date(postTimeMs).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Renders and encodes the clip; resolves with the file. Throws ClipCancelled when
 * `signal` aborts. The scenes step on a fixed clock, so two runs of this on the same
 * replay produce the same frames (the MP4 bytes may differ in encoder metadata only).
 */
export async function recordRaceClip(opts: RecordClipOptions): Promise<RecordedClip> {
  const { replay } = opts;
  if (typeof document === "undefined") throw new Error("clip: needs a browser canvas");
  if (opts.signal?.aborted) throw new ClipCancelled();

  // A photo finish ends on the line-scan strip: load its art first (it decides the schedule).
  const photo = isPhotoFinish(replay);
  const photoArt = photo ? await loadPhotoFinishArt(opts.artBaseUrl ?? "/art").catch(() => null) : null;
  const schedule = clipSchedule(replay, { photo: photo && !!photoArt });
  const { width: W, height: H } = CLIP_SIZES[opts.orientation];
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const layout = clipLayout(W, H);
  const fps = schedule.fps;
  const step = 1 / fps;

  const [T, { loadArt }] = await Promise.all([import("three"), import("../three/art")]);
  const art = await loadArt(opts.artBaseUrl ?? null);
  if (opts.signal?.aborted) throw new ClipCancelled();
  const scene = await createClipScene(T, replay, opts, art);
  // Half the output size, then a 2x nearest upscale in the composite: crisp pixel art.
  scene.resize(Math.max(1, W / 2), Math.max(1, H / 2));
  scene.warmup();

  const lines = buildRaceCall({
    replay,
    names: Object.fromEntries(replay.horses.map((h) => [h.horseId, h.name])),
    mine: [...(opts.mine ?? [])],
    distanceM: replay.race.distanceM,
    course: opts.course ? { name: opts.course.name, homeStraightM: opts.course.homeStraightM, finishGradientPermille: opts.course.finishGradientPermille } : undefined,
    going: replay.race.going,
    uptoSec: Number.POSITIVE_INFINITY,
    seed: replay.race.id,
  });
  const rows = endCardRows(replay);
  const photoCard =
    schedule.photoFrames > 0 && photoArt
      ? renderPhotoShareCard(photoFinishModel(replay), photoArt, {
          course: opts.meta?.courseName ?? replay.race.name,
          raceName: replay.race.name,
          date: opts.meta?.dateLabel,
          stables: opts.meta?.stables,
        })
      : null;
  const dateLabel = opts.meta?.dateLabel ?? clipDateLabel(replay.race.postTimeMs);
  const subtitle = [opts.meta?.courseName, dateLabel, `${replay.race.distanceM} m`].filter(Boolean).join(" · ");
  const url = opts.meta?.url ?? (typeof location !== "undefined" ? location.host : "");
  const director = new Director();
  const renderSceneAt = (t: number) =>
    scene.render({ time: t, realDt: step, camera: opts.camera ?? "director", follow: opts.follow ?? false, frozen: false, flash: 0, director });

  const encoder = await createClipEncoder({ width: W, height: H, fps });
  const total = schedule.frames.length;
  try {
    // Warm-up: stepped but never encoded, so cameras, the director and ambient fx are
    // where continuous playback would have them when the clip starts.
    const warmStart = Math.max(0, schedule.startSec - CLIP_WARMUP_SEC);
    for (let t = warmStart; t < schedule.startSec - 1e-9; t += step) {
      if (opts.signal?.aborted) throw new ClipCancelled();
      renderSceneAt(t);
    }
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new ClipCancelled();
      const f = schedule.frames[i]!;
      if (f.photo) {
        drawPhotoCard(ctx, layout, photoCard!);
        drawWordmark(ctx, layout, url);
      } else if (f.timeSec !== null) {
        renderSceneAt(f.timeSec);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(scene.canvas, 0, 0, W, H);
        drawBanner(ctx, layout, replay.race.name, subtitle);
        const ov = overlayAt(schedule, i, lines);
        if (ov.caption) drawCaption(ctx, layout, ov.caption);
        if (ov.endCardFade > 0) drawEndCard(ctx, layout, rows, ov.endCardFade);
        drawWordmark(ctx, layout, url);
      }
      await encoder.addFrame(canvas, i);
      opts.onProgress?.(i + 1, total, encoder.kind);
      // Let the progress UI paint and a cancel land promptly.
      if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0));
    }
    const blob = await encoder.finalize();
    return { blob, ext: encoder.ext, fileName: clipFileName({ course: opts.meta?.courseName, race: replay.race.name, dateMs: replay.race.postTimeMs, ext: encoder.ext }) };
  } catch (err) {
    encoder.cancel();
    throw err;
  } finally {
    scene.destroy();
  }
}
