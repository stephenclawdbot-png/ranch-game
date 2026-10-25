# @thoroughbred/art-pipeline

The art slots the game renders, and how real art replaces the procedural placeholders.

- **`manifest.ts`**: `AssetManifestSchema` (Zod) and `defaultManifest`. The default
  manifest lists every slot the race viewer and UI use (`horse.body.gallop`,
  `jockey.crouch`, `track.*` layers, props, VFX, weather, buildings and portraits). Each
  slot has a kind, depth band, frame size, anchor and animation ranges. Everything starts
  as `placeholder`.
- **`resolve.ts`**: `resolveAsset(manifest, id)`. An entry counts as real art only when
  its `status` is `approved` and it has a `src`. Anything else falls back to the
  procedural renderer.
- **`palettes.ts`**: `COAT_PALETTES` and `resolveHorseColors(appearance)`. These are the
  coat, points, mane, hoof, marking and silks colours shared by the race viewer and UI
  portraits.
- **`adapters.ts`**: the `PixelLabAdapter` interface, plus `UnconfiguredPixelLabAdapter`,
  which throws `PixelLabNotConfiguredError`. There are no network calls in this repo.
  `ManualImportAdapter` validates hand-made sheets into `pending_review` entries.

## Workflow

PixelLab runs at build time only. Generated or imported sheets land as `pending_review`.
A human approves each one (`status: "approved"`, `src` set to the hosted URL) and commits
the manifest. Viewers pick the approved sheets up through `resolveAsset`. The race viewer
takes a `manifest` prop for this.

`pnpm --filter @thoroughbred/art-pipeline test` and `pnpm --filter @thoroughbred/art-pipeline typecheck`
