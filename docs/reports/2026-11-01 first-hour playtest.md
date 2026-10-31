# First-hour playtest (2026-11-01)

**Goal (owner):** before 50 beta testers arrive, the first hour is a hook, not a filter. A new
player races within minutes, understands why they won or lost, knows the one thing to try next,
and isn't buried in systems they don't need yet.

**How it was run.** The app ran locally as the beta runs it (`PLAYTEST_MODE=1`,
`USDG_MODE=practice`, a login-code secret, embedded PGlite in a fresh directory, `next build` +
`next start`; never production). `apps/web/e2e/first-hour.mjs` plays a brand-new player at
390×844 (phone, touch) and 1440×900 (desktop): landing → "I have an invite" → register (types a
stable name) → Wilf's welcome → first Story race → result + Why → the suggested next action →
second race → the stable → home → wiki. Every step is timed (wall clock, clicks) and
screenshotted. I read every screenshot, then reviewed the run as three players.

Caveat on the clock: the machine was shared with four other agents (load average 17-22 on 4
cores), so the robot's seconds are noisy, and a race takes as long as its broadcast (a 1,000 m
race plays in about 60 s, a 1,400 m race in about 86 s, plus the 10 s countdown and the finish).
Click counts and the order of things are the reliable numbers.

## 1. Baseline (before any change, at 3b4c4a9)

| Step | Phone: s (clicks) | Desktop: s (clicks) |
|---|---|---|
| Landing loads, "I have an invite" visible | 0.7 (0) | 0.9 (0) |
| Invite code accepted | 1.2 (2) | 2.1 (2) |
| Registered, Wilf screen 1 | 0.6 (1) | 1.1 (1) |
| Wilf's 4 screens done ("Yes, keep it simple") | 0.7 (4) | 0.6 (4) |
| Starters shown, "Race <horse> now" tapped | 1.2 (1) | 1.3 (1) |
| **First race entered** | **7.2 s, 8 clicks** | **8.6 s, 8 clicks** |
| Race broadcast to result (1,000 m / 1,400 m) | 109.5 | 138.0 |
| Why card read | 6.4 | 6.0 |
| Second race entered ("Race again") | 11.4 (1) | 21.3 (1) |
| Second result | 97.4 | 100.4 |
| Back to the stable | 7.1 (1) | 31.0 (1) |
| Home, wiki | 4.9 | 4.7 |
| **Total** | **259 s, 10 clicks** | **326 s, 10 clicks** |

A person adds reading and typing the robot doesn't: about 10 s on the landing, 10 s for the code,
15-30 s to think of a stable name, 40-60 s for Wilf's four screens and 10 s on the starters, so
**about 1.5-2 minutes from landing to the first "Race now" tap**, and the first result about
2 minutes after that. The path to the first race was already short and nearly unavoidable (one
brass button per screen). The problems start at the result.

What the baseline runs actually said:

- Phone, first race: 9th of 9, last at every call, on its best trip and surface. Why card:
  *"Finished 9th of 9, 7½ lengths behind the winner. The early pace was slow, so the leaders had
  plenty left and it was hard to make up ground. Conditions suited."* No "worth trying next" at all
  (nothing for a loss in good conditions), so the only action was "Race Lucky Penny again", same
  plan.
- Desktop, first race: 8th of 8, 16½ lengths, on **heavy** dirt at 1,400 m (best 1,150 m). The
  Story secretary draws the trip, surface and going at random (3 in 4 near the horse's trip, 3 in
  4 on its surface, a third of dirt races heavy), the very first race included.
- Rating line on both: *"Rating 40 → 33. OR -7: finished 9th of 9 in a race the handicapper
  expected it to finish mid-field — held by the per-race cap."*
- Tips read *"The heavy ground cost his"*, *"worth giving his that long"* for colts.
- Second race advice: *"Ran the same day as hard work: his peak is 3-5 days after"*: wait three
  days, in the player's first ten minutes.
- On the phone the Why card started about 1,900 px down the result page (2¼ screens) and the
  "Race again" button about 2,500 px down, under the photo card, the board, the credits and the
  rating line.

A probe of 30 brand-new stables' first Story races (pick auto, in-memory database) found **1 win
in 30 (3 %)**, half in the first three, against a fair-share 11 % for a 9-runner field: a new
horse's band rating (40) sits above its real ability (about 30-35), and the Story Club window is
band −12 to +12, so most first fields are stronger than the starter.

