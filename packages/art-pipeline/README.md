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
- **`palettes.ts`**: `COAT_PALETTES`, `coatPaletteOf(appearance)` (layered coat v2: base,
  cream, dun, grey, roan, plus champagne, silver and pearl) and `resolveHorseColors(appearance)`.
  These are the coat, points, mane, hoof, marking and silks colours shared by the race viewer
  and UI portraits.
- **`portrait34.ts`**: the genetic 3/4 portrait, pure and deterministic.
  `portraitLookOf(appearance)` maps the genes to the portrait's palette and patterns (coat,
  mane and skin ramps, eye colour, roan / greying / varnish ticks, grullo dark head, face
  marking raised by splash, sabino edges and chin, tobiano, leopard spots, few-spot, white
  throat, champagne freckles, mottled skin); `paintGeneticPortrait(look, source)` recolours a
  painted strip through the offline role map and frame warps (docs/art-direction.md, "Genetic
  3/4 portraits"); `portraitCacheKey` keys the result by genes, face and size (bump
  `PORTRAIT_RECOLOUR_VERSION` when the output pixels change).
- **`adapters.ts`**: the `PixelLabAdapter` interface, plus `UnconfiguredPixelLabAdapter`,
  which throws `PixelLabNotConfiguredError`. There are no network calls in this repo.
  `ManualImportAdapter` validates hand-made sheets into `pending_review` entries.

## Workflow

PixelLab runs at build time only. Generated or imported sheets land as `pending_review`.
A human approves each one (`status: "approved"`, `src` set to the hosted URL) and commits
the manifest. Viewers pick the approved sheets up through `resolveAsset`. The race viewer
takes a `manifest` prop for this.

`pnpm --filter @thoroughbred/art-pipeline test` and `pnpm --filter @thoroughbred/art-pipeline typecheck`
