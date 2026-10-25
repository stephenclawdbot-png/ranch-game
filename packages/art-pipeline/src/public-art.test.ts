/**
 * Validates the generated art drop (apps/web/public/art/manifest.json) against
 * AssetManifestSchema and checks every src exists with the declared frame layout.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AssetManifestSchema } from "./index";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/art");
const MANIFEST = join(ART, "manifest.json");

function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe.skipIf(!existsSync(MANIFEST))("public art manifest", () => {
  const raw = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { version: 1, assets: [] };

  it("validates against AssetManifestSchema", () => {
    const parsed = AssetManifestSchema.safeParse(raw);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 5), null, 1));
    expect(parsed.data.assets.every((a) => a.origin === "pixellab" && a.status === "approved")).toBe(true);
  });

  it("every src exists and matches its frame layout", () => {
    for (const a of raw.assets as Array<{ id: string; src: string; frameCount: number; frameWidth: number; frameHeight: number }>) {
      const file = join(ART, a.src);
      expect(existsSync(file), `${a.id}: ${a.src} missing`).toBe(true);
      const { w, h } = pngSize(file);
      expect(w, `${a.id} width`).toBe(a.frameWidth * a.frameCount);
      expect(h, `${a.id} height`).toBe(a.frameHeight);
    }
  });
});
