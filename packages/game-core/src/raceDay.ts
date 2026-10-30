/**
 * Race-day extras and jockey hire: optional paid choices made when entering a Live race.
 *
 * Every effect is small, published and fair: an extra only takes away part of a cost the race
 * puts on the horse (the going, fatigue, injury risk) or narrows its day-form spread. Nothing
 * here can make a horse run faster than its genes and condition allow on its best day.
 *
 * - Shoes for the going: soft-ground shoes (soft or heavy going) halve the pace a horse loses to
 *   the ground and the going's extra injury risk; firm-ground shoes halve firm going's extra
 *   injury risk (firm costs no pace).
 * - Physio session: takes PHYSIO fatigue off before the race (never below 0).
 * - Pre-race vet check: multiplies the race's injury risk (a "Vet-checked" factor line).
 * - Jockeys: the stable apprentice (free, as before), a journeyman or a top jockey: a narrower
 *   day-form swing (both ways: fewer bad days and fewer lucky ones) and a keen horse settled
 *   early (less of its extra early energy drain).
 *
 * Prices are a share of the race's purse with a floor and a cap, so they scale with the race's
 * class and size. Charged in Stable Credits with the entry (burned; never USDG) and refunded
 * if the horse is scratched before entries close or the race is abandoned. The choice is
 * stored with the entry and applied when the field locks, so replays reproduce it.
 */
import { z } from "zod";
import type { Going, RaceKit } from "@thoroughbred/shared";

export const RACE_EXTRA_KEYS = ["soft_shoes", "firm_shoes", "physio", "vet_check"] as const;
export type RaceExtraKey = (typeof RACE_EXTRA_KEYS)[number];
export const JOCKEY_KEYS = ["apprentice", "journeyman", "top"] as const;
export type JockeyKey = (typeof JOCKEY_KEYS)[number];

/** A price: `purseBps` of the race's purse (parts per 10,000), at least `floor`, at most `cap`, rounded to 10. */
export interface RaceDayPrice {
  purseBps: number;
  floor: number;
  cap: number;
}

export interface RaceExtraDef {
  key: RaceExtraKey;
  /** Entry-sheet name. */
  label: string;
  /** Racecard tag (equipment column). */
  tag: string;
  /** Plain-words effect for the entry sheet and the wiki. */
  effect: string;
  /** Goings it is offered on; null = every race. */
  goings: readonly Going[] | null;
  price: RaceDayPrice;
}

export interface JockeyDef {
  key: JockeyKey;
  label: string;
  /** Racecard tag; null for the stable apprentice (the default ride shows nothing). */
  tag: string | null;
  effect: string;
  /** null = free. */
  price: RaceDayPrice | null;
  /** Share of the day-form amplitude that still applies, permille (engine kit). */
  formAmpPermille: number;
  /** Share of a keen horse's extra early drain that still applies, permille (engine kit). */
  keenPermille: number;
}

/**
 * Shoes keep this share (permille) of what the going costs: the pace penalty on soft/heavy
 * ground (engine `goingPenaltyPermille`) and the going's extra injury risk above 1.0×.
 */
export const SHOES_KEEP_PERMILLE = 500;
/** Fatigue a physio session takes off before the race (not below 0). */
export const PHYSIO_FATIGUE_OFF = 150;
/** A pre-race vet check multiplies the race's injury risk by this, permille. */
export const VET_CHECK_RISK_PERMILLE = 750;

/** Every extra on offer: effects above, prices as purse shares. */
export const RACE_EXTRAS: Record<RaceExtraKey, RaceExtraDef> = {
  soft_shoes: {
    key: "soft_shoes",
    label: "Soft-ground shoes",
    tag: "Soft shoes",
    effect: `Grip in the mud: half the pace your horse loses to soft or heavy ground, and half the going's extra injury risk.`,
    goings: ["soft", "heavy"],
    price: { purseBps: 200, floor: 40, cap: 1_000 },
  },
  firm_shoes: {
    key: "firm_shoes",
    label: "Firm-ground shoes",
    tag: "Firm shoes",
    effect: `Cushioned shoes for fast ground: half the extra injury risk of firm going.`,
    goings: ["firm"],
    price: { purseBps: 200, floor: 40, cap: 1_000 },
  },
  physio: {
    key: "physio",
    label: "Physio session",
    tag: "Physio",
    effect: `A rub-down before the race: ${PHYSIO_FATIGUE_OFF} fatigue off (less tiredness, lower injury risk).`,
    goings: null,
    price: { purseBps: 200, floor: 40, cap: 1_000 },
  },
  vet_check: {
    key: "vet_check",
    label: "Pre-race vet check",
    tag: "Vet-checked",
    effect: `The vet looks the horse over before it runs: injury risk × ${VET_CHECK_RISK_PERMILLE / 1000}.`,
    goings: null,
    price: { purseBps: 200, floor: 40, cap: 1_000 },
  },
};

