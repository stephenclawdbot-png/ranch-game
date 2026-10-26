"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { HorseRecord, LegMarking } from "@thoroughbred/shared";
import type { HorseDetailView } from "@/lib/types";
import { TRIP_BANDS, aptitudes, horseSummary, type AptitudeCell } from "@/lib/aptitude";
import { COAT_LABEL, GOING_LABEL, SEX_LABEL, STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { riskText } from "../entry/EntryForm";
import { HorsePortrait } from "../HorsePortrait";
import { Silks } from "../Silks";
import { GradeBadge, StatBars } from "../StatBars";
import { useEntry } from "../entry/EntryProvider";
import { PixelIcon } from "../icons";
import { ActionBar } from "../ui/ActionBar";
import { EmptyState, SceneBand } from "../ui/Page";
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
          <span key={c.key} className={`flex items-center gap-1.5 px-1.5 py-1 ${c.best ? "surface-2" : ""}`} title={`${name(c.key)}: ${c.grade}`}>
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

  const first = horse.name;
  return (
    <div className="grid gap-6">
      <SceneBand
        scene="barn"
        size="crop"
        alt=""
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Silks silks={horse.appearance.silks} cap={false} className="h-[26px] w-8" /> {stableName}
          </span>
        }
        title={<span data-testid="horse-name">{horse.name}</span>}
        aside={
          <Link href={isMine ? "/stable" : "/races"} className="link !text-on-baize [text-shadow:0_1px_0_#050d08]">
            ‹ {isMine ? "Stable" : "Races"}
          </Link>
        }
      />
      {tabs}

      <section className="surface grid gap-4 p-4 sm:grid-cols-[auto_1fr] sm:gap-6 sm:p-5" aria-labelledby="horse-h">
        <div className="well grid h-fit w-fit place-items-center self-start justify-self-center p-2 sm:justify-self-start">
          <HorsePortrait appearance={horse.appearance} scale={1} className="md:hidden" title={`${horse.name}, ${COAT_LABEL[horse.appearance.coat]}`} />
          <HorsePortrait appearance={horse.appearance} scale={2} className="hidden md:block" />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <p className="flex flex-wrap items-center gap-2">
              <span className="tag" title="Registration number" data-testid="reg-no">
                {view.regNo}
              </span>
              {isMine && <span className="tag tag-you">Yours</span>}
            </p>
            <h2 id="horse-h" className="t-hero mt-2">
              {horse.age > 0 ? `${horse.age}-year-old ` : "A young "}
              {COAT_LABEL[horse.appearance.coat].toLowerCase()} {SEX_LABEL[horse.sex].toLowerCase()}
              {horse.age > 0 ? "" : " in the nursery"}
            </h2>
            <p className="t-meta">
              {STYLE_LABEL[horse.style]} · best {formatDistance(horse.preferredDistanceM)} on {SURFACE_LABEL[horse.preferredSurface].toLowerCase()}
              {view.trainer && ` · trained by ${view.trainer}`}
            </p>
          </div>
          <p className="max-w-prose">{horseSummary(horse)}</p>
          <p className="t-meta">{recordText(record)}</p>
          {st && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[0.875rem] font-bold" aria-label="Condition" data-testid="horse-status">
              <li className="inline-flex items-center gap-1.5">
                <i className={`dot ${st.condition === "tired" ? "dot-warn" : "dot-pos"}`} aria-hidden />
                {st.condition === "tired" ? "Tired" : st.condition === "fresh" ? "Fresh" : "Ready"} · {Math.round(st.freshness / 10)}%
              </li>
              <li>
                {st.starts}/{st.maxStarts} starts
              </li>
              <li>OR {st.rating}</li>
              {st.injury && (
                <li className="text-negative">
                  Injured ({st.injury.severity.replace("_", " ")}){st.injury.untilMs ? ` · back ${new Date(st.injury.untilMs).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                </li>
              )}
              <li className={st.risk.label === "low" ? "" : "text-negative"} title={st.risk.factors.join(" · ")}>
                Risk {riskText(st.risk)}
              </li>
            </ul>
          )}
          {isMine && st?.block === "Not yet of racing age" ? (
            <ActionBar className="md:mt-2">
              <Link href={`/horse/${horse.id}/care`} className="btn btn-brass btn-lg" data-testid="care-link">
                <PixelIcon name="grooming-brush" size={32} className="-my-2" /> Care for {first}
              </Link>
            </ActionBar>
          ) : isMine && st?.block ? (
            <p className="t-meta font-bold" data-testid="enter-a-race-blocked">
              {st.block}. {first} can race again once that&rsquo;s over.
            </p>
          ) : isMine ? (
            <ActionBar className="md:mt-2">
              <button type="button" className="btn btn-brass btn-lg" onClick={() => entry.open(horse.id)} data-testid="enter-a-race">
                <PixelIcon name="flag" size={32} className="-my-2" /> Enter {first} in a race
              </button>
            </ActionBar>
          ) : view.stud ? (
            <div className="grid gap-2" data-testid="stud-info">
              <p className="t-meta">
                {view.stud.club ? "A Club stallion standing at stud" : "Standing at stud"} · fee <span className="num text-cream">{formatCredits(view.stud.fee)}</span> (plus the breeding fee)
              </p>
              <Link href="/breeding" className="btn w-fit" data-testid="plan-cover-with">
                Plan a cover with {first}
              </Link>
            </div>
          ) : view.kind === "house" ? (
            <p className="t-meta">A Club horse. You&rsquo;ll meet it on the card at Kestrel Downs.</p>
          ) : null}
          {isMine && view.actions && (view.actions.cover || view.actions.stud || view.actions.sell) && (
            <ul className="flex flex-wrap gap-2" aria-label="More for this horse" data-testid="horse-actions">
              {view.actions.cover && (
                <li>
                  <Link href="/breeding" className="btn btn-outline btn-sm" data-testid="plan-cover">
                    Plan a cover
                  </Link>
                </li>
              )}
              {view.actions.stud && (
                <li>
                  <Link href="/breeding#studs" className="btn btn-outline btn-sm" data-testid="stand-at-stud">
                    {view.stud ? `At stud · ${formatCredits(view.stud.fee)}` : "Stand at stud"}
                  </Link>
                </li>
              )}
              {view.actions.sell && (
                <li>
                  <Link href="/market#sell" className="btn btn-outline btn-sm" data-testid="sell-horse">
                    Sell
                  </Link>
                </li>
              )}
            </ul>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface p-4" aria-labelledby="apt-h">
          <h2 id="apt-h" className="t-h2">
            Aptitudes
          </h2>
          <p className="mt-1 text-sm text-cream-dim">
            How much of {horse.name}&rsquo;s ability shows in each condition. A keeps it all; E loses a lot.
          </p>
          <dl className="mt-2 divide-y-2 divide-dotted divide-line">
            <AptRow label="Trip" cells={apt.trip} name={tripName} />
            <AptRow label="Surface" cells={apt.surface} name={(k) => SURFACE_LABEL[k]} />
            <AptRow label="Going" cells={apt.going} name={(k) => GOING_LABEL[k]} />
            <AptRow label="Plan" cells={apt.style} name={(k) => STYLE_LABEL[k]} />
          </dl>
          <p className="caption mt-2">Trip bands: {TRIP_BANDS.map((b) => `${b.label} ${b.range}`).join(" · ")}.</p>
        </section>

        <section className="surface p-4" aria-labelledby="ability-h">
          <div className="flex items-end justify-between gap-2">
            <h2 id="ability-h" className="t-h2">
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
          <h2 id="history-h" className="t-h2 mb-3">
            Form
          </h2>
          {history.length === 0 ? (
            <EmptyState icon="stopwatch" title="No runs yet" text={`${first}'s first start shows here with its replay.`} />
          ) : (
            <ul className="surface rows" data-testid="history">
              {history.map((h) => (
                <li key={h.raceId}>
                  <Link href={`/race/${h.raceId}`} className="row-link group gap-3 px-4 py-3">
                    <PositionBadge position={h.position} />
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold group-hover:underline">{h.raceName}</p>
                      <p className="t-meta">
                        {h.kind === "live" ? "Live" : "Story"} · {formatDistance(h.distanceM)} · {SURFACE_LABEL[h.surface]} · {h.fieldSize} ran ·{" "}
                        {new Date(h.postTimeMs).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                    {h.prize > 0 ? <span className="reward">+{formatCredits(h.prize)}</span> : <span className="chev">▶</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="ped-h" data-testid="pedigree">
        <h2 id="ped-h" className="t-h2 mb-3">
          Pedigree
        </h2>
        <div className="surface grid gap-3 p-4">
          <div className="ped-tree">
            <PedigreeBox role="Sire" p={view.pedigree.sire} />
            <PedigreeBox role="Dam" p={view.pedigree.dam} />
            <div className="ped-self">
              <span className="label">Generation {horse.generation}</span>
              <span className="t-title">{horse.name}</span>
              <span className="caption">{view.regNo}</span>
            </div>
          </div>
          <p className="t-meta">
            {FACE_LABEL[horse.appearance.face]}; {legsText(horse.appearance.legs)}.
          </p>
        </div>
      </section>
    </div>
  );
}

function PedigreeBox({ role, p }: { role: "Sire" | "Dam"; p: HorseDetailView["pedigree"]["sire"] }) {
  return (
    <div className="ped-parent">
      <span className="label">{role}</span>
      {p ? (
        <>
          <Link href={`/horse/${p.id}`} className="t-title hover:underline">
            {p.name}
          </Link>
          {p.regNo && <span className="caption">{p.regNo}</span>}
        </>
      ) : (
        <span className="t-meta">Foundation stock</span>
      )}
    </div>
  );
}
