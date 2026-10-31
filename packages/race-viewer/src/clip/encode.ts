/**
 * Clip encoding, entirely in the browser.
 *
 * Preferred: WebCodecs VideoEncoder (H.264) muxed to MP4 with mp4-muxer (MIT), fed
 * rendered frames as fast as they come — timestamps are the frame schedule's, so the
 * encode is quick and identical every time.
 *
 * Fallback: MediaRecorder on the canvas's captureStream (WebM/VP9 or VP8; MP4 where the
 * platform records it). MediaRecorder stamps frames by the wall clock, so the fallback
 * paces itself to real time — same pixels, same schedule, a real-time wait.
 */
export interface ClipEncoderOptions {
  width: number;
  height: number;
  fps: number;
}

export interface ClipEncoder {
  /** Container extension for the filename ("mp4" | "webm"). */
  readonly ext: string;
  /** How the clip is being encoded (shown in the progress UI). */
  readonly kind: "mp4" | "recorder";
  /** Offer the canvas as frame `index` (already drawn). */
  addFrame(canvas: HTMLCanvasElement, index: number): Promise<void>;
  /** Flush and return the finished file. */
  finalize(): Promise<Blob>;
  /** Abort; finalize() must not be called after this. */
  cancel(): void;
}

/** Bits/s: enough for crisp pixel art with hard edges, bounded for file size. */
export function clipBitrate(width: number, height: number, fps: number): number {
  return Math.min(12_000_000, Math.max(4_000_000, Math.round(width * height * fps * 0.11)));
}

export async function createClipEncoder(opts: ClipEncoderOptions): Promise<ClipEncoder> {
  const webcodecs = await tryWebCodecs(opts);
  if (webcodecs) return webcodecs;
  return createRecorderEncoder(opts);
}

async function tryWebCodecs(opts: ClipEncoderOptions): Promise<ClipEncoder | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  const bitrate = clipBitrate(opts.width, opts.height, opts.fps);
  // High, then Main, then Baseline (level 4.0 covers 1920x1080/1080x1920 at 30 fps).
  let codec: string | null = null;
  try {
    for (const c of ["avc1.640028", "avc1.4d0028", "avc1.42001f"]) {
      const support = await VideoEncoder.isConfigSupported({ codec: c, width: opts.width, height: opts.height, bitrate, framerate: opts.fps });
      if (support.supported) {
        codec = c;
        break;
      }
    }
  } catch {
    return null;
  }
  if (!codec) return null;
  let MuxerMod: typeof import("mp4-muxer");
  try {
    MuxerMod = await import("mp4-muxer");
  } catch {
    return null;
  }
  const { Muxer, ArrayBufferTarget } = MuxerMod;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: opts.width, height: opts.height },
    fastStart: "in-memory",
  });
  let failed: unknown = null;
  let cancelled = false;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failed = e;
    },
  });
  encoder.configure({ codec, width: opts.width, height: opts.height, bitrate, framerate: opts.fps });
  const frameUs = 1_000_000 / opts.fps;
  return {
    ext: "mp4",
    kind: "mp4",
    async addFrame(canvas, index) {
      if (failed) throw failed;
      if (cancelled) throw new Error("clip: cancelled");
      // Backpressure: don't queue the whole clip's frames into the encoder at once.
      while (encoder.encodeQueueSize > 8) {
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          encoder.addEventListener("dequeue", done, { once: true });
          setTimeout(done, 50);
        });
      }
      const frame = new VideoFrame(canvas, { timestamp: Math.round(index * frameUs), duration: Math.round(frameUs) });
      try {
        encoder.encode(frame, { keyFrame: index % (opts.fps * 2) === 0 });
      } finally {
        frame.close();
      }
    },
    async finalize() {
      if (failed) throw failed;
      await encoder.flush();
      encoder.close();
      muxer.finalize();
      return new Blob([muxer.target.buffer], { type: "video/mp4" });
    },
    cancel() {
      cancelled = true;
      try {
        if (encoder.state !== "closed") encoder.close();
      } catch {
        /* already closed */
      }
    },
  };
}

function pickRecorderMime(): { mimeType?: string; ext: string } {
  if (typeof MediaRecorder === "undefined") return { ext: "webm" };
  for (const m of ["video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, ext: m.startsWith("video/mp4") ? "mp4" : "webm" };
    } catch {
      /* keep looking */
    }
  }
  return { ext: "webm" };
}

/** MediaRecorder fallback: wall-clock paced (captureStream frames are stamped on arrival). */
function createRecorderEncoder(opts: ClipEncoderOptions): ClipEncoder {
  if (typeof MediaRecorder === "undefined") throw new Error("clip: this browser can’t record video (no WebCodecs or MediaRecorder)");
  const { mimeType, ext } = pickRecorderMime();
  const bitrate = clipBitrate(opts.width, opts.height, opts.fps);
  let stream: MediaStream | null = null;
  let rec: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stopped: Promise<void> | null = null;
  let cancelled = false;
  const t0 = { now: 0 };
  return {
    ext,
    kind: "recorder",
    async addFrame(canvas, index) {
      if (cancelled) throw new Error("clip: cancelled");
      if (!rec) {
        stream = canvas.captureStream(opts.fps);
        rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: bitrate });
        chunks = [];
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        stopped = new Promise<void>((resolve) => {
          rec!.onstop = () => resolve();
        });
        t0.now = performance.now();
        rec.start(250);
      }
      // Pace to the frame schedule: MediaRecorder timestamps by the wall clock.
      const due = t0.now + (index * 1000) / opts.fps;
      const wait = due - performance.now();
      if (wait > 1) await new Promise((r) => setTimeout(r, wait));
    },
    async finalize() {
      if (!rec || !stopped) throw new Error("clip: nothing recorded");
      if (rec.state !== "inactive") rec.stop();
      await stopped;
      stream?.getTracks().forEach((t) => t.stop());
      const type = rec.mimeType || mimeType || "video/webm";
      return new Blob(chunks, { type });
    },
    cancel() {
      cancelled = true;
      chunks = [];
      try {
        if (rec && rec.state !== "inactive") rec.stop();
      } catch {
        /* already stopped */
      }
      stream?.getTracks().forEach((t) => t.stop());
    },
  };
}
