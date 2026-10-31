# 07 · Prioritised roadmap and performance feasibility

Principle: **extend, don't replace.** No engine migration, no renderer rewrite, no new 3D horse
models: nothing in the audit shows a limitation that forces one. Every step is behind a flag,
measured, and reversible.

## 1. Scoring

Each candidate is scored 1-5 on: Impact (player value), Evidence strength, Cost (5 = cheapest),
Risk (5 = safest), Performance (5 = no cost), Reuse of existing assets/tech, First-session
relevance, Long-term relevance. Expected value = Impact × Evidence × (Cost + Risk + Perf +
Reuse)/4 × (1 + First-session/5). Scores are my judgement from 03-06.

| Item | Imp | Evid | Cost | Risk | Perf | Reuse | 1st-session | Long-term | EV | Pri |
|---|---|---|---|---|---|---|---|---|---|---|
| V-01 Phone race layout | 5 | 5 | 4 | 4 | 5 | 5 | 5 | 4 | 225 | **P0** |
| V-03 Saddle-cloth identity | 5 | 4 | 3 | 4 | 5 | 5 | 5 | 5 | 170 | **P0** |
| V-02 Final-400 m group framing (phones) | 4 | 4 | 4 | 4 | 5 | 5 | 5 | 4 | 144 | **P0** |
| V-00 Real-device perf baseline | 3 | 5 | 5 | 5 | 5 | 5 | 3 | 5 | 120 | **P0** (gate) |
| V-06 Family-likeness foal reveal | 5 | 4 | 4 | 5 | 5 | 5 | 1 | 5 | 114 | **P1** |
| V-05 Mane/tail variety | 4 | 4 | 3 | 4 | 4 | 5 | 4 | 5 | 115 | **P1** |
| V-08 First-win owner's moment | 4 | 3 | 4 | 5 | 5 | 5 | 5 | 4 | 114 | **P1** |
| V-04 Build from morph genes | 5 | 4 | 2 | 3 | 4 | 4 | 4 | 5 | 117 | **P1** |
| V-10 3D judge-shot separation | 3 | 4 | 4 | 4 | 5 | 5 | 3 | 4 | 86 | **P1** |
| V-09 3D gate shot | 3 | 4 | 4 | 5 | 5 | 5 | 3 | 3 | 91 | **P1** |
| V-07 Coat class tag + family line | 3 | 4 | 5 | 5 | 5 | 5 | 2 | 4 | 84 | **P1** |
| V-21 Foal reveal end state reads clean | 3 | 4 | 5 | 5 | 5 | 5 | 2 | 3 | 84 | **P1** |
| V-11 Marking readability LOD | 3 | 3 | 4 | 4 | 5 | 5 | 3 | 4 | 65 | P2 |
| V-12 Foal/yearling bodies | 3 | 3 | 3 | 4 | 5 | 4 | 1 | 4 | 43 | P2 |
| V-14 Winner's walk back | 3 | 3 | 3 | 4 | 5 | 5 | 2 | 3 | 54 | P2 |
| V-15 HUD-free owner photo | 3 | 2 | 4 | 4 | 5 | 5 | 1 | 4 | 32 | P2 |
| V-16 Course establishing shot | 2 | 3 | 4 | 5 | 5 | 5 | 2 | 3 | 40 | P2 |
| V-19 Portrait atlas weight | 2 | 2 | 4 | 4 | 5 | 5 | 3 | 3 | 29 | P2 (only if V-00 shows cost) |
| V-20 Breeding preview "from which parent" | 2 | 3 | 5 | 5 | 5 | 5 | 1 | 4 | 36 | P2 |
| V-13 Veteran portraits | 2 | 2 | 4 | 5 | 5 | 5 | 1 | 4 | 23 | P3 |
| V-17 Plaits/braids (care, never sold) | 2 | 3 | 3 | 4 | 4 | 4 | 1 | 3 | 27 | P3 |
| V-18 Seasonal light | 2 | 1 | 3 | 4 | 4 | 4 | 1 | 3 | 9 | P3 |

## 2. Roadmap by area (A-F of the brief)

**A. Horse visual identity (no asset replacement).** P0 cloth identity (V-03); P1 build (V-04),
mane/tail (V-05), coat class tag (V-07); P2 marking LOD (V-11), foal/yearling bodies (V-12); P3
veteran portraits (V-13), plaits (V-17). Every item reads existing genes; consistency test across
all renderers (06 §6). Existing genetics are never overwritten.

**B. Animation.** Protect the gallop (cadence already within ~6 % of measured racehorse stride).
P1 mane/tail motion varied per horse (V-05); P2 winner's walk back (V-14). Explicitly **not**
recommended now: a new canter strip or cornering (side-on track makes cornering invisible; the
gallop slowed to ~8-10 fps already stands in for a canter per `art/STATUS.md`). Fatigue: the
engine's energy is already shown on the Why card; a visual "tiring" (head carriage lower, drive
strip earlier) could use the existing `drive` strip when the engine's `tiring` event fires (P2,
not ticketed until the owner wants it; it must only *display* engine events, never invent them).

**C. Cinematography.** P0 phone final-400 m group framing (V-02); P1 3D gate (V-09) and judge
(V-10) framing; P2 course establishing shot (V-16). Constraints: simulation authoritative, no
invented action, no cuts beyond today's spring moves, no shake, no extra zoom pulses (03 F11:
camera motion sickness is a documented complaint).

