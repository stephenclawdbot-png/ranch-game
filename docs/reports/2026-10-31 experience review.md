# Experience review: "how would you play" (2026-10-31)

Owner's brief: "I want people to experience the game fun, like management at the same time geek on
technical stuff. Plus I want them to waste their time on trial and error which we should give...
addicting at the same time enjoyable like a full stable manager."

Four independent answers to "how would you play, where would you get hooked, where would you quit,
what's missing for trial and error and for a full stable manager, top 10 improvements": GLM, Kimi, a
separate Claude reviewer (each read the docs, wiki, routes and game-core on the dev branch, read-only), and
the lead. Raw answers: GLM and Kimi via `tools/agents/ollama-worker.sh`, Claude via `api-worker.sh` ($0.90).

## What already works (all four agree)

- **The breeding preview** (exact grade odds, beats-both-parents %, family limits, coat/trait odds) and
  the foal reveal: the long-term hook, "a loot drop with published odds".
- **The training board's honesty** (gains, fatigue, knock risk and the freshness peak before you pay).
- **Close finishes as events** (engine 1.4.0 + the v2 finale: photograph, line-scan, slow-mo, weighed in,
  top-3 cards).
- **Road to Saturday** (qualify or the Plate, one appointment race).

## The diagnosis (all four agree)

**The game records everything and shows the player almost none of it after the fact.** Feedback is
excellent *before* a decision and poor *after* it: no training log, form lines without going / course /
draw / tactic / jockey / fatigue / rating change, no splits, no finances view, no way to test an idea
without spending a race you care about. And **nobody in it has a name yet**: Club fields are honest but
anonymous, rivals are detected (`social.ts`) but never shown, jockeys are a priced dropdown.

Second-order: a small stable runs out of meaningful actions in ~10 minutes a day; care is a one-right-
answer chore; training is solvable in a week; discoveries (quirks, "Improving", scans) arrive as quiet
text, not moments.

## Consensus improvements (how many of the four named it)

| # | Improvement | Votes | Size | Builds on |
|---|---|---|---|---|
| 1 | Full form lines + per-horse log (training, condition, every race input/output) | 4 | S | entry snapshot, training records, HorseDetail |
| 2 | Splits / form book (W-P by going, course, trip, tactic, jockey; per horse, sire line, stable) | 4 | S-M | race history |
| 3 | "What if" re-runs / exhibition vs ghosts (same field, one change, unrated, labelled) | 4 | M | deterministic engine, verifyReplay |
| 4 | Finances page (weekly P&L by kind, per-horse earned vs cost) | 4 | S | ledger |
| 5 | Rivals panel + head-to-head + news feed | 4 | M | social.ts rivalry detection, results |
| 6 | Jockeys Phase 1 | 4 | L | in progress |
| 7 | Discoveries as moments (quirk fires, Improver step, scan results, retirement / memorial) | 3 | S | inbox, Hall, Legacy Farm |
| 8 | Campaign planning: pin a horse to a future race, reminders, clashes | 3 | S-M | 24 h card, /week |
| 9 | Near-miss honesty ("9th on points, 4 short") + "try next" advice on the Why card | 2 | S | RoadToSaturday, WhyCard, courses.ts |
| 10 | Wiki honesty gaps: nick formula, quirk catalogue, jockey effect sizes | 2 | S | wiki kit |
| 11 | Stallion ranking for a mare (loop the breeding preview over the stud book) | 1 | S-M | /api/breeding/preview |
| 12 | Daily Cup variety (seeded weekday trip/going) | 1 | S | dailyCup.ts |
| 13 | Deeper training (multi-week blocks, hidden "responds to X" traits) and less chore-like care | 2 | M | training.ts, quirks |

Fixed already: the wiki said "no running costs" while weekly upkeep is charged (Claude reviewer); corrected.

## Lead's view

I'd play exactly as the reviewers describe, and I'd hit the same wall on day 3: I'd want to know *why*
my filly ran 4th on soft at Saltmarsh but won on good at Kestrel, and the game would make me keep my own
spreadsheet. The geek promise lives or dies on items 1-3: they turn every race into data and every idea
into a cheap experiment. Items 5-7 are the "full stable manager" warmth (people, rivals, stories). The
"what if" re-run is the single most distinctive feature we can build because our races are provably
deterministic; no other horse game can honestly say "same race, same luck, different tactic".

Guard rails for what-if: only after the race is settled (seed revealed), unrated, no credits, clearly
labelled counterfactual, never available for a race not yet run, and the luck (day form, gate) stays
the same so only the changed input moves the result.

## Plan

- **Wave 1 (now, small, high consensus):** form book (1 + 2), finances page (4), moments + near-miss +
  try-next + wiki gaps (7, 9, 10).
- **Wave 2:** what-if re-runs (3), rivals + news (5, with jockeys' news in Phase 3), campaign planner (8),
  stallion ranking (11), Cup variety (12).
- **Wave 3 (needs design):** training depth and care rework (13), named staff.
- **Persona UI playtests** (newcomer, daily manager, geek, competitor) on the dev build after wave 1, with
  screenshots, to check the new screens land.

## Decision for the owner

The breeding preview computes odds from the true (hidden) genotypes, so a careful player can infer hidden
alleles by previewing against known partners. Either (a) keep it as a deliberate scouting mechanic and say
so in the wiki, or (b) compute the preview from revealed information only (wider, honest-uncertainty odds).
Recommendation: (b) for hidden-copy traits, keep exact odds for what's already revealed.
