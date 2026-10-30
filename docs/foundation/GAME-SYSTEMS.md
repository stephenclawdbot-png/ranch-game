# Post Time: how the game works (systems map)

The operating picture of the game: the loops players live in, how horses and credits flow,
how competition funnels, and where each piece lives in code. Read this before changing a
rule. The companion documents:

- [`KNOBS.md`](KNOBS.md): every tunable value, where it lives and what it moves.
- [`tools/season-harness`](../../tools/season-harness): runs the real game code with simulated
  stables for a season and charts the outcomes. **Every rule change is run through it before
  it ships** (see "How we change the game" at the end).

Diagrams are Mermaid (GitHub renders them).

---

## 1. The four loops

A player lives in four nested loops. Each inner loop feeds a number the next loop is waiting
for. When a loop does not feed the next one, it feels pointless ("a race every few minutes,
but what's the point?").

```mermaid
flowchart LR
  subgraph D["Daily (15-30 min)"]
    care[Care: bond, growth, healing]
    train[Training: gain vs injury risk]
    week["This week page: Road to Saturday, one next step"]
    enter["Spend entries on races that fit: one Live race per horse a day"]
    cup["Daily Cup run (points settled after the day)"]
  end
  subgraph W["Weekly"]
    lp["League points: best 20 runs, capped"]
    q[Feature Qualifiers Mon-Fri]
    wf[Weekend Feature Sat]
    plate["Saturday Plate, 30 min later: qualifier runners who missed"]
    recap[Sunday recap in the inbox]
  end
  subgraph S["Season (4 weeks)"]
    promo["Promotion; relegation from Gold up (Bronze and Silver are floors)"]
    final[Season Finals per division]
  end
  subgraph L["Long term (months)"]
    breed[Breeding: better foals]
    legacy[Hall of Fame, Trophy Room, bloodlines]
  end
  care --> enter
  train --> enter
  week --> enter
  enter --> lp
  enter --> q
  q -->|top 3| wf
  q -->|missed| plate
  lp --> recap
  recap --> promo
  wf --> final
  final --> legacy
  promo --> legacy
  enter -->|starts, rating| breed
  breed -->|next season's horse| enter
```

**Scarcity makes the choices.** 10 entries a day, one Live race per horse per day (three
races counting Story), a 40-start career and 4 lifetime breedings turn every action into a
trade-off (KNOBS §2, §3). One Live start a day makes a career last at least 40 days and
makes a bigger string of horses worth having.

---

## 2. A horse's life

```mermaid
stateDiagram-v2
  [*] --> Foal: born (covering + 24 h) or pulled from a pack / starter
  Foal --> Weanling: care sessions
  Weanling --> Yearling: care sessions
  Yearling --> Juvenile: racing age (all care sessions done)
  Juvenile --> Prime: starts
  Prime --> Veteran: starts
  Juvenile --> AtStud: Send to stud / Make a broodmare / career-ending injury
  Prime --> AtStud
  Veteran --> AtStud: or the 40th start
  AtStud --> LegacyFarm: last breeding used (automatic) or Retire for good
  Juvenile --> LegacyFarm: Retire for good
  Prime --> LegacyFarm
  Veteran --> LegacyFarm
  Juvenile --> InMemoriam: fatal race injury (Live races only)
  Prime --> InMemoriam
  Veteran --> InMemoriam
  InMemoriam --> LegacyFarm
  LegacyFarm --> [*]: never deleted; no stall, no racing, no breeding
```

- Racing horses with enough starts can breed while still racing.
- A parent retired by injury can pass on **fragile legs** (dominant gene).
- Geldings "End racing" and never breed.

---

## 3. Horse population: what comes in, what goes out

A breeding game inflates unless horses leave as fast as they arrive. Axie and Zed Run had no
exit; Post Time has several. The target is roughly one horse leaving active play for every
horse born.

```mermaid
flowchart LR
  starters[Starter horses] --> active((Active horses))
  packs[Pack foals] --> active
  foals[Bred foals] --> active
  club[Club runners, house studs] -.fill fields.-> active
  active -->|40 starts / choice| stud[At stud / broodmare]
  stud -->|breedings| foals
  stud -->|last breeding| legacy[Legacy Farm]
  active -->|Retire for good| legacy
  active -->|fatal injury| legacy
  active -->|release| clubpool[Club]
```

Levers: breedings per lifetime and per season, career length, fatal share, regression of
foals toward the family (family limits, ~half of good x good foals land below both parents),
pack supply (crop cap, weekly limits). Harness metrics: `horses.born`, `horses.retired`,
`horses.legacy`, `horses.died`, population by stage.

---

## 4. Credits: faucets and sinks

Stable Credits are never cashed out. They are created by play and destroyed by spending; the
ledger records every movement by kind, so the harness can total them.

```mermaid
flowchart LR
  subgraph Faucets
    purses[Race purses]
    story[Story rewards]
    goals[Daily goals]
    cupc[Daily Cup credits]
    ins[Insurance payouts]
    release[Release to Club]
    start[Starting grant]
  end
  subgraph Sinks
    fees[Breeding base fee]
    studburn[Stud fee cut]
    entryfee[Entry fees, top classes]
    trainc[Training]
    vet[Vet]
    scan[Pedigree scan]
    packsc[Paddock packs]
    fac[Stalls and facilities]
    refill[Entry refills]
    prem[Insurance premiums]
    mfee[Market fee]
    extras["Race-day extras, jockey fees (refunded on a scratch)"]
  end
  Faucets --> wallet((Stable balances))
  wallet --> Sinks
  wallet <-->|"player to player, never between linked accounts"| market["Horse market; stud fees (capped at the stallion's appraisal)"]
  purses -->|"a leased runner's purse, split 30-80% owner / rest lessee (lease_share)"| lease["Horse leasing"]
  lease --> wallet
```

Leasing (2026-10-30, KNOBS 11a) creates no credits and, in the beta, moves none between players
directly: there is no upfront fee (`LEASE_FEE_MAX` = 0), so the only flow is a leased runner's
own purse, minted once and split between owner and lessee in one `lease_share` transaction at
settlement (the runner's share of the race's `purse` transaction moves there). Upkeep for a
leased horse is paid by the lessee (the stable that used it). Linked accounts can't lease to each
other; lessees need a 7-day-old account with 10 Live starts; reciprocal leases are flagged.

Purses were halved and a 5% entry fee added on 2026-10-29 (live purses were about 3x the
model's; now about 1.7x for ordinary races, KNOBS "Live vs model mismatches" 1), and the
owner-picked sinks followed (upkeep, race-day extras, jockeys, sponsorship). Latest harness
(sinks2): 81 credits spent per 100 earned, purses 58% of credits earned in play; see
`HARNESS-LOG.md`.

---

## 5. Competition funnel

```mermaid
flowchart TD
  card["Live card: a race every 15 min, published 6 h ahead"] --> runs["Your starts: one Live race per horse a day"]
  week["This week (/week): Saturday's conditions from Monday, your Qualifier places, the League gap"] -.->|plans| runs
  runs --> league["League points: best 20 runs a week, capped at 240"]
  runs --> rating[Official rating 0-140]
  card --> quals["Feature Qualifiers, Mon-Fri 19:00 UTC (Listed purse x2, open to every rating)"]
  quals -->|top 3| wf["Weekend Feature, Sat 19:00 UTC (Group 1; qualified horses only, no rating floor)"]
  rating -->|100+| wf
  quals -->|ran but missed| plate["Saturday Plate, Sat 19:30 UTC (Listed, no band)"]
  league --> tiers["Tier: Bronze to Champion; top 5 up; bottom 5 down from Gold up"]
  tiers --> recap["Sunday recap: finish, move, gap to promotion"]
  wf --> final["Season Final, last day, one per division (OR 95+)"]
  rating --> final
  final --> hall[Hall of Fame, Trophy Room]
  cupd["Daily Cup: one run a day, same race for all"] --> plaques[Plaques]
  cupd --> cpts["Cup points, settled after each day"]
  story["Story chapters"] --> licence[Licences]
  licence -->|"Club, County: maidens to handicaps"| card
  licence -->|"National: Listed, Group 3, the Features, Weekend Feature, Plate"| wf
  licence -->|"Classics: the Season Final only"| final
```

Licences moved on 2026-10-29: the Weekend Feature and the card's Features need the National
licence (they needed Classics, and no harness stable reached a Weekend Feature then). Since
fixes4 the funnel fills: about 180 Qualifier runs and 20-28 Weekend Feature runners a season in
the harness (`HARNESS-LOG.md`). The Weekend Feature's gate is qualifying (top 3 in a Qualifier,
or OR 100+), not a rating floor; only the Season Final keeps OR 95+.

---

## 6. Code map: where each system lives

```mermaid
flowchart LR
  ui["apps/web app + components"] --> api["apps/web/app/api/* routes"]
  api --> server["apps/web/src/server (game.ts, economy.ts, horseLife.ts, competition.ts, week.ts, horseView.ts)"]
  server --> db["packages/db services (races, card, breeding, market, leagues, ledger, horses)"]
  server --> engine["packages/racing-engine (simulateRace, verifyReplay)"]
  db --> core["packages/game-core (rules: lifecycle, condition, training, genetics, breeding, economy, seasons, leagues)"]
  server --> core
  engine --> shared["packages/shared (Horse, schemas)"]
  db --> pg[("Postgres / PGlite")]
  server --> chain["apps/web/src/server/chain + packages/contracts (optional web3)"]
  wiki["apps/web/src/wiki (reads game-core live)"] --> core
  harness["tools/season-harness"] --> server
```

Rules of the road: game-core holds the rules and is pure; db owns state, locking and the
ledger; the server layer composes them for the app. The wiki reads rule numbers from
game-core, so it never goes stale.

---

## 7. How we change the game (Graphs → Harness)

```mermaid
flowchart LR
  idea[Proposed change] --> knob["Find the knob (KNOBS.md)"]
  knob --> graph["Which loop / flow does it move? (this doc)"]
  graph --> base["Harness baseline run"]
  base --> change["Make the change on a branch"]
  change --> run["Harness run, same seed"]
  run --> compare["Compare report: deltas per metric"]
  compare -->|acceptable| ship["Tests, wiki check, commit"]
  compare -->|not| knob
```

1. Name the knob and the loop it serves.
2. Write down the expected effect on two or three harness metrics before running anything.
3. Run the harness baseline and the change with the same seed and cohorts, then compare.
4. Ship only if the deltas match the intent and nothing else moved unexpectedly (credits
   created vs destroyed, horses in vs out, field sizes, qualifiers per week).

### The health dashboard (what "healthy" means for the beta)

| Signal | Healthy range (beta, ~50 stables) | Harness metric |
|---|---|---|
| Credits destroyed / created | 0.85 to 1.15 over a season | `credits.created`, `credits.destroyed` |
| Horses leaving / horses born | about 1 | `horses.*` |
| Real-player runners per Live race | rising; fields not mostly Club runners | `races.fieldSize`, `races.playerShare` |
| Stables that try a Feature Qualifier each week | most grinders, some casuals | `competition.qualifierEntrants` |
| Weekend Feature qualifiers per week | a handful, not zero, not everyone | `competition.featureQualified` |
| Foals below / between / above parents | about 50 / few / 45 (the gamble) | `breeding.foalVsParents` |
| Injuries, fatal | rare and visible | `injuries.bySeverity` |
| Farmer cohort advantage | none measurable | per-cohort balances, linked transfers |
