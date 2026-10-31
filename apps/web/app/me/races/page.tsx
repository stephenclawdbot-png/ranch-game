"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useEntry } from "@/components/entry/EntryProvider";
import { PlayerGate } from "@/components/PlayerGate";
import { PositionBadge } from "@/components/ui/PositionBadge";
import { EmptyState, PageHeader } from "@/components/ui/Page";
import { SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import type { PlayerState } from "@/lib/player";
import type { MyRacesView, RunView, StableFormBookView } from "@/lib/types";
import { FormLines } from "@/components/formBook/FormLines";
import { SplitsPanel } from "@/components/formBook/SplitsPanel";

type Kind = "all" | "live" | "story";
const KINDS: { v: Kind; label: string }[] = [
  { v: "all", label: "All" },
  { v: "live", label: "Live" },
  { v: "story", label: "Story" },
];

const when = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** One run, in the horse page's Form shape: badge, race name, meta with the horse first, prize or play. */
function RunRow({ r }: { r: RunView }) {
  return (
    <li>
      <Link href={`/race/${r.raceId}`} className="row-link group gap-3 px-4 py-3">
        <PositionBadge position={r.position} />
        <span className="min-w-0 flex-1">
          <span className="block font-extrabold group-hover:underline">{r.raceName}</span>
          <span className="t-meta block">
            {r.horseName} · {r.kind === "live" ? "Live" : "Story"} · {formatDistance(r.distanceM)} · {SURFACE_LABEL[r.surface]} · {r.fieldSize} ran · {when(r.postTimeMs)}
          </span>
        </span>
        {r.prize > 0 ? <span className="reward">+{formatCredits(r.prize)}</span> : <span className="chev">▶</span>}
      </Link>
    </li>
  );
}

/** /me/races: every run the stable has made, each with its replay. Filters restart the list. */
function MyRaces({ state }: { state: PlayerState }) {
  const entry = useEntry();
  const [horseId, setHorseId] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [winsOnly, setWinsOnly] = useState(false);
  const [rows, setRows] = useState<RunView[]>([]);
  const [summary, setSummary] = useState<MyRacesView["summary"] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const filtered = kind !== "all" || winsOnly || horseId !== "";
  const [numbers, setNumbers] = useState(false);
  const [book, setBook] = useState<StableFormBookView | null>(null);
  const lines = rows.flatMap((r) => (r.line ? [r.line] : []));

  // The stable's splits (or one horse's): settled runs only, refreshed when the horse changes.
  useEffect(() => {
    let live = true;
    const p = new URLSearchParams();
    if (horseId) p.set("horse", horseId);
    fetch(`/api/me/formbook?${p}`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<StableFormBookView>) : null))
      .then((v) => {
        if (live) setBook(v);
      })
      .catch(() => {
        if (live) setBook(null);
      });
    return () => {
      live = false;
    };
  }, [horseId]);

  const load = useCallback(
    async (cursor: string | null) => {
      setBusy(true);
      setFailed(false);
      try {
        const p = new URLSearchParams({ kind, wins: winsOnly ? "1" : "0" });
        if (horseId) p.set("horse", horseId);
        if (cursor) p.set("cursor", cursor);
        const res = await fetch(`/api/me/races?${p}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const page = (await res.json()) as MyRacesView;
        setSummary(page.summary);
        setRows((cur) => (cursor ? cur.concat(page.rows) : page.rows));
        setNextCursor(page.nextCursor);
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [kind, winsOnly, horseId],
  );

  // Filter changes always restart from the first page.
  useEffect(() => {
    void load(null);
  }, [load]);

  const s = summary;
  return (
    <div className="mx-auto grid max-w-6xl content-start gap-4" data-testid="my-races-page">
      <PageHeader
        eyebrow={state.stableName}
        title="My races"
        meta={s ? `${s.runs} ${s.runs === 1 ? "run" : "runs"} · ${s.wins} ${s.wins === 1 ? "win" : "wins"} · ${s.places} ${s.places === 1 ? "place" : "places"} · +${formatCredits(s.credits)} credits` : "…"}
      />

      <div className="flex flex-wrap items-center gap-3">
        <select className="field min-h-11" value={horseId} onChange={(e) => setHorseId(e.target.value)} aria-label="Horse" data-testid="races-horse">
          <option value="">All horses</option>
          {state.horses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.horse.name}
            </option>
          ))}
        </select>
        <div className="segmented" role="group" aria-label="Race kind">
          {KINDS.map((k) => (
            <button key={k.v} type="button" aria-pressed={kind === k.v} onClick={() => setKind(k.v)} data-testid={`races-kind-${k.v}`}>
              {k.label}
            </button>
          ))}
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-bold" data-testid="races-wins-only">
          <input type="checkbox" checked={winsOnly} onChange={(e) => setWinsOnly(e.target.checked)} /> Wins only
        </label>
        <button type="button" className="btn-ghost min-h-11 text-sm font-bold" aria-pressed={numbers} onClick={() => setNumbers((n) => !n)} data-testid="races-numbers">
          {numbers ? "Hide numbers" : "Show numbers"}
        </button>
      </div>

      {rows.length > 0 ? (
        lines.length === rows.length ? (
          <div data-testid="my-races-rows">
            <FormLines lines={lines} numbers={numbers} showHorse={horseId === ""} initial={lines.length} whatIf />
          </div>
        ) : (
          <ul className="surface rows" data-testid="my-races-rows">
            {rows.map((r) => (
              <RunRow key={`${r.raceId}:${r.horseId}`} r={r} />
            ))}
          </ul>
        )
      ) : busy ? (
        <div className="min-h-40" aria-busy />
      ) : failed ? (
        <EmptyState icon="cross" title="Couldn't load your races" text="Check your connection and try again." action={<button className="btn" onClick={() => void load(null)}>Try again</button>} />
      ) : filtered ? (
        <EmptyState icon="stopwatch" title="No races match these filters." text="Try another horse or kind, or clear the wins-only tick." />
      ) : (
        <EmptyState
          icon="stopwatch"
          title="No races yet"
          text="Your first race shows here with its replay."
          action={
            state.horses.length > 0 ? (
              <button type="button" className="btn btn-brass" onClick={entry.quickPick} data-testid="race-now">
                Race now
              </button>
            ) : (
              <Link href="/play" className="btn btn-brass" data-testid="race-now">
                Race now
              </Link>
            )
          }
        />
      )}

      {nextCursor && (
        <button type="button" className="btn w-full" disabled={busy} onClick={() => void load(nextCursor)} data-testid="load-more">
          {busy ? "Loading…" : "Load more"}
        </button>
      )}

      {book && book.splits.total.runs > 0 && (
        <section aria-labelledby="book-h" className="grid gap-3" data-testid="stable-splits">
          <div>
            <h2 id="book-h" className="t-h2">
              Form book
            </h2>
            <p className="t-meta">{horseId ? "This horse's" : "The whole stable's"} settled runs, split by the conditions they were run under (every race kind, whatever the filters above).</p>
          </div>
          <SplitsPanel splits={book.splits} subject={horseId ? (state.horses.find((h) => h.id === horseId)?.horse.name ?? "This horse") : state.stableName} />
        </section>
      )}
    </div>
  );
}

export default function MyRacesPage() {
  return <PlayerGate>{(state) => <MyRaces state={state} />}</PlayerGate>;
}