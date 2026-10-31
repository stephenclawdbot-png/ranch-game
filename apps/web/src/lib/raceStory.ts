/**
 * The result in one sentence and one change (first-hour playtest, 2026-11-01): why your horse
 * won or lost, said the way a person at the rail would say it, and the ONE thing to try next.
 *
 * Every word comes from the race engine's own record of the run: the energy tank and speed in
 * the replay frames, where the horse was at each quarter, the engine's events (a slow start, a
 * boxed-in moment, "tiring") and the fit grades. Nothing is invented: a reason is only given when
 * the numbers show it, and the fallback ("the others were simply quicker") is itself measured
 * (the horse's best speed against the field's). Pure and deterministic.
 */
import { FRAME_FIELD, FRAME_STRIDE, type Horse, type RaceReplay, type RunningStyle } from "@thoroughbred/shared";
import { formatDistance, ordinal } from "./format";
import type { RaceAnalysis } from "./raceAnalysis";
import type { TryNextTip } from "./tryNext";

/**
 * Energy in the replay frames runs 0..1000 (the engine's tank, permille). The engine paces every
 * kick to what the tank can pay for, so nearly every horse crosses the line almost empty (median
 * about 35): "used too much early" is read from the tank two-thirds of the way round, against the
 * field's, and from the engine's own "tiring" call.
 */
export const TANK_FULL = 1000;
/** Crossed the line with at least this much left (about the field's top tenth): it had more to give. */
export const TANK_LEFT = 150;
/** Among the lowest this share of the field (permille) on energy two-thirds of the way round. */
export const LOW_TANK_PERMILLE = 250;

export type ReasonKind =
  | "made_all" // won from the front
  | "came_late" // won from off the pace
  | "won_handy" // won from a handy position
  | "slow_start" // missed the break
  | "ran_dry" // used too much early, nothing left late
  | "conditions" // a poor trip / surface / going fit
  | "boxed_in" // trapped behind horses late
  | "left_too_much" // finished with plenty left, too far back
  | "outpaced"; // the others had more speed

export type ChangeKind = "tactic" | "suited" | "fresh_horse" | "again";

export interface OneChange {
  kind: ChangeKind;
  /** For "tactic": the riding plan to try. */
  tactic?: RunningStyle;
  /** One or two sentences: what to change and why it may help. Never a promise. */
  text: string;
  /** The button: "Try again as a stalker". */
  label: string;
}

export interface RaceStory {
  kind: ReasonKind;
  /** One plain sentence: why it went that way. */
  reason: string;
  facts: RunFacts;
  /** The one change to try (your own losses only). */
  change: OneChange | null;
}

export interface RunFacts {
  /** Energy two-thirds of the way round, 0..1000, and its rank in the field (1 = least left). */
  energyAtTwoThirds: number;
  lowTankRank: number;
  /** The engine called the horse tiring ("has nothing left"): metres still to run then. */
  tiringWithM: number | null;
  /** Energy left at the line, 0..1000. */
  energyAtFinish: number;
  /** Rank of this horse's best speed in the field (1 = fastest). */
  topSpeedRank: number;
  /** Places lost (positive) or gained (negative) from the 3/4 point to the line. */
  lateChange: number;
  slowStart: boolean;
  boxedInLate: boolean;
}

function val(replay: RaceReplay, f: number, h: number, field: keyof typeof FRAME_FIELD): number {
  return replay.frames[f]![h * FRAME_STRIDE + FRAME_FIELD[field]]!;
}

/** The first frame at which horse h has covered `mm` (or the last frame). */
function frameAt(replay: RaceReplay, h: number, mm: number): number {
  for (let f = 0; f < replay.frames.length; f++) if (val(replay, f, h, "distanceMm") >= mm) return f;
  return replay.frames.length - 1;
}

