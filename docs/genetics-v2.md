# Genetics v2: 12 breeds, more genes you can see, size that matters

Owner request (2026-10-29): more than 4 breeds, as in other horse-racing games; size matters;
foals inherit their breed %; add dominant and recessive genes.

## What already exists (v1)

- **Breed %:** 4 breeds in permille. A foal is the exact average of its parents (`blendBreeds`).
- **Colour:** 8 genes with real inheritance:
  - Extension: E dominant over e. Chestnut (e/e) is recessive, so two bays can throw a chestnut.
  - Agouti: A over At over a.
  - Cream: incomplete dominant (1 copy palomino or buckskin, 2 copies cremello).
  - Grey, roan and dun: dominant.
  - Liver: recessive.
  - Sabino-1: incomplete dominant.
- **Inherited from both parents:** stat potentials (with partial dominance), vigour, distance,
  surface, running style, maturity, white tendency, 5 body-shape genes and 4 part-type genes.
- **Hidden quirks:** mudlark and late kick are recessive; gate-shy and crowd-shy are dominant.
- **Horse page:** a genetics summary lists every gene and whether the horse carries it.

Most of this is invisible today. Renderers draw neither breed nor body shape (see the breed-looks ticket).

## v2 at a glance

1. **12 breeds:** the 4 we have plus 8 new ones (table below). No breed is better overall: each
   breed's stat means sum to 2,550–2,630, the same band as today.
2. **14 new genes** (table below): 6 colour/pattern genes, 4 body genes, 2 performance genes,
   and 2 face/ear genes. They include dominant, recessive and incomplete-dominant ones, so
   hidden carriers and surprise foals happen.
3. **Size matters, zero-sum.** A taller horse gains top speed and stamina and loses burst and
   soundness; a smaller horse the reverse. The stat total is unchanged.
4. **Named crosses and purebreds:** "Purebred Arabian" when one breed has 7/8 or more;
   "Anglo-Arab", "Appendix Quarter Horse" and "Hispano-Arabe" for classic crosses; otherwise
   "Crossbred (TB × QH)", the top two breeds.

## Breeds

Stats are mean alleles: spd / sta / bur / dur / ada / tem. Distance is permille for
sprint / mile / middle / staying. Turf is permille. Size is the height offset; "Ht freq" is
the frequency of the tall allele (below).

| Breed | Stats | Distance | Turf | Style f/s/c | Maturity e/n/l | Size | Notes |
|---|---|---|---|---|---|---|---|
| Thoroughbred | 470/430/440/400/400/410 | 150/400/350/100 | 700 | 300/400/300 | 300/450/250 | +3 % | existing |
| Arabian | 400/500/380/470/430/400 | 0/150/350/500 | 450 | 200/350/450 | 150/400/450 | −5 % | existing; dished face |
| Quarter Horse | 480/330/500/440/400/470 | 800/200/0/0 | 200 | 550/350/100 | 550/350/100 | −2 % | existing |
| Akhal-Teke | 440/480/400/430/470/360 | 0/200/400/400 | 450 | 350/400/250 | 200/450/350 | +2 % | existing; metallic sheen |
| Standardbred | 430/470/380/470/400/450 | 50/450/400/100 | 250 | 400/450/150 | 250/500/250 | 0 % | steady, sound, calm |
| Appaloosa | 430/420/430/450/460/410 | 250/450/250/50 | 450 | 350/400/250 | 300/450/250 | −1 % | leopard spots |
| Paint Horse | 470/340/490/440/410/450 | 700/250/50/0 | 250 | 500/350/150 | 500/400/100 | −2 % | tobiano patches |
| Mustang | 410/480/400/500/480/330 | 100/300/350/250 | 400 | 250/400/350 | 200/450/350 | −6 % | small, tough, dun/silver |
| Andalusian | 400/420/470/430/420/460 | 150/450/350/50 | 750 | 250/400/350 | 200/450/350 | 0 % | baroque, grey, pearl |
| Friesian | 360/470/400/470/430/470 | 0/200/450/350 | 650 | 200/450/350 | 100/400/500 | +5 % | black, feathered legs |
| Warmblood | 420/470/420/450/440/400 | 50/300/450/200 | 800 | 250/400/350 | 150/450/400 | +6 % | big, scopey, turf |
| Marwari | 420/480/410/470/450/370 | 50/250/400/300 | 300 | 300/350/350 | 200/450/350 | 0 % | curled ears |

