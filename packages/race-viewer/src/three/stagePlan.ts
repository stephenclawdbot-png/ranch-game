/**
 * What the 3D view builds from the race stage (pure, no three.js): world positions of the
 * landmarks and scenery billboards. Only the projection is the 3D view's own (depth rows, the
 * far rail's z); the items, their x along the course and their art come from the stage, so the
 * guard test can compare `hd2dInventory` with Trackside's.
 */
import { MID_SPREAD_PX_PER_M, elevationAt, inventoryOf, landmarkKey, type RaceStage, type StageInventory, type StageMidItem } from "../stage/buildRaceStage";
import type { PlateGrid } from "../stage/plates";

export const TRACK_PRE = 180;
export const TRACK_POST = 340;

export interface Hd2dProp {
  kind: "pole" | "board" | "post" | "judge";
  label: string;
  x: number;
  y: number;
  z: number;
  side: "far";
  art: string | null;
  plate: PlateGrid | null;
}

export interface Hd2dPlan {
  trackW: number;
  farZ: number;
  props: Hd2dProp[];
  /** Midground billboards: the stage's row plus a deeper echo row of the same items. */
  mid: (StageMidItem & { y: number; z: number })[];
  railDecor: { src: string; x: number; y: number; z: number; w: number; h: number; flip: boolean }[];
  stand: { src: string; x: number; y: number; z: number; w: number; h: number };
  crowd: { src: string; x0: number; x1: number; y: number; z: number; h: number }[];
  scenery: string[];
}

export function laneZ(stage: RaceStage, lane: number): number {
  return -(stage.lanes.railGapM + lane * stage.lanes.widthM);
}

export function trackWidth(stage: RaceStage): number {
  return stage.lanes.railGapM * 2 + (stage.lanes.count - 1) * stage.lanes.widthM;
}

export function hd2dPlan(stage: RaceStage): Hd2dPlan {
  const trackW = trackWidth(stage);
  const farZ = -trackW;
  const el = (x: number) => elevationAt(stage.elevation, x);
  const lm = stage.landmarks;
  const inside = farZ + 0.45;
  const props: Hd2dProp[] = [
    ...lm.poles.map((p) => ({ kind: "pole" as const, label: p.label, x: p.x, y: el(p.x), z: inside, side: p.side, art: "race/furlong-pole.png", plate: p.plate })),
    ...lm.boards.map((b) => ({ kind: "board" as const, label: b.label, x: b.x, y: el(b.x), z: inside, side: b.side, art: "race/furlong-pole.png", plate: b.plate })),
    { kind: "judge", label: "judge", x: lm.judgeBox.x, y: el(lm.judgeBox.x), z: farZ - lm.judgeBox.depthM, side: "far", art: null, plate: null },
    { kind: "post", label: "post", x: lm.winningPost.x, y: el(lm.winningPost.x), z: inside, side: "far", art: lm.winningPost.art, plate: null },
  ];
  const sc = stage.scenery;
  const periodM = sc.mid.length > 1 ? sc.midTemplate.period / MID_SPREAD_PX_PER_M : 100;
  const mid = [
    ...sc.mid.map((m) => ({ ...m, y: el(m.xM), z: farZ - m.depthM })),
    ...sc.mid.map((m) => ({ ...m, xM: m.xM + periodM / 2, depthM: m.depthM * 1.8 + 40, y: el(m.xM + periodM / 2), z: farZ - (m.depthM * 1.8 + 40) })),
  ];
  const railDecor: Hd2dPlan["railDecor"] = [];
  if (sc.railDecor) {
    const d = sc.railDecor;
    let i = 0;
    for (let x = -TRACK_PRE + 10; x < stage.L + TRACK_POST - 10; x += d.everyM, i++) {
      railDecor.push({ src: d.src, x, y: el(x) + d.liftM, z: farZ - 0.35, w: d.widthM, h: d.heightM, flip: i % 2 === 1 });
    }
  }
  const st = sc.stand;
  const scenery = [sc.far, ...sc.mid.map((m) => m.src), st.src, ...sc.crowd.map((c) => c.src), `field:${sc.field.join(",")}`, `rail:${sc.railFill.join(",")}`];
  if (sc.railDecor) scenery.push(sc.railDecor.src);
  return {
    trackW,
    farZ,
    props,
    mid,
    railDecor,
    stand: { src: st.src, x: st.centreX, y: el(st.centreX), z: farZ - st.depthM, w: st.widthM, h: st.heightM },
    crowd: sc.crowd.map((c) => ({ src: c.src, x0: c.fromX, x1: c.toX, y: el(c.fromX), z: farZ - 1.3, h: 128 / 96 })),
    scenery,
  };
}

export function hd2dInventory(stage: RaceStage, plan = hd2dPlan(stage)): StageInventory {
  const keys = [landmarkKey("stalls", stage.landmarks.stalls.x, "track"), landmarkKey("line", stage.landmarks.finishLine.x, "track"), ...plan.props.map((p) => landmarkKey(`${p.kind}-${p.label}`, p.x, p.side))];
  return inventoryOf(keys, plan.scenery, stage.look);
}
