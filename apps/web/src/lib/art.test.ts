import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CoatSchema } from "@thoroughbred/shared";
import { ART_SLOTS, pickArt, type ArtFile } from "./art";
import ART_INDEX from "./art.index.json";

const files = new Map((ART_INDEX as ArtFile[]).map((f) => [f.path, f]));

describe("art index", () => {
  it("every coat the game can produce has a PixelLab 3/4 portrait (so the code-drawn head is only a load-failure fallback)", () => {
    for (const coat of CoatSchema.options) {
      const art = pickArt(files, ART_SLOTS.portrait(coat));
      expect(art, coat).not.toBeNull();
      expect(existsSync(join(process.cwd(), "public", "art", art!.path)), art!.path).toBe(true);
      expect(art!.w).toBe(art!.h);
    }
  });

  it("is in sync with public/art (run `pnpm --filter @thoroughbred/web art-index`)", () => {
    const before = readFileSync(join(process.cwd(), "src/lib/art.index.json"), "utf8");
    execFileSync(process.execPath, [join(process.cwd(), "scripts/art-index.mjs")]);
    expect(readFileSync(join(process.cwd(), "src/lib/art.index.json"), "utf8")).toBe(before);
  });
});
