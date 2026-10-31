"use client";
import dynamic from "next/dynamic";
import type { RaceViewerProps } from "@thoroughbred/race-viewer";
import { trackRacePerf } from "@/lib/telemetry";

/** The horse's genetic 3/4 portrait, loaded only when a finale card shows one. */
const LazyPortrait = dynamic(() => import("./HorsePortrait").then((m) => m.HorsePortrait), { ssr: false });

/** Finale cards: the 3/4 portrait filling the card's frame (pixel art scaled by the box, not smoothed). */
export const renderFinalePortrait: NonNullable<RaceViewerProps["renderPortrait"]> = (h) => <LazyPortrait appearance={h.appearance} title={h.name} className="h-full w-full" />;

/** The race viewer, client-only (it needs WebGL/canvas). */
export const RaceViewerClient = dynamic(
  () =>
    import("@thoroughbred/race-viewer").then((m) => {
      // The race page shows the title strip and its own staged results sequence.
      const Viewer = (props: RaceViewerProps) => <m.RaceViewer hudTitle={false} resultsCard={false} onPerfReport={trackRacePerf} renderPortrait={renderFinalePortrait} {...props} />;
      return Viewer;
    }),
  {
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
  },
);