**Colour allele frequencies for the new breeds** (permille of the non-wild allele:
E, A, At, Cr, G, Rn, D, l, Sb1; then the white tendency):

| Breed | E | A | At | Cr | G | Rn | D | l | Sb1 | white |
|---|---|---|---|---|---|---|---|---|---|---|
| Standardbred | 650 | 600 | 250 | 0 | 10 | 0 | 0 | 100 | 5 | 15 |
| Appaloosa | 550 | 500 | 100 | 50 | 30 | 60 | 40 | 200 | 20 | 25 |
| Paint Horse | 500 | 500 | 100 | 100 | 20 | 50 | 50 | 300 | 60 | 45 |
| Mustang | 550 | 550 | 100 | 60 | 40 | 80 | 250 | 200 | 20 | 20 |
| Andalusian | 600 | 450 | 100 | 30 | 450 | 0 | 0 | 200 | 10 | 15 |
| Friesian | 950 | 30 | 0 | 0 | 0 | 0 | 0 | 100 | 0 | 3 |
| Warmblood | 600 | 600 | 200 | 10 | 80 | 5 | 0 | 200 | 40 | 35 |
| Marwari | 550 | 550 | 100 | 20 | 150 | 20 | 10 | 200 | 80 | 40 |

Friesians are black, but about 1 in 10 carries hidden red (e). Two carriers have a 1 in 4
chance of a chestnut foal: the classic recessive surprise.

## New genes (all diploid: one allele from each parent)

| Gene | Alleles | Inheritance | Effect | Common in |
|---|---|---|---|---|
| Champagne | Ch / n | dominant | lightens the body to gold, amber or sable; pink freckled skin; amber eyes | QH, Paint, Mustang |
| Silver | Z / n | dominant, **only shows on black pigment** | black becomes chocolate with a flaxen mane; bay gets a silver mane; a chestnut carries it **invisibly** | Mustang |
| Pearl | prl / n | **recessive** | prl/prl: pale apricot. One prl plus one Cr: pale with green or blue eyes. One prl alone: hidden | Andalusian |
| Tobiano | TO / n | dominant | white patches crossing the back, white legs, dark head; TO/TO adds small "ink spots" | Paint, Mustang |
| Leopard complex | LP / n | incomplete dominant | LP/n: spotted (with PATN1) or varnish roan; LP/LP: few-spot (nearly white) | Appaloosa |
| Pattern-1 | PATN1 / n | dominant, **only shows with LP** | full leopard or blanket; without LP it's hidden | Appaloosa |
| Splash white | SW / n | incomplete dominant | big blaze, white legs, blue eyes; SW/SW: bald face, white belly | Paint, QH |
| Height (LCORL) | Ht / n | incomplete dominant | +3 % height per copy, on top of the breed size and the polygenic height | Warmblood, Friesian, TB |
| Feathering | fe / Fe | **recessive** (fe/fe shows) | long hair on the lower legs | Friesian (all fe/fe) |
| Speed gene (MSTN) | C / T | incomplete dominant | C/C sprinter (−200 m best trip, +burst); C/T miler; T/T stayer (+200 m, +stamina) | QH, Paint: C; Arabian: T |
| Big heart | bh / n | **recessive**, rare | bh/bh: +25 stamina potential (hidden until the foal races or is checked) | TB, Akhal-Teke |
| Iron legs | IL / n | dominant | −20 % injury risk | Mustang, Standardbred |
| Curled ears | Ce / n | dominant | inward-curling ear tips | Marwari |
| Dished face | Dh / n | incomplete dominant | Dh/n: slight dish; Dh/Dh: classic Arabian dish | Arabian |

New-allele frequencies per breed (permille; any breed not listed is 0):

- **Ch:** QH 20, Paint 20, Mustang 10.
- **Z:** QH 5, Mustang 60.
- **prl:** Andalusian 120.
- **TO:** QH 10, Paint 550, Mustang 80.
- **LP:** Appaloosa 600, Mustang 30.
- **PATN1:** Appaloosa 400.
- **SW:** QH 30, Paint 80.
- **Ht:** TB 600, Arabian 150, QH 300, Akhal-Teke 500, Standardbred 450, Appaloosa 350,
  Paint 300, Mustang 100, Andalusian 350, Friesian 750, Warmblood 850, Marwari 400.
