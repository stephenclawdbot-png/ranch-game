/**
 * The finances page's server view: the stable's books for a period (this week, last week,
 * the season, all time), straight from the ledger via services/finances.ts. Read-only —
 * nothing here posts or settles.
 */
import { FINANCE_PERIODS, financePeriodBounds, stableFinances, type FinancePeriod, type StableFinances, type Db } from "@thoroughbred/db";
import type { Session } from "./session";

export interface FinancesView {
  period: FinancePeriod;
  /** Display bounds, UTC ("26 Oct" style; null start = all time). */
  fromLabel: string | null;
  toLabel: string;
  fin: StableFinances;
}

/** `?period=` value, falling back to this week. */
export function parseFinancePeriod(x: unknown): FinancePeriod {
  return FINANCE_PERIODS.includes(x as FinancePeriod) ? (x as FinancePeriod) : "this_week";
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (d: Date) => DAY.format(d);

export async function financesView(db: Db, session: Session, period: FinancePeriod, now: Date): Promise<FinancesView> {
  const fin = await stableFinances(db, { stableId: session.stable.id, period, now });
  const bounds = financePeriodBounds(period, now);
  // An unfinished period (this week, a running season, all time) is presented up to now.
  const to = bounds.to > now ? now : bounds.to;
  return { period, fromLabel: fin.from ? dayLabel(fin.from) : null, toLabel: dayLabel(to), fin };
}