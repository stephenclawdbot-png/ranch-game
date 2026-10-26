"use client";

import { useAdminData } from "./adminApi";

interface Metrics {
  days: { day: string; actives: number; sessions: number; signups: number; races: number; racesByKind: Record<string, number> }[];
  retention: { cohort: number; day1: number | null; day7: number | null; day1Eligible: number; day7Eligible: number };
  funnel: { signups: number; firstRace: number; secondSession: number };
  totals: { testers: number; feedback: number; events: number };
}

const pct = (v: number | null) => (v === null ? "–" : `${v}%`);

export function MetricsSection() {
  const { data, error } = useAdminData<{ metrics: Metrics }>("/api/admin/metrics?days=14");
  if (error) return <p className="font-bold text-negative">{error}</p>;
  if (!data) return <p className="text-cream-dim">Loading…</p>;
  const m = data.metrics;
  const maxActives = Math.max(1, ...m.days.map((d) => d.actives));
  const maxRaces = Math.max(1, ...m.days.map((d) => d.races));
  return (
    <div className="grid gap-4" data-testid="metrics">
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Testers" value={String(m.totals.testers)} />
        <Tile label="Day-1 retention" value={pct(m.retention.day1)} sub={`of ${m.retention.day1Eligible} who could`} />
        <Tile label="Day-7 retention" value={pct(m.retention.day7)} sub={`of ${m.retention.day7Eligible} who could`} />
        <Tile label="Feedback" value={String(m.totals.feedback)} />
      </ul>
      <section className="surface grid gap-2 p-3">
        <h2 className="t-title">Funnel</h2>
        <ol className="grid gap-1 text-sm" data-testid="funnel">
          {[
            ["Signed up", m.funnel.signups],
            ["Ran a first race", m.funnel.firstRace],
            ["Came back for a second session", m.funnel.secondSession],
          ].map(([label, n]) => (
            <li key={label as string} className="grid grid-cols-[1fr_auto] items-center gap-2">
              <span>{label}</span>
              <span className="num text-cream">
                {n as number}
                {m.funnel.signups > 0 && <span className="text-cream-dim"> ({Math.round(((n as number) * 100) / m.funnel.signups)}%)</span>}
              </span>
            </li>
          ))}
        </ol>
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

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <li className="surface p-3">
      <p className="text-xs font-bold text-cream-dim">{label}</p>
      <p className="score text-[2rem] leading-none text-cream">{value}</p>
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
