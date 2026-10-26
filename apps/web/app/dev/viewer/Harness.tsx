"use client";
import { useEffect, useMemo } from "react";
import { RaceViewer, type CameraMode } from "@thoroughbred/race-viewer";
import { SpriteSheet, fakeLiveFeed, fakeReplay } from "@thoroughbred/race-viewer/dev";
import type { Surface, Weather } from "@thoroughbred/shared";

export interface HarnessParams {
  weather?: string;
  surface?: string;
  horses?: string;
  seed?: string;
  distance?: string;
  /** Start playback at this race time (s). */
  t?: string;
  /** Seconds until the gates open (wall-clock sync demo); negative = race already running. */
  start?: string;
  studio?: string;
  phase?: string;
  quality?: string;
  camera?: string;
  highlight?: string;
  paused?: string;
  gallop?: string;
  drive?: string;
  /** Live broadcast demo: seconds until the off (e.g. live=5; negative = already running). */
  live?: string;
  /** "none" = skip /art (code-drawn art only). */
  art?: string;
  /** Stage height (px), like the race page passes it. */
  h?: string;
  /** Low internal resolution, nearest upscale. */
  pixel?: string;
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export function ViewerHarness({ params }: { params: HarnessParams }) {
  const replay = useMemo(
    () =>
      fakeReplay({
        horses: num(params.horses, 10),
        seed: num(params.seed, 7),
        distanceM: num(params.distance, 1200),
        weather: (params.weather as Weather) ?? "clear",
        surface: (params.surface as Surface) ?? "turf",
      }),
    [params.horses, params.seed, params.distance, params.weather, params.surface],
  );
  const startAtMs = useMemo(() => (params.start !== undefined ? Date.now() + num(params.start, 5) * 1000 : undefined), [params.start]);

  const feed = useMemo(
    () => (params.live !== undefined ? fakeLiveFeed(replay, Date.now() + num(params.live, 5) * 1000) : undefined),
    [replay, params.live],
  );
  useEffect(() => () => feed?.stop(), [feed]);

  if (params.studio) {
    return (
      <main style={{ padding: 16 }}>
        <SpriteSheet horses={replay.horses} artBaseUrl={params.art === "none" ? null : "/art"} />
      </main>
    );
  }
  return (
    <main style={{ padding: "16px", maxWidth: 1280, margin: "0 auto" }}>
      <RaceViewer
        {...(feed ? { feed } : { replay })}
        debug
        startAtMs={startAtMs}
        initialTimeSec={params.t !== undefined ? num(params.t, 0) : undefined}
        autoplay={params.paused === undefined}
        quality={(params.quality as "auto" | "high" | "low") ?? "auto"}
        initialCamera={params.camera as CameraMode | undefined}
        highlightHorseId={params.highlight ?? "h3"}
        pixelated={params.pixel !== undefined}
        artBaseUrl={params.art === "none" ? null : "/art"}
        height={params.h !== undefined ? num(params.h, 420) : undefined}
      />
    </main>
  );
}
