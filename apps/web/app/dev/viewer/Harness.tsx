"use client";
import { useEffect, useMemo } from "react";
import { RaceViewer, ClipShareButton, type CameraMode } from "@thoroughbred/race-viewer";
import { SpriteSheet, fakeLiveFeed, fakeReplay } from "@thoroughbred/race-viewer/dev";
import type { RaceReplay, Surface, Weather } from "@thoroughbred/shared";
import * as gc from "@thoroughbred/game-core";
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
  /** "1": every runner ridden by a named jockey (alternating women and men), with a look and patterned silks. */
  riders?: string;
}

const RIDER_SILKS = [
  { primary: "#1f4d8a", secondary: "#f2d64b", cap: "#f2d64b", pattern: "hoops" },
  { primary: "#b0392e", secondary: "#f3e7c9", cap: "#b0392e", pattern: "sash" },
  { primary: "#2f6b3a", secondary: "#f3e7c9", cap: "#2f6b3a", pattern: "quartered" },
  { primary: "#6b2b8a", secondary: "#e0a030", cap: "#e0a030", pattern: "stars" },
  { primary: "#111111", secondary: "#e8e8e8", cap: "#e8e8e8", pattern: "stripes" },
  { primary: "#d06a20", secondary: "#203060", cap: "#203060", pattern: "diamonds" },
  { primary: "#f3e7c9", secondary: "#7a1f1f", cap: "#7a1f1f", pattern: "chevron" },
  { primary: "#3a8ab0", secondary: "#ffffff", cap: "#3a8ab0", pattern: "solid" },
] as const;

/** The harness field with named jockeys: looks picked as the game picks them, women and men in turn. */
export function withHarnessRiders(replay: RaceReplay): RaceReplay {
  const active: gc.JockeyLook[] = [];
  return {
    ...replay,
    horses: replay.horses.map((h, i) => {
      const look = gc.pickJockeyLook({ seed: `harness-${i}`, stage: gc.JOCKEY_STAGES[i % 3]!, gender: i % 2 === 0 ? "f" : "m" }, active);
      active.push(look);
      const rl = gc.riderLookOf(look);
      return { ...h, appearance: { ...h.appearance, silks: { ...RIDER_SILKS[i % RIDER_SILKS.length]! }, rider: { skin: [...rl.skin] as [string, string, string], hair: [...rl.hair] as [string, string, string], long: rl.long, gender: rl.gender } } };
    }),
  };
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export function ViewerHarness({ params }: { params: HarnessParams }) {
  const course = useMemo(() => COURSES.find((c) => c.id === params.course || c.name.toLowerCase() === params.course?.toLowerCase()) ?? null, [params.course]);
  const replay = useMemo(
    () => {
      const r = fakeReplay({
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
      });
      return params.riders === "1" ? withHarnessRiders(r) : r;
    },
    [params.horses, params.seed, params.distance, params.weather, params.surface, course, params.hour, params.photo, params.spread, params.riders],
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
