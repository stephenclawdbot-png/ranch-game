# 04 · Post Time asset and graphics inventory (preserve / improve / replace)

Built from the code at `6d67231` (branch `claude/intelligent-ride-rkrz3i`) **and** from rendered
captures of a local production build (`next build` + `next start`, embedded PGlite, swiftshader
WebGL in headless Chromium). The live site was not used. Paths are repo-relative. "Seen" means I
looked at a capture in `images/`; "code" means read from source only and **not** visually
verified.

Verdicts: **Preserve** (keep as is), **Improve** (keep the asset/tech, extend it), **Replace**
(only where a demonstrated limitation forces it; none of the core systems qualify).

## 1. Engines, libraries, licences

| Item | Version / where | Licence / limit | Verdict |
|---|---|---|---|
| three.js | 0.180.0 (`packages/race-viewer`) | MIT | Preserve |
| mp4-muxer (share clip, in-browser) | 5.2.2 | MIT | Preserve |
| Next.js / React | 15.5.28 / 19.1.10 (`apps/web`) | MIT | Preserve |
| Racing engine | `packages/racing-engine` (integer, deterministic, ENGINE_VERSION in `simulate.ts`) | own | **Untouched by this research** |
| PixelLab (source art) | `art-src/`, adapters in `packages/art-pipeline` | Terms "Last Updated: 2026-10-30": "You retain ownership of any content you create using PixelLab"; "permitting usage for both commercial and non-commercial purposes"; no training other models on its output ([ToS](https://www.pixellab.ai/termsofservice)). Owner note: copyright protection of AI-generated images is a separate legal question; not assessed here. | Preserve |
| Fonts, audio voices | `apps/web/public/brand`, `public/audio/commentary` (1,716 mp3, 7.85 MB, 3 casters) | not audited for licence in this pass | Flag for owner |

## 2. Race viewer (`packages/race-viewer/src`)

| Feature | Implementation (file) | Capabilities (seen) | Limitations (seen unless marked) | Verdict |
|---|---|---|---|---|
| **Trackside** (default view) | `trackside/TracksideScene.ts` (1,476 lines), `layout.ts`, `shaders.ts`, `strips.ts`, `bake.ts`, `scenery.ts` | Orthographic HD-2D side view; course-specific far panorama, midground, stand, rail decor; per-runner LUT recolour + coat-layer atlas in the fragment shader; contact shadows; hoof fx; gap markers in lengths; whole-field or follow-mine camera on a pixel-perfect zoom ladder; finish slope (Harrowgate). Stall-loading build-up; run-out with ease-up/pull-up/celebrate strips (jockey's raised fist seen at +12 s). | At whole-field zoom horses are ~45-70 px long on a 1,100 px desktop stage and ~30-40 CSS px on a 390 px phone (`images/race-*`): coat colour identifies a horse, markings do not. Saddle cloths are plain white. Midground repeats one tree type per course band. | **Preserve** core; **Improve** identification and phone framing |
| **3D view** ("classic") | `three/HD2DScene.ts` (1,880 lines), `post.ts`, `vfx.ts`, `pixelTextures.ts`, `director.ts` | Same `RaceStage` as Trackside (course scenery, landmarks, look, sun side) since Phase A; camera-facing billboards with integer LOD and pixel-snapped anchors; perspective broadcast camera with a shared director (gate, topost, establish, close, pack, judge, post, wide, replay); DOF/bloom/grade on far scenery only; rain; confetti; PiP of my horse (desktop high). The 2026-10-30 audit's H-severity mismatches (time of day, course midground, weather grade, sun side, near-rail occlusion) are **fixed** in the captures. | Gate shot at t=1 shows the field as a thin stack behind a large green stall block (`images/race-3d-desktop-start-ashcombe.png`); judge shot at the line stacks the two leaders into one silhouette (`images/race-3d-desktop-finish-saltmarsh.png`); 3D horse scale ~25-60 px in field shots. Shadows and post FX only on "high". | **Preserve**; **Improve** gate/judge framing |
| Shared stage and motion | `stage/buildRaceStage.ts`, `stage/motion.ts`, `stage/preoff.ts` | One course/light/landmark description; runner gait (gallop/drive/canter/trot/walk/stand) from speed; stride length `2.2 + 0.32·v` m clamped 3.0-7.6 (`scene/horse/gait.ts`): 7.5 m at 16.6 m/s vs 7.08 ± 0.39 m measured in 33,459 Tasmanian race starts ([Morrice-West et al., EVJ](https://minerva-access.unimelb.edu.au/server/api/core/bitstreams/27f086c6-eb23-5494-9c86-6253673b2526/content)): cadence within ~6 %. | Cornering is not represented (side-on track). | **Preserve** |
| Animation strips | `public/art/race/horse-{gallop,drive,break,lunge,easeup,celebrate,pullup,idle}.png` (+ normal maps, + women-rider `-f` copies) | 12-frame HD gallop 229×146 per frame, 47 colours, normal-mapped (`images/gallop-sheet.png`): convincing gathered and extended phases, stable jockey, mane/tail flow. 8 strips cover start, race, drive, finish, ease-up, celebrate, pull-up, idle. | One body for every horse and breed. One mane/tail shape per sheet (except code-drawn feathering). Frames 0-1 read close to the stylised "flying gallop" extension; a footfall review against a gallop reference is advised before any re-generation (unverified). No canter strip ("PixelLab's canter came out as another gallop", `art/STATUS.md`). | **Preserve**; **Improve** via code (build, mane/tail) |
| Coat rendering | `art-pipeline/coatGeometry.ts`, `coatLayers.ts`, `longHair.ts`, `race/coat-layers.png` (2048×1536) | 59 PixelLab-painted layers placed in horse space; every pattern/marking/shade drawn in every view (coat audit 2026-11-01, re-seen: pintos, greys, dapples, roans in captures). | Patterns resolve at portrait/finale scale; at race scale only colour masses read. | **Preserve** |
| Photo finish | `photo/*` (line-scan strip from crossing times), `finale/*` | Deterministic line-scan, judge's line, margin words; finale slides (3rd, 2nd, winner, mine) with animated 3/4 portraits. | Captures in `images/finale-*` (see 05). | **Preserve** |
| Race call + radio | `call/buildRaceCall.ts`, `call/voice/*`, `public/audio/commentary` | Spoiler-free generated call; 3 casters × 3 intensities, per-name clips, off by default. | Not heard in this audit (headless). | **Preserve** |
| Share clip | `clip/*` (WebCodecs + mp4-muxer) | Vertical crop following the leading group; photo-hold. | Not encoded in this audit. | **Preserve** |
| HUD | `hud/Hud.tsx`, `CourseMap.tsx`, `styles.ts` | Standings chips with gaps in lengths, distance-to-go with furlong badge, commentary line, battle chip ("NECK & NECK"), course map, progress strip with silks. | On a 390 px phone the course map, commentary callout and standings cover roughly half of the stage, and the commentary callout sits on the horses' band mid-race (`images/race-trackside-phone-mid-ashcombe.png`); in 3D playback it hid the leaders 21 m out (`images/play-phone-3d-21m-to-go.png`). | **Improve** (phone layout) |
| Perf telemetry | `RaceViewer.tsx` (`__rvFrameStats`, `perfReport`, auto-downgrade under ~40 fps; `autoQuality` = "low" when width < NARROW_PX, ≤4 cores, ≤4 GB or coarse pointer < 900 px) | Real-device perf report after 20 s | — | **Preserve** |

## 3. Horses outside the race

| Feature | Implementation | Seen | Verdict |
|---|---|---|---|
| 3/4 genetic portrait | `apps/web/src/components/HorsePortrait.tsx`, `components/pixel/geneticPortraitRender.ts`, `art-pipeline/portrait34.ts`, `portraitCoat.ts`, `public/art/portraits/*` (10 coat bases + anim + warp) | Breed heads (12), foal/yearling heads, coat layers matching the sprites; best horse asset in the game. **Cost:** loads `portraits/coat-layers-2x.png` (4096×3072, **50 MB decoded RGBA**) plus `roles.png` into CPU pixel arrays (`geneticPortraitRender.ts:107`). | **Preserve**; measure on low-end phones (07) |
| Ranch / pasture | `components/stable/RanchStage.tsx`, `diorama/*` sheets (graze, idle, walk) | The player's own horses roam the pasture with name tags (`images/phone-stable.png`): exactly what Horse Tales players asked for (03 F15). Two bays read as twins. | **Preserve**; **Improve** with build/mane |
| Diorama scene bands | `components/diorama/*`, `public/art/diorama` (86 PNG, 5.2 MB) and `art/scenes` (68 stills, 4.1 MB) | Barn, yard, paddock, grandstand, pasture plus 68 still scenes from the graphics audit rounds 1-2 (no repeats across page families; `page-scenes.test.ts`). | **Preserve** |
| Paddock parade / post parade | `components/race/PaddockParade.tsx`, race build-up | Parade with saddlecloth tiles in the racecard | **Preserve** |
| Foal reveal | `components/economy/FoalReveal.tsx`, `reveal.module.css` | Seen (pack pull, phone): stall door, foal head portrait with a snip, sex, colour, breed share, rarity, seal and seed, "See the foal in the nursery". No parents (code). The light-beam stripes stay over the foal's head at the end. | **Improve** (06 §5E, V-06, V-21) |
| Jockeys and trainers | 126 keyed faces, looks stored per jockey, women riders' strips, 8 trainer busts | Riders in races wear skin/hair/silks from the look | **Preserve** |
| Vignettes, icons, plaques | `art/vignettes` (26), `art/ui` (171 PNG), `art/trophies` | One picture per meaning (graphics audit round 2) | **Preserve** |

## 4. Asset budget (measured on disk)

| Folder | Files | Size on disk |
|---|---|---|
| `public/art/race` | 94 PNG + 3 JSON | 9.68 MB (77.3 MB decoded RGBA) |
| `public/audio` | 1,716 mp3 | 7.85 MB |
| `public/art/diorama` | 86 PNG | 5.20 MB |
| `public/art/scenes` | 68 PNG | 4.10 MB |
| `public/art/portraits` | 188 PNG | 2.18 MB |
| `public/art/course` | 22 PNG | 1.36 MB |
| `public/art/manifest.json` | 1 | 0.58 MB |
| all PNG under `public/` | | 274 MB if every image were decoded at once (none of the pages does that) |

JavaScript (from `next build` and the emitted chunks): race page first-load 483 kB as reported
by `next build`; the race-viewer chunk is 226 KB raw / 76 KB gzip, three.js 325 KB raw / 77 KB
gzip; the largest chunks are wallet libraries (565 KB and 455 KB raw). Full numbers in 07.

## 5. Summary verdict

Nothing here needs replacing. The engine, the shared stage, the strips, the coat system, the
portrait and the scene art are the foundation the roadmap builds on. Every proposal in 07 is an
**extension** of an existing asset or renderer (shader knobs, code-drawn hair, a saddle-cloth key,
layout changes, presentation sequences), not a rewrite.
