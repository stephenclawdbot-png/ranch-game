# Persona playtests (2026-10-31)

Four personas (newcomer and daily manager on a phone, geek and competitor on desktop) played the dev build
(head e1b8515, before the breeding preview rework) with an embedded database; 85 screenshots, kept
outside the repo. Report by Kimi; fixes for the S items went into the pre-ship polish pass.

# POST TIME — four-player playtest report

## 1. Newcomer (phone, fresh stable "Ashdown Stables")
**Path:** landing → Found your stable (name/silks) → welcome + rename starter → Story race build-up → live race → result + Why card → home → stable → horse page → training → race card → Live entry (Larkspur Maiden) → receipt.

**Friction (top 5):**
1. `07-first-race-setup-or-running.png` — Two countdowns disagree on the race page: header pill "Off in 0:08" vs overlay "OFF IN 0:10". A new player can't tell which clock is real. **Annoying.**
2. `08-first-race-mid.png` / `07` — Build-up says "LOADING · 5 OF 8 IN" with seconds left on the clock; the race felt like it might start before the horses finish loading. **Annoying.**
3. `07`…`213-racepage-maiden.png` — The racecard's *FORM / OR / GRADES* letters (D D D, "-") are never explained anywhere on the path. My first race asked me to read a card I couldn't parse. (The wiki explains it, but nothing links it inline.) **Annoying.**
4. `212-race-card.png` / `217-entry-receipt.png` — Runner picker cards are half-clipped off the right edge at 390 px ("Bright Id…"), and labels like "0/…" truncate. **Polish.**
5. `05-welcome-starters.png` — After renaming Little Comet to "Comet", the big CTA still says "Race Little Comet now" elsewhere (`06-rename-starter.png`) until reload; names also truncate to "Comet…" on the card. Minor identity confusion. **Polish.**

**Delights:** the "Race Little Comet now · gates open ten seconds after you tap" first-race framing (instant drama, no form-filling); the result screen's "Why it went that way" + "Worth trying next" advice card (`206-race-result.png`) — genuinely teaches; the fit checklist ("✓ Trip, ✓ Surface, ✗ Surface prefers dirt") on the race page makes strategy legible on a phone.

## 2. Daily manager (phone, 10-minute loop)
**Path:** home ("Today", goals) → race card Quick Pick → Quick-pick race + result → Daily Cup run → Cup board → horse Care tab → /stable/finances → horse Log → home re-check → Story tab.