/** What the replay says about one run (null when the horse isn't in it). */
export function runFacts(replay: RaceReplay, horseId: string, runningLine: readonly number[]): RunFacts | null {
  const h = replay.horses.findIndex((x) => x.horseId === horseId);
  if (h < 0 || replay.frames.length === 0) return null;
  const L = replay.trackLengthMm;
  const n = replay.horses.length;
  const finish = (i: number) => Math.max(0, frameAt(replay, i, L) - 1);
  const twoThirds = Array.from({ length: n }, (_, i) => val(replay, frameAt(replay, i, Math.floor((2 * L) / 3)), i, "energy"));
  const tops = Array.from({ length: n }, (_, i) => {
    let top = 0;
    for (let f = 0, end = finish(i); f <= end; f++) top = Math.max(top, val(replay, f, i, "speedMmS"));
    return top;
  });
  const mine = replay.events.filter((e) => e.horseId === horseId);
  const tiring = mine.find((e) => e.type === "tiring");
  const myFinish = finish(h);
  const halfTick = Math.floor((myFinish * replay.sampleEvery) / 2);
  return {
    energyAtTwoThirds: twoThirds[h]!,
    lowTankRank: 1 + twoThirds.filter((e) => e < twoThirds[h]!).length,
    tiringWithM: tiring ? Math.max(0, Math.round((L - val(replay, Math.min(replay.frames.length - 1, Math.floor(tiring.tick / replay.sampleEvery)), h, "distanceMm")) / 1000)) : null,
    energyAtFinish: val(replay, myFinish, h, "energy"),
    topSpeedRank: 1 + tops.filter((t) => t > tops[h]!).length,
    lateChange: (runningLine[3] ?? 0) - (runningLine[2] ?? 0),
    slowStart: mine.some((e) => e.type === "slow_start"),
    boxedInLate: mine.some((e) => e.type === "boxed_in" && e.tick >= halfTick),
  };
}

const RIDE: Record<RunningStyle, string> = { front: "a front-runner", stalker: "a stalker", closer: "a closer" };
const RIDE_HOW: Record<RunningStyle, string> = {
  front: "go to the front and set the pace",
  stalker: "sit just behind the leaders and save something for the finish",
  closer: "settle at the back and come with one late run",
};

/** A running style as a way of racing ("Going from the front is still his best way"). */
const OWN_WAY: Record<RunningStyle, string> = { front: "Going from the front", stalker: "Sitting just off the pace", closer: "Coming late" };

/** "the final furlong", "the last 400 m" */
export function toGo(m: number): string {
  if (m <= 220) return "the final furlong";
  const r = m >= 400 ? Math.round(m / 100) * 100 : Math.round(m / 50) * 50;
  return `the last ${formatDistance(r)}`;
}

/** Object and possessive pronouns ("cost him", "his best"). */
export function pron(sex: string) {
  const f = sex === "filly" || sex === "mare" || sex === "female";
  return f ? { she: "she", her: "her", him: "her", She: "She" } : { she: "he", her: "his", him: "him", She: "He" };
}

export interface StoryInput {
  horseId: string;
  analysis: Pick<RaceAnalysis, "position" | "fieldSize" | "runningLine" | "sectionals" | "fits" | "tactic">;
  horse: Pick<Horse, "name" | "sex" | "style" | "preferredDistanceM" | "preferredSurface">;
  replay: RaceReplay;
  /** The Why card's ranked "try next" tips (tryNext), first = biggest. */
  tips: readonly TryNextTip[];
  /** The owner's own runner: only then is a change suggested. */
  yours: boolean;
  /** A fresh horse in the stable to suggest instead (its name), or null. */
  freshAlternative?: string | null;
}

/**
 * Why it went that way in one sentence, and the one change. Losses are explained in priority
 * order: a missed break that left the horse at the back; using too much early (the engine's
 * "tiring" call, or among the least left two-thirds round, then losing ground); a poor fit
 * (trip, surface, going); boxed in late; finishing with plenty left from too far back; and
 * otherwise, measured, the others' better speed.
 */
export function raceStory(i: StoryInput): RaceStory | null {
  const facts = runFacts(i.replay, i.horseId, i.analysis.runningLine);
  return facts ? storyFromFacts(i, facts) : null;
}

