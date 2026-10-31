"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { HorsePortrait } from "@/components/HorsePortrait";
import { PlayerGate } from "@/components/PlayerGate";
import { StableBadge } from "@/components/StableBadge";
import { conditionLabel, riskText } from "@/components/entry/EntryForm";
import { useEntry } from "@/components/entry/EntryProvider";
import { PixelIcon, type IconName } from "@/components/icons";
import { ActionBar } from "@/components/ui/ActionBar";
import { RanchStage } from "@/components/stable/RanchStage";
import { YourJockeys } from "@/components/jockeys/YourJockeys";
import { Section } from "@/components/ui/Page";
import { aptitudes } from "@/lib/aptitude";
import { SEX_LABEL, STYLE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { recommendHorse, type PlayerState } from "@/lib/player";
import type { StableHorse } from "@/lib/types";

type SortKey = "ready" | "fit" | "rating" | "name";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "ready", label: "Ready first" },
  { key: "fit", label: "Best fit" },
  { key: "rating", label: "Rating" },
  { key: "name", label: "Name" },
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
  const [sort, setSort] = useState<SortKey>("ready");
  const best = recommendHorse(state);

  const rows = useMemo(() => {
    const list = state.horses.map((s) => ({ s, apt: aptitudes(s.horse) }));
    const ready = (s: StableHorse) => (s.block || s.lockedRaceId ? 2 : s.condition === "tired" ? 1 : 0);
    if (sort === "ready") list.sort((a, b) => ready(a.s) - ready(b.s) || (a.s.id === best?.id ? -1 : b.s.id === best?.id ? 1 : 0) || b.apt.ideal - a.apt.ideal);
    if (sort === "fit") list.sort((a, b) => b.apt.ideal - a.apt.ideal);
    if (sort === "rating") list.sort((a, b) => b.s.rating - a.s.rating || b.s.horse.record.wins - a.s.horse.record.wins);
    if (sort === "name") list.sort((a, b) => a.s.horse.name.localeCompare(b.s.horse.name));
    return list;
  }, [state, sort, best?.id]);
  const empty = Math.max(0, state.stalls.slots - state.stalls.used);

  return (
    <div>
      <RanchStage
        horses={best ? [best, ...state.horses.filter((h) => h.id !== best.id)] : state.horses}
        onRace={(id) => entry.open(id)}
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <StableBadge silks={state.silks} photoUrl={state.photoUrl} cap={false} className="h-[26px] w-8" />
            <span>
              <span data-testid="stable-name">{state.stableName}</span> · {state.stalls.used} of {state.stalls.slots} stalls
            </span>
          </span>
        }
        title="Stable"
      />

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-8">
        <div className="min-w-0">
          <div className="-mx-[var(--gutter)] flex gap-2 overflow-x-auto px-[var(--gutter)] pb-3" role="group" aria-label="Sort horses">
            {SORTS.map((s) => (
              <button key={s.key} type="button" className="fchip" aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
          <ul className="surface rows">
            {rows.map(({ s }) => (
              <RosterRow key={s.id} s={s} form={formFigures(state, s.id)} recommended={s.id === best?.id} onRace={() => entry.open(s.id)} />
            ))}
            {empty > 0 && (
              <li>
                <Link href="/packs" className="row-link gap-3 px-4 py-3" data-testid="empty-stalls">
                  <span className="empty-slot !h-16 !w-16">
                    <PixelIcon name="horseshoe" size={32} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="t-title block">
                      {empty} empty {empty === 1 ? "stall" : "stalls"}
                    </span>
                    <span className="t-meta block">Foals come from Paddock Packs and your own mares.</span>
                  </span>
                  <span className="chev">›</span>
                </Link>
              </li>
            )}
          </ul>
          {!!state.leasedOut?.length && (
            <Section title="Away on lease">
              <ul className="surface rows" data-testid="leased-out">
                {state.leasedOut.map((l) => (
                  <li key={l.id}>
                    <Link href={`/horse/${l.id}`} className="row-link gap-3 px-4 py-3">
                      <span className="well grid shrink-0 place-items-center overflow-hidden">
                        <HorsePortrait appearance={l.horse.appearance} scale="thumb" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="t-title block">{l.horse.name}</span>
                        <span className="t-meta block" data-testid="lease-out-chip">
                          On lease to {l.toStable} · back {shortDay(l.endsAtMs)}
                          {l.returnPending ? " (after its race)" : ""} · your share {l.ownerSharePct}% · {formatCredits(l.earned)} earned in {l.races} {l.races === 1 ? "race" : "races"}
                        </span>
                      </span>
                      <span className="chev">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {best && (
            <div className="mt-4">
              <ActionBar>
                <button type="button" className="btn btn-brass btn-lg" onClick={entry.quickPick} data-testid="quick-pick">
                  <PixelIcon name="flag" size={32} className="-my-2" /> Race {best.horse.name} now
                </button>
              </ActionBar>
            </div>
          )}
        </div>

        <aside className="min-w-0">
          <Section title="Around the yard" className="!mt-0 lg:!mt-[52px]">
            <ul className="surface rows">
              <YardRow icon="feed-bucket" title="Care" text="Feed, groom and turn out. Builds bond." href={state.horses[0] ? `/horse/${state.horses[0].id}/care` : "/nursery"} />
              <YardRow icon="stable" title="Facilities" text="More stalls, a vet room, a gallop." href="/facilities" />
              <YardRow icon="coin" title="Finances" text="Every credit in and out, horse by horse." href="/stable/finances" />
              <YardRow icon="star" title="Nursery" text="Foals grow with daily care." href="/nursery" />
              <YardRow icon="laurel" title="Legacy Farm" text="Retired for good: their records and best wins." href="/legacy" />
              <li>
                <div className="flex items-center gap-3 px-4 py-3">
                  <PixelIcon name="flag" size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="t-title block">Live races</span>
                    <span className="t-meta block">{state.entries.balance} entries left today</span>
                  </span>
                  <button type="button" className="btn btn-outline btn-sm" onClick={entry.quickPickLive} data-testid="live-quick-pick">
                    Enter
                  </button>
                </div>
              </li>
            </ul>
            <p className="caption mt-2" data-testid="upkeep-so-far">
              {state.upkeep.horses > 0 ? (
                <>
                  Upkeep this week so far: <strong className="text-cream-dim">{formatCredits(state.upkeep.due)} credits</strong> ({state.upkeep.horses}{" "}
                  {state.upkeep.horses === 1 ? "horse" : "horses"} used) — charged after Sunday.{" "}
                </>
              ) : (
                <>No upkeep this week yet: you pay only for horses you race, train or breed. </>
              )}
              <Link href="/stable/finances" className="link">
                Full books
              </Link>
            </p>
          </Section>
          <YourJockeys />
        </aside>
      </div>
    </div>
  );
}

function shortDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function YardRow({ icon, title, text, href }: { icon: IconName; title: string; text: string; href: string }) {
  return (
    <li>
      <Link href={href} className="row-link gap-3 px-4 py-3">
        <PixelIcon name={icon} size={32} />
        <span className="min-w-0 flex-1">
          <span className="t-title block">{title}</span>
          <span className="t-meta block">{text}</span>
        </span>
        <span className="chev">›</span>
      </Link>
    </li>
  );
}

function RosterRow({ s, form, recommended, onRace }: { s: StableHorse; form: string; recommended: boolean; onRace: () => void }) {
  const horse = s.horse;
  const cond = conditionLabel(s);
  const resting = s.block === "Not yet of racing age";
  const dot = s.lockedRaceId ? "dot-brass" : s.block || s.condition === "tired" ? "dot-warn" : "dot-pos";
  return (
    <li className={`flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4 ${recommended ? "yours" : ""}`} data-testid="horse-card">
      <Link href={`/horse/${s.id}`} className="group flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <span className="well grid shrink-0 place-items-center overflow-hidden">
          <span className="sm:hidden">
            <HorsePortrait appearance={horse.appearance} scale="thumb" />
          </span>
          <span className="hidden sm:block">
            <HorsePortrait appearance={horse.appearance} scale={1} />
          </span>
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="t-title group-hover:underline">{horse.name}</span>
          <span className="t-meta">
            {SEX_LABEL[horse.sex]} · {STYLE_LABEL[horse.style]} · <span className="whitespace-nowrap">{formatDistance(horse.preferredDistanceM)}</span>
          </span>
          {s.geneticsLine && (
            <span className="caption" data-testid="genetics-line">
              {s.geneticsLine}
            </span>
          )}
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] font-bold text-cream-dim">
            {recommended && <span className="tag tag-you !h-5 !text-[0.6875rem]">★ Best fit</span>}
            {s.lease && (
              <span className="tag !h-5 !text-[0.6875rem]" data-testid="lease-chip">
                Leased from {s.lease.fromStable} · ends {shortDay(s.lease.endsAtMs)} · your share {s.lease.sharePct}%
              </span>
            )}
            <span className="inline-flex items-center gap-1.5" title={`Injury risk next start: ${riskText(s.risk)}`}>
              <i className={`dot ${dot}`} aria-hidden />
              {s.lockedRaceId ? "Entered" : cond.text}
            </span>
            <span className="hidden sm:inline">Form {form}</span>
            <span className="hidden text-sage sm:inline">{s.regNo}</span>
          </span>
        </span>
      </Link>
      {resting ? (
        <Link href={`/horse/${s.id}/care`} className="btn btn-outline btn-sm shrink-0" aria-label={`Care for ${horse.name}`}>
          Care
        </Link>
      ) : s.block ? (
        <Link href={`/horse/${s.id}`} className="btn btn-outline btn-sm shrink-0" aria-label={`${horse.name}: ${s.block}`}>
          View
        </Link>
      ) : (
        <button type="button" className="btn btn-sm shrink-0" onClick={onRace} aria-label={`Race ${horse.name}`}>
          Race
        </button>
      )}
    </li>
  );
}

export default function StablePage() {
  return <PlayerGate band={{ scene: "barn", alt: "Inside your barn", eyebrow: "Your yard", title: "Stable" }}>{(state) => <Stable state={state} />}</PlayerGate>;
}