**D. Environment.** Already strong (score 8). P3 seasonal light (V-18). Contact shadows, hoof fx,
rain, dusk and overcast looks exist in both views (seen).

**E. Emotional moments.** P1 foal reveal with family likeness (V-06) and a clean end state
(V-21), first-win owner's moment (V-08). Reuse: finale slides, portraits, vignettes, Legacy Farm, Hall of Fame. Retirement and
Hall of Fame already have scenes and plaques (graphics audit); add the owner's moment pattern to
them after V-08 proves out.

**F. UI visual language.** See 08: keep the forest-green/brass/cream racing-programme language;
fix phone race density (V-01) first.

## 3. Sequencing

1. **Week 1:** V-00 (real devices), Prototype B (V-01 + V-02) and Prototype A (V-03) behind flags.
2. **Week 2:** owner review of A and B on a phone; Prototype C spike (V-04 + V-05) on Trackside.
3. **Week 3:** V-06 foal reveal, V-07 tag, V-08 first win; V-09/V-10 3D framing.
4. **Then:** P2 items by the owner's choice, each with its flag and the V-00 budget.

## 4. Performance feasibility (Phase 7)

**What was measured** (headless Chromium, ANGLE → SwiftShader on a shared 4-core container:
CPU-only rendering, so frame times are not GPU numbers; the viewer's own `__rvFrameStats`, plus
`renderer.info` and `performance.memory`):

| Config | Canvas (device px) | JS work / frame median (p99) | Frame median (SwiftShader) | Draw calls | Triangles | Textures | Programs | JS heap |
|---|---|---|---|---|---|---|---|---|
| Trackside desktop high | 1098×615 | 1.1 ms (6.2) | 117 ms | 56 | 110 | 142 | 5 | 123 MB |
| Trackside desktop low | 1098×615 | 1.0 ms (6.9) | 100 ms | 50 | 98 | 142 | 5 | 123 MB |
| 3D desktop high | 1098×615 | 2.1 ms (9.4) | 150 ms | ≈60 (121 over two frames, all passes) | ≈40.8k (81,654 over two frames; shadow map + PiP + post) | 119 | 35 | 131 MB |
| 3D desktop low | 1098×615 | 1.2 ms (6.7) | 83 ms | 39 | 15,546 | 114 | 17 | 139 MB |
| Trackside phone high (DPR 2) | 640×628 | 1.1 ms (5.8) | 83 ms | 57 | 112 | 142 | 5 | 131 MB |
| Trackside phone low | 480×471 | 0.9 ms (6.3) | 50 ms | 58 | 114 | 142 | 5 | 123 MB |
| 3D phone high | 640×628 | 1.4 ms (6.1), one 689 ms spike | 117 ms | ≈48 (97 over two frames) | ≈28.7k (57,398 over two frames; shadow map + post) | 119 | 34 | 131 MB |
| 3D phone low | 640×628 | 1.2 ms (7.2), one 677 ms spike | 83 ms | 46 | 15,560 | 114 | 17 | 139 MB |

Raw: `data/perf.json` (single-frame `renderer.info`) and `data/perf2.json` (accumulated over two
animation frames, all render passes; per-frame values are half, which the low-quality rows
confirm: 83 calls / 31,102 triangles over two frames vs 39 / 15,546 in one). The ~680 ms single-frame spikes in 3D on the phone
profile are likely shader compilation or the PiP warm-up under SwiftShader; check on a real phone.

Download weight: race-viewer chunk 226 KB raw / 76 KB gzip; three.js chunk 325 KB raw / 77 KB
gzip; `next build` reports 483 kB first-load JS for `/race/[id]`; race art 9.7 MB on disk (77 MB
if every race PNG were decoded); commentary 7.85 MB of mp3 (fetched per phrase, off by default).
The genetic portrait loads a 4096×3072 atlas (**50 MB decoded**) on the CPU.

**What this means.** CPU-side work is small (≈1-2 ms per frame) in both views; geometry is tiny;
the cost centre is fill/texture work and texture memory, which only real GPUs can measure.
Trackside's 142 live textures (strip LODs, LUTs, scenery bands) are the number to watch on
older phones.

**Budgets (provisional until V-00):**
- No new full-screen pass on phones; any new effect must fit inside the existing passes.
- New per-runner data goes into existing LUT rows (V-03, V-04): **0 new textures, 0 new draw
  calls**; shader cost ≤ +0.3 ms GPU per frame at phone resolution (to be measured).
- JS work per frame stays ≤ 3 ms median at 1× on desktop (today 1-2 ms).
- No new image > 2048 px on a side; no new decoded image > 16 MB.
- Download: ≤ +100 KB gzip JS and ≤ +1 MB art per feature.
- Thermal: keep `autoQuality` and the existing auto-downgrade under ~40 fps; nothing new runs when
  the replay rests (the first-week polish already pauses the viewer on the result page).

**Techniques already in place** (keep): integer LOD strips, atlases (coat layers), palette LUT
recolour instead of per-horse textures, billboards instead of meshes, procedural variation from
seeds, quality presets with auto-downgrade, camera-based detail (strip LOD by on-screen size),
prebaked bands. **Add** only: per-runner keys in the LUT (cloth, build) and code-drawn hair
variants, all of which reuse those paths.
