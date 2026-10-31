import Link from "next/link";
import type { FinanceCategory, FinancePeriod } from "@thoroughbred/db";
import type { FinancesView } from "@/server/finances";
import { formatCredits } from "@/lib/format";
import { EmptyState, SceneBand, Section } from "@/components/ui/Page";
import { WeeklyNetChart } from "./WeeklyNetChart";
import { HorseFinancesTable } from "./HorseFinancesTable";

/**
 * The finances page: the stable's books over a period — the summary, the season's weekly
 * net, the categories every credit moved through, and the per-horse sheet that answers
 * "is this horse paying for itself?". Read-only: it shows what the ledger already holds.
 */

const PERIODS: { key: FinancePeriod; label: string }[] = [
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "season", label: "This season" },
  { key: "all_time", label: "All time" },
];

const CATEGORY_LABEL: Record<FinanceCategory, string> = {
  prize: "Prize money",
  sales: "Sales",
  stud_earned: "Stud fees earned",
  leasing: "Lease income",
  goals_cup: "Daily goals and Cup",
  story: "Story and other income",
  training: "Training and care",
  upkeep: "Upkeep",
  entry_fees: "Entry fees",
  race_day: "Race-day extras and jockeys",
  stud_paid: "Stud fees paid",
  purchases: "Purchases",
  facilities: "Facilities",
  fees: "Fees burned",
  tote: "Tote bets",
  other: "Other",
};

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatCredits(Math.abs(n))}`;
const tone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-cream");

function SummaryTile({ label, value, className, testId }: { label: string; value: string; className?: string; testId: string }) {
  return (
    <div className="surface p-4" data-testid={testId}>
      <p className="t-meta">{label}</p>
      <p className={`mt-1 font-extrabold tabular-nums ${className ?? "text-cream"}`} style={{ fontSize: "1.375rem" }}>
        {value}
      </p>
    </div>
  );
}

export function FinancesScreen({ view }: { view: FinancesView }) {
  const { fin, period, fromLabel, toLabel } = view;
  const quiet = fin.income === 0 && fin.spend === 0;
  const scope = fromLabel ? `${fromLabel} – ${toLabel} (UTC)` : `up to ${toLabel} (UTC)`;
  const seasonMoved = fin.weekly.some((w) => w.net !== 0);
  // Per-horse rows only for horses with something on the books this period (no wall of zeros).
  const horsesWithData = fin.horses.filter((h) => h.earned !== 0 || h.cost !== 0 || h.starts > 0);

  return (
    <div>
      <SceneBand
        scene="stable"
        alt="The yard at first light"
        eyebrow="Stable · the books"
        title="Finances"
        meta={`${scope} · balance now ${formatCredits(fin.balanceAtEnd)} credits`}
      />

      <div className="mt-6 grid gap-8 md:gap-10">
        <div>
          <nav className="segmented w-max" aria-label="Period">
            {PERIODS.map((p) => (
              <Link key={p.key} href={`/stable/finances?period=${p.key}`} aria-current={p.key === period ? "true" : undefined}>
                {p.label}
              </Link>
            ))}
          </nav>
          <p className="caption mt-3" data-testid="finances-explainer">
            Purses land when a race settles; upkeep is charged each Monday for horses you used.{" "}
            <Link href="/wiki/credits-and-entries" className="link">
              How credits work
            </Link>
          </p>

          {quiet ? (
            <div className="mt-4">
              <EmptyState
                icon="coin"
                title="Nothing has moved yet"
                text={
                  period === "this_week"
                    ? "No credits in or out this week. Race, train or sell and the books fill up."
                    : "No credits moved in this period."
                }
              />
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3" data-testid="finances-summary">
                <SummaryTile testId="finances-in" label="In" value={formatCredits(fin.income)} />
                <SummaryTile testId="finances-out" label="Out" value={formatCredits(fin.spend)} />
                <SummaryTile testId="finances-net" label="Net" value={signed(fin.net)} className={tone(fin.net)} />
              </div>
              <p className="caption mt-2">
                {fromLabel ? (
                  <>
                    Balance {fromLabel}: <strong className="tabular-nums text-cream">{formatCredits(fin.balanceAtStart)}</strong> → now:{" "}
                    <strong className="tabular-nums text-cream">{formatCredits(fin.balanceAtEnd)}</strong> credits
                  </>
                ) : (
                  <>
                    Balance now: <strong className="tabular-nums text-cream">{formatCredits(fin.balanceAtEnd)}</strong> credits
                  </>
                )}
              </p>
            </>
          )}
        </div>

        {seasonMoved && (
          <Section id="weekly-net-h" title="Net by week this season">
            <WeeklyNetChart weekly={fin.weekly} />
          </Section>
        )}

        <Section id="categories-h" title="Where it went">
          {fin.categories.length ? (
            <div className="surface overflow-x-auto p-4">
              <table className="w-full text-left text-sm" data-testid="finances-categories">
                <caption className="sr-only">Income and spending by category this period</caption>
                <thead>
                  <tr className="border-b-2 border-line">
                    <th scope="col" className="py-2 pr-3 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-sage">
                      Category
                    </th>
                    <th scope="col" className="py-2 pl-3 text-right text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-sage">
                      In
                    </th>
                    <th scope="col" className="py-2 pl-3 text-right text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-sage">
                      Out
                    </th>
                    <th scope="col" className="py-2 pl-3 text-right text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-sage">
                      Net
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fin.categories.map((c) => (
                    <tr key={c.category} className="border-t border-line">
                      <th scope="row" className="py-2 pr-3 font-bold text-cream">
                        {CATEGORY_LABEL[c.category]}
                      </th>
                      <td className="py-2 pl-3 text-right tabular-nums text-positive">{c.income ? formatCredits(c.income) : "—"}</td>
                      <td className="py-2 pl-3 text-right tabular-nums text-negative">{c.spend ? formatCredits(c.spend) : "—"}</td>
                      <td className="py-2 pl-3 text-right tabular-nums font-bold text-cream">{signed(c.income - c.spend)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-line">
                    <th scope="row" className="py-2 pr-3 font-extrabold text-cream">
                      Total
                    </th>
                    <td className="py-2 pl-3 text-right tabular-nums font-extrabold text-cream">{formatCredits(fin.income)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums font-extrabold text-cream">{formatCredits(fin.spend)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums font-extrabold">
                      <span className={tone(fin.net)}>{signed(fin.net)}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="t-meta">No income or spending in this period.</p>
          )}
        </Section>

        <Section id="per-horse-h" title="Per horse">
          {horsesWithData.length ? (
            <>
              <HorseFinancesTable horses={horsesWithData} />
              <p className="caption mt-2">
                Earned is purses, its sale price, stud fees and lease shares; cost is training, upkeep, entry fees, race-day extras, its
                purchase price and stud fees paid for it.{" "}
                {fin.unattributed !== 0 && (
                  <>
                    Another <span className="tabular-nums">{signed(fin.unattributed)}</span> credits of net had no horse named on the posting
                    (goals, Cup and story rewards and the like) — they are in the summary and categories above, not pinned on a horse.{" "}
                  </>
                )}
                When a week's upkeep was partly waived, each used horse carries its share of what was actually charged.
              </p>
            </>
          ) : (
            <p className="t-meta" data-testid="finances-horses-empty">
              {fin.horses.length ? "No horse has earned or cost anything in this period yet." : "No horses yet — nothing has earned or cost a horse anything."}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}