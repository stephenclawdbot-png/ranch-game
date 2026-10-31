/**
 * The injury catalogue: what a horse actually hurt, by name.
 *
 * condition.ts decides WHETHER a horse is hurt and HOW BADLY (the severity and the healing time),
 * exactly as before this catalogue existed: same chance, same severity split, same healing hours,
 * same random stream. This module only gives that injury a real name, picked from its own random
 * stream (`${seed}|injury-kind`), so naming never shifts any other roll.
 *
 * How a name is picked (deterministic in the seed):
 * 1. Only injuries of the rolled severity whose typical recovery covers the rolled number of days
 *    are candidates. Every day of every severity's range is covered by at least one injury, so a
 *    named injury always heals in its own typical time and the healing hours are untouched.
 * 2. Each candidate has a base weight, multiplied by the context it happened in (KNOBS §5a):
 *    firm going favours sore shins, bruised feet and fractures; soft or heavy going favours
 *    tendon and ligament strains; long trips and tiredness favour tying-up and tendons; an
 *    all-out ride favours tendons and fractures; sprints favour sore shins; fragile legs favour
 *    fractures and tendons; veteran legs favour joint damage; deep ground when tired favours
 *    muscle trouble.
 * 3. One weighted pick from `${seed}|injury-kind`.
 *
 * Old stored injuries have no kind and show as their severity ("Minor injury" ...).
 *
 * Pure and integer-only (no clocks, no Math.random). Wording is calm and respectful: these are
 * real injuries that real racehorses get.
 */
import type { Going } from "@thoroughbred/shared";
import type { Injury, InjurySeverity, RideIntensity } from "./types";
import { Rng } from "./rng";

/** Where on the horse. */
export type InjuryArea = "front_leg" | "hind_leg" | "foot" | "back" | "heart_lungs" | "other";

export const INJURY_AREA_LABEL: Record<InjuryArea, string> = {
  front_leg: "Front leg",
  hind_leg: "Hind leg",
  foot: "Foot",
  back: "Back and hindquarters",
  heart_lungs: "Heart and lungs",
  other: "Other",
};

/** Context that makes a particular injury likelier (never changes whether a horse is hurt). */
export type InjuryTrigger = "firm" | "soft" | "heavy" | "sprint" | "long" | "tired" | "all_out" | "fragile" | "veteran" | "deep_tired";

/** Sprints: this distance or shorter. */
export const INJURY_SPRINT_MAX_M = 1400;
/** Long trips: over this distance (the same line as the injury-risk "Long trip" factor). */
export const INJURY_LONG_OVER_M = 2400;

export const INJURY_TRIGGER_LABEL: Record<InjuryTrigger, string> = {
  firm: "firm going",
  soft: "soft or heavy going",
  heavy: "heavy going",
  sprint: "sprints (1,400 m or less)",
  long: "long trips (over 2,400 m)",
  tired: "racing or working tired",
  all_out: "an all-out ride",
  fragile: "fragile legs",
  veteran: "veteran legs",
  deep_tired: "deep ground when tired",
};

export interface InjuryKindSpec {
  key: string;
  name: string;
  severity: InjurySeverity;
  area: InjuryArea;
  /** One plain-English line. */
  description: string;
  /** Typical recovery in days, inside its severity's range (INJURY_DAYS). */
  days: readonly [number, number];
  /** Base weight among injuries of its severity. */
  weight: number;
  /** Context multipliers, permille (1500 = 1.5x as likely in that context). */
  boosts: Partial<Record<InjuryTrigger, number>>;
}

/**
 * The catalogue (KNOBS §5a), by severity. Day ranges sit inside the severity's healing range
 * (condition.ts INJURY_DAYS: minor 2-4, moderate 6-12, career-ending 14-21); career-ending
 * injuries still heal that far, enough for stud, the broodmare band or the Legacy Farm.
 */
