import type { Going, RaceClass, RunningStyle, Surface, Weather, Coat, Sex } from "@thoroughbred/shared";

const nf = new Intl.NumberFormat("en-GB");

export function formatCredits(n: number): string {
  return nf.format(n);
}

/** 1600 -> "1,600 m". */
export function formatDistance(m: number): string {
  return `${nf.format(m)} m`;
}

/** Approximate furlongs, the way a racecard prints them: 1600 -> "8f". */
export function furlongs(m: number): string {
  const f = Math.round((m / 201.168) * 2) / 2;
  return `${Number.isInteger(f) ? f : `${Math.floor(f)}½`}f`;
}

/** Milliseconds -> "m:ss" (or "h:mm:ss"). Negative clamps to 0:00. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Odds in plain words: 2.5 (chance per 1,000) -> "about 1 in 400"; anything tinier -> "under 1 in 10,000". */
export function oneInText(permille: number): string {
  if (permille >= 500) return "more than 1 in 2"; // 1 in 2 or likelier
  const n = permille > 0 ? 1000 / permille : Infinity;
  if (n > 10_000) return "under 1 in 10,000";
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1); // two significant figures
  return `about 1 in ${nf.format(Math.max(2, Math.round(n / mag) * mag))}`;
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export const SURFACE_LABEL: Record<Surface, string> = { turf: "Turf", dirt: "Dirt", synthetic: "Synthetic" };
export const GOING_LABEL: Record<Going, string> = { firm: "Firm", good: "Good", soft: "Soft", heavy: "Heavy" };
export const WEATHER_LABEL: Record<Weather, string> = { clear: "Clear", overcast: "Overcast", rain: "Rain", dusk: "Dusk" };
export const CLASS_LABEL: Record<RaceClass, string> = { maiden: "Maiden", novice: "Novice", handicap: "Handicap", listed: "Listed", graded: "Graded" };
export const STYLE_LABEL: Record<RunningStyle, string> = { front: "Front-runner", stalker: "Stalker", closer: "Closer" };
export const STYLE_SHORT: Record<RunningStyle, string> = { front: "Front", stalker: "Stalk", closer: "Close" };
export const STYLE_BLURB: Record<RunningStyle, string> = {
  front: "Break fast and set the pace from the lead. Best for quick horses with stamina to hold on.",
  stalker: "Sit just off the leaders, then pounce in the straight. The balanced, all-weather ride.",
  closer: "Settle at the back, save energy, unleash one long late run. Needs a strong finishing burst.",
};
export const COAT_LABEL: Record<Coat, string> = {
  bay: "Bay", dark_bay: "Dark bay", chestnut: "Chestnut", liver_chestnut: "Liver chestnut", black: "Black",
  grey: "Grey", dapple_grey: "Dapple grey", palomino: "Palomino", buckskin: "Buckskin", roan: "Roan",
};
/** Render-coat label plus "dun" when the appearance carries the dun factor and the label doesn't say it. */
export function coatLabel(a: { coat: Coat; dun?: boolean }): string {
  const label = COAT_LABEL[a.coat];
  return a.dun && !label.toLowerCase().includes("dun") ? `Dun ${label.toLowerCase()}` : label;
}
export const SEX_LABEL: Record<Sex, string> = { colt: "Colt", filly: "Filly", stallion: "Stallion", mare: "Mare", gelding: "Gelding" };

export function shortHash(hex: string, n = 10): string {
  return hex.length > n * 2 ? `${hex.slice(0, n)}…${hex.slice(-n)}` : hex;
}

/** Fields smaller than this show the rank alone ("1st of 4"): a percentile of a handful says nothing. */
export const TOP_PERCENT_MIN_FIELD = 10;

/**
 * "Top n%" for a rank in a field: rank / field, rounded up (1st of 200 is top 1%, 1st of 1 would be
 * top 100%). Null for fields under TOP_PERCENT_MIN_FIELD.
 */
export function topPercent(rank: number, field: number): number | null {
  if (field < TOP_PERCENT_MIN_FIELD || rank < 1) return null;
  return Math.min(100, Math.ceil((Math.min(rank, field) * 100) / field));
}
