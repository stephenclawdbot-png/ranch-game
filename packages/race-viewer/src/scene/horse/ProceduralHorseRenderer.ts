/**
 * Procedural hero horse: layered vector shapes on a jointed rig.
 *
 * Units are centimetres, x forward (horse faces +x), y DOWN, ground at y = 0 and
 * the root origin at the nose tip. The scene scales the root by pixels-per-cm.
 * We see the horse's right side, so FR/HR are the near legs.
 */
import { Container, Graphics, Text, type Texture } from "pixi.js";
import { resolveHorseColors, type HorseColors } from "@thoroughbred/art-pipeline";
import type { LegMarking, ReplayHorse } from "@thoroughbred/shared";
import { bodyMotion, hoofTarget, legPhase, solveTwoBone, type LegId } from "./gait";
import type { HorsePose, HorseRenderer, HorseVisual, HorseVisualOptions } from "./HorseRenderer";
import { darken, hex, lerp, lighten, mix, rng, smoothClosed, smoothOpen, translatePts, type Pt } from "../draw";

const HALF_PI = Math.PI / 2;
const DEG = Math.PI / 180;

/** Torso origin (absolute rest pose). Torso parts are drawn relative to it. */
const T0: Pt = [-150, -122];
const NECK_PIVOT: Pt = [-104, -146];
const HEAD_PIVOT: Pt = [-46, -176];
const TAIL_ROOT: Pt = [-238, -150];
const SADDLE: Pt = [-150, -160];

interface LegSpec {
  id: LegId;
  kind: "fore" | "hind";
  pivot: Pt;
  upper: number;
  lower: number;
  pastern: number;
  near: boolean;
  /** Index into appearance.legs: FL, FR, HL, HR. */
  mark: number;
  /** Planted pastern angle (rad, y-down, from +x). */
  stanceAngle: number;
  /** Pastern flex relative to the cannon at full curl. */
  flexRel: number;
}

const LEG_SPECS: LegSpec[] = [
  { id: "HL", kind: "hind", pivot: [-206, -124], upper: 60, lower: 52, pastern: 17, near: false, mark: 2, stanceAngle: 64 * DEG, flexRel: 55 * DEG },
  { id: "FL", kind: "fore", pivot: [-90, -120], upper: 62, lower: 46, pastern: 17, near: false, mark: 0, stanceAngle: 60 * DEG, flexRel: 75 * DEG },
  { id: "HR", kind: "hind", pivot: [-212, -124], upper: 60, lower: 52, pastern: 17, near: true, mark: 3, stanceAngle: 64 * DEG, flexRel: 55 * DEG },
  { id: "FR", kind: "fore", pivot: [-96, -120], upper: 62, lower: 46, pastern: 17, near: true, mark: 1, stanceAngle: 60 * DEG, flexRel: 75 * DEG },
];

/** US saddle-cloth colours by program number: [cloth, number]. */
const SADDLE_CLOTHS: [number, number][] = [
  [0xd71920, 0xffffff],
  [0xf5f5f0, 0x111111],
  [0x1f4fb4, 0xffffff],
  [0xf6d61d, 0x111111],
  [0x13824a, 0xffffff],
  [0x161616, 0xf6d61d],
  [0xf47a20, 0x111111],
  [0xf39ac0, 0x111111],
  [0x3cc6c8, 0x111111],
  [0x7d3fa0, 0xffffff],
  [0x9a9a9a, 0xd71920],
  [0x9bd23c, 0x111111],
  [0x6b4226, 0xffffff],
  [0x7a1530, 0xf6d61d],
  [0xc3b48a, 0x111111],
  [0x8fc3ea, 0xd71920],
];

interface Palette {
  body: number;
  shade: number;
  highlight: number;
  mane: number;
  hoof: number;
  points: number;
  muzzle: number;
  marking: number;
  blackPoints: boolean;
}

function toPalette(c: HorseColors): Palette {
  const points = hex(c.points);
  const body = hex(c.body);
  return {
    body,
    shade: hex(c.shade),
    highlight: hex(c.highlight),
    mane: hex(c.mane),
    hoof: hex(c.hoof),
    points,
    muzzle: hex(c.muzzle),
    marking: hex(c.marking),
    blackPoints: lumin(points) < lumin(body) * 0.55,
  };
}

function lumin(c: number): number {
  return 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
}

/** Far-side parts are drawn in shadow. */
function farPalette(p: Palette): Palette {
  const d = (c: number) => mix(c, 0x1a1410, 0.38);
  return {
    ...p,
    body: d(p.body),
    shade: d(p.shade),
    highlight: d(p.highlight),
    points: d(p.points),
    hoof: d(p.hoof),
    marking: mix(p.marking, 0x6f6a62, 0.42),
  };
}

// ---------------------------------------------------------------------------
// Static part builders
// ---------------------------------------------------------------------------

