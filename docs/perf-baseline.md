# Real-device performance baseline (V-00)

The visual research of 2026-11-01 (ticket V-00) asks for real phone and laptop numbers before any
new visual cost leaves its flag. Every frame-time number in that research is CPU-only (headless
SwiftShader), so it is not a baseline. The race viewer now records what the baseline needs on every
real device that watches a race. Nothing has to be switched on.

## What is recorded

Each mounted race viewer sends one `race_perf` event when the winner reaches the line (with at least
20 s of playback and 300 frames in, so the frame window covers the run-in; after 90 s at the latest),
or when the viewer is closed if it drew at least 150 frames. It goes to our own database through
`/api/events`, with no third parties and no new identifiers.

| Field | Meaning |
|---|---|
| `device` | `phone` (coarse pointer, short side < 600 px), `tablet` (other coarse pointer) or `desktop` |
| `gpu` | the WebGL renderer string (`unknown` when the browser hides it) |
| `dpr` | device pixel ratio |
| `view` | `trackside` or `classic` (3D) |
| `layout` | `wide`, `phone` (the 390 px race layout, V-01) or `phone-closeup` ("Close-up finish" on, V-02) |
| `fps` / `fpsLow` / `fps99` | 1000 / the median, p95 and p99 frame time, over the last ~20 s (up to 1,200 frames) |
| `workMs` / `workP99` | the viewer's own JavaScript per frame (scene update and draw calls), median and p99, ms |
| `slowPct` | % of frames over the device's frame budget: 33.4 ms on phones and tablets (30 fps), 16.8 ms on desktop (60 fps) |
| `quality` | the render quality at report time (`high` / `low`) |
| `downgraded` / `downgradeSec` | whether the auto-downgrade (high to low under ~40 fps) fired, and after how many seconds of playback (-1: never) |

## Reading it on the admin page

Open `/admin`, section **Metrics**, panel **Performance (race viewer, last 14 days)**.

1. **The device table** (one row per device class): reports, median fps, low fps, the share of
   reports on target (30 fps phones and tablets, 60 desktop), and the share that downgraded.
2. **Baseline by view and layout** (V-00): one row per device, view and layout, each number the
   median over that row's reports.
   - **fps / p95 / p99**: the smoothness a viewer sees and the hitches they feel (p99 well below
     the median means stutter: shader warm-up, texture uploads, garbage collection).
   - **JS ms / JS p99**: how much of the frame the viewer's own code uses. It is the part we control
     on the CPU. When fps is low and JS ms is small (1-3 ms), the cost is on the GPU (fill rate,
     texture memory), so the next visual feature must not add a full-screen pass or new textures.
   - **Slow**: the share of frames that missed the budget. Under 5 % reads smooth. Over 20 %
     means the device needs the low preset or a lighter scene.
   - **Downgraded · N s in**: how often and how soon the auto-downgrade fired. A downgrade in the
     first seconds on a device class means the high preset is wrong for it.
   - Rows marked `-` in Layout are reports from clients older than the baseline fields.
3. **Slowest GPUs** (at least 3 reports): the renderer strings at the bottom of the fps range.

## The baseline the ticket asks for

Watch a full race (more than 20 s of playback) in each view on at least two ordinary phones (one at
least four years old) and one laptop with integrated graphics, with "Close-up finish" off, then
again with it on. On the admin page, note the rows for those devices (the GPU list names them) in a
table in `docs/reports/` with the device names. Those numbers are the budget every later visual
ticket is measured against: ±5 % median fps, and no rise in Slow or in downgrades.

The research's provisional budgets until then (07-roadmap.md §4): no new full-screen pass on
phones; new per-runner data in existing LUT rows (0 new textures, 0 new draw calls); viewer JS at or
below 3 ms median per frame on desktop. The saddle cloths (V-03) follow them: the cloth colour and
number sit in the existing LUT row and strip mask, with no new texture and no new draw call.
