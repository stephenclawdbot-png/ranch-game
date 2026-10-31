# 06 · Genetics and appearance expansion report

Scope: how a horse *looks*, and how its looks are inherited and shown. Hard rules respected
throughout: **no change to performance genetics, race outcomes or the engine**; existing genes
and stored genomes are never overwritten or re-rolled; colour stays cosmetic (game-core
`cosmetic.ts` already guards this with a test); rare colours keep entering only by inheritance and
natural frequency (owner decision, 2026-11); no NFT/marketplace changes.

## 1. What exists today (verified in code and in rendered captures)

Genome → appearance (game-core `coat.ts`, `cosmetic.ts`, `types.ts`; shared `HorseAppearance`):

| Layer | Genes / rule | Rendered where (coat audit 2026-11-01, re-checked in captures) |
|---|---|---|
| Base | Extension E/e × Agouti A/At/a → bay, seal brown, black, chestnut; liver l/l | every view |
| Dilutions | Cream (1-2 copies), dun, champagne, silver, pearl | every view (painted layers + palette) |
| Grey | G: born coloured, "greying" before racing age, dapples while racing, white at 24 career starts or retirement (`GREY_WHITE_AT_STARTS = 24`) | every view; dapple grey visible in race captures |
| Roan, rabicano, varnish ticking | Rn, Rb | every view (ticking fixed to the body, no sparkle) |
| White patterns | sabino (Sb1 + polygenic white 0-300), tobiano, leopard complex, splash | every view; pinto and spotted coats visible in race captures |
| Shade modifiers | sooty, flaxen (chestnut only), pangaré: polygenic sums against thresholds | every view |
| Rare colours | mushroom, rabicano, brindle (X-linked), dominant white (non-lethal), Bend Or and Birdcatcher spots | every view; enter only via some Club house stallions and natural pack frequency |
| Face markings | none, star, snip, stripe, blaze, bald: polygenic white score ± per-horse jitter (heritable) | every view |
| Leg markings | none, coronet, sock, stocking per leg (hind legs carry more white) | every view |
| Feathering | fe/fe: long mane, forelock, full tail, leg feathering drawn in code per frame | every view |
| Breed | 12 breeds; breed head shape on the portrait (12 heads), foal/yearling heads while young | **portrait only** |
| Conformation | `MORPH_KEYS`: legLength, neckLength, girth, height, headSize (diploid); breed size; curled ears, dished face | **not in `HorseAppearance`**, so **not drawn by any race, ranch or paddock sprite**; portrait gets "per-horse nudges from the genes" (graphics audit R7). The `?rig=1` pixel-rig has morph knobs but is opt-in and off by default. |

Evidence for the conformation gap (verified, not inferred):
- `packages/shared/src` `HorseAppearanceSchema` has coat, face, legs, dun, maneColor, colour,
  silks, head, age, feather, rider: no size or morph field.
- `grep` finds no `girth`, `legLen`, `heightScale` in `packages/race-viewer/src`,
  `packages/art-pipeline/src` or web components. `docs/genetics-v2.md`'s sprite table promises
  "Height and leg-length scale; girth widens the barrel" for Trackside; that row is **not built**.
- Captures: every runner in `images/race-*` shares one silhouette; the phone Stable page lists
  one horse as "bay · Curled ears · Dished face · 80% Arabian · 20% Marwari" and another as
  "bay · 100% QH", and on the pasture above the list the two bays have the same body, head and
  ears (`images/phone-stable.png`).

## 2. Real Thoroughbred colour reference (primary source)

