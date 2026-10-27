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

const pct = (v: number | null) => (v === null ? "–" : `${v}%`);

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
  const { data, error } = useAdminData<{ metrics: Metrics }>("/api/admin/metrics?days=14");
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