import { describe, expect, it } from "vitest";
import { CoatSchema, type HorseAppearance } from "@thoroughbred/shared";
import {
  AssetManifestSchema,
  COAT_PALETTES,
  ManualImportAdapter,
  PixelLabNotConfiguredError,
  UnconfiguredPixelLabAdapter,
  defaultManifest,
  resolveAsset,
  resolveHorseColors,
  type AssetEntry,
} from "./index";

const hex = /^#[0-9a-f]{6}$/i;

describe("asset manifest", () => {
  it("default manifest validates and is all placeholders", () => {
    const parsed = AssetManifestSchema.parse(defaultManifest);
    expect(parsed.assets.length).toBeGreaterThan(20);
    for (const a of parsed.assets) {
      expect(a.status).toBe("placeholder");
      expect(a.src).toBeNull();
    }
  });

  it("covers every slot the race viewer needs", () => {
    const ids = new Set(defaultManifest.assets.map((a) => a.id));
    for (const id of [
      "horse.body.gallop",
      "horse.body.canter",
      "horse.body.walk",
      "horse.body.idle",
      "jockey.crouch",
      "jockey.upright",
      "silks.patterns",
      "track.sky",
      "track.far_hills",
      "track.grandstand",
      "track.crowd",
      "track.inner_rail",
      "track.surface.turf",
      "track.surface.dirt",
      "track.outer_rail",
      "track.hedge",
      "prop.finish_post",
      "prop.furlong_pole",
      "weather.rain",
      "weather.dusk",
      "building.stable",
      "building.podium",
      "ui.portrait.horse",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("rejects duplicate ids and animation ranges past the sheet", () => {
    const a = defaultManifest.assets[0]!;
    expect(AssetManifestSchema.safeParse({ version: 1, assets: [a, a] }).success).toBe(false);
    const bad = { ...a, animations: { gallop: { from: 0, to: 99, loop: true } } };
    expect(AssetManifestSchema.safeParse({ version: 1, assets: [bad] }).success).toBe(false);
  });
});

describe("resolveAsset", () => {
  const approved: AssetEntry = {
    ...defaultManifest.assets[0]!,
    origin: "pixellab",
    status: "approved",
    src: "/art/horse-gallop.png",
    sourcePrompt: "side view galloping thoroughbred",
  };

  it("falls back for placeholders and missing slots", () => {
    expect(resolveAsset(defaultManifest, "horse.body.gallop")).toMatchObject({ fallback: true, reason: "not_approved" });
    expect(resolveAsset(defaultManifest, "nope")).toEqual({ entry: undefined, fallback: true, reason: "missing" });
  });

  it("falls back for pending review even with a src", () => {
    const m = { version: 1 as const, assets: [{ ...approved, status: "pending_review" as const }] };
    expect(resolveAsset(m, approved.id).fallback).toBe(true);
  });

  it("uses approved art with a src", () => {
    const m = { version: 1 as const, assets: [approved] };
    expect(resolveAsset(m, approved.id)).toMatchObject({ fallback: false, reason: "approved" });
  });
});

describe("palettes", () => {
  it("cover every coat with valid hex colours", () => {
    for (const coat of CoatSchema.options) {
      const p = COAT_PALETTES[coat];
      expect(p, coat).toBeDefined();
      for (const k of ["body", "shade", "highlight", "mane", "hoof", "points", "muzzle"] as const) {
        expect(p[k], `${coat}.${k}`).toMatch(hex);
      }
    }
  });

  it("bay has black points and mane; mane override wins", () => {
    const app: HorseAppearance = {
      coat: "bay",
      face: "blaze",
      legs: ["none", "sock", "none", "none"],
      silks: { primary: "#112233", secondary: "#ffffff", pattern: "hoops", cap: "#ff0000" },
    };
    const c = resolveHorseColors(app);
    expect(c.mane).toBe(COAT_PALETTES.bay.mane);
    expect(c.points).toBe(COAT_PALETTES.bay.points);
    expect(resolveHorseColors({ ...app, maneColor: "#abcdef" }).mane).toBe("#abcdef");
    expect(c.silks.pattern).toBe("hoops");
  });
});

describe("adapters", () => {
  it("unconfigured PixelLab adapter refuses clearly", async () => {
    const px = new UnconfiguredPixelLabAdapter();
    expect(px.isConfigured()).toBe(false);
    await expect(px.getBalance()).rejects.toBeInstanceOf(PixelLabNotConfiguredError);
    await expect(
      px.generateSpriteSheet({ assetId: "horse.body.gallop", prompt: "x", frameCount: 12, frameWidth: 320, frameHeight: 240 }),
    ).rejects.toThrow(/not configured/);
  });

  it("manual import validates, lands as pending_review, then approves", () => {
    const imp = new ManualImportAdapter();
    const base = defaultManifest.assets.find((a) => a.id === "horse.body.gallop")!;
    expect(imp.validate({ ...base }).ok).toBe(false); // placeholder origin, no src
    expect(imp.validate({ id: "x" }).ok).toBe(false);
    const { manifest, result } = imp.importInto(defaultManifest, {
      ...base,
      origin: "manual",
      status: "pending_review",
      src: "/art/gallop.png",
    });
    expect(result.ok).toBe(true);
    expect(resolveAsset(manifest, base.id).fallback).toBe(true);
    const approved = imp.approve(manifest, base.id);
    expect(resolveAsset(approved, base.id).fallback).toBe(false);
    expect(() => imp.approve(defaultManifest, base.id)).toThrow();
    expect(AssetManifestSchema.safeParse(approved).success).toBe(true);
  });
});