## 2. Three players

**(a) Crypto-native, on a phone.** Lands, sees "Connect wallet" in the top bar and on the landing
(good, familiar). Pastes the invite, invents a name, skims Wilf. Fine so far. The first result is
a loss with three screens of cards before any reason, and the reason is "the pace was slow,
conditions suited": that reads as "the dice". The rating line is jargon (OR, handicapper,
per-race cap). Goes to Sales looking for the market: locked, explained (good), but Packs offers a
Premium Pack paid in T-USDG on day one, and the Stable page shows jockey wages and a transfer
window. Would hesitate at the result (is this skill or RNG?) and get distracted by the
money-adjacent bits before learning the loop. Likely to stay if the loop is legible; likely to
judge it "a slot machine" if not.

**(b) Casual mobile gamer who has never seen horse racing.** Said "Yes, keep it simple". The
racecard on a phone breaks names mid-word ("Northe rn", "Harbou r Willow"). Watches the race
(fun). Result: last, then "Rating 40 → 33" with OR and per-race cap, then a card of sectionals and
running positions. Doesn't know what to change; the only big button repeats the same thing.
Second race: told to wait 3-5 days. Home then shows three to-do lists (Stable steps, Today 4 to
do, Today's goals) plus Road to Saturday, the Live card and Rivals. **This player quits after the
second loss**: no reason they understand, no change to try, and a wall of chores.

**(c) Sim/strategy fan on desktop.** Likes the sectionals, the fit grades and the seal. First race
on heavy ground over a trip beyond the horse's best feels unfair ("why did the game pick this for
my first race?"). Wants cause and effect: the Why card shows pace and sectionals, but not energy,
which is the thing the engine actually runs on. Would try "What if?" and change plans manually;
annoyed by the bare "Race again". Stays, but grumbles about the first race and the opaque cause.

## 3. Friction list, merged and ranked by how many players it would lose

| # | Friction | Loses | Fix |
|---|---|---|---|
| 1 | A loss gives no concrete reason (pace and "conditions suited" only) and often no suggestion at all | a, b, c | **Fixed**: Wilf's verdict, one sentence from the engine's record |
| 2 | No one-tap "try the change": the big button repeats the same race | a, b, c | **Fixed**: "Try again as a stalker" / "at a race that suits" / "Race <fresh horse> instead" |
| 3 | First race on random conditions (heavy, too far) against a field mostly above the starter: 3 % first-race wins | b, c (a) | **Fixed**: first Story race at the horse's best vs a level Club field (22 % wins) |
| 4 | The why and the next action sit 2-3 phone screens below the fold | a, b | **Fixed**: verdict right under your result, its button is the screen's one action (floats on phones) |
| 5 | Rating line jargon (OR, handicapper, per-race cap); "replays pay a little" on a first race | a, b | **Fixed**: "Down 7: finished 9th of 9 when, on the ratings, it was expected to finish mid-field (7 is the most one race can take off)." |
| 6 | Wrong pronouns in tips ("cost his", "giving his") | b, c | **Fixed** (tests) |
| 7 | Advice to wait 3-5 days in the first ten minutes | b | **Fixed** as the one change: a fresh horse in the stable instead |
| 8 | Jockey wages and transfer window on the Stable page while contracts are locked | b (a) | **Fixed**: hidden until jockey contracts open |
| 9 | Premium Packs buyable with T-USDG on day one | a | **Fixed**: the odds stay published; buying opens with the market (day 3 / chapter 1 / wallet) |
| 10 | Home after two races: three to-do lists, Road to Saturday, Live card, Rivals | b | **Fixed** (§8): one first-week list; Road to Saturday and Rivals wait for the first Live entry |
| 11 | Racecard names break mid-word on phones | b | **Fixed** (wrap between words, slightly smaller on phones) |
| 12 | Desktop result pages are heavy: navigating away took 20-140 s on a busy machine (the replay keeps rendering) | c | **Fixed** (§8): the replay rests once the results show |
| 13 | The login code card (a 23-character code) sits on the starters screen before the first race | a | **Fixed** (§8): after the first result, dismissible once; still on Profile |
| 14 | The photo card repeats the board above your result | b | **Fixed** (§8): your result and the verdict come first, the photo card below |

## 4. What changed

**The verdict (owner items 1 and 2).** `apps/web/src/lib/raceStory.ts` turns the replay into one
sentence and one change; `components/results/Verdict.tsx` shows it as Wilf, directly under your
credits, with one brass button. Reasons, in priority order, each backed by the engine's own data:

- *missed the break* (the engine's `slow_start` event, and back in the field early);
- *used too much early (leading / chasing the leader), nothing left with the final furlong to go,
  dropping from 2nd to 6th* (the engine's `tiring` call, or among the least energy two-thirds of
  the way round and losing ground late; when the trip was beyond its best, it says so);
- *the heavy ground / 1,400 m (his best is 1,150 m) didn't suit* (the fit grades);
- *boxed in behind horses when they quickened* (the `boxed_in` event, second half);
- *finished with plenty left in the tank (26 %) but too far back* (energy at the line);
- otherwise, measured: *the first few were simply quicker; his best speed was the 6th-fastest
  of 9*.

Wins say how it was won (made all / came late with the fastest finish / sat handy and quickened).
The change is always one tap: a riding plan, a race that suits (new `suited` Story option: nearest
Story trip to the horse's best, its surface, good ground), a fresh horse from the stable, or simply
again (luck: a slow start, a bad draw).

The changes were checked on the engine, same field, same luck, one change (the What-if idea):
holding a natural front-runner up when it ran dry *lost* 0.56 places on average (77 worse, 39
better), so the verdict never suggests riding against a horse's own style for that; it says
stamina ran out and offers a fresh horse or a race that suits instead. Riding closer to the pace
when it finished with plenty left gains 1.1-3.9 places; going back to its own style after an
off-style ride gains 0.2-5.5. A test pins this: every riding change the verdict suggests gains
places on average over 120 simulated races (`raceStory.test.ts`).

**Fair first race (item 1).** A stable's first Story race (no settled run yet) is at its horse's
best, against a Club window from 8 below the horse's real ability mark up to about 2 above it (the
documented §10 "first maiden"; the race itself is simulated honestly and can be lost). Probe of
new stables' first races: 1/30 wins (3 %) before; suited conditions alone 1/40; with the level
field **9/40 (22 %)**, half still outside the first three. Later Story races are unchanged.

**Plain rating line, sharper wording (item 2).** game-core `ratingChangeReason` and the result
caption; WhyCard is now "The race in numbers" under the verdict (and "Why X won" leads with the
same plain sentence for other stables' winners).

**Beginner unlocks (item 3).** Audited: the market, leasing, tote, claiming and jockey contracts
are gated (FeatureGate, route guards). Leaks fixed: jockey contracts (wages, transfer window) on
the Stable page, and Premium Pack buying (T-USDG) on Packs; the published odds stay visible.
Road to Saturday waits for the first Live entry. Nothing is taken from existing stables (unguided:
everything open).

**Day-3 bloodline nudge (item 4).** game-core `bloodlineNudge` (pure rule), db
`bloodlineNudgeFor`, `onboarding.bloodline` in the player view, `BloodlineNudge` on Home: from the
stable's third day, once, Wilf suggests retiring the lowest-rated racing filly to the broodmares
(a retired mare can breed straight away; a mare already retired comes first) and opens the
stallion finder on her (`/breeding?mare=<id>#finder`). "Not now" is final (coach mark
`bloodline`); never shown to a stable that has bred, an existing stable, or one without a mare of
racing age. Retiring asks for a confirmation (it is permanent).

## 5. Before and after

Final run on the final code (fresh database), against the baseline:

| | Phone before | Phone after | Desktop before | Desktop after |
|---|---|---|---|---|
| First race entered (robot) | 7.2 s, 8 clicks | 8.2 s, 8 clicks | 8.6 s, 8 clicks | 5.3 s, 8 clicks |
| First result (incl. broadcast) | 117 s | 131 s | 148 s | 158 s |
| First result | 9th of 9 (best conditions) | won, made all | 8th of 8 (heavy, too far) | 2nd of 8 (best conditions) |
| A concrete reason | no ("pace slow, conditions suited") | yes | partly (fit only) | yes |
| One suggested change, one tap | none | (a win: race again) | two tips, no button | "Race Bright Idea instead" |
| Why on the phone result page | ~1,900 px down, button ~2,500 px | 1,426 px down, its button floats in the thumb zone | | |
| Second race entered | 142 s, 9 clicks (same plan) | 143 s, 9 clicks | 182 s, 9 clicks | 338 s, 9 clicks (see below) |
| Total to the wiki | 259 s, 10 clicks | 319 s, 10 clicks | 326 s, 10 clicks | 403 s, 10 clicks |
| First-race conditions | random | horse's best | random | horse's best |
| First-race wins (probe of new stables) | 3 % | 22 % | | |

Clicks are unchanged (the path to the first race was already 8 taps); what changed is what the
taps lead to. The robot's seconds swing with machine load (load average 17-22 from four other
agents on 4 cores) and with the trip drawn. On desktop, opening the second race from the result
page took 152 s on that machine (the replay keeps rendering while the next route renders): the
player arrives with the race nearly over. The baseline showed the same (21 s, and 31 s to reach
the stable); recommendation 2 below.

The final runs said, verbatim:

- Desktop, first race: *"Bold Harvest used too much early leading, and had nothing left with the
  final furlong to go, dropping from 1st to 2nd."* Try this: *"Going from the front is still his
  best way: stamina is what ran out, and stamina work on the gallops builds it. Give Bright Idea a
  run meanwhile: fresh and ready."* Button: **Race Bright Idea instead**.
- Phone, second race (the Story secretary drew 2,000 m): *"Brave Heart ran out of energy with the
  last 500 m to go, dropping from 2nd to 9th: 2,000 m is further than her best (1,450 m)."* Change:
  **Try again at a race that suits**.
- Rating: *"Up 1: finished 2nd of 8 when, on the ratings, it was expected to finish close up."*
- An earlier after-run (before the measured rule) showed the loop working end to end on the phone:
  *"First Light used too much early chasing the leader ... dropping from 2nd to 6th"*, one tap, a
  new race with the change, 3rd of 9.

## 6. Recommendations (larger or design-changing)

The owner approved 1, 2, 3 and 6; they are built (§8). 4 and 5 are still open.

1. **Built (§8). One to-do list on Home for the first week.** Stable steps, Today and Today's goals overlap
   (care and the Daily Cup appear twice). Fold Today's goals into Stable steps until the guide is
   done, and show Rivals and the Live card after the first Live entry.
2. **Built (§8). Lighter result page.** For your own runner, put the verdict above the photo card, and pause
   the replay viewer when the results are on screen (desktop navigation from a result page took
   20-140 s on a busy machine because the replay keeps rendering).
3. **Built (§8). Move the login-code card** from the starters screen to just after the first result ("save
   this to come back on another device"): one less thing before the first race.
4. **Stamina as a visible lever.** The engine's most common loss is "ran out of energy"; a one-tap
   "stamina week" training plan from the verdict would make the fix playable in the first hour.
5. **Story difficulty curve.** The level first race fixes the first impression; races 2-5 still
   use band −12/+12 against a novice whose band rating runs above its ability. Consider easing the
   Club window by real ability for the first few Story races (needs the lead's balance call).
6. **Built (§8). Explain energy on the Why card** (an energy bar per third, from the frames) for the sim fans.

## 7. Artefacts

- Script: `apps/web/e2e/first-hour.mjs` (writes `timings.json` and numbered screenshots).
- Screenshots and timings of these runs were kept outside the repo (scratchpad).
- Tests: `apps/web/src/lib/raceStory.test.ts` (wording rules and the measured-change rule),
  `apps/web/src/lib/tryNext.test.ts` (pronouns), `apps/web/src/server/firstStory.test.ts`,
  `apps/web/src/server/guide.test.ts` and `packages/db/src/test/guide.test.ts` (the nudge),
  `packages/game-core/src/bloodlineNudge.test.ts`, `packages/game-core/src/ratings.test.ts`.
- Tests for §8: `packages/game-core/src/firstWeek.test.ts`, `packages/db/src/test/guide.test.ts`
  ("the first-week list on Home"), `apps/web/src/components/onboarding/firstWeek.test.ts`,
  `apps/web/src/lib/energyTrace.test.ts`, `packages/race-viewer/src/rest.test.ts`.

## 8. The four approved recommendations, built (2026-11-01)

**One first-week list on Home (recommendation 1).** Stable steps *is* the first-week list, so it
became the single to-do on Home rather than a new system. game-core `firstWeekList` puts the paid
Stable steps (unchanged credits, paid once each, same bonus and plaque) in the order a new trainer
meets them and adds four unpaid jobs ticked from the records: the first race (a result in
`race_entries`), naming a horse (the `horse.rename` audit row; on the list only while a horse
hasn't started, or once done), a Feature Qualifier entry (a race whose calendar kind is
`feature_qualifier`) and reading a career story (a one-time mark, `career_story`, sent after one
of your own horses' stories has been on screen two seconds). db `firstWeekView` is the player
view's `onboarding.firstWeek`. Home shows the next three jobs, each one tap to where it is done
(a Live entry opens the quick-pick sheet), today's three goals folded into the same card, and the
whole week under "The whole first week". The card hides once everything is done or after day 6.
While it shows, the separate "Today's goals" card is gone and "Today" keeps only what isn't on the
list (a gift foal, a free pack, a foaling: "Also today"); Rivals now waits for the first Live entry
like Road to Saturday. No new rewards: the extras pay 0, and a test checks the list pays exactly
what the steps pay.

**A lighter result page (recommendation 2).** For your own runner: your result, then Wilf's verdict
with its one change and "Try again", then the rating line, then the photo card and the board, the
race in numbers, the next actions and the full result. The course strip and "In plain words" move
under the result once it is in (they still lead before the off). Nothing was removed. The replay
viewer gets a `rest` prop: once the results show it pauses the run-out (never the race itself on a
broadcast running behind, never the finale) and stops drawing while nothing on the stage changes;
play, a seek, a camera change or a resize draws again (`race-viewer/src/rest.ts`).

**The login code after the first result (recommendation 3).** Off the starters screen; on your own
result pages for testers ("Save this to come back on another device", Copy), under the next
actions, until "Saved it, hide this" (a one-time mark kept on the server). Still on Profile.

**Energy on the Why card (recommendation 6).** `lib/energyTrace.ts` reads the horse's energy
(`FRAME_FIELD.energy`, the engine's tank, 0-1000) at 25 points of the trip straight from the replay
frames, with the other runners' median beside it. The Why card draws it as a line from the off to
the finish post, the engine's tiring line (7 %) dotted, and a "ran low" mark where the tank first
fell to it (more than 25 m out). One sentence under it ("ran low on energy with 300 m to go" /
"still had 28 % left at the line" / "used up the tank at about the right time"), and the whole
line in words as the image's label and under "In words".

Same script, same machine (load average 6-8 from other agents), fresh database each run; the
"after" columns are the final run (an earlier after-run gave the same positions within 4 px):

| | Phone before | Phone after | Desktop before | Desktop after |
|---|---|---|---|---|
| Verdict's top on the result page | 1,438 px | **826 px** | 1,544 px | **1,005 px** |
| Photo card's top | above the verdict | 1,325 px (below it) | above the verdict | 1,231 px |
| Its "Try again" button | under the verdict text | 1,134 px | | |
| Result page height | 3,728 px | 4,292 px (+ energy line, login code) | 2,671 px | 3,193 px |
| Opening the next race from the result page | 2.4 s | 0.8 s | **> 240 s (run failed)** | **0.5 s** |
| Replay at rest after the result (`data-rv-rest`) | (kept drawing) | yes | (kept drawing) | yes |
| Login code before the first race | yes | no (starters screen 2,009 → 1,651 px) | yes | no |
| Login code after the first result | no | yes, dismissible | no | yes |
| To-do lists on Home after two races | 3 (Stable steps, Today 4, Today's goals) + Rivals | 1 ("Your first week", goals folded in) | 3 + Rivals | 1 |
| Home page height after two races | 3,008 px | 2,383 px | | |
| First-week list | | 2 of 14 done; next: care, training plan, Live race | | same |
| Total to the wiki | 276 s, 10 clicks | 247 s, 10 clicks | failed at the second race | 264 s, 10 clicks |

The desktop "before" run reproduced the friction-list item 12 exactly: tapping "Race First Light
again" on the result page never reached the next race within the script's 240 s. After the change
it took 0.5-0.6 s on both after-runs. The result page is longer in total because it now carries the
energy line and (testers) the login code, but what a player needs first sits about one phone screen
higher. The energy lines in these runs read, verbatim: *"Steady On's energy: 100% at the off, 71% a
third of the way, 51% two-thirds of the way and 28% at the finish (a typical rival had 42%
two-thirds of the way and 4% at the finish). Steady On still had 28% left at the line: energy to
spare."*

