"use client";
import dynamic from "next/dynamic";

/** The PixiJS race viewer, client-only (it needs WebGL/canvas). */
export const RaceViewerClient = dynamic(() => import("@/lib/_shims_client").then((m) => m.RaceViewer), {
  ssr: false,
  loading: () => (
    <div className="flex aspect-[16/9] w-full items-center justify-center rounded-2xl bg-turf-900 text-sm text-sage">Loading the track…</div>
  ),
});
