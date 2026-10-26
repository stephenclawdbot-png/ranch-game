/**
 * Project Thoroughbred economy audit simulation.
 *
 *   pnpm exec tsx tools/economy-sim/main.ts            # full run (~1-2 min), writes docs/economy/results/
 *   pnpm exec tsx tools/economy-sim/main.ts --quick    # fewer seeds, same tables (smoke test)
 *   pnpm exec tsx tools/economy-sim/main.ts --only=pool_beta,affiliates
 *
 * Deterministic: fixed seed strings, so a rerun prints the same tables.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AFFILIATE, BETA, CONTRACT, GAME, POOL_RULES, checkSync, gc } from "./lib/constants.ts";
import { RESULTS_DIR, Report, fmt, pct, usd } from "./lib/out.ts";
import { calibrate, expectedPurseShare, sigma, winProbability } from "./lib/race.ts";
import { mean } from "./lib/rng.ts";
import { AFF_CONFIGS, marginalReturn, ownerTake, splitRows, washCases } from "./models/affiliates.ts";
import { ARCHETYPES, multiAccount, oneOffSinkCapacity, setGoalsImplemented, summarise, type ArchetypeSummary } from "./models/credits.ts";
import { CURRENT_SPLIT, DEFAULT_SEASON, LEVER_SETS, gasUsd, seasonModel } from "./models/money.ts";
import { DEFAULT_PITY, crossCheck, packValue, pityStats } from "./models/packs.ts";
import { defaultPoolConfig, summarisePool, type PoolSimConfig, type PoolSummary } from "./models/pool.ts";
import type { ArchKey } from "./models/testers.ts";
import { runPopulationSim, DEFAULT_SIM } from "../../packages/game-core/src/sim/population.ts";

const args = process.argv.slice(2);
const QUICK = args.includes("--quick");
const ONLY = args.find((a) => a.startsWith("--only="))?.slice(7).split(",") ?? null;
const want = (name: string) => !ONLY || ONLY.includes(name);
const SEEDS = { credits: QUICK ? 6 : 40, beta: QUICK ? 40 : 400, season: QUICK ? 20 : 150, sens: QUICK ? 15 : 120 };
const ETH_USD = 3000;
const summary: Record<string, unknown> = { generatedWith: { seeds: SEEDS, ethUsd: ETH_USD } };

const errors = checkSync();
if (errors.length) {
  console.error("Mirrored constants are out of sync with the code:\n - " + errors.join("\n - "));
  process.exit(1);
}
const t0 = Date.now();
const SIGMA = calibrate();
console.log(`race-noise sigma calibrated: ${SIGMA} rating points`);

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

const credit: Record<string, ArchetypeSummary> = {};
for (const a of ARCHETYPES) credit[a.key] = summarise(a, SEEDS.credits);
const liveStarts = Object.fromEntries(ARCHETYPES.map((a) => [a.key, credit[a.key]!.weeks.map((w) => w.live)])) as Record<ArchKey, number[]>;

if (want("credits")) {
  const r = new Report("credits", "Stable Credits: faucets, sinks and archetype flows", "28-day day-by-day model per archetype with the real game-core constants; Monte Carlo over race results (`" + SEEDS.credits + "` runs each). See `tools/economy-sim/models/credits.ts` for the behaviour rules.");
  r.h2("Faucets and sinks in code");
  r.table(
    ["Item", "Constant (code)", "Kind", "Notes"],
    [
      ["Starter grant", fmt(GAME.starterGrant), "faucet", "once (docs/balance.md still says 5,000)"],
      ["Live purses", `maiden ${fmt(GAME.purse.maiden)}, novice ${fmt(GAME.purse.novice)}, quick ${fmt(GAME.purse.quick)}, hcp ${fmt(GAME.purse.hcp_0_55)}/${fmt(GAME.purse.hcp_50_75)}/${fmt(GAME.purse.hcp_70_95)}, listed ${fmt(GAME.purse.listed)}, G3/G2/G1 ${fmt(GAME.purse.g3)}/${fmt(GAME.purse.g2)}/${fmt(GAME.purse.g1)}`, "faucet", "split 55/20/12/7/4/2; ~10% of the purse per runner at par"],
      ["Weekend Feature / Season Final", `${fmt(GAME.weekendFeaturePurse)} / ${fmt(GAME.seasonFinalPurse)}`, "faucet", "licence 4"],
      ["Story first wins", Object.entries(GAME.storyFirstWin).map(([k, v]) => `${k} ${fmt(v)}`).join(", "), "faucet", "6 races/chapter = 24,000 total"],
      ["Story replays / chapter caps", `${GAME.storyReplay} / ${Object.values(GAME.storyCap).map((v) => fmt(v)).join(", ")}`, "faucet", "40,000 lifetime per account; every story race costs a career start"],
      ["Daily Cup participation", fmt(GAME.dailyCupCredits), "faucet", "per day"],
      ["Daily goals", `${GAME.dailyGoalsPerDay} x ${GAME.dailyGoalCredits}`, "faucet", "**defined in game-core, never paid by the server**"],
      ["Referral activation", fmt(AFFILIATE.activeRewardCredits), "faucet", "per invitee with 5 races + 3 play days (story races count)"],
      ["Insurance payout", `${GAME.insurancePayoutPermille / 10}% of appraisal`, "faucet", `premium ${GAME.insurancePremiumPermille / 10}% once`],
      ["Release to Club", fmt(GAME.releaseCredits), "faucet", "per horse"],
      ["Training", Object.values(GAME.workouts).map((w) => w.cost).filter((x) => x > 0).join("/"), "sink", "per session; 3 slots per horse per day (+1 with trainer)"],
      ["Entry fees", `listed ${GAME.entryFee.listed}, G3 ${GAME.entryFee.g3}, G2 ${GAME.entryFee.g2}, G1 ${GAME.entryFee.g1}`, "sink", ""],
      ["Entry refill", `${GAME.entryRefillCost} for +${GAME.entryRefillAmount}`, "sink", "once a day, bank < 5"],
      ["Entry tiers", GAME.entryTierCost.map((x) => fmt(x)).join(" / "), "sink", "one-off"],
      ["Stalls 7..24", `2,000 + 400 x (n - 7) = ${fmt(oneOffSinkCapacity().stalls)} total`, "sink", "one-off"],
      ["Trainer / vet", `${GAME.facility.trainer.join(" / ")} ; ${GAME.facility.vet.join(" / ")}`, "sink", "one-off"],
      ["Paddock Pack", fmt(GAME.paddockPrice), "sink", `<= ${GAME.paddockBuysPerWeek}/week`],
      ["Breeding", `${fmt(GAME.breedingBaseFee)} base + stud fee (10% burned)`, "sink", "1 covering per mare per season"],
      ["Scan / vet", `${GAME.scan} / ${GAME.vet}`, "sink", ""],
      ["Market fee", `${GAME.marketFeePermille / 10}% burned`, "sink", `floor ${GAME.listingFloorPermille / 10}% of appraisal, **no price ceiling**`],
    ],
  );
  r.h2("Weekly flow by archetype (mean of runs)");
  const rows: (string | number)[][] = [];
  for (const a of ARCHETYPES) {
    const s = credit[a.key]!;
    s.weeks.forEach((w, i) => rows.push([i === 0 ? a.label : "", `W${i + 1}`, fmt(w.faucet), fmt(w.sink), fmt(w.net), fmt(w.balance), fmt(w.live, 1), fmt(w.story, 1), fmt(w.racers, 1)]));
  }
  r.table(["Archetype", "Week", "Faucets", "Sinks", "Net", "Balance (end)", "Live starts", "Story starts", "Racers at week end"], rows);
  r.h2("28-day totals: where credits come from and go");
  r.table(
    ["Archetype", "Starter", "Purses", "Story", "Cup", "Training", "Entry fees+refills", "Packs", "Stalls+facilities", "Breeding+scans", "Spend/earn ratio", "Story chapters done", "No racer left (first day)", "Days with no racer"],
    ARCHETYPES.map((a) => {
      const s = credit[a.key]!;
      const f = s.faucetMix;
      const k = s.sinkMix;
      const earned = Object.values(f).reduce((x, y) => x + y, 0);
      const spent = Object.values(k).reduce((x, y) => x + y, 0);
      return [a.label, fmt(f.starter!), fmt(f.purses!), fmt(f.story!), fmt(f.cup!), fmt(k.training!), fmt(k.entryFees! + k.refills!), fmt(k.paddock!), fmt(k.stalls! + k.facilities!), fmt(k.breeding! + k.scans!), (spent / earned).toFixed(2), fmt(s.chapters, 1), s.careerEndDay === null ? "-" : `day ${s.careerEndDay + 1}`, fmt(s.droughtDays, 1)];
    }),
  );
  setGoalsImplemented(true);
  const withGoals = summarise(ARCHETYPES.find((a) => a.key === "engaged")!, SEEDS.credits);
  setGoalsImplemented(false);
  const eng = credit.engaged!;
  const ratio = (s: ArchetypeSummary) => Object.values(s.sinkMix).reduce((x, y) => x + y, 0) / Object.values(s.faucetMix).reduce((x, y) => x + y, 0);
  r.h2("Daily goals: documented faucet that is not paid");
  r.table(
    ["Engaged player, 28 days", "Faucets", "Sinks", "Ratio"],
    [
      ["As implemented (no goals)", fmt(Object.values(eng.faucetMix).reduce((x, y) => x + y, 0)), fmt(Object.values(eng.sinkMix).reduce((x, y) => x + y, 0)), ratio(eng).toFixed(2)],
      ["If 3 x 120 goals were paid daily", fmt(Object.values(withGoals.faucetMix).reduce((x, y) => x + y, 0)), fmt(Object.values(withGoals.sinkMix).reduce((x, y) => x + y, 0)), ratio(withGoals).toFixed(2)],
    ],
  );
  r.h2("Multi-account attempt (alts play Story + Cup, then buy the main's junk horse at an inflated price)");
  r.table(
    ["Alts", "Credits per alt after 14 days", "Moved to main (after 5% burn)", "+ referral rewards", "vs an engaged player's 28-day faucets"],
    [1, 2, 3, 5].map((k) => {
      const m = multiAccount(k, SEEDS.credits);
      const engTotal = Object.values(eng.faucetMix).reduce((x, y) => x + y, 0);
      return [k, fmt(m.perAlt14), fmt(m.total), fmt(m.referralRewards), pct((m.total + m.referralRewards) / engTotal, 0)];
    }),
  );
  const cap = oneOffSinkCapacity();
  const grinderNet = mean(credit.grinder!.weeks.map((w) => w.faucet));
  r.h2("Sink saturation");
  r.table(
    ["One-off sink", "Credits"],
    [
      ["Stalls 7..24", fmt(cap.stalls)],
      ["Trainer levels", fmt(cap.trainer)],
      ["Vet levels", fmt(cap.vet)],
      ["Entry tiers", fmt(cap.entry)],
      ["Total", fmt(cap.total)],
      ["Weeks of a grinder's gross faucet to exhaust them", fmt(cap.total / grinderNet, 1)],
    ],
  );
  // Insurance EV.
  const ceBase = (GAME.insurancePremiumPermille / 1000) as number;
  const perStartBase = 0.004 * 0.03;
  const perStartAbuse = 0.06 * 0.08;
  r.h2("Insurance");
  r.table(
    ["Case", "Career-ending chance per start", "Over 40 starts", "Payout x P vs premium (5%)"],
    [
      ["Baseline (fresh, normal ride, good going)", pct(perStartBase, 3), pct(1 - Math.pow(1 - perStartBase, 40), 2), `${pct(0.6 * (1 - Math.pow(1 - perStartBase, 40)), 2)} vs ${pct(ceBase, 0)}`],
      ["Abuse: tired + all-out + 3rd start of the day + heavy, veteran", pct(perStartAbuse, 2), pct(1 - Math.pow(1 - perStartAbuse, 12), 1) + " (last 12 starts)", `${pct(0.6 * (1 - Math.pow(1 - perStartAbuse, 12)), 1)} of a (higher) late-career appraisal vs ${pct(ceBase, 0)} of an early one`],
    ],
  );
  const path = r.write();
  summary.credits = Object.fromEntries(ARCHETYPES.map((a) => [a.key, { weeks: credit[a.key]!.weeks, ratio: ratio(credit[a.key]!), careerEndDay: credit[a.key]!.careerEndDay }]));
  console.log("wrote", path);
}

// ---------------------------------------------------------------------------
// Population (game-core's own Monte Carlo at beta scale)
// ---------------------------------------------------------------------------

const pv = packValue(QUICK ? 150 : 600);
if (want("population")) {
  const pop = runPopulationSim({ ...DEFAULT_SIM, players: 50, seasons: 3, seed: "econ-pop-50", joinPermillePerSeason: 0 });
  const r = new Report("population", "Horse population at beta scale (game-core population Monte Carlo)", "`runPopulationSim` from `packages/game-core/src/sim/population.ts` with 50 players, 3 seasons, no new joiners (all real rules: packs, care-gated growth, 40-start careers, 4 breedings, 1 covering per mare per season, kin blocks, stalls 6 -> 24, Legacy Farm, release to Club).");
  r.table(
    ["Season", "Active horses/player (max)", "Legacy Farm/player", "Released (cum.)", "Foals bred (cum.)", "Pack foals (cum.)", "Top-1% mean potential", "Best (gen)", "Population mean", "Best Premium foal possible (ceiling)"],
    pop.rows.map((x) => [x.season, `${x.activePerPlayer} (${x.maxActive})`, x.legacyPerPlayer, x.releasedTotal, x.foalsBred, x.packFoals, x.top1Mean, `${x.bestMean} (g${x.bestGeneration})`, x.popMean, `<= ${gc.meanCeiling(x.season)}`]),
  );
  r.p(
    `New horses per player per season: ${fmt((pop.rows[2]!.foalsBred + pop.rows[2]!.packFoals) / 50 / 3, 1)} (bred + pack). Exits: none are destroyed. Active horses are bounded by stalls (max ${GAME.maxStalls} + 1 nursery); everything else accumulates on the Legacy Farm (unbounded, no stall) or goes to the Club. The real sink is the stall cap, not retirement.`,
  );
  r.p(`Premium Pack value (real mint, ${QUICK ? 150 : 600} pulls): mean potential ${fmt(pv.premiumMean, 1)} (max ${fmt(pv.premiumMax)}); Paddock ${fmt(pv.paddockMean, 1)}; a starter ${fmt(pv.starterMean, 1)}; the best of a stable's 3 starters ${fmt(pv.bestStarterMean, 1)}.`);
  r.write();
  summary.population = pop.rows;
}

// ---------------------------------------------------------------------------
// Packs: odds, pity, value
// ---------------------------------------------------------------------------

if (want("packs")) {
  const r = new Report("packs", "Premium Pack odds, pity and value");
  const cc = crossCheck(QUICK ? 600 : 3000);
  r.h2("Cross-check: fast pity model vs real gc.pullPack");
  r.table(
    ["Rarity", "Published", "gc.pullPack observed", "Sim model"],
    ["common", "uncommon", "rare", "epic", "legendary"].map((k) => [k, pct((GAME.packOdds.premium as Record<string, number>)[k]! / 10_000, 2), pct(cc.realRates[k] ?? 0, 2), pct((cc.fastRates as Record<string, number>)[k] ?? 0, 2)]),
  );
  r.h2("Pity configurations");
  const cfgs = [DEFAULT_PITY, { rareWithin: 10, epicWithin: 30 }, { rareWithin: 10, epicWithin: 20 }, { rareWithin: 8, epicWithin: 20 }];
  r.table(
    ["Rare+ within", "Epic+ within", "Effective Rare+", "Effective Epic+", "Mean pulls to first Epic+", "Mean $ to first Epic+", "P(no Epic+ in 10 pulls = 1 week cap)", "P(no Epic+ in 20 pulls = 2-week beta max)"],
    cfgs.map((c) => {
      const s = pityStats(c, QUICK ? 3000 : 20_000);
      return [c.rareWithin, c.epicWithin, pct(s.rates.rare + s.rates.epic + s.rates.legendary), pct(s.rates.epic + s.rates.legendary), fmt(s.meanPullsToEpic, 1), usd(s.meanPullsToEpic * BETA.premiumUsdCents / 100), pct(s.pNoEpicIn10), pct(s.pNoEpicIn20)];
    }),
  );
  r.h2("What a Premium Pack is worth genetically");
  r.table(
    ["Source", "Mean potential", "Note"],
    [
      ...Object.entries(pv.premiumByRarity).map(([k, v]) => [`Premium ${k}`, `${fmt(v.mean, 1)} (max ${fmt(v.max)})`, `${v.n} samples`]),
      ["Premium, all pulls", fmt(pv.premiumMean, 1), "the expected foal"],
      ["Paddock (credits / free)", fmt(pv.paddockMean, 1), ""],
      ["Starter (any)", fmt(pv.starterMean, 1), "club-bred, everyone gets 3"],
      ["Best of a stable's 3 starters", fmt(pv.bestStarterMean, 1), ""],
      ...pv.ceilingBySeason.map((c) => [`Pack ceiling, season ${c.season}`, `mean <= ${c.meanCeiling}, stat <= ${c.statCeiling}`, "all pack foals"]),
    ],
  );
  r.write();
}

// ---------------------------------------------------------------------------
// Prize pool: beta (2 weeks) and 12 weeks
// ---------------------------------------------------------------------------

function poolTables(r: Report, s: PoolSummary) {
  r.table(
    ["Flow (mean per run)", "USD"],
    [
      ["Premium Pack revenue", usd(s.revenue)],
      ["-> Prize Pool (inflow)", usd(s.inflow)],
      ["-> affiliates paid to testers", usd(s.affiliateToTesters)],
      ["-> affiliates paid to the owner's wallet", usd(s.affiliateToOwner)],
      ["-> treasury", usd(s.treasury)],
      ["Owner total (treasury + owner commissions)", `${usd(s.ownerTotal)} (${pct(s.ownerTotal / Math.max(1e-9, s.revenue))})`],
      ["Pool allocated in epochs", usd(s.allocated)],
      ["Pool claimed by the end", usd(s.claimed)],
      ["Pool balance at the end (ETH still in the contract)", `${usd(s.endBalance)} (${pct(s.strandedShare)} of inflow)`],
      ["... of which never allocated to anyone", `${usd(s.inflow - s.allocated)} (${pct(s.unallocatedShare)} of inflow)`],
      ["Gas (buyers + claims + epoch posts)", usd(s.gasUsd)],
    ],
  );
  r.table(
    ["Week", "Revenue", "Pool inflow", "Epoch budget (25% of free)", "Allocated", "Rank-1 prize", "Eligible players", "Pool balance (end)"],
    s.weeks.map((w) => [w.week, usd(w.revenue), usd(w.inflow), usd(w.budget), usd(w.allocated), usd(w.rank1), fmt(w.eligible, 1), usd(w.balanceEnd)]),
  );
  r.table(
    ["Archetype", "Testers", "Prize $/week", "Share paid at least once", "Spend (period)", "Net (prize - spend)"],
    Object.entries(s.byArch).map(([k, v]) => [k, fmt(v.n, 1), usd(v.wonPerWeek), pct(v.pPaidOnce, 0), usd(v.spend), usd(v.net)]),
  );
  r.table(
    ["Spend segment", "Share of testers", "Share of prize money", "Mean spend", "Mean prize"],
    Object.entries(s.bySegment).map(([k, v]) => [k, pct(v.popShare, 0), pct(v.prizeShare, 0), usd(v.spend), usd(v.won)]),
  );
  r.table(
    ["Fairness metric", "Value", "Reading"],
    [
      ["Distinct winners", fmt(s.distinctWinners, 1), `of ${s.runs[0]!.testers.length} accounts`],
      ["Top-3 accounts' share of prizes", pct(s.top3Share), ""],
      ["Gini of prizes (all testers)", s.giniWon.toFixed(2), "1 = one person takes all"],
      ["Score variance explained by activity (Live runs, play days)", pct(s.r2Activity, 0), "volume"],
      ["... by activity + horse ability + race-selection skill", pct(s.r2ActivityAbility, 0), "the increment is the skill/ability part"],
      ["Score variance that is pure race luck", pct(s.noiseShare, 0), "same activity, re-rolled races"],
      ["Week-1 vs week-2 rank persistence (Spearman)", s.persistence.toFixed(2), ""],
      ["Spend vs prize (Spearman, all testers)", s.spendWinCorr.toFixed(2), "confounded: payers are the engaged players"],
      ["Spend vs prize within the same archetype", s.spendWinCorrWithinArch.toFixed(2), "the causal part"],
    ],
  );
}

let beta: PoolSummary | null = null;
if (want("pool_beta") || want("money_season") || want("affiliates")) {
  beta = summarisePool(defaultPoolConfig(liveStarts, { seeds: SEEDS.beta }));
}
if (want("pool_beta") && beta) {
  const r = new Report("pool_beta", "Prize Pool in the 2-week closed beta (agent-based, current rules)", `50 testers (casual 15, engaged 15, grinder 5, breeder 5, whale 3, story-only 7), ${SEEDS.beta} seeds. Purchases: 30% minnows (Poisson 1.2 packs/wk), 15% dolphins (Poisson 4), whales want 10/wk; every foal needs a free stall at quote time, so week-1 caps are 2/3/5. Weekly purchase decay 45%. Race-noise sigma ${sigma()} rating points (calibrated: +90 rating -> 35% win in a 10-runner field). phi = 0.5 of an ability edge reaches Live points (classes are rating-windowed); the Daily Cup counts ability fully.`);
  poolTables(r, beta);
  const bn = summarisePool(defaultPoolConfig(liveStarts, { seeds: SEEDS.beta, scoring: "bestN" }));
  const rt = summarisePool(defaultPoolConfig(liveStarts, { seeds: SEEDS.beta, scoring: "rate" }));
  const bn12 = summarisePool(defaultPoolConfig(liveStarts, { seeds: SEEDS.season, weeks: 12, leak: false, scoring: "bestN" }));
  const rt12 = summarisePool(defaultPoolConfig(liveStarts, { seeds: SEEDS.season, weeks: 12, leak: false, scoring: "rate" }));
  const cu12 = summarisePool(defaultPoolConfig(liveStarts, { seeds: SEEDS.season, weeks: 12, leak: false }));
  r.h2("Scoring variants: what does the score actually measure?");
  r.p("current = race points capped at 240/week + every Cup day; best-N = best 15 Live runs + best 5 Cup days; rate = points per run x 15 (full weight from 8 runs) + mean of the best 3 Cup days x 5. 12-week columns use the fixed (no-leak) rules, where abilities spread out through training and breeding.");
  const row = (label: string, f: (s: PoolSummary) => string) => [label, f(beta), f(bn), f(rt), f(cu12), f(bn12), f(rt12)];
  r.table(
    ["Metric", "Beta current", "Beta best-N", "Beta rate", "12 wk current", "12 wk best-N", "12 wk rate"],
    [
      row("Variance explained by activity (volume)", (s) => pct(s.r2Activity, 0)),
      row("... + ability + skill", (s) => pct(s.r2ActivityAbility, 0)),
      row("Skill/ability increment", (s) => pct(s.r2ActivityAbility - s.r2Activity, 0)),
      row("Pure race luck", (s) => pct(s.noiseShare, 0)),
      row("Casual share paid at least once", (s) => pct(s.byArch.casual?.pPaidOnce ?? 0, 0)),
      row("Grinder prize $/week", (s) => usd(s.byArch.grinder?.wonPerWeek ?? 0)),
      row("Distinct winners", (s) => fmt(s.distinctWinners, 1)),
    ],
  );
  r.write();
  summary.poolBeta = { revenue: beta.revenue, inflow: beta.inflow, allocated: beta.allocated, endBalance: beta.endBalance, stranded: beta.strandedShare, ownerTotal: beta.ownerTotal, affT: beta.affiliateToTesters, affO: beta.affiliateToOwner, gas: beta.gasUsd, weeks: beta.weeks, byArch: beta.byArch, bySegment: beta.bySegment, noise: beta.noiseShare, r2: [beta.r2Activity, beta.r2ActivityAbility], persistence: beta.persistence, bestN: { r2: [bn.r2Activity, bn.r2ActivityAbility], noise: bn.noiseShare }, rate: { r2: [rt.r2Activity, rt.r2ActivityAbility], noise: rt.noiseShare }, rate12: { r2: [rt12.r2Activity, rt12.r2ActivityAbility], noise: rt12.noiseShare }, cur12: { r2: [cu12.r2Activity, cu12.r2ActivityAbility], noise: cu12.noiseShare } };
}

let seasonLeak: PoolSummary | null = null;
let seasonFixed: PoolSummary | null = null;
if (want("pool_season") || want("affiliates")) {
  seasonLeak = summarisePool(defaultPoolConfig(liveStarts, { weeks: 12, seeds: SEEDS.season }));
  seasonFixed = summarisePool(defaultPoolConfig(liveStarts, { weeks: 12, seeds: SEEDS.season, leak: false }));
}
if (want("pool_season") && seasonLeak && seasonFixed) {
  const r = new Report("pool_season", "Prize Pool over 12 weeks: does money buy prizes?", `Same testers playing on for 12 weeks (${SEEDS.season} seeds), 45%/week purchase decay. **Current rules**: horses pulled from Premium Packs don't score, but their offspring do (from ~week 6: 19 care days + 24 h + 19 care days) and so do horses bought with the credits a premium foal sells for (from ~week 3: 7-day / 20-race seller rule). **Fixed rules**: premium lineage and premium-funded horses don't score.`);
  r.h2("Current rules (leak)");
  poolTables(r, seasonLeak);
  r.h2("Fixed rules (no leak)");
  poolTables(r, seasonFixed);
  const wl = seasonLeak.bySegment.whale!;
  const wf = seasonFixed.bySegment.whale!;
  r.h2("What the leak is worth to a whale");
  r.table(
    ["", "Current", "Fixed", "Difference"],
    [
      ["Whale prize over 12 weeks", usd(wl.won), usd(wf.won), usd(wl.won - wf.won)],
      ["Whale spend", usd(wl.spend), usd(wf.spend), ""],
      ["Prize recaptured per $ spent", pct(wl.won / Math.max(1e-9, wl.spend)), pct(wf.won / Math.max(1e-9, wf.spend)), pct((wl.won - wf.won) / Math.max(1e-9, wl.spend))],
      ["Whales' share of prize money (6% of testers)", pct(wl.prizeShare), pct(wf.prizeShare), ""],
    ],
  );
  r.write();
  summary.poolSeason = { leak: { stranded: seasonLeak.strandedShare, bySegment: seasonLeak.bySegment, corrWithin: seasonLeak.spendWinCorrWithinArch, weeks: seasonLeak.weeks }, fixed: { bySegment: seasonFixed.bySegment, corrWithin: seasonFixed.spendWinCorrWithinArch }, whaleLeakGainPerDollar: (wl.won - wf.won) / Math.max(1e-9, wl.spend) };
}

// ---------------------------------------------------------------------------
// Sybils
// ---------------------------------------------------------------------------

if (want("sybil")) {
  const r = new Report("sybil", "Sybil farming of the Prize Pool (one person, several accounts)", "No purchase needed: every account gets 3 starters and can score. Each extra account plays like a grinder (it needs its own play time, wallet and 3 active days). Detection = the chance per week that linked-account signals (device, fingerprint, IP, wallet funding) flag an alt; flagged accounts are held back.");
  const rows: (string | number)[][] = [];
  for (const det of [0, 0.3]) {
    for (const k of [1, 2, 3, 5]) {
      const s = summarisePool(defaultPoolConfig(liveStarts, { seeds: Math.round(SEEDS.beta / 3), sybil: { accounts: k, arch: "grinder", detectPerWeek: det } }));
      rows.push([pct(det, 0), k, usd(s.sybilHumanWon), usd(s.honestRefWon), (s.sybilHumanWon / Math.max(1e-9, s.honestRefWon)).toFixed(2), usd(s.allocated)]);
    }
  }
  r.table(["Detection / week", "Accounts", "Sybil's prizes (2 weeks)", "An honest grinder's prizes", "Multiple", "Total allocated"], rows);
  r.write();
}

// ---------------------------------------------------------------------------
// Money over a 12-week season: levers x decay
// ---------------------------------------------------------------------------

if (want("money_season")) {
  const r1 = beta ? beta.weeks[0]!.revenue / 50 : DEFAULT_SEASON.packUsdPerPlayerW1;
  const a = { ...DEFAULT_SEASON, packUsdPerPlayerW1: r1 };
  const r = new Report("money_season", "Where does the pot come from? 12-week revenue and pool under purchase decay", `Week-1 pack revenue per tester = ${usd(r1)} (from the beta agent sim). Active players: 35% core + 65% x 0.8^(w-1). **Packs only**: pack novelty decays by d per week, and from week 5 breeding substitutes for packs (bred top-1% passes the best possible Premium foal in season 2; see population.md), floor 35%. **Fresh blood**: a new seasonal bloodline in weeks 1/5/9 resets novelty (each drop recaptures 75% of the last one) and keeps packs useful to breeders (90%) — obtainable free at lower odds so it is not pay-to-win. **Season pass**: $9.99/4 weeks, 25% of actives at season start + 5% mid-season. **Cosmetics**: $0.40/active/week, -10%/week within a season, reset by each drop. Pool split applies to every SKU unless stated.`);
  const rows: (string | number)[][] = [];
  for (const d of [0.3, 0.45, 0.6]) {
    for (const lev of LEVER_SETS) {
      const m = seasonModel(lev, d, a);
      rows.push([pct(d, 0), lev.label, usd(m.revenue, 0), usd(m.packs, 0), usd(m.pass + m.cosmetics, 0), usd(m.lastWeekRevenue, 0), usd(m.poolIn, 0), usd(m.paid, 0), usd(m.endBalance, 0), usd(m.lastWeekPrizePerActive), usd(m.ownerNet, 0)]);
    }
  }
  r.table(["Decay", "Levers", "12-wk revenue", "of which packs", "pass + cosmetics", "Week-12 revenue", "Pool inflow", "Pool paid", "Pool balance wk 12", "Wk-12 prize per active", "Owner net"], rows);
  const base = seasonModel(LEVER_SETS[0]!, 0.45, a);
  const all = seasonModel(LEVER_SETS[4]!, 0.45, a);
  r.h2("Week by week at 45% decay: packs only vs all three levers");
  r.table(
    ["Week", "Active", "Revenue (packs only)", "Pool in", "Pool paid", "Rank-1 prize", "Revenue (all levers)", "Pool in", "Pool paid", "Rank-1 prize"],
    base.rows.map((x, i) => {
      const y = all.rows[i]!;
      return [x.week, fmt(x.active, 1), usd(x.revenue), usd(x.poolIn), usd(x.paid), usd(x.rank1), usd(y.revenue), usd(y.poolIn), usd(y.paid), usd(y.rank1)];
    }),
  );
  const scale = { ...a, players: 500 };
  r.h2("Same levers at 500 players (first real season scale)");
  r.table(
    ["Levers (45% decay)", "12-wk revenue", "Pool inflow", "Pool paid", "Pool balance wk 12", "Rank-1 prize wk 12", "Owner net"],
    LEVER_SETS.map((lev) => {
      const m = seasonModel(lev, 0.45, scale);
      return [lev.label, usd(m.revenue, 0), usd(m.poolIn, 0), usd(m.paid, 0), usd(m.endBalance, 0), usd(m.rows[m.rows.length - 1]!.rank1), usd(m.ownerNet, 0)];
    }),
  );
  r.p(`At 500 players the pool's payout throughput is the binding limit: ${POOL_RULES.paidRanks} ranks x $${POOL_RULES.capUsdCents / 100} cap with linear weights pays at most $200 a week (only once the budget reaches $1,100). Inflow above that accumulates in a pool the owner can never withdraw from.`);
  r.write();
  summary.moneySeason = { r1, base: { revenue: base.revenue, poolIn: base.poolIn, paid: base.paid, end: base.endBalance, wk12: base.lastWeekRevenue }, all: { revenue: all.revenue, poolIn: all.poolIn, paid: all.paid, end: all.endBalance, wk12: all.lastWeekRevenue } };
}

// ---------------------------------------------------------------------------
// Affiliates
// ---------------------------------------------------------------------------

if (want("affiliates")) {
  const r = new Report("affiliates", "Affiliates: splits, owner take, wash and ring break-evens");
  const packUsd = BETA.premiumUsdCents / 100;
  r.h2(`Where one $${packUsd} pack goes`);
  r.table(
    ["Config", "Buyer's tree position", "Pool", "Testers' commissions", "Owner's commission", "Treasury", "Owner total"],
    splitRows(packUsd).map((x) => [x.label, x.tree, usd(x.pool), usd(x.testerComm), usd(x.ownerComm), usd(x.treasury), `${usd(x.ownerTotal)} (${pct(x.ownerTotal / packUsd, 0)})`]),
  );
  r.h2("Effective owner take for a 70% owner-direct / 25% tester-invited / 5% two-deep tree");
  r.table(
    ["Config", "Owner (treasury + own commissions)", "Testers' commissions", "Pool"],
    AFF_CONFIGS.map(({ label, c }) => {
      const o = ownerTake(c);
      return [label, pct(o.owner), pct(o.tester), pct(o.pool)];
    }),
  );
  const paid2 = beta ? beta.allocated / Math.max(1e-9, beta.inflow) : 0.35;
  const paid12 = seasonLeak ? seasonLeak.allocated / Math.max(1e-9, seasonLeak.inflow) : 0.8;
  const leak = seasonLeak && seasonFixed ? Math.max(0, (seasonLeak.bySegment.whale!.won - seasonFixed.bySegment.whale!.won) / Math.max(1e-9, seasonLeak.bySegment.whale!.spend)) : 0;
  r.h2("Wash buying: return per $1 spent (break-even needs >= $1.00)");
  r.p(`Share of the pool ever allocated: ${pct(paid2, 0)} within the 2-week beta, ${pct(paid12, 0)} over 12 weeks. Leak gain (extra prizes per $ because premium offspring / premium-funded horses score, current rules, from pool_season): ${pct(leak, 1)}.`);
  const rows: (string | number)[][] = [];
  const cur = AFF_CONFIGS[0]!.c;
  for (const w of washCases(cur)) {
    for (const cap of [0.2, 0.5, 1]) {
      rows.push([w.label, pct(cap, 0), usd(marginalReturn(cur, w.affInside, cap, paid2, 0)), usd(marginalReturn(cur, w.affInside, cap, paid12, leak)), usd(marginalReturn(AFF_CONFIGS[4]!.c, w.affInside * 1.5, cap, 1, leak))]);
    }
  }
  r.table(["Strategy", "Group's share of all pool prizes", "Beta (2 wk)", "12 weeks incl. leak", "Contract maximum (50% pool, 15/5%), all paid out"], rows);
  r.h2("Caps in practice");
  r.table(
    ["Rule", "Value", "Packs of invitee sales to hit it", "Binds in a 50-tester beta?"],
    [
      ["Weekly per-inviter cap", usd(AFFILIATE.weeklyCapUsdCents / 100), fmt(AFFILIATE.weeklyCapUsdCents / 100 / (packUsd * AFFILIATE.ref1Bps / 10_000)), "no (whole-beta weekly revenue is ~$200-400)"],
      ["Owner cap", "none", "-", "-"],
      ["Commission window", `${AFFILIATE.windowDays} days`, "-", "longer than the beta"],
      ["Per-player pool cap / week", usd(POOL_RULES.capUsdCents / 100), "-", "no: rank-1 gets ~$5-7 in the beta"],
    ],
  );
  r.write();
}

// ---------------------------------------------------------------------------
// Sensitivity
// ---------------------------------------------------------------------------

if (want("sensitivity")) {
  const r = new Report("sensitivity", "Sensitivity analysis", `Agent-based pool sim (${SEEDS.sens} seeds each). Beta = 2 weeks; season = 12 weeks. One lever moves at a time from the current settings.`);
  const run = (over: Partial<PoolSimConfig>) => summarisePool(defaultPoolConfig(liveStarts, { seeds: SEEDS.sens, ...over }));
  r.h2("Pool share (poolBps)");
  r.table(
    ["Pool share", "Beta pool inflow", "Beta allocated", "Beta rank-1 wk 2", "Never allocated after the beta", "12-wk allocated", "ETH left in the pool wk 12", "12-wk owner total"],
    [1000, 1500, 2000, 3000, 4000, 5000].map((bps) => {
      const b = run({ poolBps: bps });
      const s = run({ poolBps: bps, weeks: 12 });
      return [pct(bps / 10_000, 0), usd(b.inflow), usd(b.allocated), usd(b.weeks[1]!.rank1), usd(b.inflow - b.allocated), usd(s.allocated), usd(s.endBalance), usd(s.ownerTotal)];
    }),
  );
  r.h2("Pack price (constant-elasticity demand)");
  const rows: (string | number)[][] = [];
  for (const el of [-1.0, -1.5, -2.0]) {
    for (const p of [2.99, 4.99, 7.99, 9.99]) {
      const s = run({ packUsd: p, demandScale: Math.pow(p / 4.99, el) });
      rows.push([el, usd(p), usd(s.revenue), usd(s.inflow), usd(s.ownerTotal), usd(s.bySegment.whale!.spend)]);
    }
  }
  r.table(["Elasticity", "Price", "Beta revenue", "Pool inflow", "Owner total", "Whale spend"], rows);
  r.h2("Purchase decay");
  r.table(
    ["Weekly decay", "Beta revenue", "12-wk revenue", "12-wk allocated", "Week-12 rank-1 prize"],
    [0.3, 0.45, 0.6].map((d) => {
      const b = run({ decay: d });
      const s = run({ decay: d, weeks: 12 });
      return [pct(d, 0), usd(b.revenue), usd(s.revenue), usd(s.allocated), usd(s.weeks[11]!.rank1)];
    }),
  );
  r.h2("Prize curve: per-player cap and paid ranks (beta)");
  r.table(
    ["Cap / week", "Paid ranks", "Distinct winners", "Top-3 share", "Gini", "Casual paid at least once"],
    [
      [10, 10],
      [20, 10],
      [20, 5],
      [20, 20],
      [10, 20],
    ].map(([cap, ranks]) => {
      const s = run({ capUsd: cap!, paidRanks: ranks! });
      return [usd(cap!, 0), ranks!, fmt(s.distinctWinners, 1), pct(s.top3Share), s.giniWon.toFixed(2), pct(s.byArch.casual?.pPaidOnce ?? 0, 0)];
    }),
  );
  r.h2("phi: how much of an ability edge reaches Live points (12 weeks, current rules)");
  r.table(
    ["phi", "Whale prize share (leak)", "Whale prize share (fixed)", "Within-archetype spend/prize corr (leak)", "(fixed)"],
    [0.2, 0.5, 0.8].map((phi) => {
      const l = run({ phi, weeks: 12 });
      const f = run({ phi, weeks: 12, leak: false });
      return [phi, pct(l.bySegment.whale!.prizeShare), pct(f.bySegment.whale!.prizeShare), l.spendWinCorrWithinArch.toFixed(2), f.spendWinCorrWithinArch.toFixed(2)];
    }),
  );
  r.h2("Credits faucets (engaged player, 28 days)");
  const eng = ARCHETYPES.find((a) => a.key === "engaged")!;
  const ratioOf = (s: ArchetypeSummary) => Object.values(s.sinkMix).reduce((x, y) => x + y, 0) / Object.values(s.faucetMix).reduce((x, y) => x + y, 0);
  const cases: [string, () => ArchetypeSummary][] = [
    ["Current", () => summarise(eng, SEEDS.credits)],
    ["Story caps x 0.5", () => summarise(eng, SEEDS.credits, { storyCapScale: 0.5 })],
    ["No Cup credits", () => summarise(eng, SEEDS.credits, { cupCredits: 0 })],
    [
      "Daily goals paid (3 x 120)",
      () => {
        setGoalsImplemented(true);
        const s = summarise(eng, SEEDS.credits);
        setGoalsImplemented(false);
        return s;
      },
    ],
  ];
  r.table(
    ["Case", "Faucets", "Sinks", "Ratio", "End balance"],
    cases.map(([label, f]) => {
      const s = f();
      return [label, fmt(Object.values(s.faucetMix).reduce((x, y) => x + y, 0)), fmt(Object.values(s.sinkMix).reduce((x, y) => x + y, 0)), ratioOf(s).toFixed(2), fmt(s.weeks[s.weeks.length - 1]!.balance)];
    }),
  );
  r.write();
}

// ---------------------------------------------------------------------------
// Gas and calibration notes
// ---------------------------------------------------------------------------

if (want("chain")) {
  const g = gasUsd(ETH_USD);
  const r = new Report("chain", "Chain costs and model calibration");
  r.table(
    ["Item", "USD (ETH = $" + ETH_USD + ")", "Share of a $4.99 pack"],
    [
      ["Purchase tx (buyer)", usd(g.purchase, 3), pct(g.purchase / 4.99, 2)],
      ["Claim tx (winner)", usd(g.claim, 3), pct(g.claim / 4.99, 2)],
      ["Epoch post (owner/server)", usd(g.postEpoch, 3), "-"],
      ["Getting ETH onto Robinhood Chain (one-off per tester)", usd(g.onramp, 2), `${pct(g.onramp / 20, 0)} of a $20 budget`],
    ],
  );
  r.h2("Race model calibration");
  r.table(
    ["Quantity", "Value"],
    [
      ["Noise sigma (rating points)", SIGMA],
      ["Win chance at par, 10 runners", pct(winProbability(0, 10))],
      ["Win chance +55 (a legendary vs best starter)", pct(winProbability(55, 10))],
      ["Win chance +90 (calibration target 35%)", pct(winProbability(90, 10))],
      ["Expected purse share at par / +20 skill", `${pct(expectedPurseShare(0, 10))} / ${pct(expectedPurseShare(20, 10))}`],
    ],
  );
  r.write();
}

writeFileSync(resolve(RESULTS_DIR, "summary.json"), JSON.stringify(summary, null, 1));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${RESULTS_DIR}`);
void CONTRACT;
void CURRENT_SPLIT;
