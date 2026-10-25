"use client";
import dynamic from "next/dynamic";

/** The race viewer, client-only (it needs WebGL/canvas). */
export const RaceViewerClient = dynamic(() => import("@thoroughbred/race-viewer").then((m) => m.RaceViewer), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-64 w-full flex-col items-center justify-center gap-3 text-sage">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2 w-2 bg-brass" style={{ animation: `blink 900ms steps(1) ${i * 300}ms infinite` }} />
        ))}
      </span>
      <span className="eyebrow">Loading the track</span>
    </div>
  ),
});
