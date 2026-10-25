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

## 4a. Career clock (user decision, supersedes the calendar ageing in §4)

**Horses age by career activity, not by calendar time.** An inactive player's horses never
age, decline or die. Seasons exist only for competitions: leagues, finals, titles.

- **Foal → racing age:** 19 counted care sessions (5 / 7 / 7), as in §4.
- **Career stages by starts:**

  | Starts | Stage |
  |---|---|
  | 0–8 | Juvenile (maiden and novice races, trials) |
  | 9–35 | Prime |
  | 36–50 | Veteran (gradual decline, speed fades first) |
  | 50 | Mandatory racing retirement |

  The owner may retire a horse earlier. The horse page shows "Career: n / 50 starts".
- **Maturity gene:** early, normal or late peaker. It shifts each stat's maturity curve over
  the starts axis, so an early type peaks at about starts 8–20 and a late type at about
  starts 20–40.
- **Stud and broodmare career:** 4 breedings total, at most 1 per mare per season. Breeding
  is only available after racing retirement, or from start 30 onwards for horses still
  racing. The stud stage ends when all breedings are used, or when the owner pensions the
  horse.
- **Pasture / Legend:** a permanent retired state. The horse stays in the stable and the
  Hall of Fame. There is no death.
- **Injury:**
  - Risk comes from durability, fatigue, how often the horse races, going, and riding
    risk.
  - **The risk is shown before entry.**
  - Recovery takes real days, and care plus the vet facility speed it up. Healing while
    away is fine.
  - A rare career-ending injury forces racing retirement only, and the horse can still go
    to stud. It is never fatal, and insurance can be bought with credits.
- **Other dynamic variables:**
  - form and morale (recent results, bond, freshness);
  - fatigue and freshness;
  - genetic quirks, revealed through racing (loves mud, gate-shy, finds a kick, hates a
    crowd);
  - bond, which never decays from absence.
- **No time-based fees.** Capacity is limited by stall slots (licence and facilities).
  Costs come from activity only: training, entries, vet, breeding.

### 4a amendments (user-approved)

- **Career length:** 40 starts. Juvenile 0–6, prime 7–28, veteran 29–40. Mandatory racing
  retirement at 40. Breeding is available from start 25 or after retirement.
- **Rest:** freshness recovers in real time. A horse can race again whenever the owner
  chooses, but racing it tired lowers performance and raises injury risk. Hard cap: 3 starts
  per horse per day.
- **Ride mode is core, and always optional.** Every race offers "Ride". If the player
  doesn't ride, the auto-jockey follows the race plan. A ride's influence is capped at about
  ±3–5%. Build it after the Phase 1 integration.

## 4b. Population control & anti-multi-account (user-approved)

- **Stall cap is the primary control.** A stable starts with 6 stalls; facilities add more,
  up to 24. A player can never own more horses than stalls, so foaling uses a nursery
  overflow slot and the foal is never lost. The active population is therefore at most
  players × stalls.
- **Packs produce foals,** which need 19 care days before they can race.
- **Pack limits:**
  - Paddock Pack: 1 free every 3rd play day, plus up to 3 bought with credits per week.
  - Premium Pack: up to 10 per week per account.
  - A **seasonal global foal crop cap** (e.g. 10,000), with the remaining count shown
    publicly.
- **Ways out of the active pool:** racing retirement at 40 starts. Pensioned and Legend
  horses move to the **Legacy Farm**, which needs no stall. Any horse can be **released to
  the Club** for a few credits.
- **Bound horses:** starter horses and free-pack horses are "Club-bred". They can't be sold,
  traded or transferred. Their foals are tradeable only after 5 starts.
- **Market friction:**
  - a 5% fee, burned;
  - a listing price floor of about 70% of the appraised value;
  - no direct credit transfers;
  - to sell, an account needs to be at least 7 days old, have at least 20 races and a
    verified email.