export const INJURY_KINDS: readonly InjuryKindSpec[] = [
  // --- Minor (2-4 days) ---------------------------------------------------------------------
  {
    key: "sore_shins",
    name: "Sore shins",
    severity: "minor",
    area: "front_leg",
    description: "Bucked shins: tender, inflamed shin bones from fast work, common in young horses.",
    days: [3, 4],
    weight: 100,
    boosts: { firm: 1800, sprint: 1600 },
  },
  {
    key: "bruised_sole",
    name: "Bruised foot",
    severity: "minor",
    area: "foot",
    description: "A bruise to the sole of the hoof from hard ground or a stone; sore for a few days.",
    days: [2, 3],
    weight: 100,
    boosts: { firm: 1500 },
  },
  {
    key: "overreach",
    name: "Overreach cut",
    severity: "minor",
    area: "front_leg",
    description: "A hind hoof clipped the back of a front heel and left a small cut.",
    days: [2, 3],
    weight: 80,
    boosts: { soft: 1500, tired: 1300 },
  },
  {
    key: "tying_up",
    name: "Mild tying-up",
    severity: "minor",
    area: "back",
    description: "Stiff, cramped muscles over the back and quarters after effort; eases with rest.",
    days: [2, 3],
    weight: 70,
    boosts: { tired: 2000, long: 1600, deep_tired: 1800 },
  },
  {
    key: "lost_shoe",
    name: "Lost shoe and a bruise",
    severity: "minor",
    area: "foot",
    description: "A shoe came off in running and the hoof wall is bruised until the farrier re-shoes it.",
    days: [2, 2],
    weight: 60,
    boosts: { heavy: 1600, soft: 1300 },
  },
  {
    key: "knocked_joint",
    name: "Knocked joint",
    severity: "minor",
    area: "hind_leg",
    description: "A bump to a fetlock or hock in the race; a little swelling that settles.",
    days: [2, 4],
    weight: 80,
    boosts: {},
  },
  // --- Moderate (6-12 days) -----------------------------------------------------------------
  {
    key: "tendon_strain",
    name: "Tendon strain",
    severity: "moderate",
    area: "front_leg",
    description: "Mild strain of a flexor tendon behind the cannon; heat and swelling that need box rest.",
    days: [8, 12],
    weight: 100,
    boosts: { soft: 1500, tired: 1500, all_out: 1500, long: 1300, fragile: 1500 },
  },
  {
    key: "foot_abscess",
    name: "Foot abscess",
    severity: "moderate",
    area: "foot",
    description: "An infection trapped inside the hoof; lame until it is drained and poulticed.",
    days: [6, 9],
    weight: 80,
    boosts: { heavy: 1600, soft: 1300 },
  },
  {
    key: "stress_fracture",
    name: "Hairline fracture",
    severity: "moderate",
    area: "front_leg",
    description: "A fine stress crack in the cannon bone; it knits with rest and slow work.",
    days: [9, 12],
    weight: 70,
    boosts: { firm: 1700, all_out: 1400, sprint: 1300, fragile: 1600 },
  },
  {
    key: "back_strain",
    name: "Back strain",
    severity: "moderate",
    area: "back",
    description: "A sore sacroiliac or back muscles from slipping or pulling hard; needs rest and physio.",
    days: [6, 10],
    weight: 70,
    boosts: { heavy: 1500, tired: 1300, deep_tired: 1500 },
  },
  {
    key: "splint",
    name: "Splint injury",
    severity: "moderate",
    area: "front_leg",
    description: "Inflammation of a small splint bone beside the cannon; it firms up with rest.",
    days: [6, 9],
    weight: 70,
    boosts: { firm: 1500, sprint: 1300 },
  },
  {
    key: "eiph_mild",
    name: "Bled from the lungs (mild)",
    severity: "moderate",
    area: "heart_lungs",
    description: "A little bleeding in the lungs under hard effort (EIPH); a short break lets them settle.",
    days: [6, 8],
    weight: 60,
    boosts: { long: 1300, all_out: 1500, tired: 1200 },
  },
  // --- Career-ending (14-21 days to settle; no more racing) ---------------------------------
  {
    key: "bowed_tendon",
    name: "Bowed tendon",
    severity: "career_ending",
    area: "front_leg",
    description: "A badly torn flexor tendon that bows the back of the leg; sound for a quiet life, not for racing.",
    days: [16, 21],
    weight: 100,
    boosts: { soft: 1600, tired: 1500, all_out: 1500, fragile: 1500, long: 1300 },
  },
  {
    key: "suspensory",
    name: "Suspensory ligament injury",
    severity: "career_ending",
    area: "front_leg",
    description: "A torn suspensory ligament, the sling that holds up the fetlock; it heals, but not for racing.",
    days: [15, 21],
    weight: 80,
    boosts: { soft: 1600, heavy: 1300, tired: 1300, long: 1300 },
  },
  {
    key: "sesamoid_fracture",
    name: "Sesamoid fracture",
    severity: "career_ending",
    area: "front_leg",
    description: "A break in one of the small bones at the back of the fetlock; repaired for a comfortable retirement.",
    days: [16, 21],
    weight: 70,
    boosts: { firm: 1600, all_out: 1500, fragile: 1600, tired: 1300 },
  },
  {
    key: "condylar_fracture",
    name: "Condylar fracture",
    severity: "career_ending",
    area: "front_leg",
    description: "A fracture at the lower end of the cannon bone, usually repaired with screws; retired sound for pasture or stud.",
    days: [18, 21],
    weight: 60,
    boosts: { firm: 1700, all_out: 1600, fragile: 1700, sprint: 1200 },
  },
  {
    key: "joint_damage",
    name: "Chronic joint damage",
    severity: "career_ending",
    area: "front_leg",
    description: "Worn cartilage and arthritic changes in a knee or fetlock; comfortable at pasture, not in a race.",
    days: [14, 17],
    weight: 60,
    boosts: { veteran: 2500, firm: 1300 },
  },
  {
    key: "recurrent_bleeding",
    name: "Severe recurrent bleeding",
    severity: "career_ending",
    area: "heart_lungs",
    description: "Heavy bleeding from the lungs that keeps coming back under race effort; fine for a quiet life.",
    days: [14, 16],
    weight: 50,
    boosts: { long: 1400, all_out: 1400 },
  },
  // --- Fatal (Live races only; never Story races or training) -------------------------------
  {
    key: "catastrophic_fracture",
    name: "Catastrophic leg fracture",
    severity: "fatal",
    area: "front_leg",
    description: "A breakdown: a leg fracture that could not be repaired. The vets put the horse's welfare first.",
    days: [21, 21],
    weight: 100,
    boosts: { firm: 1600, all_out: 1500, fragile: 1700, tired: 1300 },
  },
  {
    key: "cardiac_failure",
    name: "Sudden heart failure",
    severity: "fatal",
    area: "heart_lungs",
    description: "The heart failed suddenly during the race. It happens without warning, even to sound horses.",
    days: [21, 21],
    weight: 25,
    boosts: { long: 1300, all_out: 1300 },
  },
  {
    key: "pulmonary_haemorrhage",
    name: "Severe bleeding from the lungs",
    severity: "fatal",
    area: "heart_lungs",
    description: "A sudden, severe haemorrhage in the lungs under race effort.",
    days: [21, 21],
    weight: 20,
    boosts: { long: 1300, all_out: 1400 },
  },
];

