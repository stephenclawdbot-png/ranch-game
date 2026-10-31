/**
 * Jockeys (docs/design/jockeys.md, Phase 1: roster and riding).
 *
 * Jockeys are computer-controlled riders with careers that outlive any one stable. Four skills
 * (0..1000 realised, each with a hidden potential ceiling) map onto the engine's sealed per-runner
 * kit (`jockeyKit`): small, published effects (best vs worst about 2-3 OR in total,
 * tools/balance/jockeys.report.ts). Apprentices claim a weight allowance in handicaps until they
 * have ridden enough winners. Credits only: nothing here touches USDG, packs or the chain.
 *
 * Pure and deterministic: seeds and times are always passed in.
 */
import type { RaceKit } from "@thoroughbred/shared";
import { raceDayPrice, type RaceDayPrice } from "./raceDay";
import { Rng, seedFrom } from "./rng";
import { MS_PER_DAY } from "./time";

export const JOCKEY_SKILLS = ["gate", "pace", "finish", "handling"] as const;
export type JockeySkill = (typeof JOCKEY_SKILLS)[number];
export type JockeySkills = Record<JockeySkill, number>;

export const JOCKEY_SKILL_LABELS: Record<JockeySkill, { label: string; effect: string }> = {
  gate: { label: "Gate", effect: "Breaking from the stalls: fewer slow starts." },
  pace: { label: "Pace judgement", effect: "Rates the horse through the race: less energy wasted." },
  finish: { label: "Finishing drive", effect: "Gets more out of the horse in a late battle." },
  handling: { label: "Horse handling", effect: "Steadier day form; settles a keen horse early." },
};

export const JOCKEY_STAGES = ["apprentice", "prime", "veteran"] as const;
export type JockeyStage = (typeof JOCKEY_STAGES)[number];

/** Shown on the jockey's page now; weights contract choices in Phase 2. */
export const JOCKEY_PERSONALITIES = ["money", "ambitious", "loyal", "workhorse"] as const;
export type JockeyPersonality = (typeof JOCKEY_PERSONALITIES)[number];
export const JOCKEY_PERSONALITY_LABELS: Record<JockeyPersonality, { label: string; blurb: string }> = {
  money: { label: "Money-minded", blurb: "Rides for whoever pays best." },
  ambitious: { label: "Ambitious", blurb: "Wants the best horses and the big races." },
  loyal: { label: "Loyal", blurb: "Values time and big wins together." },
  workhorse: { label: "Workhorse", blurb: "Just wants plenty of rides." },
};

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** Most jockeys one stable can hold (signed or developed). Every stable starts with one apprentice. */
export const JOCKEYS_PER_STABLE_MAX = 3;
/** Target size of the whole jockey pool per active stable (active = raced or logged in within 14 days). */
export const JOCKEY_POOL_PER_ACTIVE_STABLE = 1.5;
/** A stable counts as active when it raced or logged in within this many days. */
export const JOCKEY_ACTIVE_STABLE_DAYS = 14;
/** A stable idle this many days releases its jockeys to the Club pool. */
export const JOCKEY_IDLE_RELEASE_DAYS = 21;
/** Retirements are announced this many weeks ahead (a farewell ride or two). */
export const JOCKEY_RETIREMENT_NOTICE_WEEKS = 2;
/**
 * Career length in weeks (a season is 4 weeks): apprentice, prime, then a veteran stage drawn per
 * jockey in [veteranMin, veteranMax]. Total 20-24 weeks (5-6 seasons). Shorten `prime` to ~4 for
 * ~3-season careers.
 */
export const JOCKEY_CAREER_WEEKS = { apprentice: 4, prime: 12, veteranMin: 4, veteranMax: 8 } as const;
/** Apprentice weight allowance: `lb` claimed until the jockey has ridden `untilWins` winners. Handicaps only. */
export const APPRENTICE_CLAIMS: readonly { lb: number; untilWins: number }[] = [
  { lb: 7, untilWins: 10 },
  { lb: 5, untilWins: 25 },
  { lb: 3, untilWins: 50 },
];
/** Two rides by one jockey need post times at least this far apart. */
export const JOCKEY_CLASH_MS = 10 * 60_000;
/**
 * Skill growth per ride: each skill moves floor(gap × xp / JOCKEY_GROWTH_DIV) towards its
 * potential (at least 1 while below it), so growth is fast early and slow near the ceiling.
 */