- **Linked accounts:** device, fingerprint, IP pattern or wallet links are flagged. Trades
  between linked accounts are blocked, and their leaderboard results are reviewed. Ranked
  rewards (Daily Cup, leagues, titles) require a verified account; those rewards are
  cosmetic.

## 4e. Two modes: Story (single-player) and Live (multiplayer). User decision; refines §4d.

- **Story mode.** A single-player career campaign (Rival Stars-like). Solo races against
  **named AI rival stables** with personalities, organised in chapters (Club → County →
  National → Classics).
  - **Watching:** watch, speed up, or **skip to the result** (instant). It's solo, so nothing
    is spoiled.
  - **Rewards:**
    - story unlocks, cosmetics, a gift foal;
    - **licences** that unlock Live race classes;
    - credits capped per chapter: full reward the first time a story race is won, minimal
      on replays, so story races can't be farmed.
  - **Shared with Live:** the same stable horses run, using freshness and career starts.
    Story races don't consume daily Live entries.
  - **On-ramp:** new players start here. Chapter 1 unlocks Live maiden races.
- **Live racing.** Everything in §4d: a shared 3-minute card, always live, with ratings,
  leagues, the Daily Cup and the Season Final.
- **Phase 1:** the existing solo quick races (`/api/races/quick`, `instant` allowed) are the
  base of Story mode. Chapters, named rivals and licences come in Phase 3.

## 4d. ALL LIVE RACES ARE LIVE AND SHARED (user decision; solo races live on as Story mode, §4e)

- **The core loop is a shared race card.** A race goes off every 3 minutes across tracks,
  distances, surfaces and classes. Every viewer sees the same race at the same moment, live.
- **Entries** are open from when the card is published until 1 minute before the off. The
  seed commitment is published when entries open. At entry close, the field snapshot is
  locked.
- **Fields of 8–12 horses come from different players.** At lock, any gates still empty are
  filled with house-stable AI horses of the race's class band, so races are always full at
  launch or off-peak. AI share falls as player numbers grow.
- **Matchmaking:** race eligibility comes from class and rating bands (maiden, novice,
  handicap bands, listed, graded). A player can't enter two horses that would make up more
  than half of a field. One horse can run in only one race at a time, and stable entries
  apply (see the entries proposal).
- **Quick Pick** means "enter my best-fit fresh horse into the next suitable race on the
  card", in one tap.
- **Watching is optional.** The race runs live regardless. If you're away, the result and
  replay go to your inbox.
- **There are no instant results.** Every race is live for everyone. Solo quick races are a
  stopgap until the database is wired in, then they're removed.
- **This needs server state** (`packages/db`), plus a real `DATABASE_URL` (Neon) in
  production, because entries must be shared across serverless instances.

## 4c. Quick Pick & watch options (partly superseded by §4d: no instant results)

- **Quick Pick:** one tap. The server picks the best-suited starter horse, using the
  form-guide rating at its preferred trip and ground, and rides it on its natural style. It
  rotates away from horses the client reports as recently run. The response includes a short
  reason, which is shown on a pick card.
  - API: `POST /api/races/quick { playerId, pick: "auto", exclude?: number[], instant? }`
  - The response includes `pick: { horseIndex, tactic, reason }`.
- **Watch options:** for a quick race, the player chooses one of:
  - **Watch live:** the normal broadcast.
  - **Watch later:** the result and replay go to the inbox (client-side for now).
  - **Instant result** (`instant: true`): the race is back-dated past the broadcast window,
    so it's final immediately. This is only for solo quick races against AI. Shared
    scheduled races always stay live.
- **Assistant Trainer (later, with the database):** optionally spends leftover daily entries
  on Quick Picks under safe rules (fresh horses only, never high injury risk), with a daily
  summary.
- **Note:** quick races are settled on the client until the database lands. With the
  database, each race consumes an entry when it's created and is settled on the server
  regardless of whether anyone watches, so cherry-picking results is impossible.

## 4. Life cycle & growth (original calendar model; ageing replaced by §4a)

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
