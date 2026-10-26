/**
 * Stable Credits: faucets and sinks per player archetype, simulated day by day for 28 days
 * (one competition season) with the real constants. Monte Carlo over race results.
 *
 * Mechanics modelled (all from game-core / packages/db):
 *  - starter grant, 3 club-bred starters at racing age, gift foal on day 2 (19 care days);
 *  - Story: 4 chapters x 6 races, first-win reward per race, 20 per replay, chapter caps,
 *    licence = chapters completed + 1 (3 wins each). Story races are free (no entries) but
 *    COUNT AS CAREER STARTS (settleRace increments starts for every kind except the Daily Cup);
 *  - Live: 1 entry per race (10/day, bank 20, +5 refill for 250 once a day when bank < 5),
 *    3 starts per horse per day, 40-start career, purse by tier and licence;
 *  - Daily Cup participation credits; daily goals are NOT paid by the server (finding), so
 *    they are off unless GOALS_IMPLEMENTED;
 *  - training (WORKOUTS costs), paddock packs (1,200, <= 3/week, free one every 3rd play day,
 *    each needs a free stall), stalls (2,000 + 400 x (n - 7)), trainer / vet / entry tiers,
 *    breeding (1,500 base, 1 covering per mare per season, foal after 24 h), scans.
 */
import { GAME, PURSE_SPLIT, gc } from "../lib/constants.ts";
import { drawPosition, winProbability } from "../lib/race.ts";
import { SimRng, mean } from "../lib/rng.ts";

export let GOALS_IMPLEMENTED = false;
export function setGoalsImplemented(v: boolean) {
  GOALS_IMPLEMENTED = v;
}

export interface Archetype {
  key: string;
  label: string;
  pPlay: number;
  liveTarget: number;
  storyTarget: number;
  storyReplays: boolean;
  cup: boolean;
  refill: boolean;
  trainPerRacer: number;
  paddockPerWeek: number;
  claimFree: boolean;
  stallTarget: number;
  reserve: number;
  facilities: readonly ("trainer1" | "vet1" | "trainer2" | "entry1" | "entry2")[];
  breeder: boolean;
  outsideStudShare: number;
  scansPerWeek: number;
  /** Race-selection skill (trip / surface / class fit) in rating points. */
  skillEdge: number;
  /** ETH Premium Packs wanted per week (stall-limited; foals take a stall at quote time). */
  premiumWanted: number;
  /** Pension a starter to the Legacy Farm to make room for a wanted pack. */
  pensionForSpace: boolean;
}

export const ARCHETYPES: readonly Archetype[] = [
  { key: "casual", label: "Casual (1 session/day, ~4 days/wk)", pPlay: 0.6, liveTarget: 3, storyTarget: 2, storyReplays: false, cup: true, refill: false, trainPerRacer: 0.7, paddockPerWeek: 0.5, claimFree: true, stallTarget: 7, reserve: 1500, facilities: [], breeder: false, outsideStudShare: 0, scansPerWeek: 0, skillEdge: 0, premiumWanted: 0, pensionForSpace: false },
  { key: "engaged", label: "Engaged (2-3 sessions/day)", pPlay: 0.9, liveTarget: 6, storyTarget: 3, storyReplays: false, cup: true, refill: true, trainPerRacer: 2, paddockPerWeek: 1, claimFree: true, stallTarget: 10, reserve: 1000, facilities: ["trainer1", "vet1"], breeder: true, outsideStudShare: 0.3, scansPerWeek: 0.5, skillEdge: 20, premiumWanted: 0, pensionForSpace: false },
  { key: "grinder", label: "Grinder (max entries)", pPlay: 1, liveTarget: 15, storyTarget: 4, storyReplays: false, cup: true, refill: true, trainPerRacer: 3, paddockPerWeek: 3, claimFree: true, stallTarget: 14, reserve: 500, facilities: ["trainer1", "entry1", "vet1", "entry2", "trainer2"], breeder: true, outsideStudShare: 0.3, scansPerWeek: 0.5, skillEdge: 10, premiumWanted: 0, pensionForSpace: false },
  { key: "breeder", label: "Breeder", pPlay: 0.95, liveTarget: 4, storyTarget: 3, storyReplays: false, cup: true, refill: false, trainPerRacer: 1, paddockPerWeek: 3, claimFree: true, stallTarget: 16, reserve: 500, facilities: ["vet1"], breeder: true, outsideStudShare: 0.5, scansPerWeek: 2, skillEdge: 15, premiumWanted: 0, pensionForSpace: false },
  { key: "whale", label: "Whale (engaged + max ETH packs)", pPlay: 0.95, liveTarget: 6, storyTarget: 3, storyReplays: false, cup: true, refill: true, trainPerRacer: 2, paddockPerWeek: 1, claimFree: true, stallTarget: 24, reserve: 0, facilities: ["trainer1"], breeder: true, outsideStudShare: 0.3, scansPerWeek: 1, skillEdge: 15, premiumWanted: 10, pensionForSpace: false },
  { key: "story_skipper", label: "Story-only skipper", pPlay: 0.8, liveTarget: 0, storyTarget: 9, storyReplays: true, cup: true, refill: false, trainPerRacer: 0, paddockPerWeek: 0, claimFree: false, stallTarget: 6, reserve: 0, facilities: [], breeder: false, outsideStudShare: 0, scansPerWeek: 0, skillEdge: 0, premiumWanted: 0, pensionForSpace: false },
];