export const JOCKEY_GROWTH_DIV = 1_400;
/** Experience a ride is worth: base, plus up to this much more for a strong field and a rich race. */
export const JOCKEY_XP_BASE = 10;
export const JOCKEY_XP_FIELD_MAX = 15;
export const JOCKEY_XP_PURSE_MAX = 15;
/** Veteran decline per week, skill points (realised and potential); pace judgement holds. */
export const JOCKEY_VETERAN_DECLINE: JockeySkills = { gate: 14, pace: 2, finish: 12, handling: 8 };
/** Rides until the potential range on a jockey's page narrows to one grade. */
export const JOCKEY_SCOUT_RIDES = 60;
/** Width (skill points) of the potential range with no rides yet. */
export const JOCKEY_SCOUT_SPREAD = 300;

/**
 * Engine kit per skill point (0..1000), as the share of a cost that still applies (permille):
 * gate 1000 halves the slow-start chance; pace 1000 saves 4% of the energy drain; finish 0
 * keeps 70% of the late-battle response (1000 keeps all of it); handling 1000 narrows day form by
 * 22% and settles a keen horse's extra early drain by 55% (C-grade ≈ the old journeyman, A ≈ the
 * old top jockey).
 */
export const JOCKEY_KIT = {
  slowStartCut: 500,
  drainCut: 40,
  battleFloor: 700,
  formAmpCut: 220,
  keenCut: 550,
} as const;

/** Grade floors on the 0..1000 skill scale (overall = mean of the four skills). */
export const JOCKEY_GRADE_FLOORS: readonly [JockeyGrade, number][] = [
  ["A", 750],
  ["B", 600],
  ["C", 450],
  ["D", 300],
  ["E", 0],
];
export type JockeyGrade = "A" | "B" | "C" | "D" | "E";
export const JOCKEY_GRADES: readonly JockeyGrade[] = ["A", "B", "C", "D", "E"];

/**
 * Freelance booking fee by grade: a share of the purse with a floor and cap (raceDay prices). A
 * C-grade freelancer costs what the old journeyman did, an A-grade what the old top jockey did.
 */
export const JOCKEY_FREELANCE_PRICE: Record<JockeyGrade, RaceDayPrice> = {
  A: { purseBps: 500, floor: 100, cap: 3_000 },
  B: { purseBps: 375, floor: 80, cap: 2_250 },
  C: { purseBps: 250, floor: 50, cap: 1_500 },
  D: { purseBps: 150, floor: 30, cap: 900 },
  E: { purseBps: 100, floor: 20, cap: 600 },
};
/** One-off signing fee (Phase 1, no contracts yet) for an unsigned freelancer, by grade. Burned. */
export const JOCKEY_SIGNING_FEE: Record<JockeyGrade, number> = { A: 4_000, B: 2_000, C: 1_000, D: 500, E: 250 };

// ---------------------------------------------------------------------------
// Grades and display
// ---------------------------------------------------------------------------

export function jockeyGradeOf(value: number): JockeyGrade {
  for (const [g, floor] of JOCKEY_GRADE_FLOORS) if (value >= floor) return g;
  return "E";
}

/** Mean of the four skills (floored). */
export function jockeyOverall(skills: JockeySkills): number {
  return Math.floor((skills.gate + skills.pace + skills.finish + skills.handling) / 4);
}

export function jockeyGrade(skills: JockeySkills): JockeyGrade {
  return jockeyGradeOf(jockeyOverall(skills));
}

/**
 * The potential range a page shows ("C to A"): starts JOCKEY_SCOUT_SPREAD wide around the true
 * potential (offset per jockey from its seed, so the middle doesn't give it away) and narrows to
 * the true value after JOCKEY_SCOUT_RIDES rides. Never below what the jockey already shows.
 */