const BY_KEY = new Map(INJURY_KINDS.map((k) => [k.key, k]));

/** The catalogue entry for a key, or undefined (old injuries have no kind). */
export function injuryKindOf(key: string | null | undefined): InjuryKindSpec | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

export const INJURY_SEVERITY_LABEL: Record<InjurySeverity, string> = {
  minor: "Minor injury",
  moderate: "Moderate injury",
  career_ending: "Career-ending injury",
  fatal: "Fatal injury",
};

/** What the player sees as the injury's name: the catalogue name, else the severity ("Minor injury"). */
export function injuryName(injury: Pick<Injury, "severity" | "kind">): string {
  return injuryKindOf(injury.kind)?.name ?? INJURY_SEVERITY_LABEL[injury.severity];
}

/** The same, from loosely typed stored data (inbox, log, jsonb rows). */
export function injuryNameOf(severity: string | null | undefined, kind?: string | null): string {
  const k = injuryKindOf(kind);
  if (k) return k.name;
  return (INJURY_SEVERITY_LABEL as Record<string, string>)[severity ?? ""] ?? "Injury";
}

/** Context an injury happens in. Everything optional: training injuries know only tiredness. */
export interface InjuryContext {
  going?: Going;
  distanceM?: number;
  intensity?: RideIntensity;
  /** Fatigue above the tired threshold (condition.ts TIRED_THRESHOLD). */
  tired?: boolean;
  fragile?: boolean;
  veteran?: boolean;
}

/** The triggers a context switches on. */
export function injuryTriggers(ctx: InjuryContext): InjuryTrigger[] {
  const out: InjuryTrigger[] = [];
  const deep = ctx.going === "soft" || ctx.going === "heavy";
  if (ctx.going === "firm") out.push("firm");
  if (deep) out.push("soft");
  if (ctx.going === "heavy") out.push("heavy");
  if (ctx.distanceM !== undefined && ctx.distanceM <= INJURY_SPRINT_MAX_M) out.push("sprint");
  if (ctx.distanceM !== undefined && ctx.distanceM > INJURY_LONG_OVER_M) out.push("long");
  if (ctx.tired) out.push("tired");
  if (ctx.intensity === "all_out") out.push("all_out");
  if (ctx.fragile) out.push("fragile");
  if (ctx.veteran) out.push("veteran");
  if (deep && ctx.tired) out.push("deep_tired");
  return out;
}

