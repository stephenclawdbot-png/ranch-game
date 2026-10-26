"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { HorsePortrait } from "@/components/HorsePortrait";
import { PlayerGate } from "@/components/PlayerGate";
import { Silks } from "@/components/Silks";
import { GradeBadge } from "@/components/StatBars";
import { conditionLabel, riskText } from "@/components/entry/EntryForm";
import { useEntry } from "@/components/entry/EntryProvider";
import { PixelIcon } from "@/components/icons";
import { ActionBar } from "@/components/ui/ActionBar";
import { StorageNote } from "@/components/ui/StorageNote";
import { aptitudes, tripBand } from "@/lib/aptitude";
import { SEX_LABEL, STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { recommendHorse, totals, type PlayerState } from "@/lib/player";
import type { StableHorse } from "@/lib/types";

type SortKey = "rating" | "trip" | "wins";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "rating", label: "Best" },
  { key: "trip", label: "Trip" },
  { key: "wins", label: "Wins" },
];

/** Last three finishing positions, oldest first ("5-2-1"), or "–" if unraced. */
function formFigures(state: PlayerState, horseId: string): string {
  const runs = state.runs
    .filter((r) => r.horseId === horseId)
    .slice(0, 3)
    .reverse();
  return runs.length ? runs.map((r) => (r.position > 9 ? "0" : String(r.position))).join("-") : "–";
}