const rel = (pts: readonly Pt[], o: Pt): Pt[] => translatePts(pts, -o[0], -o[1]);

const BODY: Pt[] = [
  [-110, -162], // withers
  [-128, -156],
  [-150, -151], // back
  [-176, -153], // loin
  [-200, -160], // croup
  [-224, -157],
  [-240, -146], // tail root
  [-247, -128], // buttock
  [-244, -110],
  [-230, -98],
  [-206, -98], // stifle / flank
  [-180, -96],
  [-152, -92], // belly
  [-124, -93], // girth
  [-104, -98],
  [-88, -108], // chest bottom
  [-80, -124], // chest
  [-80, -138], // point of shoulder
  [-90, -152],
];

function buildBody(p: Palette, coat: HorseColors["texture"], seed: number): Graphics {
  const g = new Graphics();
  const b = rel(BODY, T0);
  smoothClosed(g, b).fill(p.body);
  // Belly / underside shadow.
  smoothClosed(
    g,
    rel(
      [
        [-238, -116],
        [-214, -108],
        [-180, -104],
        [-150, -100],
        [-118, -102],
        [-92, -112],
        [-88, -104],
        [-104, -97],
        [-124, -92],
        [-152, -91],
        [-180, -95],
        [-206, -97],
        [-232, -100],
      ],
      T0,
    ),
  ).fill({ color: p.shade, alpha: 0.75 });
  // Topline rim light.
  smoothClosed(
    g,
    rel(
      [
        [-112, -160],
        [-150, -150],
        [-176, -152],
        [-202, -159],
        [-226, -155],
        [-236, -147],
        [-222, -150],
        [-200, -153],
        [-176, -147],
        [-150, -145],
        [-122, -153],
      ],
      T0,
    ),
  ).fill({ color: p.highlight, alpha: 0.55 });
  // Hindquarter muscle mass + highlight.
  smoothClosed(
    g,
    rel(
      [
        [-206, -150],
        [-228, -146],
        [-240, -130],
        [-234, -114],
        [-216, -110],
        [-204, -124],
      ],
      T0,
    ),
  ).fill({ color: p.highlight, alpha: 0.22 });
  // Shoulder mass.
  smoothClosed(
    g,
    rel(
      [
        [-112, -156],
        [-98, -140],
        [-86, -124],
        [-94, -112],
        [-112, -118],
        [-122, -140],
      ],
      T0,
    ),
  ).fill({ color: p.highlight, alpha: 0.16 });
  // Muscle definition strokes.
  smoothOpen(g, rel([[-114, -158], [-112, -138], [-100, -118], [-94, -108]], T0)).stroke({ width: 1.6, color: p.shade, alpha: 0.5 });
  smoothOpen(g, rel([[-204, -156], [-200, -136], [-208, -112], [-222, -102]], T0)).stroke({ width: 1.6, color: p.shade, alpha: 0.42 });
  smoothOpen(g, rel([[-170, -116], [-150, -110], [-128, -110]], T0)).stroke({ width: 1.2, color: p.shade, alpha: 0.28 });
  smoothOpen(g, rel([[-186, -130], [-178, -112]], T0)).stroke({ width: 1.1, color: p.shade, alpha: 0.25 });

  const r = rng(seed);
  if (coat === "dapple") {
    for (let i = 0; i < 46; i++) {
      const x = lerp(-236, -96, r());
      const y = lerp(-150, -104, r());
      g.circle(x - T0[0], y - T0[1], 2.2 + r() * 3.2).fill({ color: p.highlight, alpha: 0.38 });
    }
  } else if (coat === "roan") {
    for (let i = 0; i < 160; i++) {
      const x = lerp(-240, -88, r());
      const y = lerp(-152, -96, r());
      g.circle(x - T0[0], y - T0[1], 0.7 + r() * 0.8).fill({ color: 0xf2eee8, alpha: 0.35 });
    }
  }
  return g;
}

const NECK: Pt[] = [
  [-126, -156],
  [-106, -167],
  [-86, -176],
  [-66, -182],
  [-47, -186], // poll
  [-38, -172],
  [-40, -156], // throat latch
  [-52, -147],
  [-66, -135],
  [-78, -120],
  [-90, -108],
  [-106, -116],
];

const HEAD: Pt[] = [
  [-50, -182],
  [-38, -184],
  [-28, -177], // forehead
  [-18, -164],
  [-9, -149],
  [-2, -138], // nose
  [0, -131],
  [-2, -125], // upper lip
  [-8, -122],
  [-15, -122], // chin
  [-24, -128],
  [-34, -138], // jowl
  [-44, -150],
  [-50, -164],
];

