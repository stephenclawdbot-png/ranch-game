import { describe, expect, it } from "vitest";
import { CoatSchema, type HorseAppearance, type HorseColour } from "@thoroughbred/shared";
import {
  AssetManifestSchema,
  COAT_PALETTES,
  ManualImportAdapter,
  PixelLabNotConfiguredError,
  UnconfiguredPixelLabAdapter,
  coatPaletteOf,
  defaultManifest,
  resolveAsset,
  resolveHorseColors,
  type AssetEntry,
} from "./index";

const hex = /^#[0-9a-f]{6}$/i;

const app0: HorseAppearance = {
  coat: "bay",
  face: "blaze",
  legs: ["none", "sock", "none", "none"],
  silks: { primary: "#112233", secondary: "#ffffff", pattern: "hoops", cap: "#ff0000" },
};

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
    const c = resolveHorseColors(app0);
    expect(c.mane).toBe(COAT_PALETTES.bay.mane);
    expect(c.points).toBe(COAT_PALETTES.bay.points);
    expect(resolveHorseColors({ ...app0, maneColor: "#abcdef" }).mane).toBe("#abcdef");
    expect(c.silks.pattern).toBe("hoops");
  });

  it("legacy appearance (no colour) resolves to the fixed coat palette byte-for-byte", () => {
    for (const coat of CoatSchema.options) {
      const app = { coat, face: "none" as const, legs: ["none", "none", "none", "none"] as const, silks: app0.silks };
      expect(coatPaletteOf(app as HorseAppearance)).toEqual(COAT_PALETTES[coat]);
      expect(resolveHorseColors(app as HorseAppearance)).toMatchObject(COAT_PALETTES[coat]);
    }
  });
});

