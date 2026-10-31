# Raising and training v2 (design, 2026-10-31)

Why: every reviewer (docs/reports/2026-10-31 experience review.md, persona playtests) found raising a
foal a chore with one right answer (19 days of "tap the feed with the tick") and training solvable in
a week. The owner approved improving both ("fix all pending ... feel free to improve"). Real time
stays: a foal still needs 19 counted care days, one per day.

## Raising: one real choice a day

Each counted care session (one per horse per local day, unchanged) asks for **one focus** instead of a
feed. Feeding becomes automatic and correct (care quality stays as today for anyone who cares daily, so
no one is punished for the old chore disappearing).

| Focus | Shapes (small, bounded, deterministic) | Trade-off |
|---|---|---|
| Handling | composure (temperament realisation), easier to load in the stalls | slower bond than turnout |
| Turnout with the herd | bond, soundness (a small durability realisation nudge) | no schooling |
| Ground work | early speed realisation, gate skill of the horse (fewer slow starts) | a little keener (composure down) |
| Long walks / hacking | stamina realisation, a nudge towards longer trips | slower early speed |
| Rest day | none, but heals and keeps the foal fresh | counts as care, nothing gained |

- Each focus adds to a hidden-but-capped **upbringing profile** (per area, at most ±30 realisation
  permille in total and at most one trip-band nudge). It moves realisation within the genetic
  potential only, never above it: breeding still sets the ceiling.
- Diminishing returns: the same focus five days running gives less each day, so a varied upbringing is
  usually best, but specialising is a valid plan for a horse bred for one job.
- **Milestones** at sessions 5 (weaning), 12 (yearling) and 19 (racing age): a short card with one
  decision (e.g. "First saddle: patient or brisk?") that fixes a small trait for life (e.g. "Settles
  quickly" vs "Keen early"). Shown on the horse page and in its log.
- Everything is shown honestly after it happens ("Ground work: early speed a little up"), never as
  exact hidden numbers; the wiki explains the caps.
- Stable hand: "Care for all" applies each horse's chosen default focus.

## Training: blocks, discovery and trainers

- **Training blocks**: plan 1-3 weeks with a risk dial (easy / steady / sharp). The preview shows the
  expected range of gains and the fatigue path, not one exact number, so plans can be compared but not
  solved once and for all.
- **Hidden response traits** (1 in 3 horses has one, inherited loosely): "thrives on hill work",
  "needs company", "goes stale with too much speed work". Discovered only by doing (the form book and
  log show "responded well to stamina gallops" after enough sessions). This is the geek's trial and
  error.
- **Trainer specialism**: the Trainer facility gets a chosen specialism (speed, stamina, soundness)
  that adds a small bonus to matching work.

## Rules

- Deterministic from the horse's seed and the choices made; no randomness that a reload can reroll.
- No effect on horses already at racing age except through training blocks and traits revealed from
  now on; existing upbringings count as "balanced".
- Credits only; nothing bought with money changes any of this.
- Season harness checks: average realised ability unchanged within ±1 OR for a balanced upbringing;
  specialised upbringings move aptitudes but don't raise the ceiling.
