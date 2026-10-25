import { HORSE_LENGTH_MM } from "@thoroughbred/shared";

const QUARTER_LABELS = ["1/2", "1/2", "1/2", "3/4", "1", "1 1/4", "1 1/2", "1 3/4", "2"]; // index = quarter-lengths

/**
 * Racing-style margin label for a gap in mm.
 * <150 nose, <400 short head, <700 head, <1200 neck, then lengths:
 * quarter steps to 2, half steps to 10, whole lengths to 15, beyond that "dist".
 */
export function marginLabel(marginMm: number): string {
  if (marginMm < 150) return "nose";
  if (marginMm < 400) return "short head";
  if (marginMm < 700) return "head";
  if (marginMm < 1200) return "neck";
  const quarters = Math.floor((marginMm * 4 + HORSE_LENGTH_MM / 2) / HORSE_LENGTH_MM);
  if (quarters <= 8) return QUARTER_LABELS[quarters] ?? "1/2";
  const halves = Math.max(5, Math.floor((marginMm * 2 + HORSE_LENGTH_MM / 2) / HORSE_LENGTH_MM));
  if (halves <= 20) return halves % 2 === 0 ? `${halves / 2}` : `${(halves - 1) / 2} 1/2`;
  const whole = Math.floor((marginMm + HORSE_LENGTH_MM / 2) / HORSE_LENGTH_MM);
  if (whole <= 15) return `${Math.max(10, whole)}`;
  return "dist";
}

/** Purse split by position (percent). */
export const PRIZE_SPLIT_PCT = [55, 20, 12, 7, 4, 2] as const;

/** Integer prize per finishing position; floor each share, remainder to the winner (total == purse). */
export function splitPurse(purse: number, runners: number): number[] {
  const prizes: number[] = [];
  let paid = 0;
  for (let p = 0; p < runners; p++) {
    const pct = PRIZE_SPLIT_PCT[p] ?? 0;
    const prize = Math.floor((purse * pct) / 100);
    prizes.push(prize);
    paid += prize;
  }
  if (runners > 0) prizes[0] = (prizes[0] ?? 0) + (purse - paid);
  return prizes;
}