**Friction:**
1. `10-home-moments.png` (competitor, same home) / `daily 22-home-care-goal.png` — "Run a race" goal stayed unticked after running the Daily Cup, and the hero still says "**Your first race**". The daily loop doesn't acknowledge its own races. **Annoying, near-blocker for "what should I do today?"**
2. `07-cup-run-result.png` — Cup result card reads "TIME 1:36.38 · TODAY'S RANK 1st of 1 · TO P 1%" — "TOP 1%" wraps to "TO P / 1%" at 390 px, and 1st-of-1 rendering as "top 1%" is mathematically backwards (that's top 100%). **Annoying.**
3. `11-finances.png` (finances) — A fresh player's finances page is a wall of zeros (per-horse table all "Earned 0 · cost 0", single bar chart). Nothing explains upkeep will land later or what to do to change the numbers. **Polish.**
4. `03-quickpick-race.png` — The race card is a very long scroll of ~20 races with tiny Enter pills; "left today" counters (3:57:xx) need squinting. Quick Pick helps, but browsing the card on a phone is work. **Polish.**
5. Daily loop tap count is fine (care 3 taps, Cup 2, training 2) but **finances + log + form book live 3–4 taps deep** behind horse page tabs with no badge back on Home; "check the books" isn't part of the Today list. **Polish.**

**Delights:** the Home "Today / Today's goals" strip is exactly the 10-minute answer (care → Cup → story race) with +45/+80 payouts visible; the Care tab's "Missing a day only pauses growth; it never harms her" kills FOMO anxiety; jockey/finances honesty ("Another +3,125 had no horse named on the posting…") is a lovely nerd touch on /stable/finances.

## 3. Geek (desktop, numbers-first)
**Path:** two Story races → My races → wiki index → wiki stats → horse page with Show numbers → Career → training previews → Breeding preview → /jockeys → jockey detail → claiming + handicap racecards → replay (play, 0.5×–4×, 3D view, sectionals) → Why card.

**Friction:**
1. `10-claiming-racecard.png`, `08-feature-racepage.png`, `217-entry-receipt.png` — "Sealed race — the outcome was locked when entries closed" is displayed on races where **entries are still open** (0 entered, 16 h to close). The headline claim contradicts the screen state; the seal exists pre-close, so the copy is just wrong. **Annoying (and trust-critical — this is the fairness feature).**
2. `07-training-previews.png` — Fatigue gauge labelled "FATIGUE TIRED → OVERWORKED" on every session including Rest; plan row 2 truncates ("Stamina gallops · 6C"). Also every workout says "Peak in 3–5 days" identically — can't compare sessions. **Polish.**
3. `09-jockeys.png` — Jockey list shows grade letter + wins only; no strike rate, no fee, no form on the list; "Leading jockeys: No winners yet" leaves a big empty right column on desktop. Fresh season, but the table begs for pre-season career numbers. **Polish.**
4. `05-horse-numbers.png` — Form table shows OR "32 (−4)" per run, but nothing ties rating deltas to performance; the Why text ("13 lengths behind, pace was even") never says *why the rating went down 4*. Geek wants the formula or a wiki jump-link inline. **Polish.**
5. `10-claiming-racecard.png` — Claiming card shows plan/OR/best trip but no weight column pre-entry and no claim price until entered; handicap weights ("0-75" band in title) unexplained inline. **Polish.**

**Delights:** Show numbers + Form book splits (Going/Trip/Surface/Draw/Rest with W-2-3/Btn) — real split analysis in-game; the Breeding preview (`08-breeding.png` content: nick rating 63, potential 509 range 408–609, COI, stat ranges, coat %, MSTN, size delta) is the best pre-breeding screen I've seen in a browser game; the replay with sectionals per third, race-call ticker, verify/seal fingerprint — transparent *and* checkable.

## 4. Competitor (desktop, "Kingsfold Racing")
**Path:** /week Road to Saturday → League → Hall of Fame → Trophy Room → Daily Cup (ran, 1:35.76, 1st of 2) → board with rival Nettlebed Farm → Saturday Feature race page → entry gate (licence-blocked) → home moments.

**Friction:**
1. `02-league.png` (League page) — "You're not in a league yet · 0 owners have scored" and a huge empty middle on desktop. First competitive screen shows a vacuum. **Annoying** (fresh-world problem, but it's the first impression).
2. `01-week.png` (Road to Saturday) — Everything is gated: "Earn the National licence in Story mode" + every horse "OR 40, needs 95: 55 short". Great near-miss honesty, but no signpost of *how many weeks* to 95 — motivation leaks without a trajectory. **Annoying.**
3. `09-feature-entry-gate.png` — Entry dialog for the Feature fully renders plan/ride/extras (480 cr add-ons) with all runners red "Needs a National…" — the blocker is per-row small text, not a banner; I configured a race I can never enter. **Annoying.**
4. `03-hall.png` / `04-trophies.png` — Hall of Fame entirely empty (no inductees/champions/records); Trophy Room's 16 plaques so dimmed their captions are unreadable — the "what earns them" promise fails visually. **Polish.**
5. Cup rivalry works (beat Nettlebed Farm by 0.62 s) but "6th against the field · Gold" mingles two different rankings (vs club field vs today's board) in one line — took re-reading. **Polish.**

**Delights:** the going/weather forecast board per course with rain % (real planning against Saturday, `01-week`); "OR 40, needs 95: 55 short" per horse — quantified longing, exactly what brings a competitor back; Cup board showing a *named rival's stable* with times — instant grudge.

---

## Ranked fixes (top 15)
1. **"Sealed … locked when entries closed" copy on open races** (race pages) — change to "seed committed, published at close"; trust feature must not contradict itself. **S**
2. **Count "the Cup" toward "Run a race" and retire "Your first race" hero once any race finishes** (home/goals) — the daily loop feels broken otherwise. **S**
3. **Fix "TOP 1%" percentile math + "TO P" wrap at 390 px** (Cup result card). **S**
4. **De-duplicate/clarify the two off-timers** ("Off in" pill vs centre overlay) or label them post-time vs close-time. **S**
5. **Inline gloss for FORM / OR / GRADES** (tooltip or link to wiki Ratings & form) on racecards. **S**
6. **Desktop league empty state**: show projected Bronze table, closest rivals, or last season's winners instead of a blank column. **M**
7. **Entry dialog: surface eligibility blockers (licence) as a banner before plan/extras.** **S**
8. **Un-truncate runner cards at 390 px** (entry sheet; name/trip/status lines). **S**
9. **Training previews: differentiate fatigue gauge per session and show per-session peak windows.** **M**
10. **Finances empty state**: one line — "Upkeep lands Monday; race purses in land instantly" + link to wiki credits. **S**
11. **Home Today: add "check the books"/log nudge when finances or form changed.** **S**
12. **Trophy Room: raise dimmed plaque contrast so earn-conditions are readable.** **S**
13. **Jockeys list: add career strike rate + fee columns; fill "Leading jockeys" with pre-season career table.** **M**
14. **Why card: append rating-change rationale (−4 because beaten 13 L with even pace) or link the formula.** **M**
15. **Road to Saturday: show expected OR gain/week or "on pace for ~2 wins to qualify" guidance.** **M**

## Bugs found
- **Cup result percentile/wrap:** run the Daily Cup as the day's only entrant → card shows "1st of 1 · TOP 1%" with "TO P" broken across lines (390×844). `daily/07-cup-run-result.png`.
- **Sealed-race copy before close:** open any Live race with entries open (Race card → Ashcombe Weekend Feature or Saltmarsh Claiming) → sidebar claims outcome "locked when entries closed" while 0 entries and hours remain. `competitor/08-feature-racepage.png`, `geek/10-claiming-racecard.png`.
- **Dual off-timers drift:** watch a Story race build-up — header pill and overlay countdown differ by ~2–30 s. `newcomer/07…08`.
- **Goals/first-race state lag:** run Daily Cup only → Home still shows "Your first race" hero and unticked "Run a race". `competitor/10-home-moments.png`.
- **Stray tiny timestamp behind hero:** home top-centre shows a faint clipped "3:5x" fragment behind the countdown stack. `daily/22-home-care-goal.png`, `newcomer/208-home-authed.png`.
- **Truncation at 390 px:** entry runner cards clipped ("Bright Id…", "0/…"); week-plan row "Stamina gallops · 6C". `newcomer/212`, `geek/07` (content view).
- Server log clean: no errors/500s/warnings during all four sessions (only a third-party price-feed 451 from one source, handled).
- No broken links or cross-screen number contradictions found in ratings (36→32 and form-book OR columns reconcile).

Note: during screenshot review I found two pairs of mislabelled filenames in the saved set (daily 11↔13 and 08↔12 are swapped contents; geek 08↔01 likewise) — the screens themselves are all present and complete.
