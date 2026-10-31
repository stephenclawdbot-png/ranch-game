# Jockeys (design, 2026-10-31)

Owner: "Some stables would have their own jockeys... a jockey from this stable might move to another
stable... this jockey I used to train with my champion is now training the noob stable, or this loser
jockey from my stable is now a championship jockey... with 100+ players... how would their stats work,
should they have their own place on the website... I need them to retire too so there's no inflation of
jockeys... can they hire 3 max per stable?"

Jockeys are computer-controlled characters (like Club horses), never players. They have careers that
outlive any one stable; stables sign, develop and try to keep them. Credits only: jockeys are never
bought, sold, paid or rewarded in USDG or packs, and nothing about them is tradeable on chain.

## The jockey

- **Identity:** generated name, a portrait (the existing jockey/rider art recoloured; silks of the
  current stable or Club grey), home stable history.
- **Four skills**, each 0-1000 realised with a hidden potential ceiling, shown as A-E grades like horse
  stats; a young jockey shows a potential range ("C to A") that narrows with rides:
  - **Gate** (breaking from the stalls: slow-start chance, early position),
  - **Pace judgement** (energy efficiency in the run, tactic fit),
  - **Finishing drive** (kick and late-battle response),
  - **Horse handling** (day-form consistency, settling keen/nervy horses).
- **Personality** (shown on the page; weights the contract choice in Phase 2): money-minded, ambitious,
  loyal, workhorse.
- **Experience** from rides (bigger/more competitive races teach more); skills move towards potential,
  fast early and slower near the ceiling. Short form streak from recent results (small).
- **Specialities** appear from results (course or going), a small bonus there.
- **Apprentice weight allowance:** 7 / 5 / 3 lb claimed until 10 / 25 / 50 winners (handicap weights
  apply 1 lb = 1 OR, engine 1.4.0).
- **Career curve:** apprentice ~1 season (4 weeks), prime ~3 seasons, veteran 1-2 seasons with slow
  decline (pace judgement holds). Total ~5-6 seasons (20-24 weeks); one setting (`JOCKEY_CAREER_WEEKS`)
  can shorten it to ~3 seasons. Retirement announced 2 weeks ahead, a farewell ride, then the jockeys'
  Hall of Fame.

## Supply (no inflation)

- Pool target ~1.5 jockeys per active stable (active = raced or logged in within 14 days). Weekly intake
  of apprentices in proportion to active stables minus the pool's surplus; retirements go out. Same ratio
  at 50 or 5,000 players.
- **Max 3 jockeys per stable** (`JOCKEYS_PER_STABLE_MAX`). Every stable starts with 1 apprentice.
- **Idle stables:** a stable inactive for 21 days releases its jockeys to the free pool (keeps 0).
- Unsigned jockeys are **Club freelancers**: any stable can book one for a single ride for a fee scaled
  by the jockey's grade and the purse (today's journeyman/top hire prices become the freelance prices).

## Effects in races (small, sealed, fair)

- Skills map onto the engine's sealed race-day kit (today's jockey tiers already narrow day form and
  settle keen horses). Best vs worst jockey is worth about 2-3 OR in total; a jockey never turns a
  bad horse into a good one.
- The jockey and their skills are frozen into the locked field with the runner, so old races replay and
  verify exactly; nothing depends on who owns the jockey.

## Phase 1: roster and riding

- Tables for jockeys, their skills/potential, rides and career events; migration + backfill (an
  apprentice for every existing stable; a starting Club freelance pool).
- Booking: the entry sheet picks your jockey (one of yours, or a Club freelancer for a fee). A jockey
  rides at most one horse per race and only where the post times don't clash.
- Engine: per-runner kit from the jockey's skills (new optional kit fields, golden fixtures keep older
  races byte-identical). Apprentice allowance off the handicap weight.
- Growth after each settled race; weekly ageing, intake and retirements in `runMaintenance`.
- Pages: Racing → Jockeys (all jockeys, prospects, leaderboard by winners this season), a page per jockey
  (portrait, skills/grades and potential range, record, career path across stables, personality), Stable →
  Your jockeys, the racecard shows each runner's jockey (with apprentice claim, e.g. "T. Ashby (5)").
- Wiki page "Jockeys", numbers read from game-core; KNOBS rows; harness agents book jockeys; harness
  metrics: pool per active stable, rides per jockey, skill distribution, retirements/intake.

## Phase 2: contracts and the weekly window

- Contracts: 4 weeks / 8 weeks / a season, weekly wage (a credits sink), promised rides a week, buyout
  price. Notes 2 weeks before a contract ends.
- Weekly window, Sunday 20:00 UTC: free agents (contract ended, released, idle stables, new apprentices)
  receive offers from any stable (max 3 open offers per stable; the signing fee is escrowed, refunded if
  lost). At the deadline, jockey-proposing deferred acceptance: each jockey ranks offers by its visible
  personality utility (wage, quality of the stable's horses = mean rating of its top 5, rides promised,
  prestige = league tier/trophies/recent winners, loyalty = time and big wins together, contract length);
  stables hold at most their free places; exact ties by a seeded draw. Results are published, verifiable.
- Morale: promised vs actual rides; two weeks of broken promises lets the jockey leave at the next
  deadline without a buyout. Page shows "Wants: more rides · better horses · wage 300+".
- Development bonus: a stable that developed a jockey (apprentice → 25 rides there) gets a small credit
  bonus when that jockey wins a feature for someone else, plus "developed at" credit.
- Linked accounts can't sign each other's jockeys (same refusal as the market).

## Phase 3: buyouts, loans, championship, news, Hall of Fame

- Buyout (rival pays the buyout price, the jockey must prefer the move), loans (a week of rides).
- Jockeys' championship per season (winners, then places), Champion Jockey crowned at the Season Final.
- News feed items ("Ex-Gilded Hollow apprentice Tom Ashby wins the Weekend Feature for Thistle Mead").
- Jockeys' Hall of Fame; later, retired jockeys as coaches.

Each phase runs a season harness before it ships.
