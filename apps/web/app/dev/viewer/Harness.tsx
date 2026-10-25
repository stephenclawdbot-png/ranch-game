"use client";
import { useMemo } from "react";
import { RaceViewer, type CameraMode } from "@thoroughbred/race-viewer";
import { HorseStudio, fakeReplay } from "@thoroughbred/race-viewer/dev";
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

  if (params.studio) {
    return (
      <main style={{ padding: 16 }}>
        <HorseStudio
          horses={replay.horses}
          phase={params.phase !== undefined ? num(params.phase, 0) : undefined}
          gallop={num(params.gallop, 1)}
          drive={num(params.drive, 0)}
        />
      </main>
    );
  }
  return (
    <main style={{ padding: "16px", maxWidth: 1280, margin: "0 auto" }}>
      <RaceViewer
        replay={replay}
        debug
        startAtMs={startAtMs}
        initialTimeSec={params.t !== undefined ? num(params.t, 0) : undefined}
        autoplay={params.paused === undefined}
        quality={(params.quality as "auto" | "high" | "low") ?? "auto"}
        initialCamera={params.camera as CameraMode | undefined}
        highlightHorseId={params.highlight ?? "h3"}
      />
    </main>
  );
}
