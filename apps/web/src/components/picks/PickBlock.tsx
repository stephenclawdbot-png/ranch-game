"use client";
/**
 * The race page's Pick block (points only, never money): pick one runner to win until the off.
 * The points a winning pick scores come from the runner's rank by rating in the field (10 for the
 * top-rated up to 50 for the lowest-rated). The outcome shows only once the server has scored the
 * pick, which it does only after the broadcast's result is public: re-fetched when the result is
 * on screen.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { RacePickView } from "@thoroughbred/db";
import { api } from "@/lib/player";
import { formatClock } from "@/lib/format";

export function PickBlock({ raceId, phase, signedIn }: { raceId: string; phase: string; signedIn: boolean }) {
  const [view, setView] = useState<RacePickView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch(`/api/races/${raceId}/pick`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<RacePickView>) : null))
      .then(setView)
      .catch(() => undefined);
  }, [raceId]);
  useEffect(load, [load, phase]);
  if (!view) return null;

  async function pick(horseId: string) {
    setBusy(horseId);
    setErr(null);
    try {
      setView(await api<RacePickView>(`/api/races/${raceId}/pick`, { body: { horseId } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save your pick.");
      load();
    } finally {
      setBusy(null);
    }
  }

  const m = view.mine;
  return (
    <section className="surface grid gap-2 p-3 sm:p-4" aria-labelledby="pick-h" data-testid="pick-block">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="pick-h" className="t-title">
          Pick the winner
        </h2>
        <Link href="/tipsters" className="link shrink-0 text-sm">
          Tipsters ›
        </Link>
      </div>
      {m && m.outcome !== "open" ? (
        <p className="text-sm font-bold" data-testid="pick-outcome">
          {m.outcome === "won" ? (
            <>
              <span className="tag tag-good">+{m.points} pts</span> {m.horseName} won. Nice pick.
            </>
          ) : m.outcome === "lost" ? (
            <>You picked {m.horseName}. Not this time: no points, nothing lost.</>
          ) : (
            <>{m.horseName} didn&apos;t run, so your pick doesn&apos;t count.</>
          )}
        </p>
      ) : view.open ? (
        <>
          <p className="t-meta">
            {m ? `Your pick: ${m.horseName}. You can change it until the off (${formatClock(view.closesAtMs)}).` : `Points only. Picks close at the off (${formatClock(view.closesAtMs)}).`}
          </p>
          {!signedIn ? (
            <p className="caption">
              <Link href="/play" className="link">
                Found a stable
              </Link>{" "}
              to pick.
            </p>
          ) : (
            <ul className="rows !p-0" data-testid="pick-runners">
              {view.runners.map((r) => {
                const chosen = m?.horseId === r.horseId;
                return (
                  <li key={r.horseId} className="flex items-center gap-2 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-cream [overflow-wrap:anywhere]">{r.horseName}</span>
                      <span className="caption block truncate">{r.stableName}</span>
                    </span>
                    <span className="num shrink-0 text-cream-dim" title="Points if it wins: by its rating rank in the field">
                      {r.pointsIfWins} pts
                    </span>
                    <button
                      type="button"
                      className={`btn btn-sm shrink-0 ${chosen ? "btn-brass" : ""}`}
                      aria-pressed={chosen}
                      disabled={busy !== null}
                      onClick={() => pick(r.horseId)}
                      data-testid="pick-button"
                    >
                      {chosen ? "Picked ✓" : busy === r.horseId ? "…" : "Pick"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="caption">
            {view.picks} {view.picks === 1 ? "tipster has" : "tipsters have"} picked. Points follow the field at the off: Club runners join when entries close.
          </p>
        </>
      ) : m ? (
        <p className="text-sm" data-testid="pick-pending">
          Your pick: <b>{m.horseName}</b>. Points are added once the result is in.
        </p>
      ) : (
        <p className="t-meta">Picks closed at the off.</p>
      )}
      {err && <p className="text-sm font-bold text-negative">{err}</p>}
    </section>
  );
}
