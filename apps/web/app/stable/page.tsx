"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Horse } from "@thoroughbred/shared";
import { HorsePortrait } from "@/components/HorsePortrait";
import { PlayerGate } from "@/components/PlayerGate";
import { Silks } from "@/components/Silks";
import { GradeBadge } from "@/components/StatBars";
import { useEntry } from "@/components/entry/EntryProvider";
import { PixelIcon } from "@/components/icons";
import { ActionBar } from "@/components/ui/ActionBar";
import { StorageNote } from "@/components/ui/StorageNote";
import { aptitudes, recommendIndex, tripBand } from "@/lib/aptitude";
import { SEX_LABEL, STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { horseRecord, totals, type PlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";

type SortKey = "rating" | "trip" | "wins";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "rating", label: "Best" },
  { key: "trip", label: "Trip" },
  { key: "wins", label: "Wins" },
];

/** Last three finishing positions, oldest first ("5-2-1"), or "–" if unraced. */
function formFigures(state: PlayerState, index: number): string {
  const runs = state.progress.history.filter((h) => h.horseIndex === index).slice(0, 3).reverse();
  return runs.length ? runs.map((r) => (r.position > 9 ? "0" : String(r.position))).join("-") : "–";
}

function Stable({ state }: { state: PlayerState }) {
  const { horses, error } = usePlayerHorses(state.player.playerId, state.player.silks);
  const entry = useEntry();
  const [sort, setSort] = useState<SortKey>("rating");
  const t = totals(state);

  const rows = useMemo(() => {
    if (!horses) return null;
    const list = horses.map((h, i) => ({ h, i, apt: aptitudes(h), rec: horseRecord(state, i) }));
    if (sort === "rating") list.sort((a, b) => b.apt.ideal - a.apt.ideal);
    if (sort === "trip") list.sort((a, b) => a.h.preferredDistanceM - b.h.preferredDistanceM);
    if (sort === "wins") list.sort((a, b) => b.rec.wins - a.rec.wins || b.rec.earnings - a.rec.earnings);
    return list;
  }, [horses, sort, state]);
  const best = horses ? recommendIndex(horses, (i) => horseRecord(state, i).starts) : 0;

  return (
    <div className="grid gap-5">
      <header className="flex items-center gap-3">
        <Silks silks={state.player.silks} cap={false} className="h-[39px] w-12 shrink-0" />
        <div className="min-w-0">
          <h1 className="t-display-l" data-testid="stable-name">
            {state.player.stableName}
          </h1>
          <p className="t-meta">
            <span className="num text-cream">{formatCredits(state.progress.credits)}</span> credits · {t.starts} {t.starts === 1 ? "run" : "runs"} · {t.wins}{" "}
            {t.wins === 1 ? "win" : "wins"}
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

        {error && <p className="px-oxblood p-3 text-sm">Couldn&rsquo;t reach the track ({error}). Your stable is safe on this device; try refreshing.</p>}

        <div className="surface !p-0">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_7rem_7rem_6rem_7.5rem_4rem_6rem] items-center gap-3 border-b-2 border-line px-3 py-2 lg:grid" aria-hidden>
            {["Horse", "Style", "Best trip", "Surface", "Spd · Sta · Brs", "Form", ""].map((c) => (
              <span key={c} className="label">
                {c}
              </span>
            ))}
          </div>
          <ul className="rows">
            {rows
              ? rows.map(({ h, i, apt }) => {
                  const trip = apt.trip.find((c) => c.best)!;
                  return (
                    <RosterRow key={h.id} horse={h} tripGrade={trip.grade} form={formFigures(state, i)} recommended={i === best} onRace={() => entry.open(i)} />
                  );
                })
              : Array.from({ length: 6 }, (_, i) => <li key={i} className="h-[4.5rem] opacity-50" />)}
          </ul>
        </div>
      </section>

      {horses && (
        <ActionBar>
          <button type="button" className="btn btn-brass btn-lg" onClick={() => entry.open(best)} data-testid="race-best">
            <PixelIcon name="flag" size={32} className="-my-2" /> Race {horses[best]!.name}
          </button>
        </ActionBar>
      )}

      <div className="grid gap-3 border-t-2 border-line pt-4">
        <Link href="/me" className="inline-flex min-h-11 w-fit items-center gap-2 font-bold text-cream-dim underline decoration-2 underline-offset-4 hover:text-cream">
          <PixelIcon name="pencil" className="h-4 w-4" /> Edit name &amp; colours
        </Link>
        <StorageNote />
      </div>
    </div>
  );
}

