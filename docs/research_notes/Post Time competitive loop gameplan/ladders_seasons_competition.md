# Competitive ladders, seasons and qualification design (input for Post Time)

Research date: 2026-10-29. Each fact has an inline source. Where sources are fan wikis, guides or old pages, the note says so and gives a date. The Post Time takeaways sit under "Inferences" in each section.

## 1. Ranked ladders: TFT, Hearthstone, Chess.com/Lichess, Dota 2 / CS2 Premier, Pokémon Showdown

### Takeaway
The best-regarded ladders combine three things. First, a hidden skill rating (MMR, Elo or Glicko) that drives matchmaking. Second, a visible, forgiving progression layer on top (LP, stars, tiers) with floors, no-loss bands and bonus multipliers that make progress feel steady. Third, a small, scarce "apex" layer (Master+/Legend/leaderboards) where decay, activity rules and absolute rank numbers make staying on top a weekly chore. The visible layer resets every season; the hidden rating is only softened.

### Cited Findings
**Teamfight Tactics (Riot, official FAQ; no date shown, rules said to apply "as of patch 11.22")**
- Tiers are Iron, Bronze, Silver, Gold, Platinum, Emerald, Diamond, Master, Grandmaster and Challenger. — [Riot TFT Ranked FAQ](https://support.riotgames.com/tft/account/teamfight-tactics-ranked-faq)
- A player's first ranked game provisionally places them at Iron II. They then play 5 placement games with accelerated LP (up to 100 LP per win) and **no LP loss**. Returning players start provisionally between Iron II and Bronze IV, depending on last season's rank. — [Riot TFT Ranked FAQ](https://support.riotgames.com/tft/account/teamfight-tactics-ranked-faq)
- There are no promotion series. Reaching 100 LP promotes the player and leftover LP carries over. **Finishing 4th or better never loses LP; finishing 5th or worse never gains LP** (8-player lobbies). — [Riot TFT Ranked FAQ](https://support.riotgames.com/tft/account/teamfight-tactics-ranked-faq)
- Since patch 11.22, players from Iron to Master cannot be demoted out of a *tier*. They can still drop a *division* within a tier. Grandmaster and Challenger can be demoted. There is no demotion shield. — [Riot TFT Ranked FAQ](https://support.riotgames.com/tft/account/teamfight-tactics-ranked-faq)
- Decay applies to Master and above only. A player can bank up to 14 games, and one banked game is used up each day. Each idle day after that costs LP: Master −50, Grandmaster −150, Challenger −250. Decay cannot drop a player out of Master or Diamond. — [Riot TFT Ranked FAQ](https://support.riotgames.com/tft/account/teamfight-tactics-ranked-faq)
- Each season brings a new set and a **soft MMR reset** that pulls MMR toward the median. Seasons are about 4 months long. End-of-season rewards (an exclusive "victorious" Tactician) go to Gold and above, and cheating penalties make a player ineligible. — [Riot TFT Ranked FAQ](https://support.riotgames.com/tft/account/teamfight-tactics-ranked-faq)
- Ranked parties have tier limits (for example, Platinum to Diamond can only invite players one rank above or below). From Master up, players queue solo, or duo within 400 LP; the FAQ contradicts itself on this point. — [Riot TFT Ranked FAQ](https://support.riotgames.com/tft/account/teamfight-tactics-ranked-faq)
- Riot's original 2019 rationale for TFT ranked is in the [Nexus dev post "Ranked Teamfight Tactics"](https://nexus.leagueoflegends.com/en-gb/2019/07/dev-ranked-teamfight-tactics). I found it but did not fetch it, so its specifics are not verified here.

**Hearthstone (system introduced April 2020; sources are fan wikis and press, so treat the exact numbers as approximate)**
- There are five leagues: Bronze, Silver, Gold, Platinum and Diamond. Each has 10 ranks, and **floors at rank 10 and rank 5** of every league. Once a player reaches a floor they cannot drop below it until the monthly reset. Every player resets to Bronze 10 each month. — [hearthstone.wiki.gg Ranked](https://hearthstone.wiki.gg/wiki/Ranked); [PC Gamer, 2020](https://www.pcgamer.com/new-hearthstone-ranking-system)
- **Star Bonus**: a multiplier on stars per win, set by last season's MMR and rank. It runs from at least 2x up to about 10x for Legend and 11x for "High Legend". The bonus shrinks as the player passes floors; sources disagree on the exact decay rule. — [hearthstone.wiki.gg Ranked](https://hearthstone.wiki.gg/wiki/Ranked); [esports.gg guide](https://esports.gg/guides/hearthstone/hearthstone-ranking-system-rewards-bonus-stars)
- Win streaks (3 or more wins) give double stars. — [hearthstone.wiki.gg Ranked](https://hearthstone.wiki.gg/wiki/Ranked)
- MMR does not reset each season; only the visible rank does. — [hearthstone.wiki.gg Ranked](https://hearthstone.wiki.gg/wiki/Ranked)
- Legend is a lock: once a player reaches it, they stay there until the season resets. Legend shows **an absolute number giving the player's position in their region**. — [hearthstone.wiki.gg Legend](https://hearthstone.wiki.gg/wiki/Legend); [hearthstone.wiki.gg Ranked rewards](https://hearthstone.wiki.gg/wiki/Ranked_rewards)
- End-of-season rewards stack across floors. A player needs **5 or more ranked wins** in a season to get the Highest Rank Bonus chest. — [PC Gamer, 2020](https://www.pcgamer.com/new-hearthstone-ranking-system); [hearthstone.wiki.gg Ranked rewards](https://hearthstone.wiki.gg/wiki/Ranked_rewards)
- Blizzard has used the end-of-month top Legend ranks per region as an entry route into Masters Qualifier play; one older report cites the top 200 per region. This is old and unverified for 2026. — [Inven Global](https://www.invenglobal.com/hearthstone/articles/8219/hearthstones-esports-team-is-reducing-the-grind-in-masters-qualifiers)

**Lichess (official FAQ)**
- Lichess uses Glicko-2 (Mark Glickman). New players start at **1500 ± 1000**, and the FAQ describes the 95% interval as 500 to 2500. The deviation shrinks with games and grows again during inactivity, so ratings move faster after a break. — [Lichess FAQ](https://lichess.org/faq)
- A rating is **provisional ("?") while its deviation is above 110**, for example with too few rated games or after about a year away. — [Lichess FAQ](https://lichess.org/faq)
- To appear on the leaderboard a player needs **30 or more rated games** in the category, a rated game **within the last week**, deviation below 75 (below 65 for variants), and a top-10 position. — [Lichess FAQ](https://lichess.org/faq)
- **Cheater refunds**: when a player is marked as a cheater, their 40 most recent rated games from the last 5 days are reviewed. Opponents who lost rating to them get it back, up to 150 points, capped by their later progress. Frequent aborting or leaving leads to hidden "play bans". — [Lichess FAQ](https://lichess.org/faq)
- Glicko-2 tracks a rating, a deviation (RD) and a volatility. The system constant tau should be 0.3 to 1.2. Common defaults are 1500 / RD 350 / volatility 0.06, and the 95% confidence interval is rating ± 2·RD. — [Glickman, Glicko-2 paper (glicko.net)](https://www.glicko.net/glicko/glicko2.pdf) (I did not fetch the paper; the parameters come from [R PlayerRatings docs](https://search.r-project.org/CRAN/refmans/PlayerRatings/html/glicko2.html))

**Pokémon Showdown ladder (official help page)**
- The page shows three numbers: Elo (used to sort the ladder), GXE (estimated chance of beating an average ladder player) and Glicko-1. — [PS "How the ladder works"](https://pokemonshowdown.com/pages/ladderhelp)
- Elo starts at 1000 and is **floored at 1000**. The stated reason: "This makes it unnecessary to create new accounts to 'fix' your rating." At exactly 1000 the K-factor is 80 for a win and 20 for a loss, which spreads out low-ladder players. K is 50 at 1100 to 1299 and 40 at 1300+. — [PS ladder help](https://pokemonshowdown.com/pages/ladderhelp)
- **Daily decay above 1400** works as follows. More than 5 games that day: no decay. 1 to 5 games: −1 per 100 points above 1500. 0 games: −1 per 50 points above 1400. The stated purpose is to fight rating inflation. — [PS ladder help](https://pokemonshowdown.com/pages/ladderhelp)
- Glicko-1 uses R 1500, RD 130 and a 24-hour rating period, with RD kept between 25 and 130. — [PS ladder help](https://pokemonshowdown.com/pages/ladderhelp)
- A 2025 Smogon proposal argues that PS Elo is not purely skill-based and lets smurfs distort matchmaking. It proposes Glicko-1 uncertainty for matching. — [Smogon forum proposal](https://smogon.com/forums/threads/rating-uncertainty-in-ps-ladder-matches-aka-glicko-1-against-the-smurfing-problem.3756168)

**CS2 Premier (secondary guides only; Valve's primary posts were not retrieved)**
- The visible CS Rating is hidden each season and comes back after **10 Premier wins**; losses don't count toward the 10 but still lower the hidden estimate. The July 2026 Season 5 change was described as a soft recalibration. After inactivity, one win shows the rating again. Leaderboards exist by region and worldwide. — [wecoach.gg 2026 guide](https://wecoach.gg/blog/article/cs2-ranks-premier-rating-and-competitive-system-explained-2026); [metabot.gg](https://metabot.gg/en/cs2/guides/cs2-premier-rating-explained). Sources disagree on the end-of-season medal requirement (10 vs 25 wins) and on the inactivity window.

**Rocket League (official posts, 2017 to 2020)**
- Each season applies a soft reset. Players play **10 placement matches** per playlist, and winning about half should land them near their old rank. — [Rocket League news, Season 7 (2018)](https://www.rocketleague.com/news/competitive-season-7-starts-in-february?lang=it)
- Season rewards are based on the highest rank reached. Since 2020 a player must **win 10 matches at a rank** to earn that rank's reward, and losses don't count against this. — [Rocket League, Competitive Season 1 title rewards (Nov 2020)](https://www.rocketleague.com/news/competitive-season-1-title-rewards/); [Season 5 rewards post (2017)](https://www.rocketleague.com/news/competitive-season-6-changes-season-5-rewards/)

### Inferences
- **No-loss bands are a strong retention lever.** TFT's "top half never loses LP" is a direct analogue for Post Time. In a 6 to 10 horse field, a top-half finish could guarantee no League point loss, and a placing in the top 3 could earn points. Losses then only hit bottom-half finishes, which also lets a mid-pack stable keep "grinding up".
- **Floors and locks** (Hearthstone rank 5/10 floors, Legend lock, TFT no tier demotion below GM) stop players from quitting in frustration. Post Time's weekly League tiers could have a floor at each tier's entry point and allow relegation only in the top tiers.
- **Catch-up multipliers** (Hearthstone Star Bonus) let strong players get through a reset quickly so the lower tiers are not flooded with veterans. A Post Time "bonus League points" multiplier at the start of each 4-week season, based on last season's finish, would do the same.
- **Win-count reward gates** (Rocket League: 10 wins at a rank; Hearthstone: 5 wins for the chest; CS2: 10 wins to reveal rating) reward activity, not just a lucky peak. A "must have N starts in tier X" rule for season rewards fits Post Time's 3-minute Live race cadence.
- **Apex activity rules** (TFT decay and banking, Lichess "played within the last week", PS daily decay) stop people from parking at the top. Post Time could apply decay or "banked starts" only to the top League tier or to the Season Final leaderboard.
- **Hidden plus visible split**: keep a hidden per-horse or per-stable skill rating (Glicko-2 suits sparse, irregular play) for matchmaking and seeding. Show a forgiving points layer that resets each season. Do a soft reset (pull toward the median) rather than a full wipe.
- **Rating floors also fight smurfing**: Showdown says outright that its floor removes the reason to make a new account.

### Gaps
- I did not retrieve TFT apex-tier cutoffs (the LP for Grandmaster and Challenger and when the cutoffs update) or TFT 2026 changes. The Riot FAQ is undated.
- I found no official current Hearthstone pages (Blizzard). The floor and bonus figures come from fan wikis, and the top-200/top-1000 Legend reward cutoffs are unverified.
- I did not retrieve the Chess.com rating system details (Glicko variant, rating floors, provisional rules).
- I did not retrieve Dota 2's current ranked structure (medals, seasonal recalibration). CS2 details come from guides, not Valve.
- I found no GDC talk on ranked system design. The Riot dev blogs were found but not fetched.

## 2. Qualifier funnels: Pokémon VGC, Hearthstone Masters, TFT, Gran Turismo / FIA

### Takeaway
Good funnels let many people try, and they combine accumulation (points over weeks or months, with a cap on how many results count) with sudden-death events. They also offer several routes in: win one event, rank on the points list, or show consistency. They pay out in tiers below the top spot, so a near-miss still earns something concrete.

### Cited Findings
**Pokémon VGC 2026 (VictoryRoad.pro, a community site that compiles Play! Pokémon rules)**
- **Championship Points (CP) with Best Finish Limits (BFL)**: only a player's best N results per event type count. Examples:
  - League Challenge: BFL 4, max 60 CP, 15 CP for 1st.
  - League Cup: BFL 4, max 200 CP, 50 for 1st.
  - Online Grand/Global Challenge: BFL 4, max 300 CP, 75 for 1st, with points paid down to 513th–1024th (3 CP).
  - Regionals: 1st gets 350 plus a Worlds invite, down to 20 CP for 513th–1024th. BFL 5 shared with Internationals.
  - Internationals: 1st 500, 2nd 480 and semifinalists 420, each with a Worlds invite.
  — [VictoryRoad 2026 season structure](https://victoryroad.pro/2026-season-structure)
- **Worlds invites by zone ranking**: North America and Europe top 80 Masters plus top 20 Seniors and top 20 Juniors; Latin America top 60/15/15; Oceania 20/10/10; Middle East & South Africa 5/5/5; top 4 per division at each International; each Regional champion. Players who earn invites by winning events **don't take up zone slots**. — [VictoryRoad 2026 season structure](https://victoryroad.pro/2026-season-structure)
- Regionals and Internationals cut to a top 16 and add Swiss rounds as attendance grows. Travel awards go to 1st–4th ($2,000–5,000) and 5th–8th ($1,000). Regional Masters champion prize: $6,000. — [VictoryRoad 2026](https://victoryroad.pro/2026-season-structure)
- The official Worlds page describes invite tiers. Tier 1 is invite plus travel award plus a Round 1 bye; Tier 2 adds a travel stipend; Tier 3 is the invite alone. It also gives CP thresholds (US/Canada Masters 500, Europe Masters 400), but the page has **no season year**, which conflicts with the 2026 ranking-based structure above. — [Pokémon Worlds competitor info (VGC)](https://worlds.pokemon.com/en-us/in-person/tournament-info/vgc)
- From the 2026 Worlds onward, VGC uses the game *Pokémon Champions*. Worlds 2026 ran August 28–30 in San Francisco. — [Pokémon Worlds VGC page](https://worlds.pokemon.com/en-us/in-person/tournament-info/vgc); [VictoryRoad](https://victoryroad.pro/2026-season-structure)

**Hearthstone Masters Qualifiers (Blizzard blog, about 2019; older format, may be superseded)**
- Each qualifier was changed to award **two** Masters Tour invites instead of one. Blizzard added single-elimination qualifiers next to Swiss because qualifiers were "taking too long", with the aim of cutting idle time and total time commitment. — [Hearthstone blog "How We Are Improving Masters Qualifiers"](https://hearthstone.blizzard.com/en-us/blog/22988583)
- **Consistency invite**: a player who makes the **Top 8 of a Masters Qualifier six times** in one qualifying season earns a Masters Tour invite. The rule was applied retroactively and immediately qualified 24 players for Masters Tour Las Vegas. — [Hearthstone blog](https://hearthstone.blizzard.com/en-us/blog/22988583)
- The threshold was later cut to 5 Top 8s. Single elimination took about 6 hours per event against about 12 for Swiss. Capacity was capped at 512 players in a best-of-3 Conquest format. — [Dot Esports](https://dotesports.com/hearthstone/news/changes-hearthstone-masters-qualifiers-single-elim-tourneys); [Inven Global](https://www.invenglobal.com/hearthstone/articles/8219/hearthstones-esports-team-is-reducing-the-grind-in-masters-qualifiers)

**TFT esports (Liquipedia and the official TFT esports site; varies by set)**
- Tactician's Crown (the world championship) qualification mixes routes. One was **ladder snapshots**: in one EMEA Tactician's Cup, 56 players qualified through ladder snapshots, 41 of them from the EUW ladder. Another is **qualifier points** earned over cups ("Top 13 total Qualifier Points earners"). Regional Finals also send their top 4. — [TFT EMEA Tactician's Cup II viewer's guide](https://teamfighttactics.leagueoflegends.com/en-gb/news/esports/emea-tacticians-cup-ii-cyber-city-viewers-guide/); [Liquipedia Magic n' Mayhem APAC Qualifier Points](https://liquipedia.net/tft/Magic_n%27_Mayhem/APAC/Qualifier_Points); [Liquipedia JOC 2026 Spring Regional Finals](https://liquipedia.net/tft/JOC/2026/Spring/Regional_Finals)
- In 2026, qualifier points come from performance on Tactician's Trials Days 5 & 6. The standings page was not yet filled in when retrieved. — [competetft.com qualifier points](https://competetft.com/en-GB/season/116322900041063058/qualifier-points)

**Gran Turismo / FIA (official)**
- GT Sport's Sport Mode launched with Daily Races and the FIA championships. The **Manufacturer Series** has players represent a brand and the **Nations Cup** has them represent a country, across three regions, with the top players going to a World Final. Matchmaking uses Driver Rating and Sportsmanship Rating, and Balance of Performance equalises cars. — [gran-turismo.com, "How to Enjoy Fair and Fun Online Racing" (Oct 2017)](https://www.gran-turismo.com/us/news/00_1608923.html)
- January 2025 notice: DR changes after **championship races are larger than after Daily Races**, and the DR maximum was raised. — [gran-turismo.com GT7 Sport Mode notice (17 Jan 2025)](https://www.gran-turismo.com/us/gt7/news/00_4914793.html)
- DR and SR set each season's ranking and the league a player sits in for the flagship esports series (GT World Series). Daily Race B was sometimes built around the hot-lap qualifying for the Manufacturers Cup. — [GTPlanet Daily Races, 15 Sep 2025](https://www.gtplanet.net/gran-turismo-7-daily-races-20250915)

### Inferences
- **Best Finish Limits** suit Post Time's weekday qualifier, Saturday Feature, 4-week season and Season Final structure. Count only a stable's best N qualifier results per week (for example, best 3 of 5 weekday qualifiers) and the best K Feature results per season. Grinders get more chances, but nobody can win just by playing the most races, which matters with a race every 3 minutes.
- **Multiple routes into the final**: (a) automatic entry for Feature winners, as Regional champions get Worlds invites; (b) top-N on season points; (c) a consistency route, like Hearthstone's 5–6 Top 8s, for example "placed in the top 3 in N qualifiers". Auto-qualifiers shouldn't take points-list slots, as in VGC.
- **Tiered prizes below the top**: VGC pays CP down to roughly 1,000th place and gives travel awards to 5th–8th. Post Time can show near-misses with small, real rewards (credits, cosmetics, a "Season Finalist (reserve)" badge) and a clear "you finished 9th; 8 qualify" message.
- **Cut sudden-death time**: Hearthstone moved to single elimination because Swiss "took too long". Post Time's Feature and Season Final should be one deterministic broadcast race or a short heat structure, not long brackets.
- **Heavier weighting for big events**: GT7 moves DR more after championship races. Feature and Final results should count for more rating and points than an everyday Live race.

### Gaps
- I found no official 2026 Hearthstone esports rules; Blizzard's current esports structure was not retrieved. The Masters Qualifier facts date from about 2019 to 2020.
- I did not find player counts for "qualified vs tried" in any funnel (for example, VGC entrants per season vs the roughly 80 NA Masters invites). VictoryRoad lists invite counts but not participation.
- The 2026 TFT Tactician's Crown qualification rules are spread across Liquipedia pages and are not fully confirmed.
- I found no source on how games tell players about near-misses in the UI (for example, "X points from qualifying").
- I did not retrieve Rocket League Championship Series open-qualifier structure.

## 3. Season resets and fresh starts: Path of Exile, Diablo, soft resets

### Takeaway
Fresh-start seasons create regular "everyone starts equal" moments that bring lapsed players back in waves. Developers say the main reasons are letting newcomers and returners in without feeling behind, letting new mechanics run in a clean environment, and making all content worth replaying. Ladders mostly use soft resets: the visible rank resets, but the hidden rating is kept or shrunk toward the median.

### Cited Findings
- **Diablo IV**: each season needs a new seasonal character, and old characters move to the Eternal Realm. Rod Fergusson (Blizzard) said the rule lets newcomers "jump into the game without feeling left behind" and lets lapsed players rejoin after a break. Seasons also introduce balance, mechanics and items that might break existing overpowered builds. — [Windows Central](https://windowscentral.com/gaming/does-every-diablo-4-season-require-new-characters-blizzard-says-yes); [NME](https://www.nme.com/news/blizzard-explains-why-new-characters-are-needed-to-play-season-1-of-diablo-4-3468718)
- Blizzard developers described seasons as "opportunities for players to rejoin at a fresh starting point with friends", and said Diablo II ladders and Diablo III seasons worked the same way. Player reaction to requiring new characters was mixed. — [PCGamesN interview](https://www.pcgamesn.com/diablo-4/seasonal-mechanics-blizzard-interview); [PC Gamer](https://pcgamer.com/diablo-4-new-characters-battle-pass)
- Diablo IV developers openly told players to "take a break and go play something else" when they run out of seasonal content, which accepts a cycle of churn and return. — [GamesRadar](https://gamesradar.com/out-of-stuff-to-do-in-diablo-4-take-a-break-and-go-play-something-else-lead-developers-say)
- **Path of Exile**: Chris Wilson said the "idea of restarting every three months... lets you take advantage of the content you have in the game, rather than just the endgame stuff". He has also said retention differs a lot by league; Ultimatum was "in the bottom 40% of leagues". — [MMOBomb interview](https://www.mmobomb.com/interview-scrying-future-path-exiles-prophecy-update); [Chris Wilson on r/pathofexile, July 2021](https://reddit.rtrace.io/r/pathofexile/comments/op73wg/some_thoughts_from_chris)
- PoE league launches set concurrency peaks: Settlers of Kalguur set a Steam record of 228,398 (2024), and Crucible drew about 321k across platforms. Concurrency "slumps" between expansions and comes back in waves. — [Sportskeeda](https://sportskeeda.com/mmo/path-exile-hit-new-all-time-high-steam-player-count-july-26-update); [SteamDB charts](https://steamdb.info/app/238960/charts); [Mein-MMO](https://mein-mmo.de/en/the-great-rival-of-diablo-4-shines-with-update-never-before-has-path-of-exile-had-more-players-on-steam,1156485)
- Wilson said the 13-week content cycle is hard to sustain without crunch. — [MMOBomb on crunch](https://www.mmobomb.com/news/path-exiles-chris-wilson-crunch-will-not-run-company-way)
- **Soft resets in ladders**: TFT pulls MMR toward the median each set ([Riot](https://support.riotgames.com/tft/account/teamfight-tactics-ranked-faq)). Hearthstone resets the visible rank monthly but keeps MMR, and uses a Star Bonus to speed strong players back up ([hearthstone.wiki.gg](https://hearthstone.wiki.gg/wiki/Ranked)). Rocket League places players near their old rank after 10 placement games ([Rocket League](https://www.rocketleague.com/news/competitive-season-7-starts-in-february?lang=it)). CS2 hides the rating until 10 wins ([wecoach.gg](https://wecoach.gg/blog/article/cs2-ranks-premier-rating-and-competitive-system-explained-2026)).

### Inferences
- Post Time's 4-week season is much shorter than PoE/Diablo (about 3 months) or TFT (about 4 months), but similar to Hearthstone's **monthly** ladder reset. The Hearthstone model (monthly visible reset, kept MMR, catch-up multiplier, floors) is the closest match.
- **Don't wipe the horses.** Deep genetics and breeding are the long-term investment, like eternal characters. The reset should apply to *standings* (League points, qualifier points, season tables), not to stock. A stronger "fresh start" option is a **seasonal restricted division**, such as horses foaled this season, a weight or handicap band, or a "maiden" series. That gives an equal-start race without destroying collections, similar to Diablo's Seasonal vs Eternal realms.
- **Seasonal modifiers** give each reset a reason to replay, as PoE leagues and Diablo seasons add a mechanic. Examples: a rotating "featured going/track condition" or a "featured distance" for the season, which shifts which bloodlines are optimal.
- Expect and plan for return waves: put announcements, recaps and a "new season starts Monday" hook at each 4-week boundary.

### Gaps
- I found no hard retention figures (D30 return rates) linked to season resets. The evidence is concurrency peaks and developer quotes.
- I found no GGG or Wilson quote that ties the resets to the *economy* specifically.
- I found no 2026 Diablo IV season design commentary; sources are from 2023–2024.

## 4. Breeding and building depth feeding competition: Pokémon IVs/EVs, Showdown, Smogon tools

### Takeaway
Pokémon shows that a deep, partly hidden stat system can support a large competitive scene once the community can calculate it. Smogon and Showdown provide a free simulator that removes the breeding grind for testing, public monthly usage statistics, and an open-source damage calculator. Builders can then theorycraft against a known meta, and the official game stays the place where the work is done for real.

### Cited Findings
- Pokémon Showdown publishes ladders for dozens of formats, including official VGC regulation sets (for example "gen9vgc2025regi" and a Bo3 version), so players practise official formats on a free simulator. — [PS ladder gen9vgc2025regi](https://pokemonshowdown.com/ladder/gen9vgc2025regi); [PS ladder gen9vgc2025regibo3](https://pokemonshowdown.com/ladder/gen9vgc2025regibo3)
- Smogon publishes monthly Showdown **usage statistics** with per-Pokémon "chaos" data (spreads, items, moves, teammates) by generation and tier. Third-party tools wrap this data, for example a PyPI package. — [smog-usage-stats on PyPI](https://pypi.org/project/smog-usage-stats/1.0.3)
- The community damage calculator runs on the open-source **@smogon/calc** library. Third-party tools build on it, including an MCP server for VGC calcs, and it reports damage ranges and KO chances from stats, EVs, natures, abilities, items and weather. — [pokemon-vgc-calc MCP (glama.ai)](https://glama.ai/mcp/servers/@jpbullalayao/pokemon-vgc-calc-mcp/inspect); [Lusamine.DamageCalc NuGet](https://packages.nuget.org/packages/Lusamine.DamageCalc)
- Showdown's ladder help openly publishes its rating constants (K factors, floor, decay rules, Glicko constants). — [PS ladder help](https://pokemonshowdown.com/pages/ladderhelp)

### Inferences
- **Transparency of formulas drives "geeky" engagement.** Post Time already has an in-game Wiki with live game-core numbers. The step that follows from this research is (a) a public, deterministic **race/odds calculator**, the Smogon-calc equivalent, where a player enters two horses, a distance and a going and sees a win-probability range; (b) **monthly meta statistics**, the Smogon-usage equivalent: the share of Feature entrants and winners by sire line, aptitude profile, running style and training plan; (c) a stable API or data export so the community can build tools.
- **A practice simulator removes the grind from testing.** Showdown lets players test teams without breeding them. Post Time could offer "exhibition / sim race" runs against ghost horses, with no rewards, so breeders can test a plan before spending weeks on it.
- Hidden-but-learnable stats (IVs/EVs) create a skill gap in *understanding*, not just collection. Post Time's genetics should be fully *knowable* in principle, through the wiki and formulas, even if any individual foal's values need inspection, testing or scouting to find out.

### Gaps
- I did not retrieve primary Smogon pages (smogon.com/stats, calc.pokemonshowdown.com, or the smogon/calc GitHub README). Searches returned mostly SEO pages.
- I did not collect official Game Freak/TPCi sources on IV/EV mechanics or the hyper-training and mint features that cut breeding grind; these are known from general knowledge but unverified here.
- I found no data on how many competitive players use the calculators.

## 5. Competitive integrity: smurfs, multi-accounts, collusion, win-trading, bots

### Takeaway
The measures that work combine detection at scale (statistical or behavioural, run continuously), penalties tied to the **main account or identity**, not just the alt, and **repairing the victims' ratings**. Design choices that remove the reason to cheat also help: rating floors so nobody needs a new account, party limits by tier, and hidden decay so rank can't be parked.

### Cited Findings
- **Dota 2 (Valve)**: in September 2023 Valve banned about 90,000 smurf accounts, traced every one to its owner's main account, and warned that future smurfing would hit main accounts. A later wave (patch 7.35, Dec 2023) hit "tens of thousands", including pro players, and also people who "hired behavior score farmers". — [PC Gamer](https://www.pcgamer.com/valve-banned-90000-smurf-accounts-from-dota-2then-got-the-main-accounts-too); [esports.net](https://www.esports.net/news/valve-dota-2-smurfing); [ggscore](https://ggscore.com/en/dota-2/news/53929)
- Valve made smurf detection "much more proactive", accepting that it "may on rare occasion give a normal player extra MMR". Player reports feed in alongside "other detection mechanisms", and behaviour score affects matchmaking priority. — [esports.gg](https://esports.gg/news/dota-2/dota-2-bans-smurfs-smurfing); [win.gg](https://win.gg/news/dota-2-update-for-new-ranked-season-tackles-player-bans-smurfs/)
- **Chess.com fair play** closed about 116k–125k accounts a month in mid-2025 (for example, July 2025: 116k including 20 titled players; August 2025: 123k) and 152k in January 2026, from more than 1.2 million fair-play reports. It analyses about 20 million games a day. — [Chess.com Fair Play Update July 2025](https://www.chess.com/blog/FairPlay/fair-play-update-july-2025); [August 2025](https://www.chess.com/blog/FairPlay/fair-play-update-august-2025); [Chess.com Fair Play blog index](https://www.chess.com/blog/FairPlay); [Chess.com fair play page](https://www.chess.com/fair-play)
- An older report says Chess.com closes about 100k accounts a month (about 0.3% of accounts), and **nearly 40% of closed accounts are 2 weeks old or less**, so throwaway accounts are a big part of the problem. — [GamesBeat](https://gamesbeat.com/chess-com-closes-100k-accounts-monthly-for-fair-play-violations/)
- **Lichess** refunds rating to victims of a confirmed cheater (40 games over the last 5 days, capped at 150) and quietly play-bans players who abort or leave too often. — [Lichess FAQ](https://lichess.org/faq)
- **Riot (Wild Rift) win-trading policy**: win trading is defined as "any method where players manipulate the matchmaking queues to end up on opposite teams, in order to fix the results". First offence: a 7-day ban, **ranked reset to Iron and loss of all season rewards**. Repeat offence: permanent ban. — [Riot Wild Rift support "Bannable Offenses: Win Trading"](https://support.riotgames.com/en-us/wild-rift/account/bannable-offenses-win-trading); [Ginx](https://www.ginx.tv/en/?p=14544)
- **TFT esports collusion cases**: a Set 11 player (A Hao ei) was fined for win trading. For Set 13, Riot banned Shitouren for deliberate underperforming after finding "no evidence of any direct coordination or collusion", then publicly admitted the ruling was rushed and described process changes. — [esports.gg Set 13](https://esports.gg/news/teamfight-tactics/riot-responds-to-tft-set-13-tacticians-crown-alleged-win-trading/); [esports.gg Shitouren](https://esports.gg/news/teamfight-tactics/shitouren-banned-from-competitive-tft-riot-admits-mistake)
- TFT makes players with cheating penalties ineligible for season rewards and caps the gap between duo partners in apex tiers. — [Riot TFT FAQ](https://support.riotgames.com/tft/account/teamfight-tactics-ranked-faq)
- **GT Sport/GT7**: Sportsmanship Rating **caps** Driver Rating, so DR can't rise above the SR band. Collision and penalty behaviour therefore limits competitive progress, and matchmaking pairs players with similar SR. — [GT7 online manual tips](https://gran-turismo.com/gb/gt7/manual/tips/03); [gran-turismo.com Sport Mode (2017)](https://www.gran-turismo.com/us/news/00_1608923.html)

### Inferences
- Post Time's main integrity risks are different from twitch-skill games. They are **multi-account stables** (feeding horses, credits or stud services to a main), **collusion in shared fields** (entering weak horses to block or shape a qualifier), and **bots** that farm the 3-minute Live race. Useful measures from the research:
  1. **Penalise the identity, not the account**, as Valve did by tracing smurfs to mains. Link stables by device, payment and wallet signals; see also the project's existing anti-multi-account rules in the web3-game-economy skill.
  2. **Repair the victims** (Lichess refunds). If a stable is found to have colluded, recompute that week's qualifier points and Feature field for the affected stables.
  3. **A Wild-Rift-style penalty ladder**: void season points, strip season rewards, reset League tier, and permanent ban for repeat offences. Publish it.
  4. **Remove the reason to cheat**: points floors (Showdown) make new stables pointless for "resetting". Count only best N qualifier results (Best Finish Limits) to cut the value of farming the 3-minute race. Limit how many horses one stable can enter in a single qualifier field, the analogue of a coupled entry in real racing.
  5. **Field composition rules** against blocking: draw qualifier fields by rating band at random (seeded and deterministic), so colluders can't choose to share a field.
  6. **Sportsmanship gate**: GT's rule that SR caps DR maps onto an "integrity standing" that caps League promotion, for stables flagged for things like repeat scratches or entering then withdrawing.
  7. **Expect and publish volume**: Chess.com's monthly transparency posts are a credibility tool worth copying at small scale.
- Riot's rushed TFT ruling shows that collusion decisions need a documented review process and an appeal, especially when any reward has real value.

### Gaps
- I found no source on bot detection in ladder games specifically (beyond chess engines). I found no Valve primary blog on phone-number requirements for ranked; only an anecdote turned up.
- I found no evidence on what share of smurfing or win-trading each measure removes; the sources give enforcement volumes, not effectiveness rates.
- I did not retrieve Hearthstone or Pokémon Play! esports rulebook collusion clauses.

## 6. The Daily Races model: GT7's three fixed races vs unlimited lobbies

### Takeaway
GT7's Sport Mode concentrates all ranked players into **three curated races (A, B, C) that rotate weekly** and can be re-entered without limit within the week. Fixed car, track and rules mean every attempt is comparable, practice pays off, and matchmaking pools stay full. These are the same properties Post Time's "Live race every 3 minutes plus a weekly Feature" structure needs.

### Cited Findings
- GT7 Daily Races are "the main ranked multiplayer events". There are **three per set**: Race A (usually a one-make road car), Race B (Gr.3) and Race C (Gr.4). Each set runs **seven days and rotates on Mondays**. — [GTPlanet, 15 Sep 2025](https://www.gtplanet.net/gran-turismo-7-daily-races-20250915)
- Each race has curated rules. In the 15 Sep 2025 set, Race A was the Honda S2000 '99 with a specified setup, Comfort Soft tyres and a grid start (4 laps); Race B was any Gr.3 car with BoP and a 1-lap Nürburgring 24h run of about 8 minutes, tied to a Manufacturers Cup hot-lap; Race C was 12 laps of Brands Hatch with one mandatory pit stop and pit-line penalties. — [GTPlanet](https://www.gtplanet.net/gran-turismo-7-daily-races-20250915)
- **Race A usually has DR updates off**, which makes it a low-stakes on-ramp, while B and C are ranked. Some weeks all three are ranked. SR updates always apply. — [GTPlanet](https://www.gtplanet.net/gran-turismo-7-daily-races-20250915)
- GT Sport's original design: an event "hosted every day for a set period of time" that players can enter "as many times as they like to improve their record". Matchmaking by DR and SR plus Balance of Performance is meant to let "everyone… enjoy good races under equal conditions". — [gran-turismo.com (Oct 2017)](https://www.gran-turismo.com/us/news/00_1608923.html)
- Sport Mode needs story progress (Menu Book 9) and PlayStation Plus. — [GTPlanet](https://www.gtplanet.net/?p=138443)
- DR has seven tiers (E to S) and SR six (E to S). New players start at SR B. **DR cannot rise above SR**. Ratings carried over from GT Sport. Point bands circulating online are unofficial. — [GT7 online manual tips](https://gran-turismo.com/gb/gt7/manual/tips/03); [Coach Dave Academy](https://coachdaveacademy.com/tutorials/how-to-improve-your-dr-sr-in-gt7/)
- DR and SR set the ranking and league for the GT World Series. — [GTPlanet](https://www.gtplanet.net/gran-turismo-7-daily-races-20250915)

### Inferences
- **Why fixed curated races beat unlimited choice** (inferred from the above):
  1. **Liquidity**: three races keep the ranked population in a few matchmaking pools, so fields fill quickly at every skill band.
  2. **Mastery and comparability**: the same race all week means players can practise, compare times and improve. Results across attempts mean something.
  3. **Designed variety**: weekly rotation and a different "flavour" for A, B and C give novelty on a schedule, with tie-ins to championship events (Race B mirroring the Manufacturers Cup hot-lap).
  4. **Tiered stakes**: Race A unranked, B and C ranked works as both an on-ramp and a pressure valve.
- **Mapping to Post Time**: the Live race every 3 minutes is the "always-on Daily Race". It should use a **small, curated rotating card** (for example, three race types per week, A/B/C by distance or surface or class) rather than a random race each time. Then (a) breeders can target a known week's conditions, (b) the weekday qualifiers repeat a known condition all week, and (c) the Saturday Feature can be "Race B's conditions, high stakes". Keep one unrated "Race A" lane for newcomers and testing.

### Gaps
- I found no official GT7 manual text on start intervals (how often each Daily Race lobby starts, reportedly every few minutes to 20 minutes) or on the qualifying time-trial mechanics. The official manual page returned no content when fetched.
- I found no official DR/SR point formulas, and the circulating tables are flagged as possibly inaccurate.
- I found no Polyphony statement explaining *why* it chose three races over open lobbies; the rationale above is inferred.
