/**
 * Asset manifest: every visual slot the game needs, where its art comes from and
 * whether it is approved for use. Renderers ask `resolveAsset` for a slot and fall
 * back to procedural drawing until an approved sprite sheet with a `src` exists.
 */
import { z } from "zod";

export const AssetKindSchema = z.enum([
  "horse_body",
  "horse_markings",
  "jockey",
  "silks",
  "track_layer",
  "building",
  "prop",
  "vfx",
  "weather_overlay",
  "ui_portrait",
]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetOriginSchema = z.enum(["placeholder", "pixellab", "manual"]);
export type AssetOrigin = z.infer<typeof AssetOriginSchema>;

export const AssetStatusSchema = z.enum(["placeholder", "pending_review", "approved"]);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

/** Draw-order band. Mirrors the race viewer's layer stack (back to front). */
export const DepthBandSchema = z.enum(["sky", "far", "mid", "track", "near", "overlay"]);
export type DepthBand = z.infer<typeof DepthBandSchema>;

export const OptimizationTierSchema = z.enum(["hero", "standard", "background"]);
export type OptimizationTier = z.infer<typeof OptimizationTierSchema>;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Unit = z.number().min(0).max(1);

export const AnimationRangeSchema = z
  .object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
    loop: z.boolean().default(true),
  })
  .refine((r) => r.to >= r.from, { message: "animation range `to` must be >= `from`" });
export type AnimationRange = z.infer<typeof AnimationRangeSchema>;

export const AssetEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_.-]+$/, "ids are lowercase dotted slugs"),
    kind: AssetKindSchema,
    origin: AssetOriginSchema,
    /** SPDX id or a short licence note ("internal-procedural", "PixelLab commercial"...). */
    license: z.string().min(1),
    status: AssetStatusSchema,
    frameCount: z.number().int().min(1),
    frameWidth: z.number().int().min(1),
    frameHeight: z.number().int().min(1),
    fps: z.number().min(0),
    /**
     * Pivot inside a frame, 0..1. Horse/jockey sheets use "nose tip at ground level"
     * so the viewer can place the frame directly at the horse's race distance.
     */
    anchor: z.object({ x: Unit, y: Unit }),
    depthBand: DepthBandSchema,
    palette: z.array(HexColor),
    variants: z.array(z.string().min(1)),
    /** Prompt used to generate the art (PixelLab), kept for reproducibility. */
    sourcePrompt: z.string().nullable(),
    optimizationTier: OptimizationTierSchema,
    /** Atlas / sprite-sheet path (relative to the public asset root). Null = no art yet. */
    src: z.string().min(1).nullable(),
    animations: z.record(z.string(), AnimationRangeSchema).optional(),
  })
  .superRefine((e, ctx) => {
    for (const [name, r] of Object.entries(e.animations ?? {})) {
      if (r.to >= e.frameCount) {
        ctx.addIssue({
          code: "custom",
          path: ["animations", name],
          message: `animation "${name}" ends at frame ${r.to} but the sheet has ${e.frameCount} frames`,
        });
      }
    }
    if (e.status === "approved" && e.src === null) {
      ctx.addIssue({ code: "custom", path: ["src"], message: "an approved asset needs a src" });
    }
    if (e.origin === "placeholder" && e.status !== "placeholder") {
      ctx.addIssue({ code: "custom", path: ["status"], message: "placeholder-origin assets must keep status placeholder" });
    }
  });
export type AssetEntry = z.infer<typeof AssetEntrySchema>;

export const AssetManifestSchema = z
  .object({
    version: z.literal(1),
    assets: z.array(AssetEntrySchema),
  })
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    m.assets.forEach((a, i) => {
      if (seen.has(a.id)) {
        ctx.addIssue({ code: "custom", path: ["assets", i, "id"], message: `duplicate asset id "${a.id}"` });
      }
      seen.add(a.id);
    });
  });
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

// ---------------------------------------------------------------------------
// Default manifest: every slot the brief needs, all procedural placeholders.
// ---------------------------------------------------------------------------

type Slot = Partial<AssetEntry> & Pick<AssetEntry, "id" | "kind" | "depthBand">;

function placeholder(s: Slot): AssetEntry {
  return {
    origin: "placeholder",
    license: "internal-procedural",
    status: "placeholder",
    frameCount: 1,
    frameWidth: 256,
    frameHeight: 256,
    fps: 0,
    anchor: { x: 0.5, y: 1 },
    palette: [],
    variants: [],
    sourcePrompt: null,
    optimizationTier: "standard",
    src: null,
    ...s,
  };
}

/** Nose tip at ground level, used by every horse/jockey sheet. */
const NOSE_ANCHOR = { x: 0.94, y: 0.97 };
const COATS = [
  "bay",
  "dark_bay",
  "chestnut",
  "liver_chestnut",
  "black",
  "grey",
  "dapple_grey",
  "palomino",
  "buckskin",
  "roan",
];

const horseCycle = (gait: string, frames: number, fps: number): AssetEntry =>
  placeholder({
    id: `horse.body.${gait}`,
    kind: "horse_body",
    depthBand: "track",
    frameCount: frames,
    frameWidth: 320,
    frameHeight: 240,
    fps,
    anchor: NOSE_ANCHOR,
    variants: COATS,
    optimizationTier: "hero",
    animations: { [gait]: { from: 0, to: frames - 1, loop: true } },
  });