export function storyFromFacts(i: StoryInput, facts: RunFacts): RaceStory {
  const { analysis: a, horse } = i;
  const race = i.replay.race;
  const p = pron(horse.sex);
  const n = a.fieldSize;
  const name = horse.name;
  const early = a.runningLine[0] ?? n;
  const q3 = a.runningLine[2] ?? n;
  const prominent = early <= Math.max(2, Math.ceil(n / 4));
  const back = early > Math.ceil(n / 2);
  const lateRank = a.sectionals.find((s) => s.segment === "late")?.rank ?? n;

  if (a.position === 1) {
    const kind: ReasonKind = early === 1 && q3 === 1 ? "made_all" : back ? "came_late" : "won_handy";
    const reason =
      kind === "made_all"
        ? `${name} went straight to the front and still had enough left to hold them all off.`
        : kind === "came_late"
          ? `${name} was ${ordinal(early)} early, saved energy at the back and came past them with the ${lateRank === 1 ? "fastest" : `${ordinal(lateRank)}-fastest`} finish.`
          : `${name} sat ${ordinal(early)} early, kept enough in the tank and quickened when it mattered.`;
    return { kind, reason, facts, change: null };
  }

  const poor = a.fits.filter((f) => f.level === "poor" && f.id !== "plan");
  const tripLong = poor.some((f) => f.id === "trip") && race.distanceM > horse.preferredDistanceM;
  const lowTank = facts.lowTankRank <= Math.max(1, Math.ceil((n * LOW_TANK_PERMILLE) / 1000));
  const lostLate = facts.lateChange > 0 || lateRank > Math.ceil(n / 2);
  const ranDry = facts.tiringWithM !== null ? lostLate : lowTank && early <= Math.ceil(n / 2) && (facts.lateChange >= 2 || (facts.lateChange > 0 && lateRank > Math.ceil(n / 2)));

  let kind: ReasonKind;
  let reason: string;
  if (facts.slowStart && back) {
    kind = "slow_start";
    reason = `${name} missed the break: slow out of the stalls, ${p.she} was ${ordinal(early)} early and never got back into it.`;
  } else if (ranDry) {
    kind = "ran_dry";
    const where = early === 1 ? "leading" : prominent ? "chasing the leader" : "keeping up";
    const when = facts.tiringWithM !== null ? `with ${toGo(facts.tiringWithM)} to go` : "in the closing stages";
    const dropped = facts.lateChange > 0 ? `, dropping from ${ordinal(q3)} to ${ordinal(a.position)}` : "";
    reason = tripLong
      ? `${name} ran out of energy ${when}${dropped}: ${formatDistance(race.distanceM)} is further than ${p.her} best (${formatDistance(horse.preferredDistanceM)}).`
      : `${name} used too much early ${where}, and had nothing left ${when}${dropped}.`;
  } else if (poor.length) {
    kind = "conditions";
    const words = poor.map((f) =>
      f.id === "trip"
        ? `${formatDistance(race.distanceM)} (${p.her} best is ${formatDistance(horse.preferredDistanceM)})`
        : f.id === "surface"
          ? `the ${race.surface} (${p.she} prefers ${horse.preferredSurface})`
          : `the ${race.going} ground`,
    );
    const both = words.join(" and ");
    reason = `${both[0]!.toUpperCase()}${both.slice(1)} didn't suit ${name}: it cost ${p.him} more than anything else today.`;
  } else if (facts.boxedInLate) {
    kind = "boxed_in";
    reason = `${name} got boxed in behind horses when they quickened and lost ${p.her} momentum: bad luck in running.`;
  } else if (facts.energyAtFinish >= TANK_LEFT && early > Math.ceil(n / 3) && a.position > 2) {
    kind = "left_too_much";
    reason = `${name} finished with plenty left in the tank (${Math.round(facts.energyAtFinish / 10)}%) but was ${ordinal(early)} early: too far back when the leaders kicked for home.`;
  } else {
    kind = "outpaced";
    reason =
      facts.topSpeedRank <= 2
        ? `${name} had the speed (${facts.topSpeedRank === 1 ? "the fastest" : "the 2nd-fastest"} top speed here) but not the finish: the ${a.position === 2 ? "winner" : "first few"} kept going better at the end.`
        : `No hard-luck story: the ${a.position === 2 ? "winner was" : "first few were"} simply quicker. ${name}'s best speed was the ${ordinal(facts.topSpeedRank)}-fastest of ${n}.`;
  }
  return { kind, reason, facts, change: i.yours ? oneChange(i, kind) : null };
}