- **fe:** Friesian 1000, Warmblood 50.
- **MSTN C:** TB 450, Arabian 150, QH 800, Akhal-Teke 250, Standardbred 300, Appaloosa 450,
  Paint 750, Mustang 300, Andalusian 350, Friesian 150, Warmblood 250, Marwari 250.
- **bh:** TB 60, Akhal-Teke 80, Arabian 40.
- **IL:** TB 50, Arabian 150, QH 100, Akhal-Teke 120, Standardbred 200, Appaloosa 150,
  Paint 100, Mustang 300, Andalusian 100, Friesian 100, Warmblood 150, Marwari 200.
- **Ce:** Marwari 950.
- **Dh:** Arabian 850, Marwari 200.

## Size: what it does in a race (zero-sum, game-core phenotype only)

`size` = breed size offset + polygenic height + 3 % per Ht copy, clamped to 0.88–1.12
(1.00 is an average Thoroughbred).

Each 1 % above 1.00 gives:
- speed +2 and stamina +1;
- burst −2 and durability −1.

Below 1.00 it works in reverse. The total stays the same: size changes the horse's shape,
never its strength. This goes in `phenotype.ts`, not the race engine, so engine determinism
and replays are untouched. MSTN only shifts the best trip and splits burst against stamina
±15, again zero-sum. Big heart is the one gene that raises potential, and it is rare and
recessive.

Balance check (required before merge): `tools/balance` archetypes and engine reports. Rerun
the lead's edge table (one grade better wins about 45 %, two grades about 80 %); it must hold
within ±5 points, and no breed's mean win rate in a mixed field may be outside 1/n ± 3 points.

## Old horses stay exactly the same (fairness)

- `GENOME_VERSION` becomes 2. Version 1 genomes are upgraded when read
  (`upgradeGenome`, one place):
  - new breed shares are 0;
  - every new gene is wild type (n/n, Fe/Fe);
  - MSTN is C/T, which is neutral.

  So no existing horse changes colour, size or race strength.
- Breeding commitments already made (covered, not foaled) must give the same foal for every
  v1 gene. Draw the v1 genes exactly as today, and draw the new genes from a separate stream
  (`Rng(seed + "|g2")`).
- Breed % stays the exact average of the parents. A v1 parent contributes 0 to the new breeds.

## Breeding preview and horse page