interface Horse {
  id: number;
  sex: "colt" | "filly";
  care: number;
  starts: number;
  current: number;
  retired: boolean;
  pensioned: boolean;
  coveredSeason: number;
  premium: boolean;
  bound: boolean;
}

export interface DayRow {
  day: number;
  faucets: Record<string, number>;
  sinks: Record<string, number>;
  balance: number;
  liveStarts: number;
  storyStarts: number;
  racers: number;
  stalls: number;
  horses: number;
  premiumBought: number;
}

const FAUCET_KEYS = ["starter", "purses", "story", "cup", "goals", "release"] as const;
const SINK_KEYS = ["training", "entryFees", "refills", "paddock", "stalls", "facilities", "breeding", "scans"] as const;
type FaucetKey = (typeof FAUCET_KEYS)[number];
type SinkKey = (typeof SINK_KEYS)[number];

/** Average purse a horse runs for, by licence (players pick the richest class they qualify for). */
function livePurse(licence: number, rng: SimRng): { purse: number; fee: number; entries: number } {
  // Licence 1: maiden / novice / quick / hcp_0_55; 2 adds the 50-75 and 70-95 handicaps; 3 adds listed / G3.
  const p = GAME.purse;
  const pools: [number, number, number][][] = [
    [],
    [[p.hcp_0_55, 0, 1], [p.novice, 0, 1], [p.maiden, 0, 1], [p.quick, 0, 1]],
    [[p.hcp_50_75, 0, 1], [p.hcp_0_55, 0, 1], [p.novice, 0, 1], [p.hcp_70_95, 0, 1]],
    [[p.hcp_70_95, 0, 1], [p.hcp_50_75, 0, 1], [p.listed, GAME.entryFee.listed, 1], [p.g3, GAME.entryFee.g3, 2]],
  ];
  const opts = pools[Math.min(3, Math.max(1, licence))]!;
  const [purse, fee, entries] = opts[rng.int(opts.length)]!;
  return { purse, fee, entries };
}

/** Starter "current" ratings from the real starter generator (game-core). */
function starterCurrents(seed: string): number[] {
  const hs = gc.createStarterStable({ seed: gc.seedFrom("econ-sim", seed), ownerId: seed, nowMs: 0, season: 1 });
  return hs.map((h) => {
    const s = gc.currentStats(h);
    return (s.speed + s.stamina + s.burst + s.durability + s.adaptability + s.temperament) / 6;
  });
}

export interface RunResult {
  days: DayRow[];
  totals: { faucets: Record<string, number>; sinks: Record<string, number> };
  premiumByWeek: number[];
  /** First day with no racing-age horse left (starters spent, foals not ready). */
  starterCareerEndDay: number | null;
  droughtDays: number;
  storyChaptersDone: number;
}

