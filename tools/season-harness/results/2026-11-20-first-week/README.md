# First-week pacing: measurements (2026-11-20)

Kept from the runs behind `docs/reports/2026-11-20 first-week pacing.md`. "Before" is the code at
396ab71; "after" is this change. Rerun with the commands in `tools/season-harness/README.md`.

| File | What |
|---|---|
| `first-races.jsonl` | One line per chunk of the first races probe: label (before / after), seed, policy, races per stable and the chunk's counts. Chunks add up exactly (`FIRST_TALLY`), so the 2,000 stables each side were run a few hundred at a time. |
| `first-races.md` | The added-up tables (`FIRST_TALLY_REPORT=1`). |
| `first-week-before.md` | First-week scenario at 396ab71: 10 casual and 10 engaged stables, 12 days. |
| `first-week-after.md` | The same after the change: 13 and 13 stables (two runs, seeds `fw-after-1` and `fw-after-2`, 6 and 7 per persona; their own reports are in the two folders). "foalBorn" counts 11 of 13 here: these two runs still counted a foal only when the visit itself delivered it (fixed in `src/firstWeek.ts` afterwards); every covered mare foaled. |
| `first-week-breed2-care8.md` | The scenario with `BREED_FROM_STARTS` 2 (not chosen: the casual stable covered on day 8). |
| `season.md` | The season regression: what was run and what it shows. |
