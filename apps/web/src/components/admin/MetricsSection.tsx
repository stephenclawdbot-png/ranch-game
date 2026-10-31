"use client";

import { useAdminData } from "./adminApi";

interface Metrics {
  days: { day: string; actives: number; sessions: number; signups: number; races: number; racesByKind: Record<string, number> }[];
  retention: { cohort: number; day1: number | null; day7: number | null; day1Eligible: number; day7Eligible: number };
  funnel: { signups: number; firstRace: number; raceWatched: number; liveRace: number; secondSession: number; nextDay: number };
  firstRace: { medianSec: number | null; under60Pct: number | null; n: number };
  racesPerActive: number | null;
  liveShare: number | null;
  perf: { byDevice: { device: string; reports: number; medianFps: number; lowFps: number; onTargetPct: number | null; downgradedPct: number | null }[]; slowGpus: { gpu: string; reports: number; medianFps: number }[] };
  totals: { testers: number; feedback: number; events: number };
}

interface Economy {
  fromDay: string;
  byKind: { kind: string; earned: number; spent: number }[];
  earned: number;
  spent: number;
  spentPer100: number | null;
  playerBalances: number;
  horses: { born: number; bornByOrigin: Record<string, number>; retired: number; legacyFarm: number; died: number };
  week: { weekStart: string; qualifierStables: number; featureStables: number; plateStables: number; liveStables: number };
  /** Horse leasing (packages/db leasing.ts leaseMetrics); absent on older servers. */
  leases?: {
    active: number;
    openOffers: number;
    startedThisWeek: number;
    marketSalesThisWeek: number;
    claimsThisWeek?: number;
    sharesPaidThisWeek: number;
    /** The Club's lots and offers (clubMarket.ts), counted apart; absent on older servers. */
    club?: { leasesStartedThisWeek: number; salesThisWeek: number; openOffers: number };
  };
  /** Claiming races in the window (packages/db health.ts); absent on older servers. */
  claiming?: { racesRun: number; horsesEntered: number; claimsLodged: number; horsesClaimed: number; creditsMoved: number };
  /** The tote in credits (packages/db tote.ts toteCreditsHealth); absent on older servers. */
  tote?: { houseTake: number; volume: number; bettors: number; races: number };
}

/** Players by audience (packages/db audience.ts); absent on older servers. */
interface AudienceGroup {
  key: "crypto" | "other";
  accounts: number;
  newPerDay: { day: string; n: number }[];
  day1: { eligible: number; returned: number; pct: number | null };
  day7: { eligible: number; returned: number; pct: number | null };
  activeDays: number;
  medianSpentPerActiveDay: number | null;
  racesPerActiveDay: number | null;
  usdg: { actions: number; testnetOrders: number; mainnetOrders: number } | null;
}
interface Audience {
  fromDay: string;
  toDay: string;
  groups: AudienceGroup[];
}

const pct = (v: number | null) => (v === null ? "–" : `${v}%`);
const n0 = (v: number) => v.toLocaleString("en-GB");