function Stable({ state }: { state: PlayerState }) {
  const entry = useEntry();
  const [sort, setSort] = useState<SortKey>("rating");
  const t = totals(state);

  const rows = useMemo(() => {
    const list = state.horses.map((s) => ({ s, apt: aptitudes(s.horse) }));
    if (sort === "rating") list.sort((a, b) => b.apt.ideal - a.apt.ideal);
    if (sort === "trip") list.sort((a, b) => a.s.horse.preferredDistanceM - b.s.horse.preferredDistanceM);
    if (sort === "wins") list.sort((a, b) => b.s.horse.record.wins - a.s.horse.record.wins || b.s.horse.record.earnings - a.s.horse.record.earnings);
    return list;
  }, [state, sort]);
  const best = recommendHorse(state)?.id;

  return (
    <div className="grid gap-5">
      <header className="flex items-center gap-3">
        <Silks silks={state.silks} cap={false} className="h-[39px] w-12 shrink-0" />
        <div className="min-w-0">
          <h1 className="t-display-l" data-testid="stable-name">
            {state.stableName}
          </h1>
          <p className="t-meta">
            <span className="num text-cream">{formatCredits(state.credits)}</span> credits · {state.entries.balance}/{state.entries.cap} Live entries ·{" "}
            {state.stalls.used}/{state.stalls.slots} stalls · {t.starts} {t.starts === 1 ? "run" : "runs"} · {t.wins} {t.wins === 1 ? "win" : "wins"}
          </p>
        </div>
      </header>

      <section aria-labelledby="string-h">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h2 id="string-h" className="t-display-m">
            Your horses
          </h2>
          <div className="segmented" role="group" aria-label="Sort horses">
            {SORTS.map((s) => (
              <button key={s.key} type="button" aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="surface !p-0">
          <div
            className="hidden grid-cols-[minmax(0,1.6fr)_7rem_8.5rem_7rem_7.5rem_4rem_6rem] items-center gap-3 border-b-2 border-line px-3 py-2 lg:grid"
            aria-hidden
          >
            {["Horse", "Style", "Best trip", "Condition", "Spd · Sta · Brs", "Form", ""].map((c) => (
              <span key={c} className="label">
                {c}
              </span>
            ))}
          </div>
          <ul className="rows">
            {rows.map(({ s }) => (
              <RosterRow key={s.id} s={s} form={formFigures(state, s.id)} recommended={s.id === best} onRace={() => entry.open(s.id)} />
            ))}
          </ul>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <ActionBar>
          <button type="button" className="btn btn-brass btn-lg" onClick={entry.quickPick} data-testid="quick-pick">
            <PixelIcon name="flag" size={32} className="-my-2" /> Story race now
          </button>
        </ActionBar>
        <button type="button" className="btn" onClick={entry.quickPickLive} data-testid="live-quick-pick">
          Enter next Live race
        </button>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Stable yard" data-testid="yard-links">
        <Link href="/nursery" className="btn btn-sm">
          Nursery
        </Link>
        <Link href="/facilities" className="btn btn-sm">
          Facilities
        </Link>
      </nav>

      <div className="grid gap-3 border-t-2 border-line pt-4">
        <Link
          href="/me"
          className="inline-flex min-h-11 w-fit items-center gap-2 font-bold text-cream-dim underline decoration-2 underline-offset-4 hover:text-cream"
        >
          <PixelIcon name="pencil" className="h-4 w-4" /> Edit name &amp; colours
        </Link>
        <StorageNote />
      </div>
    </div>
  );
}

function RosterRow({ s, form, recommended, onRace }: { s: StableHorse; form: string; recommended: boolean; onRace: () => void }) {
  const horse = s.horse;
  const st = horse.stats;
  const cond = conditionLabel(s);
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 lg:grid-cols-[minmax(0,1.6fr)_7rem_8.5rem_7rem_7.5rem_4rem_6rem]"
      data-testid="horse-card"
    >
      <Link href={`/horse/${s.id}`} className="group flex min-w-0 items-center gap-3">
        <span className="bg-inset">
          <HorsePortrait appearance={horse.appearance} scale="thumb" />
        </span>
        <span className="min-w-0">
          <span className="t-title block group-hover:underline">
            {horse.name}
            {recommended && <span className="ml-2 align-middle text-xs font-extrabold text-positive">✓ Quick Pick</span>}
          </span>
          <span className="t-meta block lg:hidden">
            {STYLE_LABEL[horse.style]} · {tripBand(horse.preferredDistanceM).label} {formatDistance(horse.preferredDistanceM)} ·{" "}
            {SURFACE_LABEL[horse.preferredSurface]}
          </span>
          <span className="t-meta hidden lg:block">
            {SEX_LABEL[horse.sex]} · {s.starts}/{s.maxStarts} starts · OR {s.rating}
          </span>
        </span>
      </Link>
      <span className="hidden text-sm font-bold text-cream-dim lg:block">{STYLE_LABEL[horse.style]}</span>
      <span className="hidden whitespace-nowrap text-sm font-bold text-cream lg:block">
        {tripBand(horse.preferredDistanceM).label} <span className="text-cream-dim">{formatDistance(horse.preferredDistanceM)}</span>
      </span>
      <span className={`hidden text-sm font-bold lg:block ${cond.tone}`} title={`Injury risk next start: ${riskText(s.risk)}`}>
        {cond.text}
      </span>
      <span className="hidden gap-1 lg:flex" aria-label={`Speed ${st.speed}, stamina ${st.stamina}, burst ${st.burst}`}>
        <GradeBadge value={st.speed} size="sm" />
        <GradeBadge value={st.stamina} size="sm" />
        <GradeBadge value={st.burst} size="sm" />
      </span>
      <span className="num hidden text-cream-dim lg:block" title="Last three runs, oldest first">
        {form}
      </span>
      <button type="button" className="btn btn-sm justify-self-end" onClick={onRace} disabled={!!s.block} aria-label={`Race ${horse.name}`}>
        Race
      </button>
      <span className="col-span-2 flex flex-wrap items-center gap-2 pl-[3.75rem] text-xs font-bold text-sage lg:hidden">
        <span className={cond.tone}>{cond.text}</span>
        <span>· {s.starts}/{s.maxStarts} starts</span>
        <span className="flex items-center gap-1" aria-label={`Speed ${st.speed}, stamina ${st.stamina}, burst ${st.burst}`}>
          <span>Spd</span>
          <GradeBadge value={st.speed} size="sm" />
          <span className="ml-1">Sta</span>
          <GradeBadge value={st.stamina} size="sm" />
        </span>
        <span className="ml-auto">Form {form}</span>
      </span>
    </li>
  );
}

export default function StablePage() {
  return <PlayerGate>{(state) => <Stable state={state} />}</PlayerGate>;
}