export function runArchetype(a: Archetype, seed: string, days = 28, opts: { storyCapScale?: number; cupCredits?: number } = {}): RunResult {
  const rng = new SimRng(`${a.key}|${seed}`);
  const capScale = opts.storyCapScale ?? 1;
  const cupCredits = opts.cupCredits ?? GAME.dailyCupCredits;
  const cur = starterCurrents(seed);
  let nextId = 0;
  const horses: Horse[] = GAME.starterPlan.map((p, i) => ({ id: nextId++, sex: p.sex, care: GAME.careToRacing, starts: 0, current: cur[i]!, retired: false, pensioned: false, coveredSeason: -1, premium: false, bound: true }));
  let credits = 0;
  let stalls: number = GAME.baseStalls;
  let bank = 0;
  let lastGrant = -1;
  let playDays = 0;
  let freeClaimed = 0;
  let giftGiven = false;
  const owned = new Set<string>();
  const storyWon = new Set<string>();
  const storyEarned: Record<string, number> = { club: 0, county: 0, national: 0, classics: 0 };
  let trainingGain = 0;
  const rows: DayRow[] = [];
  const premiumByWeek: number[] = [];
  let starterCareerEndDay: number | null = null;
  let droughtDays = 0;
  const tot = { faucets: Object.fromEntries(FAUCET_KEYS.map((k) => [k, 0])) as Record<string, number>, sinks: Object.fromEntries(SINK_KEYS.map((k) => [k, 0])) as Record<string, number> };

  const inStalls = () => horses.filter((h) => !h.pensioned).length;
  const freeStalls = () => Math.max(0, stalls - inStalls());
  const licence = () => {
    let lic = 1;
    for (const ch of gc.STORY_CHAPTERS) {
      const wins = [...storyWon].filter((k) => k.startsWith(ch)).length;
      if (wins >= 3) lic++;
      else break;
    }
    return Math.min(5, lic);
  };
  const racers = () => horses.filter((h) => !h.pensioned && !h.retired && h.care >= GAME.careToRacing && h.starts < GAME.careerMaxStarts);

  for (let day = 0; day < days; day++) {
    const f = Object.fromEntries(FAUCET_KEYS.map((k) => [k, 0])) as Record<FaucetKey, number>;
    const s = Object.fromEntries(SINK_KEYS.map((k) => [k, 0])) as Record<SinkKey, number>;
    if (day === 0) f.starter = GAME.starterGrant;
    const week = Math.floor(day / 7);
    if (day % 7 === 0) premiumByWeek.push(0);
    let liveStarts = 0;
    let storyStarts = 0;
    const play = day === 0 || rng.chance(a.pPlay);
    if (play) {
      playDays++;
      credits += f.starter;
      // Entries: lazy grant, missed days still grant up to the bank cap.
      const missed = lastGrant < 0 ? 1 : day - lastGrant;
      bank = Math.min(GAME.entryBank, bank + missed * GAME.entryDaily);
      lastGrant = day;
      // Gift foal from the second real day.
      if (!giftGiven && day >= 1) {
        giftGiven = true;
        horses.push({ id: nextId++, sex: rng.chance(0.5) ? "colt" : "filly", care: 0, starts: 0, current: 395 + 20 * rng.normal(), retired: false, pensioned: false, coveredSeason: -1, premium: false, bound: true });
      }
      // Care: one counted session per horse per real day.
      for (const h of horses) if (!h.pensioned && h.care < GAME.careToRacing) h.care++;

      // Horse-starts available today (3 per racer, career cap 40).
      const rs = racers();
      const capacity = new Map(rs.map((h) => [h.id, Math.min(GAME.startsPerDay, GAME.careerMaxStarts - h.starts)] as const));
      const takeStart = (prefer: "best" | "any"): Horse | null => {
        const avail = rs.filter((h) => (capacity.get(h.id) ?? 0) > 0);
        if (!avail.length) return null;
        avail.sort((x, y) => (prefer === "best" ? y.current - x.current : x.starts - y.starts));
        const h = avail[0]!;
        capacity.set(h.id, capacity.get(h.id)! - 1);
        h.starts++;
        return h;
      };
      const veteranPenalty = (h: Horse) => (h.starts > 28 ? (h.starts - 28) * 3 : 0);

      // Story: a rational player goes for the unwon race (any unlocked chapter) with the best
      // expected reward; the skipper then replays to the chapter caps.
      const lic = licence();
      for (let i = 0; i < a.storyTarget; i++) {
        const h0 = rs.filter((h) => (capacity.get(h.id) ?? 0) > 0).sort((x, y) => y.current - x.current)[0];
        if (!h0) break;
        const unlocked = gc.STORY_CHAPTER_DEFS.slice(0, Math.min(4, lic));
        let best: { race: (typeof unlocked)[number]["races"][number]; ch: gc.StoryChapter; ev: number } | null = null;
        for (const def of unlocked) {
          const cap = Math.round(GAME.storyCap[def.id] * capScale);
          for (const race of def.races) {
            if (storyWon.has(race.key)) continue;
            const pay = Math.max(0, Math.min(GAME.storyFirstWin[def.id], cap - storyEarned[def.id]!));
            const ev = pay * winProbability(Math.round(h0.current + trainingGain - race.strength), race.fieldSize);
            if (!best || ev > best.ev) best = { race, ch: def.id, ev };
          }
        }
        if (!best || best.ev < 1) {
          if (!a.storyReplays) break;
          const def = unlocked[unlocked.length - 1]!;
          const cap = Math.round(GAME.storyCap[def.id] * capScale);
          if (storyEarned[def.id]! >= cap) break;
          best = { race: def.races[rng.int(def.races.length)]!, ch: def.id, ev: 0 };
        }
        const { race, ch } = best;
        const cap = Math.round(GAME.storyCap[ch] * capScale);
        const h = takeStart("best");
        if (!h) break;
        storyStarts++;
        const edge = h.current + trainingGain - veteranPenalty(h) - race.strength;
        const won = drawPosition(rng, edge, race.fieldSize) === 1;
        const first = won && !storyWon.has(race.key);
        const raw = first ? GAME.storyFirstWin[ch] : GAME.storyReplay;
        const pay = Math.max(0, Math.min(raw, cap - storyEarned[ch]!));
        if (won) storyWon.add(race.key);
        storyEarned[ch]! += pay;
        f.story += pay;
        credits += pay;
      }

      // Live races.
      for (let i = 0; i < a.liveTarget; i++) {
        let { purse, fee, entries } = livePurse(licence(), rng);
        if (bank < entries && a.refill && bank < GAME.entryRefillBelow && !owned.has(`refill:${day}`) && credits >= GAME.entryRefillCost) {
          owned.add(`refill:${day}`);
          bank += GAME.entryRefillAmount;
          credits -= GAME.entryRefillCost;
          s.refills += GAME.entryRefillCost;
        }
        if (bank < entries) {
          if (entries === 2 && bank >= 1) ({ purse, fee, entries } = { purse: GAME.purse.hcp_0_55, fee: 0, entries: 1 });
          else break;
        }
        if (credits < fee) continue;
        const h = takeStart("any");
        if (!h) break;
        bank -= entries;
        credits -= fee;
        s.entryFees += fee;
        liveStarts++;
        // Class windows track rating, so the edge vs the class field is skill + fitness, minus veteran decline.
        const edge = a.skillEdge - veteranPenalty(h) + Math.min(15, trainingGain / 2);
        const pos = drawPosition(rng, edge, 10);
        const prize = Math.floor(purse * (PURSE_SPLIT[pos - 1] ?? 0));
        f.purses += prize;
        credits += prize;
      }

      if (a.cup) {
        f.cup += cupCredits;
        credits += cupCredits;
      }
      if (GOALS_IMPLEMENTED) {
        f.goals += GAME.dailyGoalCredits * GAME.dailyGoalsPerDay;
        credits += GAME.dailyGoalCredits * GAME.dailyGoalsPerDay;
      }

      // Training (only racing-age horses still racing).
      const avgCost = mean([GAME.workouts.speed_work.cost, GAME.workouts.stamina_gallops.cost, GAME.workouts.race_prep.cost, GAME.workouts.swimming.cost, GAME.workouts.gate_practice.cost]);
      const sessions = Math.min(GAME.trainingSlots * racers().length, Math.round(racers().length * a.trainPerRacer));
      const affordable = Math.min(sessions, Math.floor(credits / avgCost));
      s.training += affordable * avgCost;
      credits -= affordable * avgCost;
      trainingGain = Math.min(30, trainingGain + affordable * 0.25);

      // Stalls and facilities.
      const buyStall = () => {
        const n = stalls + 1;
        const cost = GAME.stallCost(n);
        if (n <= GAME.maxStalls && credits >= cost + a.reserve) {
          credits -= cost;
          s.stalls += cost;
          stalls = n;
          return true;
        }
        return false;
      };
      while (stalls < a.stallTarget && freeStalls() < 2 && buyStall()) {
        /* buy while needed */
      }
      for (const fac of a.facilities) {
        if (owned.has(fac)) continue;
        const cost = fac === "trainer1" ? GAME.facility.trainer[0] : fac === "trainer2" ? GAME.facility.trainer[1] : fac === "vet1" ? GAME.facility.vet[0] : fac === "entry1" ? GAME.entryTierCost[0] : GAME.entryTierCost[1];
        if (credits >= cost + a.reserve + 2000) {
          credits -= cost;
          s.facilities += cost;
          owned.add(fac);
        }
        break; // one facility at a time, in order
      }

      // Packs: free paddock every 3rd play day; bought paddock packs; ETH premium (stall-limited).
      const addFoal = (premium: boolean, bound: boolean) =>
        horses.push({ id: nextId++, sex: rng.chance(0.5) ? "colt" : "filly", care: 0, starts: 0, current: (premium ? 418 : 400) + 18 * rng.normal(), retired: false, pensioned: false, coveredSeason: -1, premium, bound });
      if (a.claimFree && Math.floor(playDays / GAME.freePaddockEvery) > freeClaimed && freeStalls() > 0) {
        freeClaimed++;
        addFoal(false, true);
      }
      const paddockThisWeek = [...owned].filter((k) => k.startsWith(`paddock:${week}:`)).length;
      const paddockWanted = Math.floor(a.paddockPerWeek * (week + 1) + 1e-9) - [...owned].filter((k) => k.startsWith("paddock:")).length;
      if (paddockWanted > 0 && paddockThisWeek < GAME.paddockBuysPerWeek && freeStalls() > 0 && credits >= GAME.paddockPrice + a.reserve) {
        credits -= GAME.paddockPrice;
        s.paddock += GAME.paddockPrice;
        owned.add(`paddock:${week}:${day}`);
        addFoal(false, false);
      }
      if (a.premiumWanted > 0) {
        let left = Math.min(GAME.premiumPerWeek, a.premiumWanted) - premiumByWeek[week]!;
        while (left > 0) {
          if (freeStalls() <= 0 && !buyStall()) {
            if (!a.pensionForSpace) break;
            const old = horses.find((h) => !h.pensioned && h.bound && h.care >= GAME.careToRacing && h.starts >= 20);
            if (!old) break;
            old.pensioned = true;
          }
          if (freeStalls() <= 0) break;
          addFoal(true, false);
          premiumByWeek[week]!++;
          left--;
        }
      }

      // Breeding: retire a racing-age filly with >= 25 starts (or a spent starter) and cover once a season.
      if (a.breeder) {
        const season = 0;
        const mares = horses.filter((h) => !h.pensioned && h.sex === "filly" && h.care >= GAME.careToRacing && (h.retired || h.starts >= GAME.breedFromStarts) && h.coveredSeason !== season);
        const studs = horses.filter((h) => !h.pensioned && h.sex === "colt" && h.care >= GAME.careToRacing && (h.retired || h.starts >= GAME.breedFromStarts));
        for (const m of mares) {
          const outside = rng.chance(a.outsideStudShare) || !studs.length;
          const studFee = outside ? 800 : 0;
          const cost = GAME.breedingBaseFee + studFee;
          if (credits < cost) break;
          credits -= cost;
          s.breeding += cost;
          m.coveredSeason = season;
          m.retired = true;
          addFoal(false, false); // foal arrives next day (nursery overflow ok); tracked as a stall user
        }
      }
      if (a.scansPerWeek > 0 && rng.chance(a.scansPerWeek / 7) && credits >= GAME.scan) {
        credits -= GAME.scan;
        s.scans += GAME.scan;
      }
    }
    if (day > 0 && racers().length === 0) {
      if (starterCareerEndDay === null) starterCareerEndDay = day;
      droughtDays++;
    }
    for (const k of FAUCET_KEYS) tot.faucets[k]! += f[k]!;
    for (const k of SINK_KEYS) tot.sinks[k]! += s[k]!;
    rows.push({ day, faucets: f, sinks: s, balance: credits, liveStarts, storyStarts, racers: racers().length, stalls, horses: horses.filter((h) => !h.pensioned).length, premiumBought: premiumByWeek[week] ?? 0 });
  }
  const chaptersDone = gc.STORY_CHAPTER_DEFS.filter((c) => c.races.filter((r) => storyWon.has(r.key)).length >= 3).length;
  return { days: rows, totals: tot, premiumByWeek, starterCareerEndDay, droughtDays, storyChaptersDone: chaptersDone };
}