function faceMarking(g: Graphics, face: string, color: number, o: Pt): void {
  const shape = (pts: Pt[]) => smoothClosed(g, rel(pts, o)).fill(color);
  switch (face) {
    case "star":
      shape([
        [-30, -177],
        [-25, -174],
        [-28, -169],
        [-32, -173],
      ]);
      break;
    case "snip":
      shape([
        [-5, -139],
        [-1.5, -134],
        [-2, -129],
        [-6, -133],
      ]);
      break;
    case "stripe":
      shape([
        [-27, -176],
        [-23, -171],
        [-9, -148],
        [-5, -140],
        [-8, -141],
        [-13, -150],
        [-26, -170],
      ]);
      break;
    case "blaze":
      shape([
        [-30, -179],
        [-25, -176],
        [-17, -163],
        [-7, -146],
        [-1.5, -136],
        [-1, -130],
        [-6, -131],
        [-11, -142],
        [-18, -154],
        [-28, -170],
      ]);
      break;
    case "bald":
      shape([
        [-34, -180],
        [-26, -178],
        [-16, -162],
        [-6, -145],
        [-0.5, -133],
        [-2, -126],
        [-9, -126],
        [-14, -136],
        [-22, -150],
        [-32, -168],
      ]);
      break;
    default:
      break;
  }
}

function buildHead(p: Palette, face: string, seed: number): Container {
  const c = new Container();
  const g = new Graphics();
  const o = HEAD_PIVOT;
  // Far ear (behind).
  g.poly(rel([[-46, -181], [-55, -197], [-50, -182]], o)).fill(p.shade);
  smoothClosed(g, rel(HEAD, o)).fill(p.body);
  // Jowl highlight + face plane shading.
  g.ellipse(-34 - o[0], -152 - o[1], 9, 11).fill({ color: p.highlight, alpha: 0.28 });
  smoothClosed(
    g,
    rel(
      [
        [-24, -130],
        [-12, -124],
        [-3, -127],
        [-6, -134],
        [-16, -138],
      ],
      o,
    ),
  ).fill({ color: p.muzzle, alpha: 0.85 });
  smoothOpen(g, rel([[-44, -168], [-36, -158], [-26, -150], [-16, -140]], o)).stroke({ width: 1.2, color: p.shade, alpha: 0.45 });
  faceMarking(g, face, p.marking, o);
  // Nostril, mouth.
  g.ellipse(-5 - o[0], -136 - o[1], 2.6, 1.6).fill(0x140d0b);
  smoothOpen(g, rel([[-2, -126], [-8, -126], [-13, -125]], o)).stroke({ width: 1, color: 0x140d0b, alpha: 0.7 });
  // Eye.
  g.ellipse(-31 - o[0], -167 - o[1], 3.1, 2.4).fill(0x0c0807);
  g.circle(-30 - o[0], -168 - o[1], 0.9).fill({ color: 0xffffff, alpha: 0.85 });
  smoothOpen(g, rel([[-35, -169], [-31, -171], [-27, -169]], o)).stroke({ width: 0.9, color: p.shade, alpha: 0.7 });
  // Near ear, pinned slightly back at speed.
  smoothClosed(g, rel([[-40, -181], [-44, -192], [-52, -199], [-50, -188], [-47, -181]], o)).fill(p.body);
  g.poly(rel([[-44, -184], [-50, -196], [-47, -184]], o)).fill({ color: p.shade, alpha: 0.7 });
  // Bridle: crown, browband, noseband, cheekpiece, bit.
  const strap = { width: 1.8, color: 0x1b1412 };
  smoothOpen(g, rel([[-43, -182], [-41, -168], [-38, -156]], o)).stroke(strap);
  smoothOpen(g, rel([[-37, -179], [-32, -176]], o)).stroke({ ...strap, color: 0xd8d2c4, width: 2 });
  smoothOpen(g, rel([[-38, -160], [-26, -148], [-11, -129]], o)).stroke(strap);
  const sheepskin = rng(seed)() < 0.35;
  smoothOpen(g, rel([[-20, -160], [-14, -148], [-8, -140]], o)).stroke(sheepskin ? { width: 5, color: 0xf4f0e6 } : strap);
  g.circle(-10 - o[0], -127 - o[1], 1.9).stroke({ width: 1, color: 0xc9c9c9 });
  c.addChild(g);
  return c;
}

function buildNeck(p: Palette): Graphics {
  const g = new Graphics();
  const o = NECK_PIVOT;
  smoothClosed(g, rel(NECK, o)).fill(p.body);
  // Underside shadow + crest light.
  smoothClosed(
    g,
    rel(
      [
        [-42, -156],
        [-56, -148],
        [-72, -138],
        [-86, -122],
        [-94, -118],
        [-82, -128],
        [-66, -144],
        [-48, -154],
      ],
      o,
    ),
  ).fill({ color: p.shade, alpha: 0.7 });
  smoothClosed(
    g,
    rel(
      [
        [-118, -158],
        [-96, -169],
        [-70, -179],
        [-50, -183],
        [-64, -176],
        [-90, -165],
      ],
      o,
    ),
  ).fill({ color: p.highlight, alpha: 0.4 });
  // Jugular groove.
  smoothOpen(g, rel([[-50, -158], [-70, -148], [-90, -132]], o)).stroke({ width: 1.1, color: p.shade, alpha: 0.4 });
  return g;
}

