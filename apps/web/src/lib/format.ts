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
export const SEX_LABEL: Record<Sex, string> = { colt: "Colt", filly: "Filly", stallion: "Stallion", mare: "Mare", gelding: "Gelding" };

export function shortHash(hex: string, n = 10): string {
  return hex.length > n * 2 ? `${hex.slice(0, n)}…${hex.slice(-n)}` : hex;
}