- Breeding preview: odds for every new visible trait ("25 % chance of chestnut", "50 %
  tobiano"), the foal's exact breed %, the named-cross label, and a "Hidden genes" line when a
  recessive could surface ("both carry pearl: 25 % pearl foal").
- Genetics summary (`geneticsSummary.ts`): a line for each new gene, using the same carried
  flags.


## Breed strengths, pure lines and crossbreeding (owner, 2026-10-29)

> "Make sure each breed has its own strengths and weaknesses. Cross breeding is not that
> advisable but may result in something great; pure lines also have benefits. Make it fun and
> rewarding."

### 1. Each breed has a signature strength and weakness

These work like quirks. A strength or weakness is a stat change that applies only when the race
conditions match, added in `raceSnapshot`. The engine and the shared contract are unchanged.

**Strength scales with breed share:**
- 0 below 25 %;
- linear from 25 % (a quarter of full strength) up to 87.5 %;
- full strength at 87.5 % or more ("Purebred").

**The weakness always scales linearly with share.** So a cross keeps more of each
parent's strength than of its weakness: that's the reward for crossing.

| Breed | Strength (when it applies: stat change) | Weakness (when it applies: stat change) |
|---|---|---|
| Thoroughbred | **Class**: turf or good going: speed +25 | **Fragile**: injury risk ×1.15 |
| Arabian | **Endurance**: 2,000 m or more: stamina +35 | **Slow away**: 1,200 m or less: speed −20 |
| Quarter Horse | **Rocket start**: 1,200 m or less: burst +30, temperament +40 (gates) | **Fades**: over 1,600 m: stamina −30 |
| Akhal-Teke | **Desert heart**: firm going or clear/hot weather: stamina +25; recovers fatigue 15 % faster | **Hot-blooded**: field of 10 or more: temperament −60 |
| Standardbred | **Rhythm**: always: temperament +40; recovers between races 20 % faster | **No kick**: always: burst −20 |
| Appaloosa | **Sure-footed**: soft or heavy going: adaptability +100, speed +15 | **Plain on fast ground**: firm going: speed −15 |
| Paint Horse | **Turn of foot**: 1,000–1,600 m: burst +30 | **Short-winded**: over 1,800 m: stamina −25 |
| Mustang | **Iron constitution**: injury risk ×0.75; career +4 starts | **Rough**: graded or listed races: speed −15 |
| Andalusian | **Brave**: big crowd or 12 runners: temperament +60, burst +15 | **Short of stamina**: 2,000 m or more: stamina −25 |
| Friesian | **Power**: soft or heavy going: speed +25; always calm (temperament +30) | **Heavy**: firm or good going: speed −25 |
| Warmblood | **Scope**: turf, 1,600–2,400 m: speed +20, stamina +15 | **Late developer**: until 8 career starts: speed −25 |
| Marwari | **Alert**: rain or wind: adaptability +80; never gate-shy (cancels the gate-shy quirk) | **Light frame**: always: burst −15 |

Sizes are deliberate: a full strength is worth about a quarter of a grade (25 points, roughly
15–18 % wins against an even 8-runner field, up from 12 %). That's enough to choose races by
breed, never enough to make a breed win everything. The balance check below must confirm it.

### 2. Pure lines

Purebred means one breed is 87.5 % or more (the breed registries' 7/8 rule).

- **Full signature strength** (above).
- **Predictable foals ("true breeding").** When both parents are purebred of the same breed,
  the foal's stat inheritance spread is ×0.75: foals land close to the parents' average. What
  you plan is what you get.
- **Breed races.** One Live slot an hour is a breed race ("Arabian Stakes", "Quarter Horse
  Dash"), open to purebreds of that breed only. Same purse table as the class, fewer
  rivals, a breed badge in the Hall.
- **The cost:** a closed gene pool. Pure-to-pure breeding raises inbreeding (COI) faster, and
  the existing inbreeding depression applies. The breeding preview warns as today. Pure lines
  need careful pairing, never infinite.
- Market: the appraisal adds +10 % for purebreds (cosmetic prestige, it doesn't affect races).

### 3. Crossbreeding: a gamble that can pay

- **First-cross vigour.** A foal of two purebreds of *different* breeds gets
  vigour +20 (hybrid vigour: +20 to every stat potential) and COI 0. Both parents'
  strengths apply at 50 % share each, weaknesses at half. This is the "may result in something
  great" generation.
- **Later crosses scatter.** A foal with no purebred parent (cross × cross) has a stat
  inheritance spread of ×1.35: more poor foals and more stars. The average is unchanged, so it
  isn't worse on average, just riskier. "Not that advisable" without making it a trap.
- **Mixed bags lose identity.** A breed under 25 % contributes no strength, but its
  weakness still scales with its share. A horse that is a little of everything has small
  weaknesses and no strengths. The preview says so.
- **Named crosses: discoveries.** Some pairs make more than the sum of their parts. While
  both breeds are 25 % or more and together 87.5 % or more, the cross gets a **combined
  signature** at full strength, and the pair's weaknesses are halved again:

| Cross | Breeds | Combined signature |
|---|---|---|
| Anglo-Arab | TB + Arabian | Class + Endurance: a turf stayer |
| Appendix QH | QH + TB | Rocket start + Class: a sprinter that handles turf |
| Hispano-Arabe | Andalusian + Arabian | Brave + Endurance |
| Sport Horse | Warmblood + TB | Scope + Class; the warmblood's late-developer weakness is gone |
| Desert Stayer | Akhal-Teke + Arabian | Desert heart + Endurance; hot-blooded halved |
| Ranch Sprinter | Paint + QH | Turn of foot + Rocket start |
| Mountain Horse | Mustang + Appaloosa | Iron constitution + Sure-footed |

  The first stable to foal each named cross gets a Hall of Fame entry ("First Anglo-Arab:
  bred by Blackthorn Yard"). The breeding preview shows the label once a cross is
  discovered, and "???: an unknown cross" before that, so finding them is part of the game.

### 4. Balance check (required before merge)

The `tools/balance` breeds report must show:
- every purebred's win rate in mixed 8-runner Live fields between 1/n − 3 and 1/n + 3 points
  overall;
- each breed at least +4 points above its average in its strength conditions;
- first crosses about +2 points above the parents' average;
- cross × cross foals: the same mean as their parents, with a wider spread (the standard
  deviation of potential ×1.3 or more);
- the lead's edge table still holding (one grade better ≈ 45 % wins).

### Existing horses

The genes of existing horses stay exactly the same. Their breed shares (mostly 70–100 % one of
the original four breeds) **will** start expressing strengths and weaknesses. That is a rules
change by design. Switch it on at a weekly reset so the Prize Pool week isn't split, and put
one line in the patch notes.

## Portrait coverage: every breed and gene on the 3/4 portrait (owner, 2026-10-29)

The 3/4 portrait (`HorsePortrait`) is one painting per head family, split into parts (coat
shading, mane, muzzle, eye, bridle) and recoloured from the genes, with layers on top. Every
breed and gene below must be drawn on it. `/dev/coats` has one cell per row, and each visual
ticket's acceptance includes its rows.

| Breed or gene | Portrait treatment | Files | Ticket |
|---|---|---|---|
| Base colours, cream, dun, roan, grey stages (coat v2) | Coat and mane colours from `coatPaletteOf`; roan ticks on the neck and cheek; dapple rings; grullo dark head; double-cream pink muzzle and blue eye | `portraits/roles.png` | portrait34 (running) |
| Face markings (star, snip, stripe, blaze, bald) | White layer following the face's centre line | `portraits/portrait-marks.png` | portrait34 |
| Thoroughbred, Akhal-Teke, Standardbred | **Fine** head (today's painting) | `roles.png` | portrait34 |
| Arabian (and Dh carriers) | **Dished** head; Dh/n blends halfway between fine and dished | `portraits/breed/dished-{grey,bay}.png` → `roles-dished.png` | breed looks |
| Quarter Horse, Paint, Appaloosa, Mustang | **Stock** head: broad jaw, short ears, thick neck | `breed/stock-*.png` → `roles-stock.png` | breed looks |
| Andalusian, Friesian | **Baroque** head: arched heavy neck, thick mane | `breed/baroque-*.png` → `roles-baroque.png` | breed looks |
| Warmblood | **Warmblood** head: big and plain | `breed/warmblood-*.png` → `roles-warmblood.png` | breed looks |
| Marwari | Fine head + **curled ears** layer (Ce) | `portrait-ears-curled.png` | breed looks |
| Crossbreeds | Head family of the largest breed share; gene layers from the horse's own genes | (none new) | breed looks |
| Mane type (variants.mane) | Painted, thin, thick or roached masks per family | generated by the role script | breed looks |
| Akhal-Teke sheen | Gloss on the brightest coat shading plus a crest highlight, scaled by share | (none new) | breed looks |
| Champagne | Champagne palette; pink freckled muzzle; amber eye | colour v3 swatch sheet | colour v3 |
| Silver | Chocolate body and flaxen-silver mane on black pigment only | colour v3 swatch sheet | colour v3 |
| Pearl (prl/prl, prl + Cr) | Pale apricot; green or blue eye for prl + Cr | colour v3 swatch sheet | colour v3 |
| Sabino 1 / 2 | Bigger face mark, white chin; max sabino has a mostly white neck and face with a coloured poll cap and ears | `portrait-sabino.png` | patterns |
| Tobiano | White patch down the neck from the crest; head stays coloured | `portrait-tobiano.png` | patterns |
| Leopard / blanket / few-spot (LP, PATN1) | Spotted neck (leopard), a plain neck (blanket shows on the body), or a nearly white head (few-spot); mottled muzzle skin | `portrait-leopard.png` (spot seeds) | patterns |
| Splash (SW) | Very wide blaze or bald face; blue eye; SW/SW white throat | `portrait-splash.png` | patterns |
| Feathering | Not on the head: race view and dioramas only | (none new) | breed looks |

Rules for every row:
- one painting per family, with no per-coat paintings again;
- layers use `MARKING_WHITE` and the coat shading;
- deterministic per horse (seeded from the horse's appearance);
- legacy appearances (no `colour`) render as today.

## Delivery

1. **G1, GLM:** genes, breeds, inheritance, upgrade, preview, summary, named crosses; no visuals.
2. **G2, GLM:** size, MSTN, big heart and iron legs in phenotype and injury, plus the balance
   reports. The lead reviews the balance numbers.
3. **G3, GLM:** breed signatures, pure-line spread, first-cross vigour, named crosses with
   Hall discoveries, breed races, the breeds balance report. The lead reviews the numbers.
4. **Visual tickets, Kimi:**
   - colour v3 (champagne, silver, pearl swatches by the lead first);
   - every visual ticket covers its rows of the portrait coverage table above;
   - white patterns (tobiano, leopard, splash) together with sabino;
   - breed looks (head families plus feathering, curled ears, dish, size).
