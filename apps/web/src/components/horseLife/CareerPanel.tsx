"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { HorseLifeView } from "@/lib/horseLife";
import { formatCredits } from "@/lib/format";
import { ErrorNote } from "../ui/ErrorNote";
import { ConfirmButton, RangeList, useAction } from "./common";
import { HorseNameInput, useHorseNameCheck } from "../ui/HorseNameInput";

const REASON: Record<string, string> = { choice: "by your choice", max_starts: "after 40 starts", injury: "after a career-ending injury" };

/** The career clock (n / 40 starts), maturity, revealed potential and the owner's career decisions. */
export function CareerPanel({ view }: { view: HorseLifeView }) {
  const c = view.career;
  const first = view.name;
  const router = useRouter();
  const action = useAction();
  const base = `/api/horses/${view.id}`;
  const [name, setName] = useState(view.name);
  const [editing, setEditing] = useState(false);
  const check = useHorseNameCheck(name, { horseId: view.id, current: view.name });
  const pct = (n: number) => `${(n / c.maxStarts) * 100}%`;
  // the breeding career: a stallion goes to stud, a mare becomes a broodmare (retiring is final)
  const stud = view.horse.sex === "colt" || view.horse.sex === "stallion" || view.horse.sex === "gelding";

  async function career(kind: "retire" | "legacy" | "release") {
    const r = await action.run<{ action: string }>(kind, `${base}/career`, { body: { action: kind } });
    if (r && kind === "release") router.push("/stable");
  }
  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const r = await action.run("rename", `${base}/rename`, { body: { name } });
    if (r) setEditing(false);
  }

  return (
    <div className="grid gap-5">
      <section className="surface grid gap-3 p-4" aria-labelledby="clock-h" data-testid="career-clock">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="clock-h" className="t-h2">
            Career
          </h2>
          <p className="score text-[2.5rem] leading-none text-brass-bright" aria-label={`${c.starts} of ${c.maxStarts} starts`}>
            {c.starts}
            <span className="text-cream-dim"> / {c.maxStarts}</span>
          </p>
        </div>
        <p className="text-cream" data-testid="career-stage">
          {c.careerStatus === "racing"
            ? c.racingAge
              ? `${c.stageLabel}. ${c.maxStarts - c.starts} starts left in the career.`
              : `Not racing yet: ${first} reaches racing age through daily care.`
            : c.careerStatus === "retired"
              ? `${stud ? "At stud" : "A broodmare"} ${REASON[c.retirementReason ?? "choice"] ?? ""}: no more racing. ${c.breedingsLeft > 0 ? `${c.breedingsLeft} breedings left, then retired for good.` : ""}`
              : "Retired for good on the Legacy Farm: no racing, no breeding. Legends never leave the Hall."}
        </p>
        <div className="relative pt-5" aria-hidden>
          <div className="flex h-4 gap-[2px] bg-[#050b08] p-[2px]">
            {c.stages.map((s) => (
              <span
                key={s.key}
                className="relative h-full"
                style={{ flexGrow: s.to - s.from + (s.from === 0 ? 0 : 1), flexBasis: 0, background: s.current ? "#d9a441" : "#1f4d35" }}
              />
            ))}
          </div>
          <span className="absolute top-0 h-9 w-[2px] bg-cream" style={{ left: `calc(${pct(Math.min(c.starts, c.maxStarts))} - 1px)` }} />
          <span
            className="absolute top-[1.4rem] h-1.5 bg-positive/70"
            style={{ left: pct(c.maturity.peakFrom), width: pct(c.maturity.peakTo - c.maturity.peakFrom) }}
            title="Peak window"
          />
        </div>
        <ul className="grid grid-cols-3 gap-1 text-xs font-bold">
          {c.stages.map((s) => (
            <li key={s.key} className={s.current ? "text-cream" : "text-sage"}>
              {s.current && "▸ "}
              {s.label} {s.from}–{s.to}
            </li>
          ))}
        </ul>
        <div className="surface-2 grid gap-1 p-3" data-testid="maturity">
          <p className="font-extrabold">
            {c.maturity.label} <span className="text-sm font-bold text-positive">· peak around starts {c.maturity.peakFrom}–{c.maturity.peakTo}</span>
          </p>
          <p className="text-sm text-cream-dim">{c.maturity.blurb} Horses only age by racing, never by calendar time.</p>
        </div>
      </section>

      <section className="surface grid gap-3 p-4" aria-labelledby="pot-h">
        <div>
          <h2 id="pot-h" className="t-h2">
            Potential
          </h2>
          <p className="text-sm text-cream-dim">
            What {first} could become. The ranges narrow as {first} grows and races{c.scanned ? "; the Pedigree Scan already narrowed them." : "."}
          </p>
        </div>
        <RangeList ranges={c.ranges} />
        {!c.scanned && (
          <button
            type="button"
            className="btn btn-sm w-fit"
            onClick={() => action.run("scan", `${base}/scan`)}
            disabled={action.busy !== null || view.credits < c.scanCost}
            data-testid="scan"
          >
            Pedigree Scan · {formatCredits(c.scanCost)} cr
          </button>
        )}
      </section>

      <section className="surface grid gap-4 p-4" aria-labelledby="dec-h" data-testid="career-actions">
        <h2 id="dec-h" className="t-h2">
          Decisions
        </h2>
        {c.lockReason && <p className="text-sm font-bold text-warn">{c.lockReason}: career decisions wait until that&rsquo;s over.</p>}

        {c.canRename && (
          <div className="grid gap-2">
            <h3 className="t-title">Name</h3>
            {editing ? (
              <form className="flex flex-wrap items-start gap-2" onSubmit={rename}>
                <HorseNameInput id="rename" label="New name" value={name} onChange={setName} check={check} testId="rename-input" className="min-w-0 max-w-xs flex-1" />
                <button type="submit" className="btn btn-sm" disabled={action.busy !== null || !name.trim() || (check !== null && !check.ok)} data-testid="rename-save">
                  Save name
                </button>
              </form>
            ) : (
              <button type="button" className="btn btn-sm w-fit" onClick={() => setEditing(true)} data-testid="rename">
                Rename {first}
              </button>
            )}
            <p className="caption">A horse can be renamed until its first start. Racing names are unique: 2–18 characters.</p>
          </div>
        )}

        {c.canRetire && (
          <div className="grid gap-2">
            <h3 className="t-title">{view.horse.sex === "gelding" ? "End racing" : stud ? "Send to stud" : "Make a broodmare"}</h3>
            <p className="text-sm text-cream-dim">
              Ends the racing career now ({c.starts} of {c.maxStarts} starts).{" "}
              {view.horse.sex === "gelding"
                ? `Geldings don't breed: ${first} stays in your stable until you retire them.`
                : `${first} stays in your stable and breeds up to ${c.breedingsLeft} more times, then retires for good.`}
            </p>
            <ConfirmButton
              label={view.horse.sex === "gelding" ? `End ${first}'s racing` : stud ? `Send ${first} to stud` : `Make ${first} a broodmare`}
              confirmLabel="Yes, end racing"
              warning={`${first} will never race again.`}
              onConfirm={() => career("retire")}
              busy={action.busy === "retire"}
              disabled={action.busy !== null}
              testId="retire"
            />
          </div>
        )}

        {c.careerStatus !== "pasture" && (
          <div className="grid gap-2">
            <h3 className="t-title">Retire for good</h3>
            <p className="text-sm text-cream-dim">
              Retired horses don&rsquo;t race or breed again. {first} moves to the Legacy Farm: frees a stall, stays in your records and the Hall of Fame. No upkeep, ever.
            </p>
            <ConfirmButton
              label={`Retire ${first} for good`}
              confirmLabel="Yes, retire for good"
              warning={`This is permanent: ${first} won't race or breed again.`}
              onConfirm={() => career("legacy")}
              busy={action.busy === "legacy"}
              disabled={!c.canLegacy || action.busy !== null}
              testId="legacy"
            />
          </div>
        )}

        <div className="grid gap-2">
          <h3 className="t-title">Release to the Club</h3>
          <p className="text-sm text-cream-dim">
            {first} goes to the Club&rsquo;s string and frees a stall. You get {formatCredits(c.releasePayout)} credits.
            {c.bound && " Club-bred horses can't be sold, but they can always be released."}
          </p>
          <ConfirmButton
            label="Release to the Club"
            confirmLabel={`Yes, release ${first}`}
            warning={`${first} will leave your stable for good.`}
            onConfirm={() => career("release")}
            busy={action.busy === "release"}
            disabled={!c.canRelease || action.busy !== null}
            danger
            testId="release"
          />
        </div>
        {action.error != null && action.busy === null && <ErrorNote error={action.error} />}
      </section>
    </div>
  );
}