export interface ArchetypeSummary {
  a: Archetype;
  runs: RunResult[];
  /** Mean over runs, by week (0-based): faucets, sinks, net, end balance, live starts. */
  weeks: { faucet: number; sink: number; net: number; balance: number; live: number; story: number; racers: number }[];
  faucetMix: Record<string, number>;
  sinkMix: Record<string, number>;
  premiumByWeek: number[];
  careerEndDay: number | null;
  droughtDays: number;
  chapters: number;
}

export function summarise(a: Archetype, runs: number, opts: Parameters<typeof runArchetype>[3] = {}, days = 28): ArchetypeSummary {
  const rs = Array.from({ length: runs }, (_, i) => runArchetype(a, `run${i}`, days, opts));
  const nWeeks = Math.ceil(days / 7);
  const weeks = Array.from({ length: nWeeks }, (_, w) => {
    const per = rs.map((r) => {
      const d = r.days.slice(w * 7, w * 7 + 7);
      const faucet = d.reduce((x, y) => x + Object.values(y.faucets).reduce((p, q) => p + q, 0), 0);
      const sink = d.reduce((x, y) => x + Object.values(y.sinks).reduce((p, q) => p + q, 0), 0);
      return { faucet, sink, balance: d[d.length - 1]!.balance, live: d.reduce((x, y) => x + y.liveStarts, 0), story: d.reduce((x, y) => x + y.storyStarts, 0), racers: d[d.length - 1]!.racers };
    });
    const m = (k: keyof (typeof per)[number]) => mean(per.map((p) => p[k]));
    return { faucet: m("faucet"), sink: m("sink"), net: m("faucet") - m("sink"), balance: m("balance"), live: m("live"), story: m("story"), racers: m("racers") };
  });
  const faucetMix = Object.fromEntries(FAUCET_KEYS.map((k) => [k, mean(rs.map((r) => r.totals.faucets[k]!))]));
  const sinkMix = Object.fromEntries(SINK_KEYS.map((k) => [k, mean(rs.map((r) => r.totals.sinks[k]!))]));
  const premiumByWeek = Array.from({ length: nWeeks }, (_, w) => mean(rs.map((r) => r.premiumByWeek[w] ?? 0)));
  const ends = rs.map((r) => r.starterCareerEndDay).filter((x): x is number => x !== null);
  return { a, runs: rs, weeks, faucetMix, sinkMix, premiumByWeek, careerEndDay: ends.length > rs.length / 2 ? Math.round(mean(ends)) : null, droughtDays: mean(rs.map((r) => r.droughtDays)), chapters: mean(rs.map((r) => r.storyChaptersDone)) };
}