const markings = (id: string, variants: string[]): AssetEntry =>
  placeholder({
    id,
    kind: "horse_markings",
    depthBand: "track",
    frameCount: 12,
    frameWidth: 320,
    frameHeight: 240,
    fps: 24,
    anchor: NOSE_ANCHOR,
    palette: ["#f2efe8"],
    variants,
    optimizationTier: "hero",
  });

const layer = (id: string, depthBand: AssetEntry["depthBand"], w = 2048, h = 512): AssetEntry =>
  placeholder({
    id,
    kind: "track_layer",
    depthBand,
    frameWidth: w,
    frameHeight: h,
    anchor: { x: 0, y: 1 },
    optimizationTier: "background",
  });

export const defaultManifest: AssetManifest = {
  version: 1,
  assets: [
    // Horses: one cycle per gait; the frame is picked from the stride phase.
    horseCycle("gallop", 12, 24),
    horseCycle("canter", 10, 16),
    horseCycle("walk", 8, 8),
    horseCycle("idle", 6, 6),
    markings("horse.markings.face", ["star", "snip", "stripe", "blaze", "bald"]),
    markings("horse.markings.legs", ["coronet", "sock", "stocking"]),
    // Jockey + silks (silks are greyscale masks tinted with primary/secondary).
    placeholder({
      id: "jockey.crouch",
      kind: "jockey",
      depthBand: "track",
      frameCount: 12,
      frameWidth: 320,
      frameHeight: 240,
      fps: 24,
      anchor: NOSE_ANCHOR,
      optimizationTier: "hero",
      animations: { ride: { from: 0, to: 7, loop: true }, drive: { from: 8, to: 11, loop: true } },
    }),
    placeholder({
      id: "jockey.upright",
      kind: "jockey",
      depthBand: "track",
      frameCount: 6,
      frameWidth: 320,
      frameHeight: 240,
      fps: 8,
      anchor: NOSE_ANCHOR,
      optimizationTier: "hero",
    }),
    placeholder({
      id: "silks.patterns",
      kind: "silks",
      depthBand: "track",
      frameWidth: 64,
      frameHeight: 48,
      variants: ["solid", "hoops", "stripes", "chevron", "diamonds", "sash", "quartered", "stars"],
      optimizationTier: "hero",
    }),
    // Track layers, back to front.
    layer("track.sky", "sky", 1024, 512),
    layer("track.far_hills", "far"),
    layer("track.city", "far"),
    layer("track.grandstand", "mid"),
    placeholder({
      id: "track.crowd",
      kind: "track_layer",
      depthBand: "mid",
      frameCount: 4,
      frameWidth: 512,
      frameHeight: 128,
      fps: 6,
      anchor: { x: 0, y: 1 },
      optimizationTier: "background",
    }),
    layer("track.inner_rail", "track", 512, 64),
    layer("track.surface.turf", "track", 512, 256),
    layer("track.surface.dirt", "track", 512, 256),
    layer("track.outer_rail", "near", 512, 96),
    layer("track.hedge", "near", 1024, 128),
    // Props.
    placeholder({ id: "prop.finish_post", kind: "prop", depthBand: "track", frameWidth: 64, frameHeight: 256 }),
    placeholder({
      id: "prop.furlong_pole",
      kind: "prop",
      depthBand: "track",
      frameWidth: 48,
      frameHeight: 192,
      variants: ["1f", "2f", "3f", "4f", "5f", "6f", "7f", "8f"],
    }),
    placeholder({ id: "prop.starting_gate", kind: "prop", depthBand: "track", frameWidth: 512, frameHeight: 256 }),
    // VFX.
    placeholder({ id: "vfx.dust", kind: "vfx", depthBand: "track", frameCount: 8, frameWidth: 64, frameHeight: 64, fps: 16 }),
    placeholder({ id: "vfx.turf_clods", kind: "vfx", depthBand: "track", frameCount: 6, frameWidth: 32, frameHeight: 32, fps: 16 }),
    // Weather overlays.
    placeholder({ id: "weather.rain", kind: "weather_overlay", depthBand: "overlay", frameCount: 8, frameWidth: 512, frameHeight: 512, fps: 24, anchor: { x: 0, y: 0 } }),
    placeholder({ id: "weather.dusk", kind: "weather_overlay", depthBand: "overlay", frameWidth: 1024, frameHeight: 512, anchor: { x: 0, y: 0 } }),
    // UI scenes (later milestones).
    placeholder({ id: "building.stable", kind: "building", depthBand: "mid", frameWidth: 1024, frameHeight: 768 }),
    placeholder({ id: "building.barn", kind: "building", depthBand: "mid", frameWidth: 1024, frameHeight: 768 }),
    placeholder({ id: "building.podium", kind: "building", depthBand: "mid", frameWidth: 768, frameHeight: 512 }),
    placeholder({ id: "building.market", kind: "building", depthBand: "mid", frameWidth: 1024, frameHeight: 768 }),
    placeholder({
      id: "ui.portrait.horse",
      kind: "ui_portrait",
      depthBand: "overlay",
      frameWidth: 256,
      frameHeight: 256,
      variants: COATS,
      optimizationTier: "hero",
    }),
    placeholder({ id: "ui.portrait.jockey", kind: "ui_portrait", depthBand: "overlay", frameWidth: 256, frameHeight: 256 }),
  ],
};