/** Economy and weekly-loop health: the live counterpart of the season harness (healthy: spent ~85-115 per 100 earned). */
function EconomyHealth({ e }: { e: Economy }) {
  const tone = e.spentPer100 === null ? undefined : e.spentPer100 >= 85 && e.spentPer100 <= 115 ? ("positive" as const) : ("negative" as const);
  return (
    <section className="grid gap-2" data-testid="economy-health">
      <h3 className="t-h2">Economy and the weekly loop (last 7 days)</h3>
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Credits earned" value={n0(e.earned)} />
        <Tile label="Credits spent" value={n0(e.spent)} />
        <Tile label="Spent per 100 earned" value={e.spentPer100 === null ? "–" : String(e.spentPer100)} sub="healthy 85-115 (grants excluded)" tone={tone} />
        <Tile label="Held by players" value={n0(e.playerBalances)} />
        <Tile label="Horses born" value={String(e.horses.born)} sub={Object.entries(e.horses.bornByOrigin).map(([k, v]) => `${k} ${v}`).join(" · ")} />
        <Tile label="Horses out" value={String(e.horses.retired + e.horses.legacyFarm)} sub={`${e.horses.retired} retired · ${e.horses.legacyFarm} Legacy Farm · ${e.horses.died} died`} />
        <Tile label="Tried a Qualifier" value={`${e.week.qualifierStables} / ${e.week.liveStables}`} sub="stables this week / racing Live" />
        <Tile label="Saturday" value={`${e.week.featureStables} Feature · ${e.week.plateStables} Plate`} sub="stables this week" />
        {e.leases && (
          <Tile
            label="Leases vs sales"
            value={`${e.leases.startedThisWeek} leased · ${e.leases.marketSalesThisWeek} sold · ${e.leases.claimsThisWeek ?? 0} claimed`}
            sub={`players, this week · ${e.leases.active} leases active · ${e.leases.openOffers} on offer · ${n0(e.leases.sharesPaidThisWeek)} cr shares paid`}
          />
        )}
        {e.claiming && (
          <Tile
            label="Claiming races"
            value={`${e.claiming.horsesClaimed} claimed · ${n0(e.claiming.creditsMoved)} cr`}
            sub={`${e.claiming.racesRun} races · ${e.claiming.horsesEntered} runners · ${e.claiming.claimsLodged} claims lodged`}
          />
        )}
        {e.tote && (
          <Tile
            label="Tote house take"
            value={`${n0(e.tote.houseTake)} cr`}
            sub={`a sink · ${n0(e.tote.volume)} cr pooled · ${e.tote.bettors} bettors · ${e.tote.races} races`}
          />
        )}
        {e.leases?.club && (
          <Tile
            label="Club lots"
            value={`${e.leases.club.leasesStartedThisWeek} leased · ${e.leases.club.salesThisWeek} sold`}
            sub={`this week · ${e.leases.club.openOffers} Club lease offers open`}
          />
        )}
      </ul>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="p-1">Ledger kind</th>
            <th className="p-1 text-right">Earned</th>
            <th className="p-1 text-right">Spent</th>
          </tr>
        </thead>
        <tbody>
          {e.byKind.map((k) => (
            <tr key={k.kind} className="border-t-2 border-line">
              <td className="p-1 font-bold">{k.kind}</td>
              <td className="p-1 text-right">{k.earned ? n0(k.earned) : ""}</td>
              <td className="p-1 text-right">{k.spent ? n0(k.spent) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const AUDIENCE_LABEL = { crypto: "Crypto players", other: "Everyone else" } as const;

/**
 * Players by audience: crypto players (a linked or signed-in wallet, ever) against everyone else.
 * Returned = any activity (race entry, care, training, Cup, play day, credits spent) on that day
 * after signup; per-active-day figures are over (account, UTC day) pairs with activity.
 */
function AudiencePanel({ a }: { a: Audience }) {
  const days = [...new Set(a.groups.flatMap((g) => g.newPerDay.map((d) => d.day)))].sort();
  const newOn = (g: AudienceGroup, day: string) => g.newPerDay.find((d) => d.day === day)?.n ?? 0;
  const ret = (r: AudienceGroup["day1"]) => `${pct(r.pct)} (${r.returned}/${r.eligible})`;
  return (
    <section className="grid gap-2" data-testid="audience-panel">
      <h3 className="t-h2">
        Players by audience <span className="text-sm font-normal text-cream-dim">({a.fromDay} to {a.toDay}, UTC)</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-1" />
              {a.groups.map((g) => (
                <th key={g.key} className="p-1 text-right">
                  {AUDIENCE_LABEL[g.key]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Accounts (all time)", (g: AudienceGroup) => n0(g.accounts)],
                ["New in the window", (g: AudienceGroup) => n0(g.newPerDay.reduce((s, d) => s + d.n, 0))],
                ["Day-1 return", (g: AudienceGroup) => ret(g.day1)],
                ["Day-7 return", (g: AudienceGroup) => ret(g.day7)],
                ["Active days", (g: AudienceGroup) => n0(g.activeDays)],
                ["Credits spent / active day (median)", (g: AudienceGroup) => (g.medianSpentPerActiveDay === null ? "–" : n0(g.medianSpentPerActiveDay))],
                ["Races entered / active day", (g: AudienceGroup) => (g.racesPerActiveDay === null ? "–" : g.racesPerActiveDay.toFixed(2))],
                ["USDG / T-USDG actions", (g: AudienceGroup) => (g.usdg ? `${n0(g.usdg.actions)} · orders ${g.usdg.testnetOrders} testnet, ${g.usdg.mainnetOrders} mainnet` : "n/a")],
              ] as const
            ).map(([label, f]) => (
              <tr key={label} className="border-t-2 border-line">
                <td className="p-1 font-bold">{label}</td>
                {a.groups.map((g) => (
                  <td key={g.key} className="num p-1 text-right align-top">
                    {f(g)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {days.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-bold">New accounts per day</summary>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[20rem] text-sm" data-testid="audience-new-per-day">
              <thead>
                <tr className="text-left">
                  <th className="p-1">Day</th>
                  {a.groups.map((g) => (
                    <th key={g.key} className="p-1 text-right">
                      {AUDIENCE_LABEL[g.key]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d} className="border-t-2 border-line">
                    <td className="p-1">{d}</td>
                    {a.groups.map((g) => (
                      <td key={g.key} className="num p-1 text-right">
                        {newOn(g, d)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="text-xs text-cream-dim">Crypto = an account with a linked or signed-in wallet (now or before). Returned = any race entry, care, training plan, Daily Cup run, play day or credits spent on that day after signup.</p>
    </section>
  );
}

/** Seconds as "m:ss" (e.g. 82.5 -> "1:23"). */
const mmss = (sec: number | null) => {
  if (sec === null) return "–";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The 6-step funnel: full label, short label for the biggest-drop caption, metric key. */
const FUNNEL_STEPS: [label: string, short: string, key: keyof Metrics["funnel"]][] = [
  ["Signed up", "Signed up", "signups"],
  ["Ran a first race", "First race", "firstRace"],
  ["Watched a race to the end", "Watched", "raceWatched"],
  ["Entered a Live race", "Live", "liveRace"],
  ["Came back for a 2nd session", "2nd session", "secondSession"],
  ["Came back the next UTC day", "Next day", "nextDay"],
];

const FPS_TARGET: Record<string, number> = { phone: 30, tablet: 30, desktop: 60 };

export function MetricsSection() {
  const { data, error } = useAdminData<{ metrics: Metrics; economy?: Economy; audience?: Audience }>("/api/admin/metrics?days=14");
  if (error) return <p className="font-bold text-negative">{error}</p>;
  if (!data) return <p className="text-cream-dim">Loading…</p>;
  const m = data.metrics;
  const maxActives = Math.max(1, ...m.days.map((d) => d.actives));
  const maxRaces = Math.max(1, ...m.days.map((d) => d.races));
  const under60 = m.firstRace.under60Pct;
  const funnelPct = FUNNEL_STEPS.map(([, , key]) => (m.funnel.signups > 0 ? Math.round((m.funnel[key] * 100) / m.funnel.signups) : 0));
  let bigDrop: string | null = null;
  let bigDropPts = 0;
  for (let i = 1; i < FUNNEL_STEPS.length; i++) {
    const drop = funnelPct[i - 1]! - funnelPct[i]!;
    if (drop > bigDropPts) {
      bigDropPts = drop;
      bigDrop = `${FUNNEL_STEPS[i - 1]![1]} → ${FUNNEL_STEPS[i]![1]}`;
    }
  }
  return (
    <div className="grid gap-4" data-testid="metrics">
      {data.economy && <EconomyHealth e={data.economy} />}
      {data.audience && <AudiencePanel a={data.audience} />}
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Testers" value={String(m.totals.testers)} />
        <Tile label="Day-1 retention" value={pct(m.retention.day1)} sub={`of ${m.retention.day1Eligible} who could`} />
        <Tile label="Day-7 retention" value={pct(m.retention.day7)} sub={`of ${m.retention.day7Eligible} who could`} />
        <Tile label="Feedback" value={String(m.totals.feedback)} />
      </ul>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <Tile label="Time to first race" value={mmss(m.firstRace.medianSec)} sub={`median of ${m.firstRace.n}`} />
        <Tile
          label="Under 60 s"
          value={pct(under60)}
          sub="signups racing within a minute"
          tone={under60 === null ? undefined : under60 >= 80 ? "positive" : under60 < 50 ? "negative" : undefined}
        />
        <Tile label="Races / active / day" value={m.racesPerActive === null ? "–" : m.racesPerActive.toFixed(1)} sub="last 7 days" />
        <Tile label="Live share" value={pct(m.liveShare)} sub="of races, last 7 days" />
      </ul>
      <section className="surface grid gap-2 p-3">
        <h2 className="t-title">Funnel</h2>
        <ol className="grid gap-1 text-sm" data-testid="funnel">
          {FUNNEL_STEPS.map(([label, , key], i) => (
            <li key={label} className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1">
              <span>{label}</span>
              <span className="num text-cream">
                {m.funnel[key]}
                <span className="text-cream-dim"> ({funnelPct[i]}%)</span>
              </span>
              <div className="col-span-2 h-2 bg-line" aria-hidden>
                <div className="h-full bg-brass" style={{ width: `${funnelPct[i]}%` }} />
              </div>
            </li>
          ))}
        </ol>
        {bigDrop && <p className="text-xs text-cream-dim">biggest drop: {bigDrop} (−{bigDropPts} pts)</p>}
      </section>
      <section className="surface grid gap-2 p-3">
        <h2 className="t-title">Performance (race viewer, last 14 days)</h2>
        {m.perf.byDevice.length === 0 ? (
          <p className="text-sm text-cream-dim">No race_perf reports yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm" data-testid="perf-table">
                <thead className="text-cream-dim">
                  <tr>
                    <th className="p-1">Device</th>
                    <th className="p-1">Reports</th>
                    <th className="p-1">Median fps</th>
                    <th className="p-1">Low fps</th>
                    <th className="p-1">On target</th>
                    <th className="p-1">Downgraded</th>
                  </tr>
                </thead>
                <tbody>
                  {m.perf.byDevice.map((d) => {
                    const target = FPS_TARGET[d.device] ?? 30;
                    return (
                      <tr key={d.device} className="border-t-2 border-line">
                        <td className="p-1 font-bold">{d.device[0]!.toUpperCase() + d.device.slice(1)}</td>
                        <td className="p-1">{d.reports}</td>
                        <td className={`p-1 num ${d.medianFps < target ? "text-negative" : ""}`}>{Math.round(d.medianFps)}</td>
                        <td className="p-1">{Math.round(d.lowFps)}</td>
                        <td className="p-1">{pct(d.onTargetPct)}</td>
                        <td className="p-1">{pct(d.downgradedPct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {m.perf.slowGpus.length > 0 && (
              <div className="grid gap-1 text-sm">
                <p className="text-xs text-cream-dim">Slowest GPUs (≥ 3 reports)</p>
                {m.perf.slowGpus.map((g) => (
                  <p key={g.gpu}>
                    <span className="font-bold">{g.gpu}</span> <span className="text-cream-dim">· {g.reports} reports · {Math.round(g.medianFps)} median fps</span>
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      <section className="surface grid gap-2 p-3">
        <h2 className="t-title">Last 14 days (UTC)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="text-cream-dim">
              <tr>
                <th className="p-1">Day</th>
                <th className="p-1">Daily actives</th>
                <th className="p-1">Sessions</th>
                <th className="p-1">Signups</th>
                <th className="p-1">Races (live / story / cup)</th>
              </tr>
            </thead>
            <tbody>
              {m.days.map((d) => (
                <tr key={d.day} className="border-t-2 border-line">
                  <td className="p-1 font-mono">{d.day.slice(5)}</td>
                  <td className="p-1">
                    <Bar value={d.actives} max={maxActives} />
                  </td>
                  <td className="p-1">{d.sessions}</td>
                  <td className="p-1">{d.signups}</td>
                  <td className="p-1">
                    <Bar value={d.races} max={maxRaces} label={`${d.races} (${d.racesByKind.live ?? 0} / ${d.racesByKind.story ?? 0} / ${d.racesByKind.cup ?? 0})`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "positive" | "negative" }) {
  return (
    <li className="surface p-3">
      <p className="text-xs font-bold text-cream-dim">{label}</p>
      <p className={`score text-[2rem] leading-none ${tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-cream"}`}>{value}</p>
      {sub && <p className="text-xs text-cream-dim">{sub}</p>}
    </li>
  );
}

function Bar({ value, max, label }: { value: number; max: number; label?: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 bg-brass" style={{ width: `${Math.round((value / max) * 80)}px` }} aria-hidden />
      <span>{label ?? value}</span>
    </span>
  );
}