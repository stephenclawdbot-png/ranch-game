# Thoroughbred: Game Design (core systems & retention)

**Positioning.** The cozy-competitive racing stable game: Football Manager depth,
Umamusume breeding and collecting, Stardew's daily care loop, playable in a browser. It is
not a betting product. Races pay in-game **Stable Credits** only.

**Design rule.** Simple on the surface, deep underneath. Every screen shows one obvious next
action. Every system has one or two visible numbers on top and real depth behind them, for
the players who want to dig.

**Ethics rule.** We build habits, not traps:
- no punishment for being away (nothing dies, withers or decays from absence);
- no streak shaming;
- published odds and pity on every pack;
- no pay-to-win in rated races;
- no cash prizes.

Players should come back because they *want to see what happens next*.

---

## 1. Pillars

1. **Every horse is a story.** A unique genome, a visible look, a career record, a pedigree.
   Players name horses, remember them and grieve their retirement. Legacy is permanent.
2. **Your decisions show.** Training plans, race placing, tactics and pairings visibly change
   results, and the post-race "why" card explains them.
3. **Start equal, rise by skill.** Day-1 horses are modest. Elite bloodlines are *bred* over
   generations, never bought at launch.
4. **Always something brewing.** A foal growing, a mare in foal, a race this evening, a
   season final on Sunday. There's always a reason to check back, and never a penalty for
   not doing so.
5. **Live and fair.** Races unfold live with no spoilers, and every outcome is provable.

## 2. Loop stack (why people stay)

| Horizon | Loop | Hook | Reward |
|---|---|---|---|
| **Seconds** | Watch a race | Live broadcast, tension curve, your horse marked, commentary | Photo finish, a podium reveal, credits counting up |
| **Session (5–15 min)** | Care → train → enter → watch → spend | Clear next actions (the "stable board") | Visible stat gains, results, credits, foal growth step |
| **Daily** | Daily Cup (same seeded race for everyone), care sessions, 3 daily goals | Comparing with friends and the global board; foals grow only when tended | Cup points, credits, a free Paddock Pack every 3rd day of play (not consecutive days) |
| **Weekly** | Weekend Feature race; weekly league table; pregnancy and foaling | Ranking and rivalry; foals arriving | Cosmetics, titles, league promotion |
| **Season (4 weeks)** | Season calendar, classes and graded races, Season Final, breeding window | Climbing the classes; the season title | Trophies, Hall of Fame entries, season-exclusive cosmetic silks |
| **Lifetime** | Bloodlines, champions, retirement to stud, Hall of Fame | Building a dynasty | Prestige, stud demand (credits), permanent records |

**Variable reward, ethically.** Race outcomes, foal genetics and pack pulls are uncertain
and exciting, but always with published rules, odds and pity. The thrill is *finding out*.

**Return triggers (in-app and email only, no dark push):**
- "Your foal is ready for care"
- "Your race is off in 10 minutes"
- "The Daily Cup is open"
- "Your mare has foaled"

## 3. Horses: genome → phenotype

- **Genome.** Each stat (speed, stamina, burst, durability, adaptability, temperament) has
  two alleles, each a value from 0 to 1000. Its **potential** is the mean of the two alleles
  plus a dominance effect.
- **Plus:**
  - **Aptitude genes:** distance (sprint, mile, middle, staying), surface (turf, dirt) and
    running style.
  - **Coat genes:** Extension E/e, Agouti A/a, Cream Cr, Grey G, Roan Rn, Dun D.
  - **White markings:** a white-spotting tendency.
  - **Body morph genes:** height, leg length, neck length, girth, head size.
  - **Breed share:** Thoroughbred, Arabian, Quarter Horse, Akhal-Teke.
- **Inheritance.** One allele from each parent per locus, plus a bounded mutation of ±0–30
  that is rare and seeded.
- **Inbreeding.** It's tracked with the coefficient of inbreeding (COI) from the pedigree.
  High COI reduces durability and temperament and raises the chance of a negative mutation.
