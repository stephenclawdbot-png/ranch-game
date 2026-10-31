"use client";

import dynamic from "next/dynamic";
import type { RaceReplay } from "@thoroughbred/shared";
import type { RaceViewerProps } from "@thoroughbred/race-viewer";

/**
 * "Share clip" on a settled race's page: renders the viewer package's clip button
 * (records the finish in the browser; share sheet on phones, download elsewhere).
 * Only ever rendered once `feed.final` exists — the page has the official result then,
 * so the clip can never leak an unsettled race. Client-only (canvas/WebGL).
 */
const LazyClipButton = dynamic(() => import("@thoroughbred/race-viewer").then((m) => m.ClipShareButton), { ssr: false });

export function ShareClip({
  replay,
  course,
  courseName,
  highlightHorseId,
  mineHorseIds,
  connections,
}: {
  replay: RaceReplay;
  course: RaceViewerProps["course"];
  courseName?: string | null;
  highlightHorseId?: string;
  mineHorseIds?: readonly string[];
  connections?: RaceViewerProps["connections"];
}) {
  return (
    <LazyClipButton
      replay={replay}
      highlightHorseId={highlightHorseId}
      mine={mineHorseIds}
      connections={connections}
      course={course}
      meta={{ courseName: courseName ?? null }}
      className="btn btn-sm btn-brass shrink-0"
    />
  );
}