export function potentialRange(realised: number, potential: number, rides: number, seed: string, skill: JockeySkill | "overall" = "overall"): { lo: number; hi: number; loGrade: JockeyGrade; hiGrade: JockeyGrade } {
  const left = Math.max(0, JOCKEY_SCOUT_RIDES - Math.max(0, rides));
  const spread = Math.floor((JOCKEY_SCOUT_SPREAD * left) / JOCKEY_SCOUT_RIDES);
  const share = 200 + new Rng(seedFrom("jockey-scout", seed, skill)).int(601); // 200..800 permille below
  const lo = Math.max(realised, potential - Math.floor((spread * share) / 1000));
  const hi = Math.min(1000, Math.max(lo, potential + spread - Math.floor((spread * share) / 1000)));
  return { lo, hi, loGrade: jockeyGradeOf(lo), hiGrade: jockeyGradeOf(hi) };
}

/** "C to A", or one grade once the range has narrowed. */
export function potentialLabel(r: { loGrade: JockeyGrade; hiGrade: JockeyGrade }): string {
  return r.loGrade === r.hiGrade ? r.loGrade : `${r.loGrade} to ${r.hiGrade}`;
}

/** Apprentice allowance (lb) for a jockey with this many career winners; 0 once out of their claim. */
export function apprenticeClaimLb(wins: number): number {
  for (const c of APPRENTICE_CLAIMS) if (wins < c.untilWins) return c.lb;
  return 0;
}

/** Racecard name: initial and surname, with the claim in brackets ("T. Ashby (5)"). */
export function jockeyCardName(name: string, claimLb = 0): string {
  const parts = name.trim().split(/\s+/);
  const short = parts.length > 1 ? `${parts[0]![0]}. ${parts.slice(1).join(" ")}` : name;
  return claimLb > 0 ? `${short} (${claimLb})` : short;
}

// ---------------------------------------------------------------------------
// Engine kit
// ---------------------------------------------------------------------------

const clampSkill = (v: number) => (v < 0 ? 0 : v > 1000 ? 1000 : Math.floor(v));

/** The sealed engine kit fields a jockey with these skills brings to a ride (all five, always present). */
export function jockeyKit(skills: JockeySkills): Required<Pick<RaceKit, "slowStartPermille" | "drainPermille" | "battlePermille" | "formAmpPermille" | "keenPermille">> {
  const g = clampSkill(skills.gate);
  const p = clampSkill(skills.pace);
  const f = clampSkill(skills.finish);
  const h = clampSkill(skills.handling);
  return {
    slowStartPermille: 1000 - Math.floor((g * JOCKEY_KIT.slowStartCut) / 1000),
    drainPermille: 1000 - Math.floor((p * JOCKEY_KIT.drainCut) / 1000),
    battlePermille: JOCKEY_KIT.battleFloor + Math.floor((f * (1000 - JOCKEY_KIT.battleFloor)) / 1000),
    formAmpPermille: 1000 - Math.floor((h * JOCKEY_KIT.formAmpCut) / 1000),
    keenPermille: 1000 - Math.floor((h * JOCKEY_KIT.keenCut) / 1000),
  };
}