- **Genetic ceiling.**
  - Launch horses are capped at a potential of about 600 per stat, roughly C grade.
  - Selective breeding pushes the frontier by about 20–40 per generation at the top end.
  - The first A-grade horses (about 800 or more) should appear around generation 4–6.
- **Hidden until revealed.** A foal's exact potentials are shown as ranges ("B to A
  stamina"). They narrow as the horse grows, trains and races, giving the "discovery" hook.
  A paid *Pedigree Scan* (credits) narrows them early.
- **The look comes from genes** via the pixel rig: coat, markings, morphs and part variants.
  There's zero art generation per horse.

## 4. Life cycle & growth (time model)

**One season is 4 real weeks.** Age advances one year per season, at the season rollover.

| Stage | Age | Can race | Can breed | Notes |
|---|---|---|---|---|
| Foal | 0 | – | – | Grows only through **care sessions** |
| Yearling | 1 | Trials only | – | Grows through care, plus light training |
| Juvenile (2yo) | 2 | Maiden, novice | – | Peak growth in speed and burst |
| Prime | 3–6 | All | Optional | Stamina matures from 4 to 6 |
| Veteran | 7–8 | All (decline) | Yes | Speed fades first |
| Retired | 9+ or any time by choice | – | Yes (slots left) | Stud or broodmare career |
| Pensioner | 14–16 | – | – | Announced 2 seasons ahead, then Hall of Fame. Never sudden. |

