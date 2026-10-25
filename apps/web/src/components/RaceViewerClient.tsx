"use client";
import dynamic from "next/dynamic";

/** The PixiJS race viewer, client-only (it needs WebGL/canvas). */
export const RaceViewerClient = dynamic(() => import("@thoroughbred/race-viewer").then((m) => m.RaceViewer), {
  ssr: false,
  loading: () => <div className="flex h-full min-h-64 w-full items-center justify-center text-sm text-sage">Loading the track…</div>,
});
