"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { HorseRecord, LegMarking } from "@thoroughbred/shared";
import type { HorseDetailView } from "@/lib/types";
import { TRIP_BANDS, aptitudes, horseSummary, type AptitudeCell } from "@/lib/aptitude";
import { COAT_LABEL, GOING_LABEL, SEX_LABEL, STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { riskText } from "../entry/EntryForm";
import { HorsePortrait } from "../HorsePortrait";
import { SilksIcon } from "../Silks";
import { Stall } from "../Stall";
import { GradeBadge, StatBars } from "../StatBars";
import { useEntry } from "../entry/EntryProvider";
import { PixelIcon } from "../icons";
import { ActionBar } from "../ui/ActionBar";
import { PositionBadge } from "../ui/PositionBadge";

export { PositionBadge };

const FACE_LABEL = { none: "No face markings", star: "Star", snip: "Snip", stripe: "Stripe", blaze: "Blaze", bald: "Bald face" } as const;
const LEG_LABEL: Record<LegMarking, string> = { none: "", coronet: "coronet", sock: "sock", stocking: "stocking" };
const LEG_NAMES = ["near fore", "off fore", "near hind", "off hind"];

function legsText(legs: readonly LegMarking[]): string {
  const marked = legs.map((l, i) => (l === "none" ? null : `${LEG_LABEL[l]} (${LEG_NAMES[i]})`)).filter(Boolean);
  return marked.length ? marked.join(", ") : "No leg markings";
}

function recordText(r: HorseRecord): string {
  if (r.starts === 0) return "Unraced";
  return `${r.starts} ${r.starts === 1 ? "run" : "runs"} · ${r.wins} ${r.wins === 1 ? "win" : "wins"} · ${r.places} 2nd · ${r.shows} 3rd · ${formatCredits(r.earnings)} earned`;
}

/** One aptitude row: label + a grade per condition; the best is marked with a word, not colour. */
function AptRow<K extends string>({ label, cells, name }: { label: string; cells: AptitudeCell<K>[]; name: (k: K) => string }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-start gap-2 py-2 sm:grid-cols-[6rem_1fr]">
      <dt className="pt-1 font-extrabold">{label}</dt>
      <dd className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-1.5">
        {cells.map((c) => (
          <span key={c.key} className={`flex items-center gap-1.5 px-1.5 py-1 ${c.best ? "bg-surface-2" : ""}`} title={`${name(c.key)}: ${c.grade}`}>
            <GradeBadge grade={c.grade} size="sm" />
            <span className="min-w-0 text-sm leading-tight">
              <span className="block font-bold text-cream">{name(c.key)}</span>
              {c.best && <span className="block text-xs font-extrabold text-positive">✓ best</span>}
            </span>
          </span>
        ))}
      </dd>
    </div>
  );
}