describe("coat anchors v2 (layered genetics)", () => {
  type Row = [
    name: string,
    colour: Partial<HorseColour>,
    want: { body: string; shade: string; highlight: string; mane: string; points: string; stripe?: string; eye?: string },
  ];
  const rows: Row[] = [
    ["Bay", { base: "bay", cream: 0 }, { body: "#8a4527", shade: "#5a2a16", highlight: "#b5683d", mane: "#17100d", points: "#1b1310" }],
    ["Seal brown", { base: "seal_brown", cream: 0 }, { body: "#4d2618", shade: "#2e150c", highlight: "#74402a", mane: "#110b09", points: "#140d0b" }],
    ["Chestnut", { base: "chestnut", cream: 0 }, { body: "#a4552b", shade: "#73371a", highlight: "#d07f47", mane: "#c58a4d", points: "#93491f" }],
    ["Liver chestnut", { base: "liver", cream: 0 }, { body: "#5e2e1a", shade: "#3d1c0f", highlight: "#83472a", mane: "#6f3b22", points: "#522715" }],
    ["Black", { base: "black", cream: 0 }, { body: "#1f1c1c", shade: "#0f0d0d", highlight: "#47403e", mane: "#0b0a0a", points: "#141212" }],
    ["Buckskin", { base: "bay", cream: 1 }, { body: "#c9a063", shade: "#94713b", highlight: "#e2bf82", mane: "#1a1410", points: "#1b1512" }],
    ["Smoky brown", { base: "seal_brown", cream: 1 }, { body: "#8c6a45", shade: "#5e4529", highlight: "#ad8b62", mane: "#16100c", points: "#18110d" }],
    ["Palomino", { base: "chestnut", cream: 1 }, { body: "#d9b56a", shade: "#a8843f", highlight: "#f0d48f", mane: "#f3ead2", points: "#cfa95e" }],
    ["Dark palomino", { base: "liver", cream: 1 }, { body: "#b08a4c", shade: "#7f6232", highlight: "#cfaa6c", mane: "#e9dcbc", points: "#a57f43" }],
    ["Smoky black", { base: "black", cream: 1 }, { body: "#3a302a", shade: "#221c19", highlight: "#5d4d43", mane: "#120f0e", points: "#1a1614" }],
    ["Perlino (bay)", { base: "bay", cream: 2 }, { body: "#ecdcb8", shade: "#cdb98f", highlight: "#f8eed6", mane: "#c99a6e", points: "#c58f61", eye: "#7fa8c9" }],
    ["Perlino (seal brown)", { base: "seal_brown", cream: 2 }, { body: "#ecdcb8", shade: "#cdb98f", highlight: "#f8eed6", mane: "#c99a6e", points: "#c58f61", eye: "#7fa8c9" }],
    ["Cremello (chestnut)", { base: "chestnut", cream: 2 }, { body: "#efe4c8", shade: "#d2c3a0", highlight: "#fbf4e2", mane: "#f6efdd", points: "#e9dcbd", eye: "#7fa8c9" }],
    ["Cremello (liver)", { base: "liver", cream: 2 }, { body: "#efe4c8", shade: "#d2c3a0", highlight: "#fbf4e2", mane: "#f6efdd", points: "#e9dcbd", eye: "#7fa8c9" }],
    ["Smoky cream", { base: "black", cream: 2 }, { body: "#e5d6bf", shade: "#c6b398", highlight: "#f4ead9", mane: "#b89f86", points: "#b49a80", eye: "#7fa8c9" }],
    ["Bay dun", { base: "bay", cream: 0, dun: true }, { body: "#c69c64", shade: "#976f3d", highlight: "#e0bd86", mane: "#1d1611", points: "#1d1611", stripe: "#2a1e15" }],
    ["Bay dun (seal brown base)", { base: "seal_brown", cream: 0, dun: true }, { body: "#c69c64", shade: "#976f3d", highlight: "#e0bd86", mane: "#1d1611", points: "#1d1611", stripe: "#2a1e15" }],
    ["Red dun (chestnut)", { base: "chestnut", cream: 0, dun: true }, { body: "#d19a68", shade: "#a46f43", highlight: "#e8b98a", mane: "#8a4a2a", points: "#a8653c", stripe: "#8a4a2a" }],
    ["Red dun (liver)", { base: "liver", cream: 0, dun: true }, { body: "#d19a68", shade: "#a46f43", highlight: "#e8b98a", mane: "#8a4a2a", points: "#a8653c", stripe: "#8a4a2a" }],
    ["Grullo", { base: "black", cream: 0, dun: true }, { body: "#8e857a", shade: "#625a51", highlight: "#aea598", mane: "#1c1a18", points: "#1c1a18", stripe: "#1c1a18" }],
    ["Dunskin", { base: "bay", cream: 1, dun: true }, { body: "#dcc28f", shade: "#b39a68", highlight: "#efdcb0", mane: "#1d1611", points: "#1d1611", stripe: "#3a2a1a" }],
    ["Dunalino", { base: "chestnut", cream: 1, dun: true }, { body: "#e8cd96", shade: "#c4a66c", highlight: "#f6e3b8", mane: "#f2e6c8", points: "#dcbd84", stripe: "#c49a5a" }],
  ];
  const withColour = (colour: Partial<HorseColour>): HorseAppearance => ({
    coat: "bay",
    face: "none",
    legs: ["none", "none", "none", "none"],
    colour: { base: "bay", cream: 0, dun: false, roan: false, grey: "none", sabino: 0, ...colour },
    silks: app0.silks,
  });

  it.each(rows)("%s maps to its anchor hexes", (_name, colour, want) => {
    const p = coatPaletteOf(withColour(colour));
    expect(p.body).toBe(want.body);
    expect(p.shade).toBe(want.shade);
    expect(p.highlight).toBe(want.highlight);
    expect(p.mane).toBe(want.mane);
    expect(p.points).toBe(want.points);
    expect(p.stripe).toBe(want.stripe);
    expect(p.eye).toBe(want.eye);
    expect(p.texture).toBe("none");
  });

  it("two-cream coats get pink skin; single/base coats a 30 % darkened shade muzzle", () => {
    expect(coatPaletteOf(withColour({ base: "chestnut", cream: 2 })).muzzle).toBe("#d9a99a");
    expect(coatPaletteOf(withColour({ base: "bay", cream: 0 })).muzzle).not.toBe("#d9a99a");
    expect(coatPaletteOf(withColour({ base: "bay", cream: 0 })).muzzle).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("dun combos without an anchor lighten toward parchment and derive a stripe from the mane", () => {
    const smokyGrullo = coatPaletteOf(withColour({ base: "black", cream: 1, dun: true }));
    const smokyBlack = coatPaletteOf(withColour({ base: "black", cream: 1 }));
    for (const k of ["body", "shade", "highlight"] as const) {
      expect(smokyGrullo[k]).not.toBe(smokyBlack[k]);
    }
    expect(smokyGrullo.stripe).toMatch(/^#[0-9a-f]{6}$/);
    expect(smokyGrullo.mane).toBe(smokyBlack.mane);
    const dunCream = coatPaletteOf(withColour({ base: "chestnut", cream: 2, dun: true }));
    expect(dunCream.stripe).toBeDefined();
    expect(dunCream.eye).toBeUndefined(); // eye only on cremello/perlino/smoky cream
  });

  it("roan ticks over the horse's own body; greys use the existing grey palettes", () => {
    expect(coatPaletteOf(withColour({ base: "black", roan: true })).texture).toBe("roan");
    expect(coatPaletteOf(withColour({ base: "black", roan: true })).body).toBe("#1f1c1c");
    expect(coatPaletteOf(withColour({ base: "chestnut", roan: true })).body).toBe("#a4552b");
    expect(coatPaletteOf(withColour({ grey: "greying" })).texture).toBe("dapple");
    expect(coatPaletteOf(withColour({ grey: "greying" })).body).toBe("#8a4527");
    expect(coatPaletteOf(withColour({ grey: "dapple" }))).toEqual(COAT_PALETTES.dapple_grey);
    expect(coatPaletteOf(withColour({ grey: "white" }))).toEqual(COAT_PALETTES.grey);
  });

  it("maneColor override still wins on top of an anchor", () => {
    const app = withColour({ base: "chestnut", cream: 1 });
    expect(resolveHorseColors({ ...app, maneColor: "#abcdef" }).mane).toBe("#abcdef");
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