- **Care session.**
  - Feed, groom and turnout: one counted session per horse per real day.
  - Foals need 5 sessions to wean, 7 more to reach yearling, and 7 more to reach racing age.
  - Missed days pause growth and never harm the horse.
  - Care quality (the right feed for the horse's needs) adds up to +5% of potential realised.
- **Pregnancy.** 24 real hours after breeding. Foaling is an event: there's a reveal
  animation and you name the foal.
- **Current vs potential.**
  - *Current* stat = potential × maturity(age, stat-specific curve) × fitness × training
    realisation.
  - *Training realisation* starts at 60% and rises towards 100% through training, with
    diminishing returns.

## 5. Training (simple surface, deep inside)

- **Weekly plan.** Each horse gets a *plan* with 3 slots: Speed work, Stamina gallops, Gate
  practice, Swimming (low impact), Rest, or Race prep.
  - Show the result simply: an arrow up or down on each stat, and a fitness and freshness
    bar.
  - **The depth underneath:**
    - each workout trains specific stats, with diminishing returns near the potential
      ceiling;
    - fatigue builds up;
    - a horse that's overworked carries an injury risk (minor, a few days off, never fatal);
    - freshness peaks 3–5 days after hard work, so timing the race matters.
- Training costs credits, which is a sink. A **Trainer** facility upgrade adds a slot and
  better efficiency.
- **Form cycles.** A horse peaks after a good prep and dips after back-to-back races. Players
  learn to place horses well: real management depth.

## 6. Racing structure

- **Classes, by rating.** Maiden → Novice → Handicap bands (0–55, 50–75, 70–95) → Listed →
  Graded (G3, G2, G1).
  - **Rating.** An official rating (OR) is updated after every race from performance against
    the field. It's the handicapper's mark.
  - **Handicaps** assign weights (a small speed penalty) by rating, so mid-level horses win
    too. A field of equals is the most exciting.
- **Race calendar.** The schedule runs every 3 minutes, with conditions published in advance
  (distance, surface, going forecast).
  - Entries close 1 minute before the off.
  - Each horse has a limit on runs per day, to protect it and to stop farming.
- **Quick races** are casual, low-purse and still rated.
- **Daily Cup.**
  - One seeded race per day, entered with any one horse, open for 24 hours.
  - Each entry is simulated against the same fixed field (a time trial against the same
    rivals), so everyone faces identical conditions and luck.
  - It's ranked globally and among friends.
  - A **Cup Run** gives one shot per day: no grinding, which makes it a fair daily habit.
- **Weekend Feature.** A big graded race with a qualification ladder during the week.
- **Season Final.** Championship races per division, plus owner and trainer titles.
- **The "why" card** after every race explains the result:
  - trip fit, surface and going;
  - how the pace collapsed;
  - traffic;
  - freshness;
  - how your tactic worked out.

  Each point links to a concrete thing to try next.

## 7. Breeding

- **Lifetime limit:** 4 breedings per horse. At most 1 per season per mare. Stallions can
  cover up to 4 per season within their lifetime total.
- **Rules.**
  - A horse can't breed with itself.
  - Parent and child, and full siblings, are blocked.
  - The COI penalty shows in the preview.
  - Breeding needs a mare and a stallion that are both of breeding age.
- **Stud market.** Owners list stallions with a stud fee in credits; the platform takes 10%,
  which is burned as a sink.
- **The breeding preview** is the depth engine:
  - predicted ranges per stat, coat colour probabilities (with real genetics) and aptitudes;
  - the COI;
  - a "nick" rating for how well two lines combine.

  You see the odds before you commit.
- **Breeding fee:** a base credit fee plus the stud fee. It's a major sink.

## 8. Economy (Phase 1, no token)

- **Credits in:** race purses (scaled by class), daily goals and the Daily Cup.
- **Credits out:**
  - training and upkeep: a monthly stall fee per horse, which keeps stable size in check;
  - entry fees for Listed and Graded races;
  - breeding and stud fees, Paddock Packs, facility upgrades and Pedigree Scans;
  - the 5% market fee, which is burned.
- **Target:** credits spent ≈ credits earned over a week for an active player.
- **Market (credits only).**
  - List a horse, with escrow and an expiry date.
  - Horses can't be sold while entered in a race, in foal or locked.
  - Trades between linked accounts are flagged.
- **Packs (gacha).**
  - **Paddock Pack:** credits; a young horse, Common or Uncommon.
  - **Premium Pack:** mocked in Phase 1. Better tiers, still under the genetic ceiling.
  - Odds are published, with pity (Rare or better within 10 pulls; Epic within 50).
  - Pulls are seeded and committed like races.
  - Premium Packs are geo-blocked where paid loot boxes are restricted.
- **Phase 2 (later):** USDC and token as premium currency. Credits are never cashed out.

## 9. Social & status

- **Owner profile:** stable name and silks, best horses, trophies, Hall of Fame entries.
- **Leagues:** weekly owner leagues of 30 owners, with promotion and relegation by points.
  It's the core status hook.
- **Rivalries:** the game auto-detects repeat close finishes against the same owner and adds
  them to a "Rivals" panel.
- **Hall of Fame:** champions, season winners, record times, famous bloodlines. Permanent.
- **Sharing:** generated pixel "race cards" and replay links for wins and photo finishes.
- **Clubs:** later.

## 10. Onboarding (first 5 minutes)

1. Name your stable (a default is suggested) → you get 3 starter horses. Racing your first
   horse takes 1 tap.
2. Your first race is a guaranteed-competitive maiden, still simulated honestly.
3. The first "why" card teaches one concept, then the first goal unlocks: "Train your
   horse".
4. The day-1 goals introduce care, training and the Daily Cup.
5. Day 2 brings a gift foal from the club's broodmare, which introduces care and growth.
   This is the first long-term hook.

## 11. Implementation map

| Package / area | Contents |
|---|---|
| `packages/game-core` | Pure deterministic rules: genome, inheritance, coat genetics, COI, phenotype and maturity curves, care and growth, training, ratings and handicaps, eligibility, breeding rules and preview, packs (odds, pity, seeded pulls), seasons and calendar, Daily Cup, leagues, achievements. Fully unit- and property-tested. |
| `packages/db` | Drizzle schema and migrations (Postgres): accounts, stables, horses, genomes, lineage, care log, training plans, races and entries, ratings, ledger (double-entry), market, packs, seasons, leagues, Hall of Fame, audit. PGlite for dev and tests; Neon in production. |
| `apps/web` | Server actions and API routes, idempotent and authoritative (the client never sends outcomes). Screens: Stable board, Horse, Care, Training planner, Breeding barn and preview, Nursery, Market, Packs, Daily Cup, League and Season, Hall of Fame. |