/** Hair tuft drawn along local -y (pointing up), base at the origin. */
function buildTuft(color: number, len: number, w: number): Graphics {
  const g = new Graphics();
  smoothClosed(g, [
    [-w * 0.5, 0],
    [-w * 0.45, -len * 0.4],
    [-w * 0.1, -len],
    [w * 0.2, -len * 0.55],
    [w * 0.5, 0],
  ]).fill(color);
  smoothOpen(g, [
    [0, -1],
    [-w * 0.1, -len * 0.7],
  ]).stroke({ width: 0.8, color: lighten(color, 0.18), alpha: 0.6 });
  return g;
}

/** Tail segment drawn along local +y. */
function buildTailSeg(color: number, len: number, w0: number, w1: number, seed: number): Graphics {
  const g = new Graphics();
  smoothClosed(g, [
    [-w0 / 2, -2],
    [w0 / 2, -2],
    [w1 / 2 + 1, len * 0.6],
    [w1 / 2, len + 2],
    [0, len + 4],
    [-w1 / 2, len + 2],
    [-w1 / 2 - 1, len * 0.6],
  ]).fill(color);
  const r = rng(seed);
  for (let i = 0; i < 4; i++) {
    const x = (r() - 0.5) * w1;
    smoothOpen(g, [
      [x * 0.6, 0],
      [x, len * 0.5],
      [x * 1.1 + (r() - 0.5) * 2, len + 1],
    ]).stroke({ width: 0.8, color: i % 2 ? lighten(color, 0.2) : darken(color, 0.3), alpha: 0.55 });
  }
  return g;
}

function legPaint(marking: LegMarking, p: Palette) {
  return {
    coronet: marking !== "none",
    sock: marking === "sock" || marking === "stocking",
    stocking: marking === "stocking",
    lower: p.blackPoints ? p.points : p.body,
  };
}

/** Upper bone, drawn along local +y from the pivot. Local +x = front of the leg. */
function buildUpper(spec: LegSpec, p: Palette, marking: LegMarking): Graphics {
  const g = new Graphics();
  const L = spec.upper;
  const lp = legPaint(marking, p);
  if (spec.kind === "fore") {
    const shape: Pt[] = [
      [-16, -18],
      [13, -18],
      [14, 4],
      [11, 22],
      [6, 44],
      [6.5, L - 6],
      [5, L + 3],
      [-5, L + 3],
      [-6, L - 8],
      [-6, 36],
      [-9, 14],
      [-13, 0],
    ];
    smoothClosed(g, shape).fill(p.body);
    smoothClosed(g, [[-13, -10], [-12, 8], [-7, 30], [-6, L - 4], [-2, L - 4], [-3, 30], [-6, 8], [-8, -10]]).fill({ color: p.shade, alpha: 0.6 });
    smoothClosed(g, [[6, -8], [11, 6], [8, 26], [5, 40], [4, 24], [5, 6]]).fill({ color: p.highlight, alpha: 0.3 });
    if (p.blackPoints || lp.stocking) {
      smoothClosed(g, [[6, L - 14], [6.5, L - 6], [5, L + 3], [-5, L + 3], [-6, L - 8], [-6, L - 16]]).fill(lp.stocking ? p.marking : p.points);
    }
  } else {
    // Gaskin with the lower thigh: thick at the top, hock at the bottom back.
    const shape: Pt[] = [
      [-25, -24],
      [17, -22],
      [16, 4],
      [10, 26],
      [5, 44],
      [5, L - 4],
      [3, L + 4],
      [-8, L + 3],
      [-10, L - 6],
      [-10, 40],
      [-18, 20],
      [-26, 0],
    ];
    smoothClosed(g, shape).fill(p.body);
    smoothClosed(g, [[-20, -6], [-14, 20], [-9, 40], [-9, L - 4], [-5, L - 4], [-6, 40], [-9, 20], [-13, -6]]).fill({ color: p.shade, alpha: 0.6 });
    smoothClosed(g, [[2, -12], [12, -6], [10, 14], [4, 30], [2, 14]]).fill({ color: p.highlight, alpha: 0.28 });
    if (lp.stocking) {
      smoothClosed(g, [[5, L - 10], [5, L - 4], [3, L + 4], [-8, L + 3], [-10, L - 6], [-9, L - 12]]).fill(p.marking);
    }
  }
  return g;
}

