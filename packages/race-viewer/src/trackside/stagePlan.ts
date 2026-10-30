/**
 * What the Trackside view builds from the race stage (pure, no DOM): its props along the far
 * rail and the scenery layers, with Trackside's own projection choices (parallax depths).
 * The scene builds exactly this list, and `tracksideInventory` is what the guard test compares
 * with the 3D view's.
 */
import { inventoryOf, landmarkKey, type RaceStage, type StageInventory } from "../stage/buildRaceStage";
import type { PlateGrid } from "../stage/plates";

export interface TracksideProp {
  kind: "pole" | "board" | "post" | "judge";
  label: string;
  x: number;
  side: "far";
  /** Pole/post art (manifest src) or null for code-painted (judge's box). */
  art: string | null;
  plate: PlateGrid | null;
}

export interface TracksidePlan {
  props: TracksideProp[];
  stallsX: number;
  finishLineX: number;
  /** Parallax depth per backdrop layer (1 = moves with the track). */
  depth: { far: number; mid: number; stand: number };
  /** Art srcs the backdrop draws (far, midground, stand, rail decor, crowd). */
  scenery: string[];
}

export function tracksidePlan(stage: RaceStage): TracksidePlan {
  const lm = stage.landmarks;
  const props: TracksideProp[] = [
    ...lm.poles.map((p) => ({ kind: "pole" as const, label: p.label, x: p.x, side: p.side, art: "race/furlong-pole.png", plate: p.plate })),
    ...lm.boards.map((b) => ({ kind: "board" as const, label: b.label, x: b.x, side: b.side, art: "race/furlong-pole.png", plate: b.plate })),
    { kind: "judge", label: "judge", x: lm.judgeBox.x, side: "far", art: null, plate: null },
    { kind: "post", label: "post", x: lm.winningPost.x, side: "far", art: lm.winningPost.art, plate: null },
  ];
  const sc = stage.scenery;
  const scenery = [sc.far, ...sc.midTemplate.items.map((i) => i.src), sc.stand.src, ...sc.crowd.map((c) => c.src), `field:${sc.field.join(",")}`, `rail:${sc.railFill.join(",")}`];
  if (sc.railDecor) scenery.push(sc.railDecor.src);
  return { props, stallsX: lm.stalls.x, finishLineX: lm.finishLine.x, depth: { far: 0.08, mid: 0.3, stand: 0.16 }, scenery };
}

export function tracksideInventory(stage: RaceStage, plan = tracksidePlan(stage)): StageInventory {
  const keys = [landmarkKey("stalls", plan.stallsX, "track"), landmarkKey("line", plan.finishLineX, "track"), ...plan.props.map((p) => landmarkKey(`${p.kind}-${p.label}`, p.x, p.side))];
  return inventoryOf(keys, plan.scenery, stage.look);
}