/** The one change: always something the owner can do in one tap (a plan, a race that suits, another horse, or simply again). */
function oneChange(i: StoryInput, kind: ReasonKind): OneChange {
  const { analysis: a, horse } = i;
  const p = pron(horse.sex);
  const tactic = a.tactic;
  const top = i.tips[0];
  const tactical = (t: RunningStyle, why: string): OneChange => ({
    kind: "tactic",
    tactic: t,
    text: `Ride ${p.him} as ${RIDE[t]}: ${RIDE_HOW[t]}. ${why}${t === horse.style ? "" : ` It isn't ${p.her} natural style, so it's a trade-off.`}`,
    label: `Try again as ${RIDE[t]}`,
  });
  const suited = (why: string): OneChange => ({
    kind: "suited",
    text: `${why} Race ${p.him} at ${p.her} best: about ${formatDistance(horse.preferredDistanceM)} on ${horse.preferredSurface}, good ground.`,
    label: "Try again at a race that suits",
  });
  const fresh = (why: string): OneChange | null =>
    i.freshAlternative ? { kind: "fresh_horse", text: `${why} Give ${i.freshAlternative} a run meanwhile: fresh and ready.`, label: `Race ${i.freshAlternative} instead` } : null;
  const again = (why: string): OneChange => ({ kind: "again", text: why, label: `Race ${horse.name} again` });

  // Ridden against its natural style, and that cost it most: back to its own style.
  if (tactic !== horse.style && top?.id === "plan") return tactical(horse.style, `That's how ${p.she} runs best.`);
  switch (kind) {
    case "ran_dry":
      // Measured on the engine (same field, same luck): holding a horse up against its natural
      // style loses more than it saves, so the change is never "ride it slower" on its own way.
      // Ridden against its style: back to it. Too far: a race at its trip. Otherwise it is stamina.
      if (tactic !== horse.style) return tactical(horse.style, `That's how ${p.she} runs best, and ${p.she}'ll judge ${p.her} own pace.`);
      if (a.fits.some((f) => f.id === "trip" && f.level !== "good") && i.replay.race.distanceM > horse.preferredDistanceM) return suited("The trip was a little far to last.");
      return (
        fresh(`${OWN_WAY[horse.style]} is still ${p.her} best way: stamina is what ran out, and stamina work on the gallops builds it.`) ??
        again(`${OWN_WAY[horse.style]} is still ${p.her} best way: stamina is what ran out, and stamina work on the gallops builds it.`)
      );
    case "left_too_much":
      if (tactic === "closer") return tactical("stalker", `${p.She} had energy to spare: closer to the pace, it gets used.`);
      if (tactic === "stalker") return tactical("front", `${p.She} had energy to spare: from the front, it gets used.`);
      return again("Too far back with plenty left: a better start may put it right.");
    case "conditions":
      return suited("Conditions cost more than anything else.");
    case "slow_start":
      return again("A slow start is luck: the next one may well be better.");
    case "boxed_in":
      return again("Getting boxed in is luck in running: a different draw may give a clear run.");
    default: {
      // Outpaced: the biggest tip that maps to one tap, else a fresh horse, else again.
      if (top && (top.id === "trip" || top.id === "surface" || top.id === "going")) return suited(top.text.split(":")[0]! + ".");
      // A course or pace tip becomes a one-tap plan only when it points back to the horse's own
      // style (off-style plans lose more than they gain on the engine, see the ran_dry note).
      if (top && (top.id === "course" || top.id === "pace") && tactic !== horse.style && new RegExp(horse.style === "front" ? "front-runner" : horse.style).test(top.text)) {
        return tactical(horse.style, `${top.text.split(":")[0]!}.`);
      }
      if (top && (top.id === "fatigue" || top.id === "freshness")) {
        const f = fresh(`${top.text.split(":")[0]!}.`);
        if (f) return f;
      }
      return fresh(`${horse.name} needs more speed, and that comes with training.`) ?? again(`${horse.name} needs more speed, and that comes with training. Story fields change every race.`);
    }
  }
}
