"use client";
/**
 * "Share clip": cuts the finish as a video and shares it (Web Share on phones) or
 * downloads it. Rendered only for a settled race (the caller gates on the official
 * result existing — never during a live broadcast). The recording itself is an
 * offscreen, deterministic re-render of the replay (record.ts): the viewer's own
 * playback is never touched.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RaceReplay } from "@thoroughbred/shared";
import type { ViewMode } from "../types";
import type { CourseInfo } from "../course/geometry";
import type { RunnerConnections } from "../finale/FinaleOverlay";
import { injectViewerCss } from "../hud/styles";
import { ClipCancelled, clipDateLabel, recordRaceClip, type ClipMeta } from "./record";
import type { ClipOrientation } from "./plan";

export interface ClipShareButtonProps {
  /** The settled race (official result + frames). */
  replay: RaceReplay;
  /** The view to cut from; default resolves like the viewer (URL, then the remembered choice). */
  view?: ViewMode;
  follow?: boolean;
  highlightHorseId?: string;
  mine?: readonly string[];
  artBaseUrl?: string | null;
  course?: CourseInfo | null;
  connections?: Readonly<Record<string, RunnerConnections>>;
  meta?: ClipMeta;
  className?: string;
}

const VIEW_KEY = "rv:view";

/** The same view the viewer would open in (page URL, then the remembered choice). */
function resolveClipView(): ViewMode {
  if (typeof window === "undefined") return "trackside";
  try {
    const q = new URLSearchParams(window.location.search).get("view");
    if (q === "classic" || q === "broadcast" || q === "3d") return "classic";
    if (q === "trackside") return "trackside";
    const v = window.localStorage.getItem(VIEW_KEY);
    if (v === "classic" || v === "trackside") return v;
  } catch {
    /* no URL / storage blocked */
  }
  return "trackside";
}

/** Phones hold portraits: vertical is the suggested crop there. */
function suggestedOrientation(): ClipOrientation {
  if (typeof window !== "undefined") {
    try {
      if (window.matchMedia?.("(pointer: coarse)").matches) return "vertical";
      if (window.innerHeight > window.innerWidth) return "vertical";
    } catch {
      /* no matchMedia */
    }
  }
  return "landscape";
}

