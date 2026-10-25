/**
 * Rig definition (`apps/web/public/art/rig/horse-rig.json`), written by art-src/rig/build_rig.py.
 * Coordinates are *source* pixels (x right, y down) of the 128x96 PixelLab source sprites;
 * `rect` is in native atlas pixels (the PNG atlases are stored at `scale` x native).
 */

export type Vec2 = [number, number];

export const ROLES = [
  "none",
  "coat",
  "points",
  "mane",
  "hoof",
  "muzzle",
  "ink",
  "marking",
  "silksPrimary",
  "silksSecondary",
  "cap",
  "skin",
  "breeches",
  "boots",
  "tack",
  "saddlecloth",
] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_ID: Record<Role, number> = Object.fromEntries(ROLES.map((r, i) => [r, i])) as Record<Role, number>;
export const ROLE_COUNT = 16;

export interface RigPartDef {
  name: string;
  /** Native atlas rect [x, y, w, h]. Empty (w = 0) for code-drawn parts such as the rein. */
  rect: [number, number, number, number];
  /** Source-space position of the rect's top-left corner at rest. */
  origin: Vec2;
  /** Joint centre (source space). */
  pivot: Vec2;
  parent: string | null;
  /** Draw order, low = back. */
  z: number;
  side: "near" | "far";
  copyOf?: string;
  /** Variant slot ("head" | "mane" | "tail" | "build") this part belongs to, if any. */
  slot?: string;
  /** Variant index within the slot (default 0). Parts sharing a name share a bone. */
  variant?: number;
}

export interface RigDef {
  version: 1;
  /** Atlas PNG scale relative to native pixels (Scale2x passes, for RotSprite-style rotation). */
  scale: number;
  /** Native atlas size [w, h]. */
  atlas: Vec2;
  /** Source canvas size [w, h]. */
  canvas: Vec2;
  /** Ground line (source y) under the hooves. */
  groundY: number;
  roles: string[];
  parts: RigPartDef[];
  joints: Record<string, Vec2>;
  /** Torso frame in native atlas pixels: hip -> shoulder axis, for silks patterns. */
  silksFrame: { origin: Vec2; shoulder: Vec2 };
  textures: { index: string; normal: string; aux: string; index1x?: string };
}

/** Parts the gait code drives by name; a rig must provide all of them. */
export const REQUIRED_PARTS = [
  "barrel",
  "chest",
  "hindquarter",
  "neck",
  "head",
  "mane",
  "tail",
  "foreNearUpper",
  "foreNearLower",
  "foreNearHoof",
  "hindNearUpper",
  "hindNearLower",
  "hindNearHoof",
  "foreFarUpper",
  "foreFarLower",
  "foreFarHoof",
  "hindFarUpper",
  "hindFarLower",
  "hindFarHoof",
  "jTorso",
  "jHead",
  "jArmNear",
  "jArmFar",
  "jThigh",
  "jShin",
] as const;

export const REQUIRED_JOINTS = ["bit", "hand", "jKnee", "jAnkle", "jShoulder"] as const;

export class RigDefError extends Error {
  constructor(public readonly issues: string[]) {
    super(`invalid rig definition:\n  ${issues.join("\n  ")}`);
    this.name = "RigDefError";
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isVec2 = (v: unknown): v is Vec2 => Array.isArray(v) && v.length === 2 && v.every(isNum);

/**
 * Validate an untrusted horse-rig.json. Throws RigDefError listing every problem found.
 * (Hand-rolled rather than zod: pixel-rig ships to the browser and has no zod dependency.)
 */
export function parseRigDef(json: unknown): RigDef {
  const issues: string[] = [];
  const at = (path: string, msg: string) => issues.push(`${path}: ${msg}`);
  if (!json || typeof json !== "object") throw new RigDefError(["root: expected an object"]);
  const o = json as Record<string, unknown>;
  if (o.version !== 1) at("version", "expected 1");
  if (!isNum(o.scale) || o.scale < 1 || !Number.isInteger(Math.log2(o.scale))) at("scale", "expected a power of two >= 1");
  if (!isVec2(o.atlas)) at("atlas", "expected [w, h]");
  if (!isVec2(o.canvas)) at("canvas", "expected [w, h]");
  if (!isNum(o.groundY)) at("groundY", "expected a number");
  if (!Array.isArray(o.roles)) at("roles", "expected an array");
  else ROLES.forEach((r, i) => (o.roles as unknown[])[i] !== r && at(`roles[${i}]`, `expected "${r}"`));
  const names = new Set<string>();
  if (!Array.isArray(o.parts) || o.parts.length === 0) at("parts", "expected a non-empty array");
  else {
    o.parts.forEach((p: unknown, i: number) => {
      const path = `parts[${i}]`;
      if (!p || typeof p !== "object") return at(path, "expected an object");
      const q = p as Record<string, unknown>;
      if (typeof q.name !== "string" || !q.name) return at(`${path}.name`, "expected a string");
      const key = `${q.name}~${q.variant ?? 0}`;
      if (names.has(key)) at(`${path}.name`, `duplicate part "${q.name}" (variant ${q.variant ?? 0})`);
      names.add(key);
      names.add(q.name);
      if (q.slot !== undefined && typeof q.slot !== "string") at(`${path}.slot`, "expected a string");
      if (q.variant !== undefined && (!Number.isInteger(q.variant) || (q.variant as number) < 0)) at(`${path}.variant`, "expected an integer >= 0");
      if (!Array.isArray(q.rect) || q.rect.length !== 4 || !q.rect.every(isNum)) at(`${path}.rect`, "expected [x, y, w, h]");
      else if (isVec2(o.atlas)) {
        const [x, y, w, h] = q.rect as number[];
        const [aw, ah] = o.atlas as Vec2;
        if (x! < 0 || y! < 0 || x! + w! > aw || y! + h! > ah) at(`${path}.rect`, "outside the atlas");
      }
      if (!isVec2(q.origin)) at(`${path}.origin`, "expected [x, y]");
      if (!isVec2(q.pivot)) at(`${path}.pivot`, "expected [x, y]");
      if (q.parent !== null && typeof q.parent !== "string") at(`${path}.parent`, "expected a part name or null");
      if (!isNum(q.z)) at(`${path}.z`, "expected a number");
      if (q.side !== "near" && q.side !== "far") at(`${path}.side`, 'expected "near" | "far"');
    });
    for (const [i, p] of (o.parts as Record<string, unknown>[]).entries()) {
      if (typeof p?.parent === "string" && !names.has(p.parent)) at(`parts[${i}].parent`, `unknown part "${p.parent}"`);
    }
    for (const n of REQUIRED_PARTS) if (!names.has(n)) at("parts", `missing required part "${n}"`);
  }
  if (!o.joints || typeof o.joints !== "object") at("joints", "expected an object");
  else {
    const j = o.joints as Record<string, unknown>;
    for (const n of REQUIRED_JOINTS) if (!isVec2(j[n])) at(`joints.${n}`, "expected [x, y]");
  }
  const sf = o.silksFrame as Record<string, unknown> | undefined;
  if (!sf || !isVec2(sf.origin) || !isVec2(sf.shoulder)) at("silksFrame", "expected { origin, shoulder }");
  const tx = o.textures as Record<string, unknown> | undefined;
  if (!tx || typeof tx.index !== "string" || typeof tx.normal !== "string" || typeof tx.aux !== "string") {
    at("textures", "expected { index, normal, aux } file names");
  }
  if (issues.length) throw new RigDefError(issues);
  return json as RigDef;
}
