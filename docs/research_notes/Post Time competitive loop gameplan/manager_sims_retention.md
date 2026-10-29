# Long-lived management sims: daily/weekly loops, league structures and retention (comparables for Post Time)

Researched 2026-10-29. Caveat on access: hattrick.org and wiki.hattrick.org returned HTTP 403 to every direct fetch (WebFetch and curl). The Hattrick rule details below therefore come from search-engine extracts of the official pages, cited by their URLs, and were not read in full. The report writer should treat exact weekdays and times as "per official help pages, varies by country".

## 1. Hattrick (since 1997): weekly rhythm, pyramid, grind, economy, longevity, monetisation

### Takeaway
Hattrick has run for about 29 years on a very slow, fixed weekly loop: one league match at the weekend, one cup or friendly midweek, one training tick and one economy tick per week, inside a 16-week season with 8-team series and promotion/relegation. Its user base peaked near 1M (2009) and has held steady at about 200k for more than five years. That suggests a slow, appointment-based loop keeps a loyal core indefinitely but does not grow by itself.

### Cited Findings
**History, scale, user counts**
- Launched 30 August 1997 in Sweden, initially Swedish only. Hattrick Extralives was founded in early 2000. The Supporter premium service started in May 2001 and is described as the company's main source of income — [Wikipedia: Hattrick](https://en.wikipedia.org/wiki/Hattrick_(video_game))
- Ownership: Zattikka (UK casual developer) bought Hattrick Holdings in April 2012. In August 2013 the former owners agreed to buy it back — [Wikipedia](https://en.wikipedia.org/wiki/Hattrick_(video_game))
- Users: peak of "almost one million users" in February 2009. 201,895 users on 8 October 2022. 144 countries plus "Hattrick International" for Supporters — [Wikipedia](https://en.wikipedia.org/wiki/Hattrick_(video_game))
- A 2024 Galaxus/Digitec article (byline David Lee / hattrick.org) titled "Hattrick: you can easily play this game for ten or twenty years" says Hattrick has held a stable ~200,000 users for more than five years, with significantly fewer players than in the 2000s. Full text was unavailable (503); this comes from the search extract — [Galaxus](https://www.galaxus.ch/en/page/hattrick-you-can-easily-play-this-game-for-ten-or-twenty-years-31883)
- Older undated claims of "over 800,000 users" (TV Tropes) and "over 600,000 players" (Jungle World) probably count registrations or peak-era figures. Do not compare them with the 2022–2024 numbers — [TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/HatTrick); [Jungle World](https://jungle.world/print/pdf/node/15714)
- Anecdotal tenure: a Trustpilot reviewer reports playing continuously for 22 years — [Trustpilot](https://au.trustpilot.com/review/hattrick.org)

**Season and league pyramid**
- A season lasts 16 weeks: 14 league rounds, 1 week of qualifiers and 1 week with no league activity. 82 seasons had been played by November 2022 — [Hattrick Series System help](https://www13.hattrick.org/en-us/Help/Rules/SeriesSystem.aspx); [Wikipedia](https://en.wikipedia.org/wiki/Hattrick_(video_game)); [Hattrick wiki: Off-season](https://wiki.hattrick.org/wiki/Off-season)
- Each series has 8 teams playing a double round-robin (14 matches). The number of series and groups per country scales with that country's user count — [Series System](https://www13.hattrick.org/en-us/Help/Rules/SeriesSystem.aspx); [Wikipedia](https://en.wikipedia.org/wiki/Hattrick_(video_game))
- Promotion: series winners either go up directly or play a qualifier. The best-record winners meet the worst 6th-placed teams of the division above, and the weakest-record winners meet the best 5th-placed teams. The higher-division side hosts, and teams swap only if the lower team wins. In divisions VII and IX, 3rd and 4th place play promotion qualifiers. In VIII and X, 2nd place does — [Series System](https://www13.hattrick.org/en-us/Help/Rules/SeriesSystem.aspx)
- Ranking tie-breaks: series level, then place, points, goal difference, goals scored, then a coin toss. Bot teams in division V and above are promoted and relegated like human teams. Some teams that lose qualifiers or are demoted are labelled "Lucky Losers" and can fill vacancies — [Series System](https://www8.hattrick.org/en-us/Help/Rules/SeriesSystem.aspx)
- A national knockout cup runs alongside the league. Winners of the top division and the cup qualify for the "Hattrick Masters" (cross-country) — [Wikipedia](https://en.wikipedia.org/wiki/Hattrick_(video_game)); [Cup rules](https://en-us.hattrick.org/Help/Rules/Cup.aspx)

**Weekly rhythm (the core loop)**
- League matches are played at the weekend, and cup and friendly games midweek — [Beginners' guide](https://www.hattrick.org/en/Help/BeginnersGuide.aspx). The wiki uses "Sunday" for the weekend league match and "Wednesday" for the midweek cup/friendly. One wiki listing gives cup matches at Wednesday 02:30 server time. Days vary by country — [Hattrick wiki: Rules](https://wiki.hattrick.org/wiki/Rules); [Updates](https://wiki.hattrick.org/wiki/Updates); [A week in Hattrick](https://www.guiaocerin.com/week-in-hattrick)
- Training is applied once a week, on Thursday night or Friday depending on country, so orders must be set before then — [Hattrick wiki: Training](https://wiki.hattrick.org/wiki/Training); [Updates](https://wiki.hattrick.org/wiki/Updates)
- A weekly economy update runs at the weekend: wages, arena costs and interest are paid, and sponsor income arrives — [Hattrick wiki: Updates](https://wiki.hattrick.org/wiki/Updates)
- In effect a manager has about 2 matches and 4 scheduled "events" per week (league, cup/friendly, training, economy). Everything else is preparation: line-ups, the transfer market and the youth academy.

**Training as a long-term grind, youth academy, tools**
- Hattrick Organizer (HO!) is the most popular CHPP-certified helper application. All helper apps that log in to Hattrick must be CHPP-approved. HO's training planner lets managers set training for the next 16 weeks, a full season. Its TeamAnalyzer can only predict two games ahead because of CHPP restrictions — [Hattrick wiki: Hattrick Organizer](https://wiki.hattrick.org/wiki/Hattrick_Organizer); [Helper application](https://wiki.hattrick.org/wiki/Helper_application)
- HO! is open source and still actively released. Releases 10.0 and 11.0 added youth-academy columns and a "Rate my academy score" feature — [ho-dev/HattrickOrganizer releases](https://github.com/akasolace/HO/releases); [issue #367 Youth Academy](https://github.com/ho-dev/HattrickOrganizer/issues/367)
- Youth academy: a guide says a youth player must stay in the junior team at least 112 days (16 weeks, one season) and be at least 17 before promotion. The player profile shows when promotion becomes possible — [Hattrick Youth Academy guide](https://www.hattrick.org/en/Community/Press/?ArticleID=19178); [wiki: Youth Academy](https://wiki.hattrick.org/wiki/Youth_Academy)
- A separate third-party helper, Hattrick Youthclub, exists for youth analysis. Its CHPP sync is limited because Hattrick does not expose all youth data. This is a deliberate partial-transparency choice — [Hattrick Youthclub wiki](https://wiki.hattrick.org/wiki/Hattrick_Youthclub); [Youthclub manual](https://wiki.hattrick-youthclub.org/manual)
- The community ecosystem extends to squad trackers such as SquadTrick — [SquadTrick](https://squadtrick.com/)

**Monetisation (Supporter) and multi-team rules**
- Supporter tiers (Silver, Gold, Platinum, Diamond) are sold as packages, including "12 + 3" (months) offers mentioned in 2024 system notices — [System information archive](https://www.hattrick.org/en-us/Help/SystemStatus/Archive/Complete.aspx)
- Additional clubs are a paid feature. Platinum allows 1 additional club (up to 3 with purchased Extra Club Licenses), Diamond up to 3. A lapsed subscription keeps the extra club for one more week. Same-owner "sister teams" can meet in cups, and the rules accept this — [Additional club](https://en-us.hattrick.org/Help/Rules/AdditionalClub.aspx)
- Integrity: rule-breaking is reported to GameMasters (House Rules). One manager cannot coach two national teams or two U21 teams, to prevent controlling both sides of a match — [House Rules](https://en-us.hattrick.org/Help/Rules/HouseRules.aspx); [National Teams](https://en-us.hattrick.org/Help/Rules/NationalTeams.aspx)
- The sister game Battrick (same lineage) explicitly bans running multiple teams and buying players from teams that share computers or IP addresses — [Battrick rules](https://www.battrick.org/nl/rules.asp?item=21)

### Inferences
- Hattrick's long life fits a model of few, high-stakes, scheduled events: 2 matches a week, a 16-week season, and promotion decided by a 14-match table plus a one-off qualifier. With only 14 league matches, each one carries roughly 7% of the season's outcome. Post Time's 4-week season is about 4x faster, so a weekly League Day is the closest equivalent to Hattrick's weekend match.
- 8-team series is a good size: a short double round-robin, readable tables, and a clear chance to be top. Scaling the number of series to population, and backfilling empty slots with bots in low tiers, lets a small live population still produce full leagues.
- Monetising convenience, status and extra clubs rather than match power (Supporter) is consistent with a 25-year community. I did not find primary text explicitly stating "Supporter does not affect results", so this is unverified here.
- Hattrick turns paid extra clubs into a sanctioned outlet for multi-team demand while policing illicit multis. Post Time could do the same: allow a sanctioned second stable and ban covert multi-accounting.
- CHPP (an approved API with rate and visibility limits) let the community build HO! and others without exposing everything. Allowing a 16-week training plan but only a 2-match opponent preview shows how to grant data access while keeping hidden information.

### Gaps
- Exact current Supporter prices and a full feature list could not be read (hattrick.org returned 403).
- No official data on the share of paying users, D30/D365 retention, or average tenure.
- Exact training mechanics (formula, intensity and stamina share, age decay) could not be fetched. Only the weekly cadence is confirmed.
- No primary text found on Hattrick's anti-multi-account enforcement (IP checks, transfer-market investigations), only that GameMasters handle reports.

## 2. Top Eleven, FM, OOTP online leagues, Trophy Manager, Sokker, ManagerZone: cadence, daily budget, "few meaningful matches"

### Takeaway
Match frequency varies by about 15x across the genre. Hattrick plays ~2 matches a week, Sokker ~2 league matches a week, Trophy Manager 3 league matches a week plus cups, and Top Eleven compresses a full season into 28 days with daily matches. Community-run FM and OOTP leagues settle on 2–4 "sims" a week, timed to when humans can submit orders. The more frequent the matches, the more each one is a scheduled check-in rather than a story beat.

### Cited Findings
**Top Eleven (Nordeus, mobile/Facebook, 2010–)**
- Nordeus describes "every exciting 28-day Top Eleven season" — [Nordeus: Top Eleven](https://nordeus.com/games/top-eleven/)
- Scale: "over 260 million Managers" on Nordeus's site, over 300 million registered users per a September 2025 Bundesliga-partnership report, 220M+ downloads at the 10-year mark (2020), and a 15-year history by 2025 — [Wikipedia: Nordeus](https://en.wikipedia.org/wiki/Nordeus); [PocketGamer.biz 220M](https://www.pocketgamer.biz/news/73335/top-eleven-220-million-downloads/)
- Older activity figures: about 10M monthly players and 4M daily logins (Polish report citing AppStats). These are dated and cannot be verified — [benchmark.pl](https://www.benchmark.pl/top-eleven-pilkarski-menedzer-zostal-pobrany-juz-100-mln-razy-7263092040491585a); [PocketGamer.biz](https://www.pocketgamer.biz/growing-top-eleven-into-a-global-franchise)
- Interview with CEO Branko Milutinović (15 May 2020): about 35-person live team. A 10-year update added "Friendly Championship" (player-created leagues) and a "Special Sponsor" feature modelled on battle passes. In 2018 the team admitted neglecting the core game and refocused on fundamentals and pain points. Quote: "You cannot keep a game going for 10 years without strong player support and communities around you." — [PocketGamer.biz: Live and kicking](http://www.pocketgamer.biz/live-and-kicking-nordeus-top-eleven-ten-years-on/)
- Fatigue (older guide, c. 2013): players rested once per day regardless of matches played, so managers could play matches very close together without worrying about fatigue. The guide notes this was later dialled back for injuries — [SuperCheats Top Eleven: injuries, rest & treatments](https://www.supercheats.com/guides/top-eleven-football-manager/injuries-rest-and-treatments)

**Trophy Manager**
- The official site says the schedule is fixed: league matches three times per week, plus training reports and custom training programmes — [Trophy Manager](https://trophymanager.com/ir/); [OnlineSportManagers profile](https://mycompany.onlinesportmanagers.com/game-profile/football-60-trophy-manager/)
- An old forum post describes matches on Wednesday, Friday and Sunday, an 18-team league (34 games, about 3-month season), top 2 auto-promoted, cups on Monday and Thursday, and training on Tuesday. This is dated — [Tapatalk forum](https://www.tapatalk.com/groups/espnstar/trophy-manager-t43889.html)

**Sokker**
- Official rules: a 13-week season. Week 1 is warm-up matches, league matches are twice a week in weeks 2–12, and week 13 is play-offs. Friendlies must be arranged within a 6-day window — [Sokker rules ch. 12](https://sokker.org/rules/action/short/chapter/12)
- Training applies only to players who played at least one match (any minutes) in the week before training. This ties match selection to development — [Sokker forum](https://sokker.org/forum_topic/ID_forum/24854/ID_topic/3616723/pg/0)

**OOTP / FM online leagues (community-run)**
- OOTP online-league sim frequency is set by the commissioner. Examples: 3 sims a week of 10 game-days each; M/W/F exports due 9pm CST with 7-day sims; Mon/Wed/Fri/Sat regular-season sims; GMs must export at least 3x per real week. Some leagues sim a month or a season at once, others 1 sim-day per real day — [OOTP forums](https://forums.ootpdevelopments.com/showthread.php?p=2722061); [Circuit Clouts rules](https://sites.google.com/view/circuitclouts/rules); [StatsPlus Asahi rules](https://statsplus.net/asahi/home/rules/)
- Tooling: StatsLab (PHP/MySQL utilities for online leagues) and StatsPlus (league integration with Slack/Discord) — [OOTP forums](https://forums.ootpdevelopments.com/showthread.php?p=1018542); [StatsPlus wiki](https://wiki.statsplus.net/)
- FM online leagues are community-run (often Discord) and scheduled around human availability, e.g. "Monday evenings GMT" or "a couple of nights a week" — [FM Scout: online league Monday evenings](https://www.fmscout.com/q-23772-Online-league-running-Monday-evenings-GMT.html); [FM Scout: UK time zone league](https://www.fmscout.com/q-21114-Creating-A-Online-Game--Uk-Time-Zone--Anyone-Interested--No-Kane-No-gain.html?p=270398)

### Inferences
- Cadence spectrum, with matches per real week: Hattrick ~2 (1 league), Sokker ~2 league, Trophy Manager 3 league plus ~2 cup, OOTP/FM human leagues 2–4 sim batches, Top Eleven roughly daily (28-day season). Post Time is unusual: Live races every 3 minutes is far more frequent than any of these. The comparables suggest the frequent races should work as a practice-and-qualifying layer, with the weekly League Day as the high-stakes match.
- Human-run leagues (OOTP/FM) independently settled on 2–4 deadlines a week. That is about how often committed hobbyists will reliably submit orders. A daily entry budget fits if entries can be queued, and should not require players to be online at a set time.
- Sokker's "must have played to train" rule and Top Eleven's fatigue/rest show how to tie frequent participation to long-term development without making grinding mandatory. Post Time could cap training or form gains per week, or use fatigue for horses raced too often.
- Top Eleven's turnaround comment, that chasing new features hurt the core, is a useful warning for live ops.

### Gaps
- No current official ManagerZone schedule found (search returned nothing usable).
- No published retention or tenure data for Top Eleven, Trophy Manager, Sokker or ManagerZone.
- Current Top Eleven per-day match count and stamina rules are not confirmed from an official source.
- FM Mobile has no persistent online league mode to compare. Nothing found.

## 3. Mobile/idle retention benchmarks, daily login, 15–30 min sessions, energy/entry systems

### Takeaway
2025 GameAnalytics data (16k+ mobile games) puts median D1 around 22% (top 10% about 40%), D7 just under 4% (top 10% 11–12%), and D30 about 0.7–0.8% (top 10% about 3%+, top 1% 13–15%). Top-quartile mobile games hit 22–24 minutes of play per day, which matches Post Time's 15–30 minute daily target. Energy/entry systems improve habit metrics but irritate core players unless framed as a reward or a limited allowance.

### Cited Findings
- GameAnalytics 2026 report (2025 data; 16,262 mobile games with ≥1,000 MAU):
  - Mobile D1: top 25% just above 30%, top 10% ~40%, top 1% 64–68%. D1 declined vs 2024.
  - Mobile D7: median just under 4%, top 25% 6–7%, top 10% 11–12%, top 1% >25%.
  - Mobile D30: median 0.69–0.79%, top 25% 1.6–1.8%, top 1% 13–15%.
  - Mobile daily playtime: top 25% 22–24 min, top 10% 40–42 min, top 1% >94 min. Session length top 25% ~5.2 min, top 10% ~8 min. Sessions/day top 25% 5.3–5.7.
  - PC (3,582 games): median session 18 min, median playtime 32–33 min/day, DAU/MAU median 4–5% (top 10% 13–15%, top 1% just under 40%), D30 top 10% ~2.5%.
  - The data aggregates all genres; no genre split is given.
  — [GameDevReports: GameAnalytics 2026 benchmarks](https://gamedevreports.substack.com/p/gameanalytics-mobile-and-pc-game); full PDF [investgame.net](https://investgame.net/wp-content/uploads/2026/01/2026-01-27-2026-mobile-pc-benchmarks_compressed.pdf)
- A separate summary of 2025 data gives median D1 ~22% and median D7 ~4% — [GameDevReports: GameAnalytics 2025](https://gamedevreports.substack.com/p/gameanalytics-mobile-gaming-benchmarks); [2025 PDF](https://investgame.net/wp-content/uploads/2025/02/2025-GameAnalytics-Mobile-Gaming-Benchmarks.pdf)
- Genre numbers from vendor blogs (lower reliability): hyper-casual D1 20–30% / D7 5–10% / D30 <2%; "match" games D1 32.65% / D7 14.2% / D30 7.15% (2026 table) — [Segwise](https://segwise.ai/blog/mobile-gaming-app-user-retention-strategies.md); [Game Growth Advisor](https://gamegrowthadvisor.com/blog/2026-03-17-mobile-game-kpis-benchmarks-2026/)
- Energy systems, the case for: they build habit and improve DAU, session counts and retention. One critic argues this works "by making it feel wasteful to stay away". They also pace content, and in casual games energy can be about a third of bookings — [Mobile Free to Play: Understanding Energy Systems](https://mobilefreetoplay.com/?p=617); [Mobile Free to Play: Eliminating Energy](https://mobilefreetoplay.com/tag/energy/)
- Energy systems, the case against: Midnight Star (core shooter) removed its energy system after testing because players disliked being told to stop, and too few paid to bypass it. It "sends a negative message to the game's best players" — [TouchArcade, 2015](https://toucharcade.com/2015/05/28/core-gamers-and-f2p-energy-systems-dont-mix-says-developer-of-midnight-star)
- Framing: timers tend to feel better than energy points. With identical numbers, presenting the allowance as a bonus made players feel rewarded rather than punished — [Mobile Free to Play](https://mobilefreetoplay.com/?p=617); [PocketGamer: Hogwarts Mystery energy](https://www.pocketgamer.com/harry-potter-hogwarts-mystery/making-the-case-for-harry-potter-hogwarts-mysterys-energy-system/)

### Inferences
- For a niche browser management game, the useful targets are top-quartile PC/mobile numbers (D1 ≥30%, D7 ≥6–7%, D30 ≥1.6–2.5%) and DAU/MAU ≥13% (top-10% PC). Hattrick-type games are likely to have much higher long-tail retention among those who stay past the first season, but no published data confirms this.
- A 15–30 minute daily session fits top-quartile mobile playtime (22–24 min/day) and median PC session (18 min). Splitting it into 2–5 short visits (enter races, check results, adjust training) matches the 5+ sessions/day pattern.
- Post Time's daily entry budget is an energy system. The evidence says frame it as a daily allowance of entries that refills, not as a stamina bar that runs out. Avoid paid refills that can be read as buying more chances to win points. That also fits the project's no-pay-to-win stance.

### Gaps
- No primary 2025/2026 D1/D7/D30 data for sports-management or idle sub-genres specifically.
- No Deconstructor of Fun or GameRefinery primary piece on energy or entry systems was retrieved in this pass.

## 4. Frequent small events tied to a weekly goal; role of near-miss feedback

### Takeaway
The comparables layer frequent low-stakes events (friendlies, cup ties, daily matches) under one high-stakes cadence (the weekly league fixture and season table). Promotion qualifiers and playoffs create end-of-season near-miss moments. Lab evidence shows near-misses raise arousal and the urge to keep playing, but they also feel worse than plain losses and are a classic gambling mechanic. They should be shown honestly, never manufactured.

### Cited Findings
- Hattrick: weekend league match plus midweek cup/friendly, then a season-end qualifier week in which series winners play 5th/6th-placed teams from above. This adds a sudden-death promotion match to the league table — [Series System](https://www13.hattrick.org/en-us/Help/Rules/SeriesSystem.aspx); [Beginners' guide](https://www.hattrick.org/en/Help/BeginnersGuide.aspx)
- Hattrick's "Lucky Losers" let some teams that just missed out fill promotion vacancies, which softens near-misses — [Series System](https://www8.hattrick.org/en-us/Help/Rules/SeriesSystem.aspx)
- Sokker: 11 weeks of twice-weekly league play, then a play-off week — [Sokker rules](https://sokker.org/rules/action/short/chapter/12)
- Top Eleven added a battle-pass-style "Special Sponsor", i.e. frequent tasks feeding a periodic reward track — [PocketGamer.biz](http://www.pocketgamer.biz/live-and-kicking-nordeus-top-eleven-ten-years-on/)
- Near-miss research: in a Candy Crush study (Larche et al., 2017), near-misses were more arousing than losses (higher heart rate and subjective arousal) and produced the strongest urge to keep playing of any outcome. The thesis sample was 60 players — [PMC: Candy Crush Sweet Tooth](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5445157/); [UWSpace thesis](https://uwspace.uwaterloo.ca/handle/10012/12522)
- A systematic review found near-misses motivate continued play, with varying effects on emotion and betting. Players rate near-misses as more aversive than regular losses — [Springer J Gambling Studies 2016](https://link.springer.com/article/10.1007/s10899-016-9633-7)
- Clark et al., "Gambling Near-Misses Enhance Motivation to Gamble and Recruit Win-Related Brain Circuitry" (Neuron): the effect was moderated by personal control — [SGUL supplementary](https://openaccess.sgul.ac.uk/id/eprint/368/1/mmc1.pdf)

### Inferences
- Map for Post Time: Live races every 3 minutes (low stakes, practice and form-building), then a daily entry budget (some choice), then weekly League Day (high stakes, decides tier points), then a 4-week season with promotion/relegation and perhaps a qualifier race, like Hattrick's qualifier week.
- Near-miss feedback should come from real, skill-related outcomes: margin of defeat, photo-finish result, points-to-promotion gap. It should never be engineered randomness. The personal-control finding means near-misses motivate more when players feel their choices mattered. That argues for showing which training or strategy choice cost the race, which also suits Post Time's no-gambling ethics.
- Showing "points to promotion" and "points above relegation" gives every weekly race a stake, as a 14-match Hattrick table does.

### Gaps
- No controlled study found on near-misses in sports-management or league contexts specifically. All evidence is from puzzle or slot settings.
- No data found comparing retention under frequent-trivial vs infrequent-meaningful schedules in the same game.

## 5. Session design for "geeky" players: formulas, stats, exports, tools, transparency

### Takeaway
Long-lived management sims keep the engine partly hidden but give data access via an approved API. Hattrick's CHPP gave rise to HO! (open source, still maintained), Youthclub and trackers, and OOTP leagues built StatsLab and StatsPlus. Quantic Foundry's data shows Strategy and Completion motivations (the "Architect" profile) are the most stable with age, which matches the multi-decade tenure of these games.

### Cited Findings
- CHPP: all helper apps that log in must be approved. HO! is the most popular. CHPP deliberately limits opponent visibility (HO! TeamAnalyzer predicts only 2 games ahead) and youth data — [Hattrick wiki: Helper application](https://wiki.hattrick.org/wiki/Helper_application); [Hattrick Organizer](https://wiki.hattrick.org/wiki/Hattrick_Organizer); [Hattrick Youthclub](https://wiki.hattrick.org/wiki/Hattrick_Youthclub)
- HO! is open source on GitHub with continuing numbered releases (10.0, 11.0) and community feature requests — [GitHub releases](https://github.com/akasolace/HO/releases); [issue #367](https://github.com/ho-dev/HattrickOrganizer/issues/367)
- OOTP leagues rely on community stats tools (StatsLab, used to compare stats across eras; StatsPlus for Slack/Discord integration) and on export deadlines — [OOTP forums](https://forums.ootpdevelopments.com/showthread.php?p=1018542); [StatsPlus wiki](https://wiki.statsplus.net/)
- Quantic Foundry: the model is based on data from more than 1.25M gamers, with 12 motivations in 6 pairs (including Challenge–Strategy and Completion–Power). Strategy is the most age-stable motivation (2016 talk). Completion is also highly age-stable and higher for women. The "Architect" type (Strategy + Completion) wants progression, strategic decisions and to "build something that lasts" — [Quantic Foundry ECGC 2016 talk](https://quanticfoundry.com/wp-content/uploads/2016/04/Quantic-Foundry-2016-ECGC-Gaming-Motivation-Talk.pdf); [Quantic Foundry GDC 2019 talk](https://quanticfoundry.com/wp-content/uploads/2019/03/Quantic-Foundry-GDC-2019-Talk.pdf); [Skeleton Code Machine](https://www.skeletoncodemachine.com/p/what-type-of-gamer-are-you)
- A secondary German report claims Quantic data shows interest in strategy declining over 9 years. This is a single source — [WinFuture](https://winfuture.de/news,142979.html)

### Inferences
- For Post Time: publish rules-level formulas (how stats feed race outcome ranges, how genetics are inherited), keep exact per-race randomness hidden, and offer a read-only API or CSV export (stable, pedigrees, race history) with rate limits and a delay on opponent data. This mirrors CHPP's 2-match horizon and protects League Day strategy.
- An in-game wiki with live numbers (which Post Time already has) is roughly a first-party equivalent of Hattrick's community wiki and HO!. Letting fans build tools on an approved API outsources depth and builds identity.
- Architect-type players care most about multi-season goals (bloodlines, a stud book, tier history), so long-horizon records and stats pages matter more to them than daily rewards.

### Gaps
- No quantitative study found linking engine transparency or API availability to retention in management sims.
- Share of Hattrick users using CHPP tools: not found.
- Quantic Foundry genre-level profiles for sports-management titles are paid data and were not accessible.