function RosterRow({ horse, tripGrade, form, recommended, onRace }: { horse: Horse; tripGrade: string; form: string; recommended: boolean; onRace: () => void }) {
  const s = horse.stats;
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 lg:grid-cols-[minmax(0,1.6fr)_7rem_7rem_6rem_7.5rem_4rem_6rem]"
      data-testid="horse-card"
    >
      <Link href={`/horse/${horse.id}`} className="group flex min-w-0 items-center gap-3">
        <span className="bg-inset">
          <HorsePortrait appearance={horse.appearance} scale="thumb" />
        </span>
        <span className="min-w-0">
          <span className="t-title block group-hover:underline">
            {horse.name}
            {recommended && <span className="ml-2 align-middle text-xs font-extrabold text-positive">✓ Ready</span>}
          </span>
          <span className="t-meta block lg:hidden">
            {STYLE_LABEL[horse.style]} · {formatDistance(horse.preferredDistanceM)} · {SURFACE_LABEL[horse.preferredSurface]}
          </span>
          <span className="t-meta hidden lg:block">
            {horse.age}yo {SEX_LABEL[horse.sex].toLowerCase()}
          </span>
        </span>
      </Link>
      <span className="hidden text-sm font-bold text-cream-dim lg:block">{STYLE_LABEL[horse.style]}</span>
      <span className="hidden items-center gap-2 text-sm font-bold text-cream lg:flex">
        <GradeBadge grade={tripGrade} size="sm" />
        {tripBand(horse.preferredDistanceM).label} <span className="text-cream-dim">{formatDistance(horse.preferredDistanceM)}</span>
      </span>
      <span className="hidden text-sm font-bold text-cream-dim lg:block">{SURFACE_LABEL[horse.preferredSurface]}</span>
      <span className="hidden gap-1 lg:flex" aria-label={`Speed ${s.speed}, stamina ${s.stamina}, burst ${s.burst}`}>
        <GradeBadge value={s.speed} size="sm" />
        <GradeBadge value={s.stamina} size="sm" />
        <GradeBadge value={s.burst} size="sm" />
      </span>
      <span className="num hidden text-cream-dim lg:block" title="Last three runs, oldest first">
        {form}
      </span>
      <button type="button" className="btn btn-sm justify-self-end" onClick={onRace} aria-label={`Race ${horse.name}`}>
        Race
      </button>
      <span className="col-span-2 flex items-center gap-2 pl-[3.75rem] text-xs font-bold text-sage lg:hidden">
        <span className="flex items-center gap-1" aria-label={`Trip grade ${tripGrade}; speed ${s.speed}, stamina ${s.stamina}, burst ${s.burst}`}>
          <span>Trip</span>
          <GradeBadge grade={tripGrade} size="sm" />
          <span className="ml-1">Spd</span>
          <GradeBadge value={s.speed} size="sm" />
          <span className="ml-1">Sta</span>
          <GradeBadge value={s.stamina} size="sm" />
          <span className="ml-1">Brs</span>
          <GradeBadge value={s.burst} size="sm" />
        </span>
        <span className="ml-auto">Form {form}</span>
      </span>
    </li>
  );
}

export default function StablePage() {
  return <PlayerGate>{(state) => <Stable state={state} />}</PlayerGate>;
}