export function HorseDetail({ view, tabs }: { view: HorseDetailView; tabs?: ReactNode }) {
  const entry = useEntry();
  const [numbers, setNumbers] = useState(false);
  const isMine = view.mine;
  const horse = view.horse;
  const record: HorseRecord = horse.record;
  const stableName = view.stableName;
  const history = view.runs;
  const st = view.status;
  const apt = aptitudes(horse);
  const tripName = (id: string) => TRIP_BANDS.find((b) => b.id === id)!.label;

  return (
    <div className="grid gap-6">
      <nav aria-label="Breadcrumb">
        <Link href={isMine ? "/stable" : "/races"} className="inline-flex min-h-11 items-center gap-1 font-bold text-cream-dim hover:text-cream">
          ‹ {isMine ? "Your stable" : "Races"}
        </Link>
      </nav>
      {tabs}

      <section className="grid gap-4 md:grid-cols-[auto_1fr] md:gap-6" aria-labelledby="horse-h">
        <div className="surface w-fit !p-0">
          <Stall className="flex items-end justify-center px-6 pt-4 md:px-8">
            <HorsePortrait
              appearance={horse.appearance}
              scale={2}
              className="md:hidden"
              title={`${horse.name}, ${COAT_LABEL[horse.appearance.coat]}`}
            />
            <HorsePortrait appearance={horse.appearance} scale={3} className="hidden md:block" />
          </Stall>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <p className="flex items-center gap-2 text-sm font-bold text-cream-dim">
            <SilksIcon silks={horse.appearance.silks} className="h-7 w-7" /> {stableName}
            {isMine && <span className="you-tag">Yours</span>}
          </p>
          <div>
            <h1 id="horse-h" className="t-display-l md:text-[2.5rem]" data-testid="horse-name">
              {horse.name}
            </h1>
            <p className="text-cream-dim">
              {horse.age}-year-old {COAT_LABEL[horse.appearance.coat].toLowerCase()} {SEX_LABEL[horse.sex].toLowerCase()}
              {view.trainer && ` · trained by ${view.trainer}`}
            </p>
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label="At a glance">
            <li className="chip text-cream">{STYLE_LABEL[horse.style]}</li>
            <li className="chip text-cream">Best {formatDistance(horse.preferredDistanceM)}</li>
            <li className="chip text-cream">{SURFACE_LABEL[horse.preferredSurface]}</li>
          </ul>
          <p className="max-w-prose text-lg">{horseSummary(horse)}</p>
          <p className="t-meta">{recordText(record)}</p>
          {st && (
            <ul className="flex flex-wrap gap-1.5 text-sm" aria-label="Condition" data-testid="horse-status">
              <li className="chip text-cream">
                Career {st.starts}/{st.maxStarts} starts
              </li>
              <li className="chip text-cream">OR {st.rating}</li>
              <li className={`chip ${st.condition === "tired" ? "text-negative" : "text-cream"}`}>
                {st.condition === "tired" ? "Tired" : st.condition === "fresh" ? "Fresh" : "Ready"} · freshness {Math.round(st.freshness / 10)}%
              </li>
              {st.injury && (
                <li className="chip text-negative">
                  Injured ({st.injury.severity.replace("_", " ")}){st.injury.untilMs ? ` · back ${new Date(st.injury.untilMs).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                </li>
              )}
              <li className={`chip ${st.risk.label === "low" ? "text-cream" : "text-negative"}`} title={st.risk.factors.join(" · ")}>
                Injury risk {riskText(st.risk)}
              </li>
            </ul>
          )}
          {isMine && st?.block === "Not yet of racing age" ? (
            <ActionBar className="md:mt-2">
              <Link href={`/horse/${horse.id}/care`} className="btn btn-brass btn-lg" data-testid="care-link">
                <PixelIcon name="horseshoe" size={32} className="-my-2" /> Care for {horse.name.split(" ")[0]}
              </Link>
            </ActionBar>
          ) : isMine ? (
            <ActionBar className="md:mt-2">
              <button type="button" className="btn btn-brass btn-lg" onClick={() => entry.open(horse.id)} disabled={!!st?.block} data-testid="enter-a-race">
                <PixelIcon name="flag" size={32} className="-my-2" /> {st?.block ? st.block : `Race ${horse.name}`}
              </button>
            </ActionBar>
          ) : view.kind === "house" ? (
            <p className="text-sm text-cream-dim">A club horse. You&rsquo;ll meet it on the card.</p>
          ) : null}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface p-4" aria-labelledby="apt-h">
          <h2 id="apt-h" className="t-display-m">
            Aptitudes
          </h2>
          <p className="mt-1 text-sm text-cream-dim">
            How much of {horse.name.split(" ")[0]}&rsquo;s ability shows in each condition. A keeps it all; E loses a lot.
          </p>
          <dl className="mt-2 divide-y-2 divide-line">
            <AptRow label="Trip" cells={apt.trip} name={tripName} />
            <AptRow label="Surface" cells={apt.surface} name={(k) => SURFACE_LABEL[k]} />
            <AptRow label="Going" cells={apt.going} name={(k) => GOING_LABEL[k]} />
            <AptRow label="Plan" cells={apt.style} name={(k) => STYLE_LABEL[k]} />
          </dl>
          <p className="caption mt-2">Trip bands: {TRIP_BANDS.map((b) => `${b.label} ${b.range}`).join(" · ")}..</p>
        </section>

        <section className="surface p-4" aria-labelledby="ability-h">
          <div className="flex items-end justify-between gap-2">
            <h2 id="ability-h" className="t-display-m">
              Abilities
            </h2>
            <button type="button" className="btn-ghost min-h-11 text-sm font-bold" aria-pressed={numbers} onClick={() => setNumbers((n) => !n)}>
              {numbers ? "Hide numbers" : "Show numbers"}
            </button>
          </div>
          <div className="mt-3">
            <StatBars stats={horse.stats} showNumbers={numbers} />
          </div>
        </section>
      </div>

      {(isMine || history.length > 0) && (
        <section aria-labelledby="history-h">
          <h2 id="history-h" className="t-display-m mb-2">
            Form
          </h2>
          {history.length === 0 ? (
            <div className="surface p-4 text-cream-dim">
              No runs yet. {horse.name.split(" ")[0]}&rsquo;s first start will show here with its replay.
            </div>
          ) : (
            <ul className="surface rows" data-testid="history">
              {history.map((h) => (
                <li key={h.raceId}>
                  <Link href={`/race/${h.raceId}`} className="row-link group gap-3 px-3 py-2">
                    <PositionBadge position={h.position} />
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold group-hover:underline">{h.raceName}</p>
                      <p className="t-meta">
                        {h.kind === "live" ? "Live" : "Story"} · {formatDistance(h.distanceM)} · {SURFACE_LABEL[h.surface]} · {h.fieldSize} ran ·{" "}
                        {new Date(h.postTimeMs).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <span className={`num ${h.prize > 0 ? "text-positive" : "text-sage"}`}>{h.prize > 0 ? `+${formatCredits(h.prize)}` : "–"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <details className="surface p-3">
        <summary className="flex min-h-11 items-center font-extrabold">Pedigree &amp; markings</summary>
        <dl className="mt-2 grid gap-1 text-cream-dim sm:grid-cols-2">
          <div>
            <dt className="label">Sire</dt>
            <dd className="text-cream">{horse.sireId ?? "Foundation stock"}</dd>
          </div>
          <div>
            <dt className="label">Dam</dt>
            <dd className="text-cream">{horse.damId ?? "Foundation stock"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="label">Markings</dt>
            <dd>
              Generation {horse.generation}. {FACE_LABEL[horse.appearance.face]}; {legsText(horse.appearance.legs)}.
            </dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