/** Multi-account attempt: k alts play Story + Cup only, then funnel credits to the main via an
 * overpriced market listing (no price ceiling in market.ts; 5% fee burned). */
export function multiAccount(k: number, runs: number) {
  const alt = ARCHETYPES.find((x) => x.key === "story_skipper")!;
  const altRuns = Array.from({ length: runs }, (_, i) => runArchetype({ ...alt, storyReplays: false }, `alt${i}`, 14));
  const perAlt14 = mean(altRuns.map((r) => r.days[13]!.balance));
  const transferable = perAlt14 * (1 - GAME.marketFeePermille / 1000);
  return { k, perAlt14, transferable, total: transferable * k, referralRewards: k * 250 };
}

/** One-off sink capacity: everything a player can sink into facilities before they run out. */
export function oneOffSinkCapacity() {
  let stalls = 0;
  for (let n = GAME.baseStalls + 1; n <= GAME.maxStalls; n++) stalls += GAME.stallCost(n);
  const trainer = GAME.facility.trainer.reduce((a, b) => a + b, 0);
  const vet = GAME.facility.vet.reduce((a, b) => a + b, 0);
  const entry = GAME.entryTierCost.reduce((a, b) => a + b, 0);
  return { stalls, trainer, vet, entry, total: stalls + trainer + vet + entry };
}