/** Cannon bone: knee/hock to fetlock along local +y. */
function buildLower(spec: LegSpec, p: Palette, marking: LegMarking): Graphics {
  const g = new Graphics();
  const L = spec.lower;
  const lp = legPaint(marking, p);
  const hind = spec.kind === "hind";
  const shape: Pt[] = hind
    ? [
        [-8, -4],
        [4, -4],
        [4, 8],
        [3.4, L - 8],
        [5, L - 2],
        [4, L + 3],
        [-5, L + 3],
        [-5.5, L - 4],
        [-4.5, L - 10],
        [-5, 8],
      ]
    : [
        [-5, -3],
        [5, -3],
        [4, 8],
        [3.6, L - 8],
        [5.5, L - 2],
        [4.5, L + 3],
        [-5, L + 3],
        [-5.5, L - 4],
        [-4.2, L - 10],
        [-4.5, 8],
      ];
  smoothClosed(g, shape).fill(lp.lower);
  smoothClosed(g, [[-4.5, 6], [-4.2, L - 10], [-5.5, L - 4], [-3, L - 4], [-2, L - 10], [-2.5, 6]]).fill({ color: darken(lp.lower, 0.35), alpha: 0.55 });
  // Tendon highlight.
  smoothOpen(g, [[2.5, 6], [2.2, L - 10]]).stroke({ width: 1, color: lighten(lp.lower, 0.25), alpha: 0.4 });
  if (lp.stocking) {
    smoothClosed(g, shape).fill(p.marking);
  } else if (lp.sock) {
    smoothClosed(g, [[3.6, L * 0.55], [3.4, L - 8], [5.5, L - 2], [4.5, L + 3], [-5, L + 3], [-5.5, L - 4], [-4.4, L * 0.55]]).fill(p.marking);
  }
  return g;
}

/** Pastern + hoof: fetlock to the ground-contact point at local (0, len). */
function buildPastern(spec: LegSpec, p: Palette, marking: LegMarking): Graphics {
  const g = new Graphics();
  const L = spec.pastern;
  const lp = legPaint(marking, p);
  // Sole direction in local space when planted, so the hoof sits flat on the ground.
  const a = HALF_PI - spec.stanceAngle;
  const sx = Math.cos(a);
  const sy = Math.sin(a);
  const toe: Pt = [sx * 6.5, L + sy * 6.5];
  const heel: Pt = [-sx * 4.5, L - sy * 4.5];
  smoothClosed(g, [
    [-4.5, -2],
    [4.5, -2],
    [3.4, L * 0.5],
    [3.6, L - 6],
    [-3.6, L - 6],
    [-3.8, L * 0.5],
  ]).fill(lp.coronet || lp.sock ? p.marking : lp.lower);
  g.poly([[-4.4, L - 7], [4.6, L - 8], toe, heel].flat()).fill(p.hoof);
  g.poly([[-4.4, L - 7], [4.6, L - 8], [4.2, L - 5.5], [-4.2, L - 5]].flat()).fill({ color: lighten(p.hoof, 0.25), alpha: 0.6 });
  return g;
}

interface LegRig {
  spec: LegSpec;
  root: Container;
  knee: Container;
  fet: Container;
  hoofX: number;
}

function buildLeg(spec: LegSpec, p: Palette, marking: LegMarking): LegRig {
  const root = new Container();
  const knee = new Container();
  const fet = new Container();
  root.addChild(buildUpper(spec, p, marking), knee);
  knee.y = spec.upper;
  knee.addChild(buildLower(spec, p, marking), fet);
  fet.y = spec.lower;
  fet.addChild(buildPastern(spec, p, marking));
  return { spec, root, knee, fet, hoofX: spec.pivot[0] };
}

// ---------------------------------------------------------------------------
// Jockey
// ---------------------------------------------------------------------------

interface RiderRig {
  root: Container;
  arm: Container;
  torso: Container;
  /** Shoulder position in rider space; hands are at HANDS when the arm is at rest. */
}

const R_SHOULDER: Pt = [-114, -201];
const R_HANDS: Pt = [-80, -168];