/** A jockey's kit merged with race-day equipment kit (shoes keep their own field). */
export function withJockeyKit(kit: RaceKit | undefined, skills: JockeySkills): RaceKit {
  return { ...(kit ?? {}), ...jockeyKit(skills) };
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

/** Credits to book a freelancer of this grade for one ride in a race with this purse. */
export function freelanceFee(grade: JockeyGrade, purse: number): number {
  return raceDayPrice(JOCKEY_FREELANCE_PRICE[grade], purse);
}

export function signingFee(grade: JockeyGrade): number {
  return JOCKEY_SIGNING_FEE[grade];
}

// ---------------------------------------------------------------------------
// Growth, ageing, retirement
// ---------------------------------------------------------------------------

/**
 * Experience from one ride: JOCKEY_XP_BASE, plus up to JOCKEY_XP_FIELD_MAX for the field's
 * strength (mean OR, 0 at OR 30 or below, full at 90+) and up to JOCKEY_XP_PURSE_MAX for the
 * purse (full at 6,000+).
 */
export function rideExperience(race: { purse: number; fieldMeanOr: number }): number {
  const field = Math.floor((Math.min(60, Math.max(0, race.fieldMeanOr - 30)) * JOCKEY_XP_FIELD_MAX) / 60);
  const purse = Math.floor((Math.min(6_000, Math.max(0, race.purse)) * JOCKEY_XP_PURSE_MAX) / 6_000);
  return JOCKEY_XP_BASE + field + purse;
}

/** Skills after a ride worth `xp`: each moves towards its potential, fast early and slowly near the ceiling. */
export function growSkills(skills: JockeySkills, potential: JockeySkills, xp: number): JockeySkills {
  const out = { ...skills };
  for (const k of JOCKEY_SKILLS) {
    const gap = potential[k] - skills[k];
    if (gap <= 0 || xp <= 0) continue;
    out[k] = Math.min(potential[k], skills[k] + Math.max(1, Math.floor((gap * xp) / JOCKEY_GROWTH_DIV)));
  }
  return out;
}

/** A week of veteran decline: realised and potential fall (pace judgement barely). */
export function declineSkills(skills: JockeySkills, potential: JockeySkills): { skills: JockeySkills; potential: JockeySkills } {
  const s = { ...skills };
  const p = { ...potential };
  for (const k of JOCKEY_SKILLS) {
    p[k] = Math.max(0, p[k] - JOCKEY_VETERAN_DECLINE[k]);
    s[k] = Math.max(0, Math.min(p[k], s[k] - JOCKEY_VETERAN_DECLINE[k]));
  }
  return { skills: s, potential: p };
}

const WEEK_MS = 7 * MS_PER_DAY;

/** Career stage at `nowMs` for a jockey born (started riding) at `bornMs`. */
export function jockeyStageAt(bornMs: number, nowMs: number): JockeyStage {
  const weeks = Math.floor((nowMs - bornMs) / WEEK_MS);
  if (weeks < JOCKEY_CAREER_WEEKS.apprentice) return "apprentice";
  if (weeks < JOCKEY_CAREER_WEEKS.apprentice + JOCKEY_CAREER_WEEKS.prime) return "prime";
  return "veteran";
}

/** When a jockey born at `bornMs` with this seed retires (the veteran stage's length is drawn from the seed). */
export function jockeyRetireAt(bornMs: number, seed: string): number {
  const c = JOCKEY_CAREER_WEEKS;
  const vet = c.veteranMin + new Rng(seedFrom("jockey-career", seed)).int(c.veteranMax - c.veteranMin + 1);
  return bornMs + (c.apprentice + c.prime + vet) * WEEK_MS;
}

/** The retirement is announced (and shown) from this time. */
export function retirementAnnouncedAt(retireAtMs: number): number {
  return retireAtMs - JOCKEY_RETIREMENT_NOTICE_WEEKS * WEEK_MS;
}

// ---------------------------------------------------------------------------
// Supply
// ---------------------------------------------------------------------------

/** The pool size the game aims for with this many active stables. */
export function jockeyPoolTarget(activeStables: number): number {
  return Math.ceil(Math.max(0, activeStables) * JOCKEY_POOL_PER_ACTIVE_STABLE);
}

/** New apprentices this week: whatever brings the pool back to target (never negative; surplus drains by retirement). */
export function jockeyIntake(activeStables: number, poolSize: number): number {
  return Math.max(0, jockeyPoolTarget(activeStables) - Math.max(0, poolSize));
}

/** Whether a stable may take one more jockey. */
export function canHoldAnother(heldNow: number): boolean {
  return heldNow < JOCKEYS_PER_STABLE_MAX;
}

/** Two post times clash for one jockey when they are closer than JOCKEY_CLASH_MS. */
export function ridesClash(aPostMs: number, bPostMs: number): boolean {
  return Math.abs(aPostMs - bPostMs) < JOCKEY_CLASH_MS;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Tom", "Harry", "Jack", "Oliver", "George", "Alfie", "Charlie", "Freddie", "Archie", "Theo",
  "Ollie", "Sam", "Joe", "Ben", "Callum", "Rory", "Finn", "Ewan", "Lewis", "Hamish",
  "Dougie", "Conor", "Niall", "Rhys", "Owen", "Gareth", "Dylan", "Kit", "Ned", "Alex",
  "Amy", "Lucy", "Ellie", "Grace", "Hannah", "Megan", "Chloe", "Isla", "Freya", "Molly",
  "Rosie", "Daisy", "Bethan", "Siobhan", "Niamh", "Kirsty", "Fern", "Harriet", "Jess", "Poppy",
] as const;
// Ordinary British and Irish surnames; famous riders' surnames are deliberately left out.
const SURNAMES = [
  "Ashby", "Thornton", "Pemberton", "Hollis", "Ridley", "Fairbairn", "Calloway", "Dunmore", "Hartley", "Wetherby",
  "Lockwood", "Brannigan", "Pickering", "Ormsby", "Kettering", "Saltmarsh", "Greenhalgh", "Bramwell", "Tolland", "Rookwood",
  "Hasledine", "Merriweather", "Penrose", "Alderton", "Blackwood", "Coverdale", "Farrow", "Gilchrist", "Hebden", "Ingleby",
  "Jessop", "Kilbride", "Langstaff", "Maddox", "Nettleship", "Oakes", "Pryce", "Quigley", "Rawcliffe", "Sowerby",
  "Tunstall", "Upton", "Varley", "Whitlock", "Yardley", "Ackroyd", "Barraclough", "Cheshire", "Dalby", "Earnshaw",
  "Fenwick", "Garside", "Holroyd", "Illingworth", "Kirkbride", "Lowther", "Mossop", "Naylor", "Ogden", "Pargeter",
] as const;

/** A jockey's name, deterministic from its seed. */
export function jockeyName(seed: string): string {
  const r = new Rng(seedFrom("jockey-name", seed));
  return `${FIRST_NAMES[r.int(FIRST_NAMES.length)]} ${SURNAMES[r.int(SURNAMES.length)]}`;
}

export interface JockeyProfile {
  name: string;
  personality: JockeyPersonality;
  skills: JockeySkills;
  potential: JockeySkills;
}

/**
 * A new apprentice from a seed: potential 400..950 per skill around a per-jockey talent level,
 * realised 150..400 (an apprentice is raw). Most top out C-B; a few are A prospects.
 */
export function generateApprentice(seed: string): JockeyProfile {
  const r = new Rng(seedFrom("jockey-gen", seed));
  // Talent: the mean of two uniforms (a hump around the middle), 450..900.
  const talent = 450 + Math.floor((r.int(451) + r.int(451)) / 2);
  const potential = {} as JockeySkills;
  const skills = {} as JockeySkills;
  for (const k of JOCKEY_SKILLS) {
    potential[k] = Math.max(400, Math.min(950, talent + r.range(-120, 120)));
    skills[k] = Math.min(potential[k], 150 + r.int(251));
  }
  return { name: jockeyName(seed), personality: JOCKEY_PERSONALITIES[r.int(JOCKEY_PERSONALITIES.length)]!, skills, potential };
}

/**
 * A jockey for the starting Club pool, already `weeksIn` weeks into a career: grown as if it had
 * ridden `ridesPerWeek` average rides a week (and declined if it is a veteran by now), with a
 * winners tally consistent with that many rides (about one in eight).
 */
export function generateSeasonedJockey(seed: string, weeksIn: number, ridesPerWeek = 12): JockeyProfile & { rides: number; wins: number; experience: number } {
  const base = generateApprentice(seed);
  let skills = base.skills;
  let potential = base.potential;
  const xp = rideExperience({ purse: 1_500, fieldMeanOr: 60 });
  let rides = 0;
  const vetFrom = JOCKEY_CAREER_WEEKS.apprentice + JOCKEY_CAREER_WEEKS.prime;
  for (let w = 0; w < weeksIn; w++) {
    for (let i = 0; i < ridesPerWeek; i++) skills = growSkills(skills, potential, xp);
    rides += ridesPerWeek;
    if (w >= vetFrom) ({ skills, potential } = declineSkills(skills, potential));
  }
  const r = new Rng(seedFrom("jockey-tally", seed));
  const wins = Math.floor((rides * (80 + r.int(90))) / 1000);
  return { ...base, skills, potential, rides, wins, experience: rides * xp };
}
