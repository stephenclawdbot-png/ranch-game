"use client";

/**
 * The horse's log: one timeline of training (gains per stat, fatigue before → after), care,
 * races (with the replay one tap away and the rating change), injuries and the vet, reveals,
 * the improver's step, breeding, ownership and leases. Newest first, by day, paged from
 * /api/horses/[id]/log. Races still to run show no result.
 */
import Link from "next/link";
import { useState } from "react";
import type { HorseLogEntryView, HorseLogView } from "@/lib/types";
import { logEntryText, type LogTone } from "@/lib/formBook";
import { PositionBadge } from "../ui/PositionBadge";

const TONE: Record<LogTone, string> = {
  race: "bg-brass text-ink",
  work: "bg-[#2c6645] text-cream",
  care: "bg-surface-2 text-cream-dim",
  health: "bg-oxblood text-[#f6ecd3]",
  life: "bg-[#24476a] text-cream",
  money: "bg-[#5a4630] text-cream",
};

function dayHeading(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function Entry({ e, numbers }: { e: HorseLogEntryView; numbers: boolean }) {
  const t = logEntryText(e, numbers);
  const time = new Date(e.atMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const pos = e.line?.result?.position;
  const body = (
    <>
      <span className="grid w-[4.75rem] shrink-0 justify-items-start gap-1 pt-0.5">
        <span className={`px-1.5 text-[0.6875rem] font-extrabold uppercase leading-5 tracking-wide ${TONE[t.tone]}`}>{t.tag}</span>
        <span className="caption">{time}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-extrabold leading-snug text-cream">{t.title}</span>
        {t.detail && <span className="t-meta block !text-[0.8125rem]">{t.detail}</span>}
      </span>
      {pos ? <PositionBadge position={pos} size="sm" /> : null}
    </>
  );
  const link = e.raceId ? `/race/${e.raceId}` : e.horseId ? `/horse/${e.horseId}` : null;
  return (
    <li data-testid={`log-${e.kind}`}>
      {link ? (
        <Link href={link} className="row-link group !min-h-0 items-start gap-3 px-3 py-2.5">
          {body}
          <span className="chev self-center" aria-hidden>
            ▶
          </span>
        </Link>
      ) : (
        <div className="flex items-start gap-3 px-3 py-2.5">{body}</div>
      )}
    </li>
  );
}

const FILTERS: { key: string; label: string; kinds: string[] | null }[] = [
  { key: "all", label: "All", kinds: null },
  { key: "races", label: "Races", kinds: ["race", "improver", "quirk"] },
  { key: "training", label: "Training", kinds: ["training"] },
  { key: "care", label: "Care & health", kinds: ["care", "injury", "vet"] },
  { key: "life", label: "Life", kinds: ["born", "graduated", "retired", "legacy_farm", "died", "released", "renamed", "cover", "foal", "sold", "claimed", "lease_start", "lease_end", "scan"] },
];

export function HorseLog({ horseId, initial, numbers = false }: { horseId: string; initial: HorseLogView; numbers?: boolean }) {
  const [entries, setEntries] = useState(initial.entries);
  const [next, setNext] = useState(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("all");
  const [nums, setNums] = useState(numbers);

  async function more() {
    if (!next) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/horses/${horseId}/log?cursor=${encodeURIComponent(next)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as HorseLogView;
      setEntries((cur) => cur.concat(page.entries));
      setNext(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const kinds = FILTERS.find((f) => f.key === filter)?.kinds ?? null;
  const shown = kinds ? entries.filter((e) => kinds.includes(e.kind)) : entries;
  const days: { day: string; items: HorseLogEntryView[] }[] = [];
  for (const e of shown) {
    const day = dayHeading(e.atMs);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(e);
    else days.push({ day, items: [e] });
  }

  return (
    <div className="grid gap-3" data-testid="horse-log">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="segmented w-fit max-w-full overflow-x-auto" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} data-testid={`log-filter-${f.key}`}>
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost min-h-11 text-sm font-bold" aria-pressed={nums} onClick={() => setNums((v) => !v)} data-testid="log-numbers">
          {nums ? "Hide numbers" : "Show numbers"}
        </button>
      </div>
      {days.length === 0 ? (
        <p className="surface t-meta p-4">{next ? "Nothing of this kind on the loaded pages yet: load more below." : "Nothing of this kind yet."}</p>
      ) : (
        days.map((d) => (
          <section key={d.day} aria-label={d.day}>
            <h3 className="label mb-1.5">{d.day}</h3>
            <ul className="surface rows">
              {d.items.map((e) => (
                <Entry key={e.key} e={e} numbers={nums} />
              ))}
            </ul>
          </section>
        ))
      )}
      {failed && <p className="t-meta text-negative">Couldn&rsquo;t load more. Check your connection and try again.</p>}
      {next && (
        <button type="button" className="btn w-full" disabled={busy} onClick={() => void more()} data-testid="log-more">
          {busy ? "Loading…" : "Load older entries"}
        </button>
      )}
    </div>
  );
}