function buildRider(silks: HorseColors["silks"], silksTex: Texture): RiderRig {
  const root = new Container();
  const o = SADDLE;
  const skin = 0xd9a77f;
  const primary = hex(silks.primary);
  const secondary = hex(silks.secondary);
  const sleeve = silks.pattern === "solid" || silks.pattern === "sash" ? secondary : primary;

  // Leg: white breeches + black boot with tan cuff.
  const leg = new Graphics();
  smoothClosed(leg, rel([[-168, -190], [-148, -194], [-116, -184], [-108, -175], [-116, -168], [-150, -176], [-166, -178]], o)).fill(0xf3f1ea);
  smoothOpen(leg, rel([[-160, -180], [-132, -176], [-114, -172]], o)).stroke({ width: 1.2, color: 0xb9b5aa, alpha: 0.8 });
  smoothClosed(leg, rel([[-118, -180], [-108, -175], [-118, -150], [-121, -139], [-130, -140], [-126, -152]], o)).fill(0x16120f);
  smoothClosed(leg, rel([[-118, -181], [-108, -176], [-110, -171], [-120, -175]], o)).fill(0x8a5a33);
  smoothClosed(leg, rel([[-132, -142], [-120, -142], [-114, -136], [-127, -135]], o)).fill(0x16120f);
  // Stirrup.
  leg.rect(-131 - o[0], -136 - o[1], 14, 2.2).fill(0xb8b8b8);

  const torso = new Container();
  const tg = new Graphics();
  const torsoPts = rel(
    [
      [-172, -190],
      [-160, -199],
      [-138, -205],
      [-116, -210],
      [-104, -203],
      [-106, -192],
      [-122, -184],
      [-150, -180],
      [-168, -181],
    ],
    o,
  );
  smoothClosed(tg, torsoPts).fill({ texture: silksTex, textureSpace: "local" });
  // Shading on the silks so they read as cloth on a body.
  smoothClosed(tg, rel([[-168, -184], [-150, -181], [-122, -185], [-108, -192], [-112, -186], [-130, -181], [-150, -178], [-166, -179]], o)).fill({
    color: 0x000000,
    alpha: 0.22,
  });
  smoothOpen(tg, rel([[-166, -192], [-140, -203], [-116, -208]], o)).stroke({ width: 1.6, color: 0xffffff, alpha: 0.25 });
  // Head: face, goggles, skull cap with peak.
  tg.ellipse(-96 - o[0], -210 - o[1], 7.5, 8).fill(skin);
  smoothClosed(tg, rel([[-104, -214], [-96, -224], [-86, -221], [-84, -213], [-92, -211], [-102, -209]], o)).fill(hex(silks.cap));
  smoothClosed(tg, rel([[-90, -214], [-80, -213], [-79, -211], [-89, -211]], o)).fill(darken(hex(silks.cap), 0.25));
  tg.circle(-95 - o[0], -219 - o[1], 1.5).fill({ color: 0xffffff, alpha: 0.35 });
  tg.roundRect(-92 - o[0], -211 - o[1], 7, 3, 1.4).fill(0x20262c);
  tg.rect(-104 - o[0], -211 - o[1], 12, 1.4).fill(0x20262c);
  torso.addChild(tg);

  // Near arm (pivot at the shoulder) with glove.
  const arm = new Container();
  arm.position.set(R_SHOULDER[0] - o[0], R_SHOULDER[1] - o[1]);
  const ag = new Graphics();
  const ao = R_SHOULDER;
  smoothClosed(ag, rel([[-120, -205], [-108, -205], [-96, -188], [-84, -172], [-88, -167], [-102, -182], [-118, -194]], ao)).fill(sleeve);
  smoothOpen(ag, rel([[-116, -196], [-100, -184], [-88, -170]], ao)).stroke({ width: 1.2, color: 0x000000, alpha: 0.2 });
  ag.circle(R_HANDS[0] - ao[0], R_HANDS[1] - ao[1], 3.6).fill(0xf0eee8);
  arm.addChild(ag);

  root.addChild(leg, torso, arm);
  return { root, arm, torso };
}

// ---------------------------------------------------------------------------
// The horse visual
// ---------------------------------------------------------------------------

class ProceduralHorse implements HorseVisual {
  readonly view = new Container();
  private torso = new Container();
  private neck = new Container();
  private head: Container;
  private legs: LegRig[] = [];
  private tail: Container[] = [];
  private mane: Graphics[] = [];
  private rider: RiderRig;
  private reins = new Graphics();
  private seed: number;
  rise = 0;

