"use client";
import { useEffect, useMemo } from "react";
import { RaceViewer, ClipShareButton, type CameraMode } from "@thoroughbred/race-viewer";
import { SpriteSheet, fakeLiveFeed, fakeReplay } from "@thoroughbred/race-viewer/dev";
import type { Surface, Weather } from "@thoroughbred/shared";
import { COURSES } from "@thoroughbred/game-core";
import { renderFinalePortrait } from "@/components/RaceViewerClient";
import { PaddockParade } from "@/components/race/PaddockParade";

const STABLES = ["Hollow Oak Stud", "Brass Lantern Stables", "Fenwick Yard", "Marsh End Racing", "Kestrel House", "Copperbeech Farm", "Larkrise Stud", "Old Mill Stables"];

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
  /** Racecourse id or name (game-core courses.ts): scenery, gradient and course map. */
  course?: string;
  /** Local post hour (0-23): picks the lighting look (golden by day, dusk in the evening). */
  hour?: string;
  /** "0" hides the frame-time overlay. */
  debug?: string;
  /** "0": no forced photo finish (default: the first two within a nose). */
  photo?: string;
  /** Cruising-speed spread (1 default; 4 = a strung-out field). */
  spread?: string;
  /** Comma-separated horse ids injured in the race (pulled up after the line). */
  pullup?: string;
  /** "0" hides the results card. */
  results?: string;
  /** Your horse is the one that finishes in this place (e.g. 6); overrides `highlight`. */
  minepos?: string;
  /** "0" turns the finale off. */
  finale?: string;
  /** "1": the build-up before the off on a replay (starts 24 s before; use t=-24); "0": off for a live feed. */
  preoff?: string;
  /** "1": show the "Share clip" button under the viewer (settled replay; view=classic cuts the 3D view). */
  clip?: string;
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export function ViewerHarness({ params }: { params: HarnessParams }) {
  const course = useMemo(() => COURSES.find((c) => c.id === params.course || c.name.toLowerCase() === params.course?.toLowerCase()) ?? null, [params.course]);
  const replay = useMemo(
    () =>
      fakeReplay({
        horses: num(params.horses, 10),
        seed: num(params.seed, 7),
        distanceM: num(params.distance, 1200),
        weather: (params.weather as Weather) ?? "clear",
        surface: (params.surface as Surface) ?? "turf",
        name: course ? `${course.name} Sprint Stakes` : undefined,
        postTimeMs: params.hour !== undefined ? new Date().setHours(num(params.hour, 18), 0, 0, 0) : undefined,
        photoFinish: params.photo !== "0",
        spread: num(params.spread, 1),
        sealed: true,
      }),
    [params.horses, params.seed, params.distance, params.weather, params.surface, course, params.hour, params.photo, params.spread],
  );
  const highlight = params.minepos !== undefined ? (replay.result.finishOrder.find((f) => f.position === num(params.minepos, 1))?.horseId ?? "h3") : (params.highlight ?? "h3");
  const connections = useMemo(
    () => Object.fromEntries(replay.horses.map((h, i) => [h.horseId, { stableName: h.horseId === highlight ? "Your Stable" : STABLES[i % STABLES.length]!, stablePhotoUrl: null, jockey: i % 3 === 0 ? "Top jockey" : null }])),
    [replay, highlight],
  );
  const paddock = useMemo(
    () => <PaddockParade runners={replay.horses.map((h, i) => ({ id: h.horseId, name: h.name, gate: h.gate, appearance: h.appearance, stableName: connections[h.horseId]?.stableName ?? STABLES[i % STABLES.length]!, form: null }))} />,
    [replay, connections],
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
        debug={params.debug !== "0"}
        startAtMs={startAtMs}
        initialTimeSec={params.t !== undefined ? num(params.t, 0) : undefined}
        autoplay={params.paused === undefined}
        quality={(params.quality as "auto" | "high" | "low") ?? "auto"}
        initialCamera={params.camera as CameraMode | undefined}
        highlightHorseId={highlight}
        connections={connections}
        renderPortrait={renderFinalePortrait}
        finale={params.finale !== "0"}
        pixelated={params.pixel !== undefined}
        artBaseUrl={params.art === "none" ? null : "/art"}
        height={params.h !== undefined ? num(params.h, 420) : undefined}
        course={course}
        injuredHorseIds={params.pullup ? params.pullup.split(",") : undefined}
        resultsCard={params.results !== "0"}
        preOff={params.preoff === "1" ? true : params.preoff === "0" ? false : undefined}
        paddock={paddock}
      />
      {params.clip === "1" && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <ClipShareButton
            replay={replay}
            view={(new URLSearchParams(window.location.search).get("view") as "classic" | "trackside" | null) ?? undefined}
            highlightHorseId={highlight}
            mine={[highlight]}
            connections={connections}
            course={course}
            meta={{ courseName: course?.name ?? "Harrowdale" }}
            className="rv-btn"
          />
        </div>
      )}
    </main>
  );
}
