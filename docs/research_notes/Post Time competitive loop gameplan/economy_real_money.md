# Game economy sustainability and real-money competition lessons (input for "Post Time")

Research date: 2026-10-29. Not legal advice; the legal sections summarise the landscape from law-firm and press sources. Older facts are dated inline.

## Q1. Axie Infinity (2021–2023): SLP/AXS economy, breeding, scholarships, collapse

### Takeaway
Axie's soft currency (SLP) was minted by playing and burned almost only by breeding. By late 2021, 2 to 4 times more SLP was minted than burned. The Axie population only grew, so it had no sink of its own. The economy ran on new money: when new-player growth slowed, SLP fell from about $0.40 to about $0.02 and DAU fell from 2.7M to about 1.5M within about 5 months. The $620M Ronin bridge hack then deepened the collapse.

### Cited Findings
- **Faucets vs sinks (Dec 2021 snapshot):** About 100–200M SLP minted per day against about 50–100M burned. The mint/burn ratio was about 2.5 and rising. Breeding was the only sink for both SLP and AXS. — [Deconstructor of Fun, "Axie Infinity: Infinite Opportunity or Infinite Peril?" (c. Dec 2021)](https://www.deconstructoroffun.com/blog/axie-infinity-deconstruction)
- **Sky Mavis's own diagnosis (Feb 2022):** About four times as much SLP was created each day as was burned through breeding. — [Decrypt, Feb 2022](https://decrypt.co/92190/axie-infinity-making-big-changes-to-fix-its-ailing-play-to-earn-nft-economy)
- **Faucet design:**
  - Daily quests paid 25 SLP/day, cut from 50 in Aug 2021.
  - PvE was capped at 50 SLP/day, cut from 100.
  - PvP paid up to 20 SLP per win at top MMR.
  - Energy caps of 20/40/60 per day depended on Axies owned.
  - From Oct 29, 2021, players under 800 MMR earned no SLP.
  — [Deconstructor of Fun](https://www.deconstructoroffun.com/blog/axie-infinity-deconstruction)
- **Breeding cost was raised, but production did not drop:**
  - On Sep 23, 2021, breeding SLP costs rose about 66% and AXS per breed fell from 2 to 1. Daily Axie births "did not significantly drop."
  - About 8.4M Axies were in circulation on Oct 31, 2021.
  - Floor prices fell more than 75% over three months.
  - DoF's main proposed fix was a way to permanently remove Axies.
  — [Deconstructor of Fun](https://www.deconstructoroffun.com/blog/axie-infinity-deconstruction)
- **Breeding limits:**
  - Each Axie can breed at most 7 times, then becomes sterile.
  - Each breed costs 0.5 AXS (after Dec 2021) plus escalating SLP.
  - Official support table (SLP per parent): 900 at breed 0, 1,350, 2,250, 3,600, then 5,850 at breed 4.
  - Late-2021 schedules ran from 1,800 to 30,600 SLP. Figures conflict by date.
  — [Axie support](https://support.axieinfinity.com/hc/en-us/articles/7225771030555); [Esports.net guide](https://www.esports.net/wiki/guides/axie-infinity-how-to-breed/)
- **Prices and activity:**
  - SLP peaked near $0.40 in Aug 2021 and was about $0.01 or less by Feb 2022.
  - AXS hit an all-time high of about $165 in Nov 2021 and was about $50 in Feb 2022.
  - Monthly NFT volume fell from $754M (Nov 2021) to $301M (Dec) to $126M (Jan 2022).
  - Entry-level Axies fell from $200+ to about $30.
  - DAU was just under 2.2M on Jan 31, 2022, against a peak above 2.7M in Nov 2021.
  — [Decrypt](https://decrypt.co/92190/axie-infinity-making-big-changes-to-fix-its-ailing-play-to-earn-nft-economy)
- **Later figures:** DAU was just under 1.5M by late March 2022, and SLP was about $0.02. — [Rest of World, 2022](https://restofworld.org/2022/axie-infinity-hack/)
- **Fix attempted (Season 20, Feb 2022):**
  - SLP was removed from adventure mode and daily-quest SLP was cut.
  - Rewards shifted to PvP arena.
  - Buy-in tournaments and new burns were planned.
  - Founder Jeff Zirlin: "This change should have been made much sooner."
  — [Decrypt](https://decrypt.co/92190/axie-infinity-making-big-changes-to-fix-its-ailing-play-to-earn-nft-economy)
- **Scholarships:**
  - About 55% of players were in the Philippines and 65–70% in Southeast Asia.
  - An estimated 60–65% of about 2.35M owners were scholars.
  - Entry cost was about $350, roughly 40% of the average Philippine monthly salary.
  - D30 retention was 25–30%, which DoF called "the retention rate of a job, not a game."
  — [Deconstructor of Fun](https://www.deconstructoroffun.com/blog/axie-infinity-deconstruction)
- **Scholarship splits and earnings:**
  - YGG's split was 70% scholar, 20% manager, 10% guild.
  - Some managers took 70%.
  - Peak Philippine earnings reached up to $2,000/month. By April 2022, about 30,000 YGG scholars earned about $20/month.
  — [Rest of World](https://restofworld.org/2022/axie-infinity-hack/)
- **Ronin bridge hack:**
  - $620M in ETH and USDC was stolen on Mar 23, 2022 and went unnoticed for six days.
  - Attackers controlled 5 of 9 validators.
  - Sky Mavis raised $150M afterwards.
  — [Rest of World](https://restofworld.org/2022/axie-infinity-hack/)
- **Valuation:** The AXS price-to-sales ratio rose from 0.64 (Jul 2021) to 8.32 (Oct 2021), so speculation outran revenue. — [Deconstructor of Fun](https://www.deconstructoroffun.com/blog/axie-infinity-deconstruction)

### Inferences
- **For Post Time:** If breeding is the main credit sink and also the source of horse supply, the same loop appears. Each credit burned creates a permanent asset that later earns more credits. Horses need their own exit (retirement, death, stud limits) separate from the credit sink.
- Raising the breeding price alone did not slow production in Axie's case. Hard caps (breed count, cooldowns, per-season limits) are more reliable than price levers.
- Axie's collapse depended on outside money buying in. Post Time's credits are never cashed out, which removes the "job" dynamic. Adding USDC markets or USDC prizes would reintroduce it.

### Gaps
- I found no reliable 2023 DAU figures for Axie, and no Axie Origins economy figures. Search results did not cover them.

## Q2. Zed Run: horse supply, paid races, prices, decline, relaunch

### Takeaway
Zed Run was the closest analogue to Post Time: NFT racehorses, breeding, and paid-entry races with 60/25/15 prize pools. Horses never died or aged and had no burn, so supply grew without limit. Revenue relied on breeding fees from new buyers. Paid races were zero-sum: 9 of 12 entrants lost money. Growth stalled in 2021. The game closed on Feb 28, 2025 and was replaced by ZED Champions on Base, with a fixed 4,320-horse racing pool. Old horse NFTs did not carry over, and the community called it a "rug."

### Cited Findings
- **Supply (Dec 2021):**
  - The Genesis cap was 38,000, about 72% released.
  - About 43,300 wallets held horses. The top 500 holders (about 1.2%) held 24%, and the largest held 727.
  - Horses "don't die or lose ability with age… no burn mechanism," so supply kept growing.
  — [Naavik, "ZED RUN: The Need for Greater Horsepower" (Dec 2021)](https://naavik.co/digest/dec-2021-zed-run/)
- **Breeding rules:**
  - Males could breed 3 times a month, females once a month.
  - Minimum stud fees were set by bloodline (80%) and breed type (20%).
  - Public stud fees split 40–56% to the stud owner, 15% to ZED, and the rest to prize pools.
  - At least $14.8M had been spent on stud fees.
  - Breeding spend peaked in Sep 2021, then fell two months running.
  — [Naavik](https://naavik.co/digest/dec-2021-zed-run/)
- **Prices:**
  - The top sale was $158k (May 2021) and at least two horses sold above $100k.
  - The floor was about 0.009 ETH (about $41).
  - Z1 Genesis prices surged in July 2021, leveled off in September, then declined.
  — [Naavik](https://naavik.co/digest/dec-2021-zed-run/)
- **Race economics:**
  - 12-horse fields with a 60/25/15 split for the top three. The rake was cut to zero.
  - Entry fees ranged from about $2 to $500.
  - 9 of 12 entrants lose money in a typical race.
  - A top racer won about $15k across 578 races against about $25k in entry fees.
  - Free races were subsidised up to $20k/day (about $7.2M/yr) from breeding fees.
  - A Netflix-sponsored race had a $3,000 buy-in and a $75k pool, with $39k from ZED.
  — [Naavik](https://naavik.co/digest/dec-2021-zed-run/)
- **Audience (2021):**
  - Daily active owners numbered 8–10k, under 1% of Axie's player count.
  - Over 50% of traffic came from the US.
  - Growth had stalled since Sep 2021.
  - 694k lifetime races had paid $44.8M to players.
  - The company raised $20M in Jul 2021.
  — [Naavik](https://naavik.co/digest/dec-2021-zed-run/)
- **Risks Naavik flagged:**
  - Horse inflation with no sinks.
  - Dependence on the ETH price.
  - Mandatory fee floors that distort the market.
  - Hidden stats and closed servers, so players suspected unannounced algorithm changes.
  - A team-member insider-trading incident (later admitted and compensated).
  - Gambling-like mechanics inviting regulators.
  — [Naavik](https://naavik.co/digest/dec-2021-zed-run/)
- **Naavik's lessons:**
  - Paid racing is zero-sum like poker. It survives only while losing players keep paying, and when they quit, skilled players leave too.
  - Fixes for breeding inflation (odds tweaks, stamina limits) erode trust.
  — [Naavik](https://naavik.co/digest/dec-2021-zed-run/)
- **Sunset:**
  - Zed Run closed on Feb 28 (2025) after "struggles with its community and downwards asset prices."
  - A Sunset Stakes event had a $100k ZED-token pool.
  - Horse NFTs did not carry over and only reward badges transferred. Holders called it a "scam"/"rug."
  — [BlockchainGamer.biz](https://www.blockchaingamer.biz/news/37092/zed-run-discontinued-for-zed-champions/); [NFT Plazas](https://nftplazas.com/zed-run-to-sunset-with-final-event-100k-zed-tokens-up-for-grabs/)
- **ZED Champions:**
  - Launched Apr 28, 2025 on Base with a fixed racing pool of 4,320 horses, which bred foals join.
  - Each horse holds a ZED-token balance and risks a percentage each time it races.
  - Mostly crypto-press and community sources.
  — [Decrypt](https://decrypt.co/316789/ethereum-nft-game-zed-run-reborn-base); [ZED Champions news page](https://zed-champions-5ew.pages.dev/news/breeder-to-champion)
- A clone-script vendor claims ZED Champions "ended its last season in May 2026." This is unverified marketing copy. — [Coinsclone](https://www.coinsclone.com/zed-run-clone-script/)

### Inferences
- **Paid entry with pooled prizes is a wager:** Zed Run's 60/25/15 pool from entry fees is the "fee-funded pool" structure that US law-firm guidance flags as closest to gambling (see Q5). A USDC paid-entry prize race in Post Time would copy this structure.
- **Immortal horses repeat Zed Run's core failure:** Post Time already has retirement, stud, and fatal-injury mechanics. These are the sinks Zed Run lacked, and they should stay meaningful.
- **Value tied to a token or chain is a trust liability:** Asset value pegged to an outside price, plus a relaunch that discarded old assets, destroyed goodwill.

### Gaps
- I found no reliable 2023–2024 user or price data for Zed Run. ZED Champions' current status (late 2026) is unconfirmed.

## Q3. Sorare: real-money skill contests, legally

### Takeaway
Sorare has not settled its legal status in the UK. The UK Gambling Commission investigated from Oct 2021 and charged Sorare in 2024 with providing unlicensed gambling facilities, under ss.33 and 36 of the Gambling Act 2005. Sorare denies the charge, and the trial has been postponed to 7 June 2027. In France, Sorare operates under the JONUM experimental regime (three-year trial, ANJ oversight), which requires KYC, player-set spend and time limits, and reward caps. Commercially it is shrinking: revenue fell from about €143M (2022) to €43M (2024), and 35% of staff were laid off in Nov 2025.

### Cited Findings
- **UK case:**
  - The UKGC charged Sorare under Gambling Act 2005 ss.33(1), (4) and 36(3), (3A) after a roughly three-year investigation.
  - The trial was set for 16 Jun 2025, moved to 15 Jun 2026, then postponed to 7 Jun 2027 at Birmingham Magistrates' Court, with no reason given.
  - Sorare: "We firmly deny any claims that Sorare is a gambling product under U.K. laws."
  — [BlockchainGamer.biz (updated 16 Jun 2026)](https://www.blockchaingamer.biz/news/34595/uk-gambling-commission-charges-sorare/); [Cointelegraph](https://cointelegraph.com/news/sorare-uk-gambling-commission-unlicensed-gambling)
- **UKGC FOI page:** The UKGC publishes an FOI page on its enquiries into Sorare. — [UKGC](https://www.gamblingcommission.gov.uk/about-us/freedomofinformation/enquiries-into-sorare-from-the-gambling-commission)
- **JONUM decree:**
  - France authorised a three-year experimental framework for games with monetisable digital objects (JONUM), reported 25 Feb 2026.
  - **Identity:** Age and identity must be verified, and minors are barred. Users must give birth name, date and place of birth, and address before opening an account.
  - **Limits:** Players must set weekly euro-spend and playtime caps themselves. Raising a cap takes effect after 48 hours, lowering it immediately. Players are warned at 75% of a cap and blocked once it is exceeded.
  - **Self-exclusion:** Players can exclude themselves for 24 hours to 12 months.
  — [SoloAzar (25 Feb 2026)](https://www.soloazar.com/en/category/legislation/france-approves-three-year-trial-decree-for-monetisable-digital-object-games)
- **JONUM reward caps:**
  - Non-cash prizes: up to €1,000 per player, per game, per year.
  - Total crypto rewards: at most 20% of the game's annual revenue.
  - Crypto-linked rewards: at most €25,000 per player per year per game.
  — [SoloAzar](https://www.soloazar.com/en/category/legislation/france-approves-three-year-trial-decree-for-monetisable-digital-object-games)
- **JONUM scope:**
  - Casino-like mechanics are banned, except limited cases such as "fantasy horse racing formats."
  - Six categories are allowed: action, fantasy sports, adventure, racing, breeding, management.
  - Crypto transactions must be logged at their euro value.
  — [SoloAzar](https://www.soloazar.com/en/category/legislation/france-approves-three-year-trial-decree-for-monetisable-digital-object-games)
- **Underlying law:** The JONUM experiment comes from the 2023–24 SREN digital law debates and was set at three years. Amendments to shorten it failed. — [Assemblée nationale debate record](https://www.assemblee-nationale.fr/dyn/16/comptes-rendus/espnum/l16espnum2223002_compte-rendu.pdf)
- **ANJ receipts:**
  - Sorare Pro got receipt 2026-02 (filed 31 Mar 2026). Sorare got receipt 2026-04 (filed 2 Oct 2026).
  - As of 8 Oct 2026 there were four JONUM offerings: CyLimit, Sorare Pro, MFL, Sorare.
  - The ANJ says a receipt "does not determine whether the offering complies with all applicable laws."
  - Sorare says joining JONUM is not an admission that it runs gambling.
  — [15m.com](https://15m.com/news/sorare-appears-twice-in-frances-jonum-register-after-new-anj-filing/)
- **KYC:**
  - Identity verification (via Mangopay, an EU e-money institution) is required for JONUM competitions and their rewards, and it enforces 18+.
  - Unverified accounts have crypto and card rewards held, and these may be lost after 30 days.
  - Verification is triggered for players located in France who enter Sorare Pro.
  — [Sorare Help: Identity Verification](https://help.sorare.com/hc/en-us/articles/35396884763549-Identity-Verification); [Sorare Help: Account Verification](https://help.sorare.com/hc/en-us/articles/35396788841629-Account-Verification)
- **Revenue:** About €143M (2022), €59M (2023), €43M (2024). — [ReadWrite](https://readwrite.com/nft-sports-card-collecting-and-betting-platform-sorare-reportedly-on-the-verge-of-collapse/)
- **Layoffs:**
  - 13% in Mar 2024. — [TechCrunch](https://techcrunch.com/2024/03/06/nft-fantasy-sports-startup-sorare-layoffs-web3-gaming/)
  - About 35% of roughly 100 staff in Nov 2025, with a profitability target for 2026. Active cardholders reportedly rose 33% to 378k. — [Crypto Times](https://www.cryptotimes.io/2025/11/21/sorare-lays-off-35-of-staff-cto-steps-back-as-nft-boom-fades/)
- **Monthly sales (2025):** Fell to about $2.7M in Jun 2025, then rebounded past $20M in Aug 2025, attributed to reintroducing "Hot Streaks." — [Sporting Crypto newsletter](https://newsletter.sportingcrypto.com/p/sorare-s-2025-strategy)

### Inferences
- A well-funded unicorn with counsel spent more than five years in an unresolved UK prosecution. A solo or indie project offering paid-entry crypto prizes to UK players would carry serious exposure.
- **JONUM shows the real-money compliance burden:** KYC before payout, player-set limits, self-exclusion, and reward caps. A free-entry, sponsor-funded giveaway avoids almost all of it.

### Gaps
- I could not confirm Sorare's current excluded-country list (including US status) or exact prize structures from primary sources.
- The JONUM law article number and decree date are unconfirmed. Secondary sources only.

## Q4. Long-lived game economies and how breeding games avoid infinite supply

### Takeaway
Durable economies treat money supply as something to measure and manage:
- **EVE Online:** CCP has published Monthly Economic Reports with faucet and sink breakdowns since at least 2016, plus raw CSVs.
- **Old School RuneScape:** A Grand Exchange transaction tax funds an automated item sink that buys and deletes oversupplied high-end items.
- **Hattrick:** The operator tunes income to keep the economy "not over-heated… not starving," with age-linked wages and bankruptcy as sinks.
- **Path of Exile:** Periodic league resets wipe the economy entirely.

For breeding games, the reliable anti-inflation tools are hard breeding caps, ageing and retirement, mortality, and fixed racing pools. Raising the breeding price alone did not work (see Q1).

### Cited Findings
- **EVE Online:**
  - CCP's MERs track CPI, ISK sinks and faucets, regional trade balances and more, built from monthly queries on the main database. — [MassivelyOP](https://massivelyop.com/?p=50267)
  - The Feb 2021 MER broke sinks and faucets into finer categories and added a three-year CSV. — [EVE forums, MER Feb 2021](https://forums.eveonline.com/t/monthly-economic-report-february-2021/302188)
  - CCP's Aug 2026 MER post (9 Sep 2026) highlights Mining Value, the Mineral Price Index, and the Module Price Index (down about 4% month on month). It notes about 9,000 ships destroyed in the month's largest battle. Ship destruction is EVE's main item sink. — [EVE forums, MER Aug 2026](https://forums.eveonline.com/t/monthly-economic-report-august-2026/517992.md)
  - Community commenters noted high ISK supply with falling velocity (not CCP data). — same thread
- **OSRS Grand Exchange tax and item sink (9 Dec 2021):**
  - The tax was 1% per item sold, with items under 100 GP exempt and a cap of 5M GP per item.
  - New-player tools and bonds were exempt.
  - Part of the tax goes to a coffer that automatically buys specific high-value items at market price and deletes them, subject to daily quotas.
  - Jagex picks the items based on estimated daily inflow and the reduction it wants.
  - Stated goal: "will help with inflation."
  — [OSRS Wiki, Update: Grand Exchange Tax & Item Sink](https://oldschool.runescape.wiki/w/Update:Grand_Exchange_Tax_%26_Item_Sink)
- **OSRS later changes and scale:**
  - Since Jan 2023 the tax is 2% on items worth 50 coins or more. — [RuneScape Wiki, Money sinks](https://runescape.wiki/w/Money_Sinks)
  - Shortly after launch Jagex reported about 30B GP sunk per day. — [Prima Games](https://primagames.com/?p=316476)
  - An academic study found the tax did not meaningfully reduce trading volume at the tax boundaries, but the item sink contributed to luxury-good price inflation. — [arXiv 2210.07970](https://arxiv.org/pdf/2210.07970.pdf)
- **Hattrick:**
  - Wages are a weekly sink: $250 base plus an amount based on skill and age, with 20% extra for foreign players.
  - A debt of $500k triggers a bankruptcy warning, and teams not recovered within two weeks are removed.
  — [Hattrick rules: Economy](https://en-us.hattrick.org/Help/Rules/Economy.aspx)
  - Operator statements (2004–2007, via community archives) say the goal is "a global economy that is not over-heated… must not be starving." They focus on money per team rather than transfer prices, and in 2007 they noted money "leaking out" alongside a stalling transfer market and bankruptcies. — [FOFC forum archive](https://forums.operationsports.com/fofc/archive/index.php/t-59617.html) (secondary; dated)
- **Path of Exile:**
  - Each new league starts everyone with no items or currency, creating a fresh economy. Old characters move to Standard.
  - Resets keep players from stockpiling currency to buy each new item.
  — [ExitLag guide](https://www.exitlag.com/blog/path-of-exile-new-league/); [Game-Wisdom](https://game-wisdom.com/general/design-philosophy-behind-poe-2s-seasonal-model-resetting-everything-works) (secondary)
  - A late-2025/2026 league set a concurrent-player record. — [PC Gamer](https://www.pcgamer.com/games/rpg/new-path-of-exile-league-crushes-concurrent-player-record-introduces-city-builder-mode-shakes-up-the-metagame)
- **Umamusume:** Has no player market. A trained horse girl retires as a "veteran" whose "sparks"/legacies feed into future runs, so power carries forward through inheritance, not trading. — [Giant Bomb](https://www.giantbomb.com/games/3030-67586/); [Deltia's Gaming](https://deltiasgaming.com/?p=282639)
- **Umamusume revenue:** AppMagic estimates nearly $1.9B since 2021, at $177.64 per download in Japan and $11.68 outside Japan. — [Mobilegamer.biz](https://mobilegamer.biz/cult-horse-girl-game-umamusume-pretty-derby-is-galloping-up-the-charts/)
- **Breeding-supply controls observed:**
  - Axie: breeding cap of 7, then sterile. — [Axie support](https://support.axieinfinity.com/hc/en-us/articles/7225771030555)
  - Zed Run: monthly breeding cooldowns, but immortal horses meant supply still inflated. — [Naavik](https://naavik.co/digest/dec-2021-zed-run/)
  - ZED Champions: fixed 4,320 racing pool. — [Decrypt](https://decrypt.co/316789/ethereum-nft-game-zed-run-reborn-base)
  - DoF on Axie: without permanent removal, the "population only grows and breeding demand falls." — [Deconstructor of Fun](https://www.deconstructoroffun.com/blog/axie-infinity-deconstruction)

### Inferences
- **For Post Time, a design template:**
  1. **Measure:** Publish an internal or public "monthly economic report" with credits minted by source, credits burned by sink, horses born, and horses removed (retired, dead, gelded or exported).
  2. **Sinks:** Use a transaction tax on player-to-player horse sales and a sink that buys and retires surplus horses (OSRS-style "horse retirement home"), plus wages and upkeep (Hattrick-style).
  3. **Breeding:** Use hard limits per mare per season and per stallion, and ageing out.
  4. **Seasons:** Consider seasonal ladders whose prestige resets even if horses persist (a softer PoE-style reset).
- Breeding creates new value, so horse supply has to be matched by horse exits, not only credit sinks.
- **Power creep:** Rising stats across generations need regression to the mean or a caste/grade-based race structure. Otherwise new foals obsolete old stock, which is the Zed Run dynamic of demand concentrating in elite bloodlines.
- **Correction to the brief:** Pokémon does allow player-to-player trades, but has no currency marketplace. "No trading" is accurate for Umamusume. This is my knowledge, not sourced here.

### Gaps
- I did not retrieve absolute ISK faucet and sink figures from a recent MER. The figures are in CCP's CSV downloads, which I did not fetch.
- No current source on Hattrick player ageing and wage escalation specifics.
- No official GGG statement on PoE league-reset rationale.
- No developer source on Umamusume's design intent.

## Q5. Real-money legal landscape (US, UK and EU, tax, KYC). Not legal advice.

### Takeaway
A promotion is an illegal lottery if it has prize, chance and consideration together. Removing any one element is the usual path:
- **Remove consideration:** free entry, or a sweepstakes with a free alternative method of entry.
- **Remove chance:** a genuine skill contest.

US states use different tests: dominant factor (most states), material element (e.g. NY), and any chance. Several states restrict paid-entry skill contests: real-money platforms like Skillz geo-block about 5–12 states. Prizes set in advance and funded by a non-competing sponsor are far safer than pools built from entry fees.

Other key points:
- **US registration and bonding:** Sweepstakes over $5,000 in total prizes need registration and bonding in NY and FL.
- **US tax reporting:** From 2026, the US 1099-MISC prize reporting threshold is $2,000, not $600.
- **UK:** Loot boxes are under industry self-regulation, but Sorare is being prosecuted.
- **Belgium:** Treats paid loot boxes as gambling.
- **Netherlands and Austria:** Their top courts did not treat loot boxes as gambling.

### Cited Findings
- **Three US tests:**
  - **Dominant factor:** Illinois (*Dew-Becker v. Wu*) and California (*In re Allen*).
  - **Material element:** NY Penal Law 225.00, "material degree" of chance, even if skill matters. Mississippi and Missouri are also cited.
  - **Any chance:** The most restrictive.
  — [Fasthoff Law, 3 Jul 2026](https://fasthofflawfirm.com/blog/skill-contests-versus-sweepstakes-entry-fees); [Wikipedia: Dominant Factor Test](https://en.wikipedia.org/wiki/Dominant_Factor_Test)
- **Fee-funded vs sponsor-funded prizes:**
  - A guaranteed sponsor-funded prize that does not depend on entry volume differs from a pool built from participants' fees. Fee-funded pools "more closely resemble wagers."
  - *State v. American Holiday Ass'n* (Ariz. 1986): fees paid to a non-competing sponsor for guaranteed prizes were not bets.
  - *White v. Cuomo* (N.Y. 2022) supported predetermined prizes from a neutral operator.
  - Best practice: guarantee each prize before entries open and call the payment an "entry fee," not a pot or stake.
  — [Fasthoff Law](https://fasthofflawfirm.com/blog/skill-contests-versus-sweepstakes-entry-fees)
- **Random steps and judging:**
  - A random draw among top scorers adds chance and triggers sweepstakes analysis and a free entry route.
  - Rules must define the skill tested and the scoring, and keep records.
  - California Bus. & Prof. Code 17539.1–.3 requires disclosures and two years of records.
  - Arizona A.R.S. 13-3301/3311 has a narrow intellectual-contest exception with advance registration and a winner report within 10 days.
  - Louisiana R.S. 14:90 defines gambling with no stated chance element.
  — [Fasthoff Law](https://fasthofflawfirm.com/blog/skill-contests-versus-sweepstakes-entry-fees)
- **Florida:** Bans wagering on skill contests, but courts allowed skill games where the prize is not made of entry fees, does not vary with fees, is not competed for by the operator, and is announced in advance. Walters says no reliable list of permissive states exists. — [Walters Law Group (2021)](https://www.firstamendment.com/list-states-skill-gaming-allowed-prohibited/)
- **Skillz restricted states (practical benchmark):** Lists vary by app.
  - App-store listings: AZ, AR, CT, DE, (FL), (IN), LA, (ME), MT, SC, SD, TN.
  - A Skillz support page lists AR, CT, DE, LA, SD.
  - An Apr 2026 terms review adds VT.
  — [Apple App Store, Spades Cash](https://apps.apple.com/us/app/id6452588929); [terms.law review](https://terms.law/Terms-Scanner/app/gaming/skills-based-platforms/skillz/)
- **Sweepstakes basics:**
  - Prize + chance + consideration is an illegal lottery, and a free alternative method of entry removes consideration.
  - Federal mail rules require "no purchase necessary" and "purchase will not improve chances" disclosures.
  — [Snipp](https://www.snipp.com/blog/quick-guide-to-sweepstakes-laws-and-rules); [Revision Legal](https://revisionlegal.com/internet-law/online-contest-laws-business-compliance/)
- **NY and FL registration:**
  - Both require registration and bonding (bond or trust account equal to total prize value) when total prizes exceed $5,000.
  - NY files 30 days before launch. FL files 7 days before and needs a certified winners list afterwards.
  - Sources conflict on FL's scope and on the NY filing office.
  — [Fasthoff Law](https://fasthofflawfirm.com/blog/sweepstakes-state-registration-bonding); [RallyUp](https://rallyup.com/learn/understand-sweepstakes-registration-and-bonding-2/)
- **US tax reporting:**
  - The One Big Beautiful Bill Act (P.L. 119-21, §70433) raised the 1099-MISC prize threshold from $600 to $2,000 for payments after 31 Dec 2025. It is indexed for inflation from 2027.
  - Multiple prizes to the same winner in a year are aggregated.
  - Below $2,000, sponsors generally need not collect SSNs or issue 1099-MISC. Prizes remain taxable income for the winner.
  — [Reed Smith](https://www.reedsmith.com/our-insights/blogs/viewpoints/102ku4y/one-big-beautiful-bill-act-could-mean-more-valuable-prizes/); [Verrill](https://www.verrill-law.com/blog/the-new-2000-threshold-for-sending-irs-form-1099-misc-to-prize-winners/); [JD Supra](https://www.jdsupra.com/legalnews/new-prize-tax-rules-raise-the-1099-3805861/)
- **UK loot boxes:**
  - Jul 2022: the government declined to legislate, saying it was "premature" and opting for industry-led protections. The Gambling Commission's position was that the Act does not cover loot boxes.
  - Jul 2023: Ukie published 11 industry principles, to be reviewed after 12 months.
  — [Lewis Silkin (Jul 2022)](https://www.lewissilkin.com/en/insights/2022/07/27/loot-boxes-to-avoid-regulation-following-uk-governments-response-to-call-for-evi-102htqp); [CMS](https://cms.law/en/gbr/legal-updates/loot-boxes-11-new-principles-for-an-industry-led-approach)
- **Belgium:** In 2018 the Gaming Commission declared paid loot boxes (Overwatch, FIFA 18, CS:GO) illegal gambling under existing law, and developers removed paid loot boxes there. A 2026 article says enforcement remains limited. — [Gambling Insider](https://www.gamblinginsider.com/news/5801/games-developers-remove-paid-loot-boxes-in-belgium); [Casino.org](https://casino.org/news/belgium-joins-the-netherlands-in-declaring-loot-boxes-to-be-illegal-gambling)
- **Netherlands:** The KSA fined EA €10M over FIFA packs. The Council of State (Mar 2022) overturned it, finding the packs were not gambling. Politicians then pushed for a ban. — [PC Gamer](https://pcgamer.com/the-netherlands-moves-toward-an-outright-loot-box-ban)
- **Austria:** The Supreme Court (Dec 2025) held that loot boxes embedded in skill-based games fall outside gambling regulation. — [Esports Legal News (Jan 2026)](https://esportslegal.news/2026/01/28/austrian-supreme-court-loot-boxes/)
- **UK paid-entry crypto competitions:** The Sorare prosecution under the Gambling Act 2005 (see Q3) is the live UK precedent risk.

### Inferences
- **USDC paid-entry races where entry fees form the prize pool:** Fee-funded pool plus a race outcome with any randomness puts this in the riskiest category. It would likely be treated as wagering under material-element or any-chance tests, and it creates UK Gambling Act exposure (cf. Sorare).
  - Post Time races presumably include RNG, so "skill predominates" would be hard to prove.
- **USDC horse markets:** These turn horses into cashable assets, which undermines the "credits never cashed out" premise.
  - Paid premium packs whose horses can be resold for USDC would turn randomised packs into a Belgium-style gambling product ("something of value" from chance, cashable).
  - This conflicts with the project's own economy rules (the `web3-game-economy` skill states "Stable Credits never cashed out, no prize money, no gambling mechanics").
- **The $1,000 giveaway:** Under the $5,000 NY/FL registration threshold and, per winner, under the $2,000 1099-MISC threshold. If free to enter and sponsor-funded, it is the lowest-risk structure.

### Gaps
- No authoritative, current state-by-state list of paid-skill-contest legality. Sources say none exists, so the Skillz lists are a practical proxy.
- No primary IRS document fetched; law-firm summaries only.
- Money-transmission and stablecoin rules for USDC payouts were not researched.

## Q6. Best practices for a small ($1,000) prize pool

### Takeaway
Run it as a free-to-enter, operator-funded, pre-announced skill leaderboard, or as a sweepstakes with a free alternative entry if any random draw is used. Publish official rules covering:
- eligibility (age 18+, excluded jurisdictions, one account per person, employee exclusion)
- scoring and tie-breaks
- prize amounts set before launch

Expect farming: the airdrop literature shows giveaways draw multi-account farmers and most recipients leave right after collecting. Gate eligibility on sustained, verified participation, and verify identity only for winners at payout.

### Cited Findings
- **Fixed, guaranteed prizes:** Prizes should be fixed, guaranteed before entries open, and independent of entry volume. A random draw among top scorers needs sweepstakes treatment and a free entry route. — [Fasthoff Law](https://fasthofflawfirm.com/blog/skill-contests-versus-sweepstakes-entry-fees)
- **Voting and leaderboards:** Rules should address manipulation (bots, purchased votes, coordinated voting), set limits, describe responses to manipulation, and use a skill-based tie-breaker. Keep score sheets and disqualification records. — [Fasthoff Law](https://fasthofflawfirm.com/blog/skill-contests-versus-sweepstakes-entry-fees)
- **Zed Run's 60/25/15 split:** A widely used three-place split in racing communities. The $3,000-buy-in Netflix race shows sponsor co-funding ($39k of a $75k pool). — [Naavik](https://naavik.co/digest/dec-2021-zed-run/)
- **Airdrop farming:**
  - 87%, 77% and 73% of eligible accounts claimed on day one (Arkham, Lido, Arbitrum).
  - 48–66% of tokens went straight to exchanges for Optimism, 1inch and Lido.
  - The median recipient made 1 transfer, with 0 days between first and last activity for most protocols.
  - One wallet captured 11.66% of the 1inch airdrop.
  - One ZKsync farmer reportedly used over 20,000 accounts.
  — [Messias, Yaish & Livshits, "Airdrops: Giving Money Away Is Harder Than It Seems" (arXiv 2312.02752)](https://arxiv.org/html/2312.02752v4)
- **Anti-sybil trade-off:** Time-investment and staged hurdles reduce sybils but drive away casual users. — [TechFlow](https://www.techflowpost.com/en-US/article/20762) (industry commentary)
- **Axie as a warning:** Earn-motivated audiences retain like a job: 25–30% D30. — [Deconstructor of Fun](https://www.deconstructoroffun.com/blog/axie-infinity-deconstruction)
- **KYC at payout:** Sorare and JONUM verify identity before releasing rewards and hold rewards for unverified accounts. This is a template for "KYC only the winners." — [Sorare Help](https://help.sorare.com/hc/en-us/articles/35396884763549-Identity-Verification)
- **Tax paperwork:** Under the $2,000 1099 threshold per winner per year, no SSN or 1099 is generally needed. Prizes remain taxable for winners. — [Reed Smith](https://www.reedsmith.com/our-insights/blogs/viewpoints/102ku4y/one-big-beautiful-bill-act-could-mean-more-valuable-prizes/)

### Inferences
- **Suggested structure for $1,000:**
  - **Timing:** Free entry; a season-long ladder, not a single race, so outcomes reflect sustained stable management rather than one random result.
  - **Prizes:** Pre-announced, sponsor-funded by the owner, for example 1st $400 / 2nd $250 / 3rd $150 / 4th–8th $40 each. Spreading prizes across more places widens the motivated cohort while keeping each prize well under $2,000.
  - **Eligibility:** 18+; exclude jurisdictions where sweepstakes or contests are restricted (commonly Quebec historically, and states flagged above if any chance element exists); one account per person and household; employee exclusion.
  - **Anti-multi-account:** Account age and activity minimums before the season (for example, active N days and M races); verified email or phone; device and IP heuristics; winner-only ID check before payout; right to disqualify; published tie-breaker.
  - **Payout:** In fiat or gift cards rather than USDC, avoiding wallet onboarding friction and crypto-specific regulation. Keep prize credits separate from Stable Credits so credits stay non-cashable.
  - **Avoid** tying prizes to paid packs (consideration) or awarding them by random draw without a free entry route.
- **Acquisition vs retention:** Giveaways attract farmers, so measure success on retention after the season (D30 of entrants), not sign-ups. Reward breadth of participation (milestones) rather than only the top slot, and gate prizes on in-game behaviour bots find costly.

### Gaps
- I found no reliable data on payout splits or retention outcomes for small (under $5k) indie-game community tournaments specifically.
- The anti-sybil evidence comes from crypto airdrops, not traditional web games.
- Canadian (Quebec, skill-testing question) rules and EU consumer-promotion rules were not researched.