async function shareOrDownload(blob: Blob, fileName: string, title: string): Promise<"shared" | "saved"> {
  const file = new File([blob], fileName, { type: blob.type || "video/mp4" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
    await nav.share({ files: [file], title }).catch(() => undefined);
    return "shared";
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return "saved";
}

type Ui =
  | { kind: "idle" }
  | { kind: "pick" }
  | { kind: "recording"; done: number; total: number; mode: "mp4" | "recorder" }
  | { kind: "done"; how: "shared" | "saved" }
  | { kind: "error"; message: string };

export function ClipShareButton(props: ClipShareButtonProps) {
  const { replay } = props;
  const [ui, setUi] = useState<Ui>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const suggestedRef = useRef<ClipOrientation>("landscape");
  useEffect(() => injectViewerCss(), []);
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(
    async (orientation: ClipOrientation) => {
      const abort = new AbortController();
      abortRef.current?.abort();
      abortRef.current = abort;
      setUi({ kind: "recording", done: 0, total: 1, mode: "mp4" });
      try {
        const stables: Record<string, string> = {};
        if (props.connections) for (const [id, c] of Object.entries(props.connections)) if (c.stableName) stables[id] = c.stableName;
        const clip = await recordRaceClip({
          replay,
          view: props.view ?? resolveClipView(),
          orientation,
          follow: props.follow ?? false,
          highlightHorseId: props.highlightHorseId,
          mine: props.mine,
          artBaseUrl: props.artBaseUrl ?? "/art",
          course: props.course ?? null,
          meta: { courseName: props.meta?.courseName ?? props.course?.name ?? null, dateLabel: props.meta?.dateLabel ?? clipDateLabel(replay.race.postTimeMs), url: props.meta?.url, stables: props.meta?.stables ?? stables },
          signal: abort.signal,
          onProgress: (done, total, mode) => setUi((u) => (u.kind === "recording" ? { kind: "recording", done, total, mode } : u)),
        });
        if (abort.signal.aborted) throw new ClipCancelled();
        const how = await shareOrDownload(clip.blob, clip.fileName, replay.race.name);
        setUi({ kind: "done", how });
      } catch (err) {
        if (err instanceof ClipCancelled || abort.signal.aborted) setUi({ kind: "idle" });
        else setUi({ kind: "error", message: err instanceof Error ? err.message : "The clip failed" });
      }
    },
    [props, replay],
  );

  const open = () => {
    suggestedRef.current = suggestedOrientation();
    setUi({ kind: "pick" });
  };
  const close = () => setUi({ kind: "idle" });
  const cancel = () => {
    abortRef.current?.abort();
    setUi({ kind: "idle" });
  };

  const suggested = suggestedRef.current;
  return (
    <>
      <button type="button" className={props.className ?? "rv-btn rv-fin-share"} onClick={open} disabled={ui.kind === "recording"} data-rv-clip="" title="Share a clip of the finish">
        {ui.kind === "recording" ? "…" : "Share clip"}
      </button>
      {(ui.kind === "pick" || ui.kind === "recording" || ui.kind === "error" || ui.kind === "done") && (
        <div className="rv-clip-back" onClick={ui.kind === "recording" ? undefined : close}>
          <div className="rv-clip-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Share a clip of the finish">
            {ui.kind === "pick" && (
              <>
                <p className="rv-clip-h">Clip the finish</p>
                <p className="rv-clip-sub">The last 12–15 s through the line, with the call and the result burned in. Made on this device.</p>
                <div className="rv-clip-row">
                  <button type="button" className="rv-btn" onClick={() => void start("vertical")} data-rv-clip-go="vertical">
                    <span className="rv-clip-orient rv-clip-orient-v" aria-hidden />
                    Vertical
                    {suggested === "vertical" && <span className="rv-clip-hint">for TikTok / Reels</span>}
                  </button>
                  <button type="button" className="rv-btn" onClick={() => void start("landscape")} data-rv-clip-go="landscape">
                    <span className="rv-clip-orient rv-clip-orient-l" aria-hidden />
                    Landscape
                    {suggested === "landscape" && <span className="rv-clip-hint">for X / YouTube</span>}
                  </button>
                </div>
                <button type="button" className="rv-btn rv-clip-cancel" onClick={close}>
                  Cancel
                </button>
              </>
            )}
            {ui.kind === "recording" && (
              <>
                <p className="rv-clip-h">Cutting the clip…</p>
                <div className="rv-clip-bar" data-rv-clip-progress="">
                  <span style={{ width: `${Math.round((ui.done / Math.max(1, ui.total)) * 100)}%` }} />
                </div>
                <p className="rv-clip-sub">
                  {Math.round((ui.done / Math.max(1, ui.total)) * 100)}%{ui.mode === "recorder" ? " · real-time capture on this browser" : ""}
                </p>
                <button type="button" className="rv-btn rv-clip-cancel" onClick={cancel}>
                  Cancel
                </button>
              </>
            )}
            {ui.kind === "done" && (
              <>
                <p className="rv-clip-h">{ui.how === "shared" ? "Shared ✓" : "Clip saved ✓"}</p>
                <button type="button" className="rv-btn rv-clip-cancel" onClick={close}>
                  Done
                </button>
              </>
            )}
            {ui.kind === "error" && (
              <>
                <p className="rv-clip-h">Couldn’t make the clip</p>
                <p className="rv-clip-sub">{ui.message}</p>
                <button type="button" className="rv-btn rv-clip-cancel" onClick={close}>
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