/** The jockeys an owner can book. The apprentice rides as every horse did before (no kit). */
export const JOCKEYS: Record<JockeyKey, JockeyDef> = {
  apprentice: {
    key: "apprentice",
    label: "Stable apprentice",
    tag: null,
    effect: "Your stable's own rider. Free.",
    price: null,
    formAmpPermille: 1000,
    keenPermille: 1000,
  },
  journeyman: {
    key: "journeyman",
    label: "Journeyman",
    tag: "Journeyman",
    effect: "A steady pro: day-form swing 10% narrower, a keen horse settled a quarter better early.",
    price: { purseBps: 250, floor: 50, cap: 1_500 },
    formAmpPermille: 900,
    keenPermille: 750,
  },
  top: {
    key: "top",
    label: "Top jockey",
    tag: "Top jockey",
    effect: "One of the best: day-form swing 20% narrower, a keen horse's early waste halved.",
    price: { purseBps: 500, floor: 100, cap: 3_000 },
    formAmpPermille: 800,
    keenPermille: 500,
  },
};

/** What an owner chose for one entry. */
export const RaceDayChoiceSchema = z.object({
  extras: z
    .array(z.enum(RACE_EXTRA_KEYS))
    .max(RACE_EXTRA_KEYS.length)
    .refine((xs) => new Set(xs).size === xs.length, "each extra once")
    .default([]),
  jockey: z.enum(JOCKEY_KEYS).default("apprentice"),
});
export type RaceDayChoice = z.infer<typeof RaceDayChoiceSchema>;

export const NO_RACE_DAY: RaceDayChoice = { extras: [], jockey: "apprentice" };

/** Credits for one priced item in a race with this purse. */
export function raceDayPrice(price: RaceDayPrice | null, purse: number): number {
  if (!price) return 0;
  const share = Math.floor((Math.max(0, purse) * price.purseBps) / 10_000);
  const raw = Math.min(price.cap, Math.max(price.floor, share));
  return Math.round(raw / 10) * 10;
}

/** The extras on offer for a race's going (shoes only when the going calls for them). */
export function offeredExtras(going: Going): RaceExtraKey[] {
  return RACE_EXTRA_KEYS.filter((k) => {
    const g = RACE_EXTRAS[k].goings;
    return g === null || g.includes(going);
  });
}

export interface RaceDayQuote {
  extras: { key: RaceExtraKey; price: number }[];
  jockey: { key: JockeyKey; price: number };
  extrasTotal: number;
  jockeyFee: number;
  total: number;
}

/** What a choice costs in a race with this purse. */
export function raceDayQuote(choice: RaceDayChoice, purse: number): RaceDayQuote {
  const extras = RACE_EXTRA_KEYS.filter((k) => choice.extras.includes(k)).map((key) => ({ key, price: raceDayPrice(RACE_EXTRAS[key].price, purse) }));
  const extrasTotal = extras.reduce((a, x) => a + x.price, 0);
  const jockeyFee = raceDayPrice(JOCKEYS[choice.jockey].price, purse);
  return { extras, jockey: { key: choice.jockey, price: jockeyFee }, extrasTotal, jockeyFee, total: extrasTotal + jockeyFee };
}

/** Why a choice can't be bought for this race (null = fine). Extras are for Live races only. */
export function raceDayProblem(choice: RaceDayChoice, race: { going: Going; live: boolean }): string | null {
  const any = choice.extras.length > 0 || choice.jockey !== "apprentice";
  if (!any) return null;
  if (!race.live) return "race-day extras and jockeys are for Live races";
  for (const k of choice.extras) {
    if (!offeredExtras(race.going).includes(k)) return `${RACE_EXTRAS[k].label.toLowerCase()} aren't offered on ${race.going} going`;
  }
  return null;
}

/** A stored choice (entry snapshot meta) or none; anything malformed reads as none. */
export function parseRaceDay(x: unknown): RaceDayChoice {
  const p = RaceDayChoiceSchema.safeParse(x ?? {});
  return p.success ? p.data : NO_RACE_DAY;
}

export function hasRaceDay(choice: RaceDayChoice): boolean {
  return choice.extras.length > 0 || choice.jockey !== "apprentice";
}

/**
 * The engine's per-runner kit for a choice on this going, or undefined when nothing changes on
 * the track (no kit = the race runs exactly as before; physio and the vet check act through the
 * horse's condition and the injury roll, not the engine).
 */
export function raceDayKit(choice: RaceDayChoice, going: Going): RaceKit | undefined {
  const kit: RaceKit = {};
  if (choice.extras.includes("soft_shoes") && (going === "soft" || going === "heavy")) kit.goingPenaltyPermille = SHOES_KEEP_PERMILLE;
  const j = JOCKEYS[choice.jockey];
  if (j.formAmpPermille !== 1000) kit.formAmpPermille = j.formAmpPermille;
  if (j.keenPermille !== 1000) kit.keenPermille = j.keenPermille;
  return Object.keys(kit).length ? kit : undefined;
}

/** Shoes that suit this going are on (they halve its extra injury risk). */
export function shoesFor(choice: Pick<RaceDayChoice, "extras">, going: Going): boolean {
  return choice.extras.some((k) => {
    const g = RACE_EXTRAS[k].goings;
    return g !== null && g.includes(going);
  });
}

/** Racecard tags, equipment first then the jockey ("Soft shoes", "Vet-checked", "Top jockey"). */
export function raceDayTags(choice: RaceDayChoice): string[] {
  const tags = RACE_EXTRA_KEYS.filter((k) => choice.extras.includes(k)).map((k) => RACE_EXTRAS[k].tag);
  const j = JOCKEYS[choice.jockey].tag;
  return j ? [...tags, j] : tags;
}