  constructor(horse: ReplayHorse, opts: HorseVisualOptions) {
    const colors = resolveHorseColors(horse.appearance);
    const p = toPalette(colors);
    const fp = farPalette(p);
    this.seed = horse.gate * 7919 + horse.horseId.length * 31;

    // Far legs first (behind the body).
    for (const spec of LEG_SPECS) {
      const rig = buildLeg(spec, spec.near ? p : fp, horse.appearance.legs[spec.mark] ?? "none");
      this.legs.push(rig);
    }
    const far = this.legs.filter((l) => !l.spec.near);
    const near = this.legs.filter((l) => l.spec.near);

    // Torso: tail, body, neck/head, saddle cloth.
    this.torso.position.set(T0[0], T0[1]);
    const tailRoot = new Container();
    tailRoot.position.set(TAIL_ROOT[0] - T0[0], TAIL_ROOT[1] - T0[1]);
    let parent: Container = tailRoot;
    const segs: [number, number, number][] = [
      [24, 11, 12],
      [22, 12, 11],
      [22, 11, 6],
    ];
    segs.forEach(([len, w0, w1], i) => {
      const c = new Container();
      c.addChild(buildTailSeg(p.mane, len, w0, w1, this.seed + i));
      if (i > 0) c.y = segs[i - 1]![0];
      parent.addChild(c);
      this.tail.push(c);
      parent = c;
    });

    this.neck.position.set(NECK_PIVOT[0] - T0[0], NECK_PIVOT[1] - T0[1]);
    // Far-side mane strands peek above the crest.
    const crest: Pt[] = [
      [-112, -164],
      [-98, -169],
      [-86, -174],
      [-74, -178],
      [-62, -182],
      [-52, -184],
    ];
    const maneBack = new Graphics();
    smoothClosed(maneBack, rel([[-122, -160], [-100, -171], [-74, -182], [-50, -188], [-46, -183], [-70, -177], [-96, -167], [-118, -157]], NECK_PIVOT)).fill(
      p.mane,
    );
    this.neck.addChild(maneBack, buildNeck(p));
    this.head = buildHead(p, horse.appearance.face, this.seed);
    this.head.position.set(HEAD_PIVOT[0] - NECK_PIVOT[0], HEAD_PIVOT[1] - NECK_PIVOT[1]);
    this.neck.addChild(this.head);
    const tuftCount = opts.quality === "high" ? crest.length : 3;
    for (let i = 0; i < tuftCount; i++) {
      const pt = crest[Math.round((i * (crest.length - 1)) / Math.max(1, tuftCount - 1))]!;
      const t = buildTuft(p.mane, 12 + (i % 2) * 3, 9);
      t.position.set(pt[0] - NECK_PIVOT[0], pt[1] - NECK_PIVOT[1] + 2);
      this.neck.addChild(t);
      this.mane.push(t);
    }
    // Forelock.
    const forelock = buildTuft(p.mane, 9, 6);
    forelock.position.set(-42 - HEAD_PIVOT[0], -182 - HEAD_PIVOT[1]);
    forelock.rotation = 0.9;
    this.head.addChild(forelock);

    const body = buildBody(p, colors.texture, this.seed);
    // Saddle cloth with number, saddle, girth.
    const tack = new Graphics();
    const [cloth, numColor] = SADDLE_CLOTHS[(horse.gate - 1) % SADDLE_CLOTHS.length]!;
    tack.roundRect(-174 - T0[0], -158 - T0[1], 40, 28, 4).fill(cloth);
    tack.roundRect(-174 - T0[0], -158 - T0[1], 40, 28, 4).stroke({ width: 1, color: darken(cloth, 0.35), alpha: 0.7 });
    tack.rect(-174 - T0[0], -158 - T0[1], 40, 4).fill({ color: 0x000000, alpha: 0.15 });
    tack.rect(-138 - T0[0], -158 - T0[1], 6, 66).fill(0x2a211b);
    smoothClosed(tack, rel([[-170, -158], [-160, -165], [-140, -166], [-130, -160], [-140, -156], [-160, -156]], T0)).fill(0x2b1d14);
    const num = new Text({
      text: String(horse.gate),
      style: { fontFamily: "Arial, Helvetica, sans-serif", fontWeight: "800", fontSize: 18, fill: numColor },
      resolution: 3,
    });
    num.anchor.set(0.5);
    num.position.set(-158 - T0[0], -143 - T0[1]);
    this.torso.addChild(tailRoot, body, this.neck, tack, num);

    this.rider = buildRider(colors.silks, opts.silksTexture);

    for (const l of far) this.view.addChild(l.root);
    this.view.addChild(this.torso);
    for (const l of near) this.view.addChild(l.root);
    this.view.addChild(this.rider.root, this.reins);
  }

  hoofX(leg: LegId): number {
    return this.legs.find((l) => l.spec.id === leg)?.hoofX ?? -150;
  }