The Jockey Club (US) *Principal Rules and Requirements of The American Stud Book*, August 2025,
Section IV "Color Guide" ([PDF via CHRB](https://www.chrb.ca.gov/rule_law/Scientific_Material/The_Jockey_Club_RM.pdf)),
recognises exactly: **Bay** ("yellow-tan to a bright auburn… mane, tail, and lower portion of the
legs are always black"), **Dark Bay/Brown**, **Black**, **Chestnut** ("red-yellow to a
golden-yellow"), **Gray/Roan** (one category; gray = mixture of black and white hairs, roan = red
or brown and white hairs), **Palomino** ("golden-yellow… mane and tail are usually flaxen") and
**White** ("predominantly white").

Wikipedia's *Thoroughbred* article: "most often bay, dark bay or brown, chestnut, black, or
gray"; "Less common colors recognized in the United States include roan and palomino"; "White is
very rare"; "white will generally not appear on the body"; multi-colour body patterns (pinto,
Appaloosa) "are not recognized by mainstream breed registries"
([Wikipedia](https://en.wikipedia.org/wiki/Thoroughbred)). White in Thoroughbreds comes from
dominant-white alleles traced to named Thoroughbred families (W2 KY Colonel, W5 Puchilingui, W14
Shirayukihime, W22 Not Quite White, W27 Milady Fair), several of them "sabino-like"
([Wikipedia: Dominant white](https://en.wikipedia.org/wiki/Dominant_white)).

## 3. Classification of every look Post Time can draw

| Look | Class | Note |
|---|---|---|
| Bay, dark bay/brown (seal brown), chestnut, liver chestnut, black | **Realistic TB** | Jockey Club colours |
| Grey (greying, dapple, white-grey) | **Realistic TB** | Real greying is age-driven; Post Time ties it to career starts (a readable game rule; keep, but say so on the wiki) |
| Face (star, snip, stripe, blaze, bald) and leg markings (coronet, sock, stocking) | **Realistic TB** | Heritable via polygenic white (as built) |
| Sooty, flaxen on chestnut | **Realistic TB** shade variation | Within "bay/chestnut" registry colours |
| Bend Or spots, Birdcatcher spots, rabicano ticking | **Possible but rare in TB** | Widely described in TBs (Bend Or and Birdcatcher are named after 19th-century TB stallions); not sourced here beyond common usage, so marked as *reported* |
| Roan | **Possible but rare in TB** | Registry category exists (Gray/Roan); true roan is uncommon |
| Palomino | **Possible but rare in TB** | Registry colour; needs a cream allele |
| White (dominant white), sabino-like white | **Possible but rare in TB** | W alleles in named TB families |
| Pangaré | **Possible but rare in TB** (uncertain) | Modifier described generally; TB frequency not sourced |
| Buckskin, smoky black, cremello, perlino, smoky cream | **Non-TB in practice** (cream breeds) | Fine for the 11 other breeds and crosses |
| Dun (red/bay dun, grullo, dunskin, dunalino), champagne, silver, pearl, mushroom | **Non-TB** | Belong to other breeds in the game |
| Tobiano, leopard complex (blanket, few-spot, varnish), splash, brindle | **Non-TB** (not recognised by mainstream TB registries) | Correct for Paint, Appaloosa, Mustang, crosses |
| Feathering | **Non-TB** (draft/Friesian) | Correct for Friesian and crosses |
| Lethal white overo, lavender foal | **Excluded by design** | No lethal colour genes (owner decision) |
| "Fantasy" colours (blue, neon, glowing) | **None in game** | A strength vs Rival Stars' "glowing mane" trait; keep it that way |

Recommendation: show this class on the horse page as a small, factual tag beside the full coat
name ("Thoroughbred colour" / "rare in Thoroughbreds" / "a [breed] colour"), derived from
breed + phenotype. It teaches real racing without changing any gene. (Effort S; 10 backlog V-07.)

## 4. Gaps in *appearance identity* (rendered evidence)

| Gap | Evidence | Impact |
|---|---|---|
| G1. One race body for 12 breeds and every conformation | captures; schema; 03 F1 (players' top appearance complaint in other games) | A Friesian, an Arabian and a Quarter Horse are the same horse in a race |
| G2. One mane/tail shape per sprite sheet (except feathered) | coat audit §5 "left open"; captures | Two bays read as twins; 03 F3 |
| G3. Markings vanish at race scale | at whole-field zoom (0.37 px/texel desktop, horses ~45-70 px long; ~30-40 CSS px on a 390 px phone) a star or snip is 0-1 screen pixel | Coat colour alone identifies a horse; two bays are indistinguishable mid-race |
| G4. Ageing is head-and-size only | portrait has foal/yearling heads; the Ranch draws young horses with a smaller copy of the adult sheet (`RanchStage.tsx`, seen: `images/pages-desktop-stable.png`), so a foal is a small adult; race sprites are adult; no veteran look (greys whiten, but no greying muzzle on non-greys) | Long careers do not show |
| G5. Foal reveal shows the foal, not the inheritance | `FoalReveal.tsx` renders the portrait with a 1.3 s stall-door sequence; no sire/dam reference in the component. Seen for a pack foal (`images/pages-phone-foal-reveal-end.png`): foal head, "Colt foal · bay · 100% TB · Common", the seal and revealed seed; the light-beam stripes (`reveal.module.css` `.beam`, `forwards`) stay over the foal's head in the end state | The "it has its mother's blaze" moment does not exist |
| G6. Breed traits in text, not in pixels | "Curled ears · Dished face" listed, not drawn on the pasture/race sprite | Promises the eye cannot check |

## 5. Proposed expansion (no asset replacement, no gene changes)

All items read **existing** genes and write nothing new to genomes. Each renders deterministically
from the horse id / `markSeed` (already the pattern seed) so a horse looks the same everywhere.

### A. Conformation from existing morph genes (closes G1, G6)
- Add an optional `build` to `HorseAppearance` (shared contract, lead's call): `{height, leg,
  neck, girth, head}` as small signed integers (-2..+2) computed by game-core from the existing
  `MORPH_KEYS` alleles + breed size. Optional → old replays render exactly as today.
- Trackside/3D: apply as **whole-texel** vertical/horizontal stretches in the strip shader using
  the coat geometry's body/leg/neck spaces (already per-texel): legs ±1-2 texel rows, barrel ±1
  row, neck ±1-2 columns, overall height by whole-pixel scale steps at portrait/finale sizes
  only. No new art. Pixel-crispness rule kept (integer texel shifts).
- Breed silhouettes from the same knobs (Friesian: heavier barrel and neck, feathering already;
  Arabian: dished head on the portrait, shorter back; QH: lower, heavier quarters).
- Effort M (shader + geometry tests), risk: frame-sync of stretched limbs (test every frame stays
  inside the horse).

### B. Mane and tail variety (closes G2)
- The long-hair code path (`art-pipeline/longHair.ts`) already grows mane/forelock/tail per
  frame from anchors. Generalise it to **three mane lengths and two tail fullnesses for every
  horse**, chosen from `markSeed` + breed (Akhal-Teke short/fine, Arabian high tail carriage,
  Friesian long), plus an optional **pulled racing mane** look for Thoroughbreds in training.
- Owner-facing styling (plaits/braids for the paddock) is cosmetic and could be a care action, but
  is P3 and must not be sold.
- Effort M.

### C. Identity at race scale (closes G3)
- Colour the **saddle cloth** with the runner's saddlecloth number colour (the racecard's
  `Saddlecloth` component already uses the standard colour per gate) so every sprite links to
  its HUD chip; draw the number glyph only when a horse is ≥ ~120 CSS px (close shots, finale).
- Exaggerate face/leg white by one texel at ≤0.5 px/texel zoom (a "readability LOD" like
  pixel-art games do for silhouettes), only for markings that exist.
- Effort S-M. Highest player value per cost (05).

### D. Ageing (closes G4)
- Foal and yearling **body** proportions from the existing age field (portrait already has the
  heads): longer legs, shorter barrel, fluffy tail for the Nursery and Ranch (diorama walkers,
  whole-pixel downscale + leg stretch).
- Veterans (from career length / retirement): greying muzzle and eye hollows on the portrait only.
- Effort M.

### E. Inheritance made visible (closes G5)
- Foal reveal v2: after the stall door, show **dam and sire portraits small on either side**,
  then draw one or two dotted "from" lines to traits the foal shares (blaze from the dam, grey from
  the sire, a rare colour from the Club stallion). Computed from the three phenotypes only (no
  genotype or odds shown, in line with the breeding-preview rule "looks and words only").
- The horse page gets a "Family likeness" line ("Her blaze comes from her dam, Fair Wind").
- Effort S-M; reuses `HorsePortrait`, `PossibleLooks`, `fullCoatName`.

### F. Portraits (already strong, keep)
- 3/4 portrait with breed heads, painted coat layers and markings matching the sprites is the
  best-looking horse asset in the game (captures). Keep; extend with build (A) and age (D).

## 6. Consistency rule (all screens)

One horse = one appearance object, computed once by game-core and stored with the race snapshot
(already true for coat). Every renderer (Trackside, 3D, photo strip, share clip, Ranch,
paddock, stable band, portrait, finale card, foal reveal) must read the same object. Test: for a
sample of horses, the set of visible traits reported by each renderer's inventory function is
identical (extend the coat audit's identity tests to `build` and mane/tail).
