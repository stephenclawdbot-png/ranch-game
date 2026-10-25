/**
 * Art source adapters.
 *
 * PixelLab is used OFFLINE, at build time only, and only after a human approves the
 * output. Nothing here calls the network. The real PixelLab endpoints, request shapes
 * and auth MUST be verified against the official PixelLab API documentation before an
 * implementation is written; do not guess URLs or payloads.
 */
import { AssetEntrySchema, type AssetEntry, type AssetManifest } from "./manifest";

export interface SpriteSheetRequest {
  /** Manifest slot the result is for (e.g. "horse.body.gallop"). */
  assetId: string;
  prompt: string;
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  palette?: string[];
  /** Optional local reference image path for style consistency. */
  referenceImagePath?: string | null;
}

export interface SpriteSheetResult {
  assetId: string;
  /** Local path of the written sheet, to be reviewed before approval. */
  sheetPath: string;
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  /** The prompt actually used, stored in the manifest as sourcePrompt. */
  sourcePrompt: string;
}

export interface PixelLabBalance {
  credits: number;
}

export interface PixelLabAdapter {
  readonly name: string;
  /** False until an API key is configured AND generation has been approved. */
  isConfigured(): boolean;
  generateSpriteSheet(req: SpriteSheetRequest): Promise<SpriteSheetResult>;
  getBalance(): Promise<PixelLabBalance>;
}

export class PixelLabNotConfiguredError extends Error {
  constructor(action: string) {
    super(
      `PixelLab is not configured / not approved for use (${action}). ` +
        "Art stays procedural until a configured adapter is approved; see packages/art-pipeline/README.md.",
    );
    this.name = "PixelLabNotConfiguredError";
  }
}

/** The only PixelLab adapter that exists today. Every call fails loudly. */
export class UnconfiguredPixelLabAdapter implements PixelLabAdapter {
  readonly name = "pixellab-unconfigured";
  isConfigured(): boolean {
    return false;
  }
  async generateSpriteSheet(req: SpriteSheetRequest): Promise<SpriteSheetResult> {
    throw new PixelLabNotConfiguredError(`generateSpriteSheet(${req.assetId})`);
  }
  async getBalance(): Promise<PixelLabBalance> {
    throw new PixelLabNotConfiguredError("getBalance");
  }
}

export type ImportResult = { ok: true; entry: AssetEntry } | { ok: false; errors: string[] };

/**
 * Validates hand-made (or reviewed PixelLab) sprite sheets before they enter the
 * manifest. Imported entries always land as `pending_review`; `approve` flips them.
 */
export class ManualImportAdapter {
  readonly name = "manual-import";

  validate(candidate: unknown): ImportResult {
    const parsed = AssetEntrySchema.safeParse(candidate);
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
    }
    const e = parsed.data;
    const errors: string[] = [];
    if (e.origin === "placeholder") errors.push("origin: imported art must be 'manual' or 'pixellab'");
    if (!e.src) errors.push("src: imported art needs a sheet/atlas path");
    if (e.frameCount > 1 && e.fps <= 0) errors.push("fps: animated sheets need fps > 0");
    if (e.origin === "pixellab" && !e.sourcePrompt) errors.push("sourcePrompt: PixelLab art must record its prompt");
    return errors.length ? { ok: false, errors } : { ok: true, entry: { ...e, status: "pending_review" } };
  }

  /** Returns a new manifest with the slot replaced (or appended) by the imported entry. */
  importInto(manifest: AssetManifest, candidate: unknown): { manifest: AssetManifest; result: ImportResult } {
    const result = this.validate(candidate);
    if (!result.ok) return { manifest, result };
    const assets = manifest.assets.filter((a) => a.id !== result.entry.id);
    return { manifest: { ...manifest, assets: [...assets, result.entry] }, result };
  }

  /** Human sign-off: mark a reviewed slot as approved so renderers start using it. */
  approve(manifest: AssetManifest, id: string): AssetManifest {
    return {
      ...manifest,
      assets: manifest.assets.map((a) => {
        if (a.id !== id) return a;
        if (a.origin === "placeholder" || !a.src) throw new Error(`cannot approve "${id}": no imported art`);
        return { ...a, status: "approved" as const };
      }),
    };
  }
}
