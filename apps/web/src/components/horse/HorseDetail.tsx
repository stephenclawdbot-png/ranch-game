"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { HorseRecord, LegMarking } from "@thoroughbred/shared";
import type { HorseDetailView } from "@/lib/types";
import { TRIP_BANDS, aptitudes, horseSummary, type AptitudeCell } from "@/lib/aptitude";
import { GOING_LABEL, SEX_LABEL, STYLE_LABEL, SURFACE_LABEL, coatLabel, formatCredits, formatDistance } from "@/lib/format";
import { riskText } from "../entry/EntryForm";
import { GradeBadge, StatBars } from "../StatBars";
import { useEntry } from "../entry/EntryProvider";
import { PixelIcon } from "../icons";
import { ActionBar } from "../ui/ActionBar";
import { EmptyState } from "../ui/Page";
import { HorseStage } from "./HorseStage";
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
      <HorseStage
        view={view}
        status={
          <>
            <p className="mx-auto mt-3 max-w-prose text-[0.9375rem] text-on-baize-2 lg:mx-0">{horseSummary(horse)}</p>
            <p className="t-meta mt-1 !text-on-baize-3">{recordText(record)}</p>
            {st && (
              <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[0.8125rem] font-bold text-on-baize-2 lg:justify-start" aria-label="Condition" data-testid="horse-status">
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
          </>
        }
        actions={
          <>
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
          </>
        }
      />
      {tabs}

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

      {view.genetics && <Genetics gen={view.genetics} />}

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

/** Coat genotype, markings, breed mix and build — the stud-book view of the horse. */
function Genetics({ gen }: { gen: NonNullable<HorseDetailView["genetics"]> }) {
  return (
    <section className="surface p-4" aria-labelledby="gen-h" data-testid="genetics">
      <h2 id="gen-h" className="t-h2">
        Genetics
      </h2>
      <p className="mt-1 text-sm text-cream-dim">
        {gen.coat.name}
        {gen.coat.bornAs ? ` — born ${gen.coat.bornAs.toLowerCase()}, greying with career` : ""}. The genotype behind the coat.
      </p>
      <div className="mt-3 grid gap-x-6 gap-y-4 lg:grid-cols-2">
        <div>
          <table className="w-full text-sm" data-testid="genetics-loci">
            <caption className="label mb-1 text-left">Coat loci</caption>
            <tbody>
              {gen.coat.loci.map((l) => (
                <tr key={l.locus} className="border-t-2 border-dotted border-line">
                  <th scope="row" className="py-1.5 pr-2 text-left font-bold">
                    {l.locus}
                  </th>
                  <td className="w-16 py-1.5 pr-2 font-mono text-xs leading-5">{l.alleles}</td>
                  <td className={`py-1.5 leading-5 ${l.carried ? "text-cream-dim" : ""}`}>
                    {l.meaning}
                    {l.carried && <span className="label ml-1" title="A copy this horse doesn't show but can pass to its foals">(hidden copy)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid content-start gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="label self-center">Face</dt>
            <dd className="min-w-0 font-bold">{gen.white.face}</dd>
            <dt className="label self-center">Legs</dt>
            <dd className="min-w-0 font-bold">{gen.white.legs}</dd>
            <dt className="label self-center">Sabino</dt>
            <dd className="font-mono text-xs font-bold">{gen.white.sabino}</dd>
            <dt className="label self-center">White tendency</dt>
            <dd className="font-bold capitalize">{gen.white.tendency}</dd>
            <dt className="label self-center">Build</dt>
            <dd className="min-w-0 font-bold capitalize">{gen.build}</dd>
            <dt className="label self-center">Inbreeding</dt>
            <dd className="font-bold">{gen.inbreeding.text}</dd>
          </dl>
          <ul className="grid gap-1.5" aria-label="Breed mix">
            {gen.breed.map((b) => (
              <li key={b.key} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-2 text-sm">
                <span className="min-w-0 truncate font-bold">{b.label}</span>
                <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={b.share} aria-label={`${b.label} share`}>
                  <span style={{ width: `${b.share}%` }} />
                </span>
                <span className="num font-bold">{b.share}%</span>
              </li>
            ))}
          </ul>
          <div>
            <span className="label">Quirks</span>
            {gen.quirks.length ? (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {gen.quirks.map((q) => (
                  <li key={q.key} className="chip">
                    {q.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-meta mt-1">None revealed yet — quirks show themselves in races.</p>
            )}
          </div>
        </div>
      </div>
    </section>
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