  update(pose: HorsePose): void {
    const g = Math.min(1, Math.max(0, pose.gallop));
    const motion = bodyMotion(pose.phase, g);
    const idle = 1 - g;
    const rise = motion.rise + idle * Math.sin(pose.time * 1.3 + this.seed) * 0.6;
    this.rise = rise;
    const pitch = motion.pitch;
    this.torso.position.set(T0[0], T0[1] - rise);
    this.torso.rotation = pitch;
    const cos = Math.cos(pitch);
    const sin = Math.sin(pitch);
    const tx = (lx: number, ly: number): Pt => [T0[0] + lx * cos - ly * sin, T0[1] - rise + lx * sin + ly * cos];

    // Neck nod + head counter-rotation.
    const neckRot = motion.neck + idle * (0.05 * Math.sin(pose.time * 0.8 + this.seed) - 0.06);
    this.neck.rotation = neckRot;
    this.head.rotation = -neckRot * 0.35 + idle * 0.12;

    // Legs.
    const sweep = pose.strideM * 100 * 0.18;
    for (const leg of this.legs) {
      const s = leg.spec;
      const ph = legPhase(pose.phase, s.id);
      const tgt = hoofTarget(s.kind, ph, sweep, g);
      const pivotLocal: Pt = [s.pivot[0] - T0[0] + tgt.pivotDx * g, s.pivot[1] - T0[1]];
      const [px, py] = tx(pivotLocal[0], pivotLocal[1]);
      // Standing pose: hooves under the pivots.
      const standX = s.pivot[0] + (s.kind === "fore" ? 2 : -6);
      const hx = lerp(standX, s.pivot[0] + tgt.x, g);
      const hy = -tgt.lift;
      const fx = hx - Math.cos(s.stanceAngle) * s.pastern;
      const fy = hy - Math.sin(s.stanceAngle) * s.pastern;
      const ik = solveTwoBone(px, py, fx, fy, s.upper, s.lower, s.kind === "fore" ? -1 : 1);
      leg.root.position.set(px, py);
      leg.root.rotation = ik.upper - HALF_PI;
      leg.knee.rotation = ik.lower - ik.upper;
      const flexAbs = ik.lower + s.flexRel;
      const pastern = lerp(s.stanceAngle, flexAbs, tgt.flex);
      leg.fet.rotation = pastern - ik.lower;
      leg.hoofX = hx;
    }

    // Tail streams back and waves with the stride.
    const tau = Math.PI * 2;
    const base = lerp(0.35, 1.25, g); // radians from straight down toward the back
    this.tail.forEach((seg, i) => {
      const wave = Math.sin(tau * (pose.phase - 0.15 * (i + 1))) * (0.12 + 0.07 * i) * g;
      const swish = idle * Math.sin(pose.time * 1.7 + i * 0.6 + this.seed) * 0.12;
      seg.rotation = (i === 0 ? base - pitch : 0.08 * g) + wave + swish;
    });
    this.mane.forEach((t, i) => {
      t.rotation = -1.0 - 0.25 * g + Math.sin(tau * (pose.phase - 0.08 * i) + i) * 0.22 * g + idle * 0.5;
    });

    // Rider: absorbs most of the horse's bounce, pumps when driving.
    const r = this.rider;
    const [sx, sy] = tx(SADDLE[0] - T0[0], SADDLE[1] - T0[1]);
    const settle = rise * 0.55;
    r.root.position.set(sx + 5, sy + 7 + settle - (1 - g) * 12);
    r.root.rotation = -pitch * 0.55 + (1 - g) * -0.08;
    const pump = pose.drive * Math.sin(tau * (pose.phase - 0.2));
    r.arm.rotation = pump * 0.32 + motion.neck * 0.6;
    r.torso.position.set(pump * 2.5, Math.abs(pump) * 1.5);
    r.torso.rotation = pump * 0.03;

    // Reins: hands -> bit.
    const ca = Math.cos(r.arm.rotation);
    const sa = Math.sin(r.arm.rotation);
    const hxL = R_HANDS[0] - R_SHOULDER[0];
    const hyL = R_HANDS[1] - R_SHOULDER[1];
    const handRx = R_SHOULDER[0] - SADDLE[0] + hxL * ca - hyL * sa;
    const handRy = R_SHOULDER[1] - SADDLE[1] + hxL * sa + hyL * ca;
    const cr = Math.cos(r.root.rotation);
    const sr = Math.sin(r.root.rotation);
    const handX = r.root.x + handRx * cr - handRy * sr;
    const handY = r.root.y + handRx * sr + handRy * cr;
    // Bit in neck space -> torso -> root.
    const cn = Math.cos(neckRot);
    const sn = Math.sin(neckRot);
    const ch = Math.cos(this.head.rotation);
    const sh = Math.sin(this.head.rotation);
    const bxH = -10 - HEAD_PIVOT[0];
    const byH = -127 - HEAD_PIVOT[1];
    const bxN = HEAD_PIVOT[0] - NECK_PIVOT[0] + bxH * ch - byH * sh;
    const byN = HEAD_PIVOT[1] - NECK_PIVOT[1] + bxH * sh + byH * ch;
    const [bx, by] = tx(NECK_PIVOT[0] - T0[0] + bxN * cn - byN * sn, NECK_PIVOT[1] - T0[1] + bxN * sn + byN * cn);
    const midX = (handX + bx) / 2;
    const midY = Math.max(handY, by) + 4;
    this.reins.clear();
    this.reins.moveTo(handX, handY).quadraticCurveTo(midX, midY, bx, by).stroke({ width: 1.4, color: 0x1b130e });
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

export class ProceduralHorseRenderer implements HorseRenderer {
  readonly kind = "procedural" as const;
  create(horse: ReplayHorse, opts: HorseVisualOptions): HorseVisual {
    return new ProceduralHorse(horse, opts);
  }
  destroy(): void {}
}