/** A kind's weight in this context (integer). */
export function injuryKindWeight(spec: InjuryKindSpec, triggers: readonly InjuryTrigger[]): number {
  let w = spec.weight * 1000;
  for (const t of triggers) {
    const m = spec.boosts[t];
    if (m !== undefined) w = Math.floor((w * m) / 1000);
  }
  return Math.max(1, w);
}

/** Injuries of a severity that can take this many days to heal (all of the severity if none fit). */
function candidates(severity: InjurySeverity, days: number): InjuryKindSpec[] {
  const all = INJURY_KINDS.filter((k) => k.severity === severity);
  const fit = all.filter((k) => days >= k.days[0] && days <= k.days[1]);
  return fit.length ? fit : all;
}

/**
 * Name an injury of a known severity and healing time: a weighted pick, by context, among the
 * injuries of that severity whose typical recovery covers `days`. Its own random stream
 * (`${seed}|injury-kind`), so it never shifts another roll.
 */
export function pickInjuryKind(severity: InjurySeverity, days: number, ctx: InjuryContext, seed: string): string {
  const list = candidates(severity, days);
  const triggers = injuryTriggers(ctx);
  const i = new Rng(`${seed}|injury-kind`).weighted(list.map((k) => injuryKindWeight(k, triggers)));
  return list[i]!.key;
}

/**
 * Each named injury's chance (relative, integer) IF the horse is hurt in this context: exact over
 * the severity split (career-ending share, then 30% moderate and 70% minor, as condition.ts rolls
 * it) and the uniform healing days. Fatal ones are left out (a share of career-ending, Live only).
 * Most likely first.
 */
export function injuryKindShares(ctx: InjuryContext, careerEndingShare: number): { spec: InjuryKindSpec; share: number }[] {
  const triggers = injuryTriggers(ctx);
  const ce = Math.max(0, Math.min(1000, careerEndingShare));
  const sevP: [InjurySeverity, number, [number, number]][] = [
    ["minor", (1000 - ce) * 700, [2, 4]],
    ["moderate", (1000 - ce) * 300, [6, 12]],
    ["career_ending", ce * 1000, [14, 21]],
  ];
  const score = new Map<string, number>();
  for (const [sev, p, [lo, hi]] of sevP) {
    const nDays = hi - lo + 1;
    for (let d = lo; d <= hi; d++) {
      const list = candidates(sev, d);
      const ws = list.map((k) => injuryKindWeight(k, triggers));
      const total = ws.reduce((a, b) => a + b, 0);
      list.forEach((k, i) => score.set(k.key, (score.get(k.key) ?? 0) + Math.floor((p * ws[i]!) / total / nDays)));
    }
  }
  const order = new Map(INJURY_KINDS.map((k, i) => [k.key, i]));
  return [...score.entries()].sort((a, b) => b[1] - a[1] || order.get(a[0])! - order.get(b[0])!).map(([k, share]) => ({ spec: BY_KEY.get(k)!, share }));
}

/**
 * "Most likely if injured today" (entry sheet, Care tab): the `n` likeliest names overall (mostly
 * minor: most injuries are) and the likeliest moderate-or-worse one, when it isn't among them.
 */
export function likelyInjuries(ctx: InjuryContext, careerEndingShare: number, n = 2): { common: string[]; serious: string | null } {
  const all = injuryKindShares(ctx, careerEndingShare);
  const common = all.slice(0, n);
  const serious = all.find((k) => k.spec.severity !== "minor");
  return { common: common.map((k) => k.spec.name), serious: serious && !common.includes(serious) ? serious.spec.name : null };
}

/** The likely line as one phrase: "sore shins, knocked joint; if serious, tendon strain". */
export function likelyInjuriesText(l: { common: readonly string[]; serious: string | null }): string {
  const c = l.common.join(", ").toLowerCase();
  return l.serious ? `${c}; if serious, ${l.serious.toLowerCase()}` : c;
}

/** "firm going, sprints (1,400 m or less)" — what makes a kind likelier (wiki). */
export function injuryLikelierText(spec: InjuryKindSpec): string {
  const ts = (Object.keys(spec.boosts) as InjuryTrigger[]).sort((a, b) => spec.boosts[b]! - spec.boosts[a]!);
  // soft and heavy together read as one: "soft or heavy going (heavy most)"
  const both = ts.includes("soft") && ts.includes("heavy");
  const label = (t: InjuryTrigger) => (both && t === "soft" ? "soft or heavy going (heavy most)" : INJURY_TRIGGER_LABEL[t]);
  const shown = both ? ts.filter((t) => t !== "heavy") : ts;
  return shown.length ? shown.map(label).join(", ") : "nothing in particular: bad luck in running";
}
