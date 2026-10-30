import { CLAIM_REENTRY_LOCK_DAYS, MARKET_FEE_PERMILLE, RESALE_LOCK_MS } from "@thoroughbred/game-core";

/** The claiming rules in one line (racecard; numbers from game-core claiming.ts and the market). */
export const CLAIMING_RULES = `Any other stable with a free stall can claim a runner at its price until entries close (several claims: a draw). The horse moves after the race whatever the result; the owner keeps the purse and gets the price less ${MARKET_FEE_PERMILLE / 10}%. No resale for ${RESALE_LOCK_MS / 3_600_000} h, no claiming race for ${CLAIM_REENTRY_LOCK_DAYS} days.`;

/** What the owner agrees to on the entry sheet of a claiming race. */
export const CLAIMING_ENTRY_NOTE = `Claiming race: your horse is for sale at the price you set. If another stable claims it, it moves to them after the race whatever the result, even if it is injured in the race (a fatal injury voids the claim). You keep the purse and get the price less the ${MARKET_FEE_PERMILLE / 10}% market fee.`;
