"use client";

/**
 * Full form lines (the form book): every start with the conditions it was run under, what the
 * stable chose, and the settled result. Phones get a dense row (position, date, race, trip and
 * going, beaten distance, rating change) that taps open to the rest; desktop gets the table.
 * A race not yet settled shows "Declared" or "Running" and nothing of the result.
 */
import Link from "next/link";
import { Fragment, useState } from "react";
import type { FormLineView } from "@/lib/types";
import { CLASS_LABEL, GOING_LABEL, STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import {
  EXTRA_LABEL,
  INTENSITY_LABEL,
  behindText,
  dateText,
  drawText,
  fatigueWord,
  jockeyText,
  lengthsText,
  marginPhrase,
  raceTimeText,
  ratingText,
  weightText,
} from "@/lib/formBook";
import { PositionBadge } from "../ui/PositionBadge";

const classLabel = (c: string) => CLASS_LABEL[c as keyof typeof CLASS_LABEL] ?? c;
const tacticLabel = (t: string) => STYLE_LABEL[t as keyof typeof STYLE_LABEL] ?? t;

function StatusChip({ l }: { l: FormLineView }) {
  return (
    <span className={`chip ${l.status === "running" ? "chip-live" : ""} justify-center`} data-testid="form-status">
      {l.status === "running" ? "Running" : "Declared"}
    </span>
  );
}

function Pos({ l, size = "sm" }: { l: FormLineView; size?: "sm" | "md" }) {
  return l.result ? <PositionBadge position={l.result.position} size={size} /> : <StatusChip l={l} />;
}

function ratingDelta(l: FormLineView): { text: string; cls: string } {
  const after = l.result?.ratingAfter ?? null;
  if (after === null) return { text: `${l.ratingBefore}`, cls: "text-cream-dim" };
  const d = after - l.ratingBefore;
  return { text: d === 0 ? `${after}` : `${after} (${d > 0 ? "+" : ""}${d})`, cls: d > 0 ? "text-positive" : d < 0 ? "text-negative" : "text-cream-dim" };
}

/** Everything the dense row leaves out (phones: tapped open; desktop: under the row). */
function Detail({ l, numbers, showHorse }: { l: FormLineView; numbers: boolean; showHorse: boolean }) {
  const r = l.result;
  const facts: [string, string][] = [
    ...(showHorse && l.horseName ? ([["Horse", l.horseName]] as [string, string][]) : []),
    ["Race", `${l.raceName} · ${l.kind === "live" ? classLabel(l.raceClass) : "Story"}`],
    ["Course", l.course ?? "—"],
    ["Trip", formatDistance(l.distanceM)],
    ["Surface · going", `${SURFACE_LABEL[l.surface]} · ${GOING_LABEL[l.going]}`],
    ["Field · draw", `${l.fieldSize} ran · gate ${drawText(l)}`],
    ["Tactic", `${tacticLabel(l.tactic)}${l.intensity ? ` · ${INTENSITY_LABEL[l.intensity] ?? l.intensity}` : ""}`],
    ["Jockey", jockeyText(l.jockey)],
    ["Race-day extras", l.extras.length ? l.extras.map((x) => EXTRA_LABEL[x] ?? x).join(", ") : "None"],
    ["Weight", weightText(l)],
  ];
  if (l.fatigue !== null) facts.push(["At the off", `${fatigueWord(l.fatigue)}${numbers ? ` (fatigue ${l.fatigue}‰, freshness ${l.freshness ?? "—"}‰)` : ""}`]);
  if (r) {
    facts.push(["Result", `${r.position} of ${l.fieldSize}${r.position === 1 ? (r.marginLabel ? `, won by ${marginPhrase(r.marginLabel)}` : "") : `, beaten ${lengthsText(r.beatenMm)}`}`]);
    facts.push(["Time", `${raceTimeText(r.timeUs)}${behindText(r.timeUs, r.winningTimeUs) ? ` (${behindText(r.timeUs, r.winningTimeUs)}; winner ${raceTimeText(r.winningTimeUs)})` : ""}`]);
    facts.push(["Rating", ratingText(l.ratingBefore, r.ratingAfter)]);
    facts.push(["Purse won", r.prize > 0 ? `${formatCredits(r.prize)} of ${formatCredits(l.purse)}` : "—"]);
  } else {
    facts.push(["Result", l.status === "running" ? "Running now: the result shows once it's in" : "Not run yet"]);
  }
  return (
    <div className="grid gap-3 px-3 pb-3 pt-1">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
        {facts.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="caption self-center">{k}</dt>
            <dd className="font-bold text-cream">{v}</dd>
          </Fragment>
        ))}
      </dl>
      <Link href={`/race/${l.raceId}`} className="btn btn-sm w-fit" data-testid="form-replay">
        {l.result ? "Watch the replay" : l.status === "running" ? "Watch live" : "Race card"}
      </Link>
    </div>
  );
}

/** The phone row: the key five facts, tap to open. */
function PhoneRow({ l, numbers, showHorse }: { l: FormLineView; numbers: boolean; showHorse: boolean }) {
  const [open, setOpen] = useState(false);
  const rd = ratingDelta(l);
  return (
    <li data-testid="form-line">
      <button type="button" className="flex min-h-14 w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-2" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Pos l={l} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-extrabold text-cream">
            {showHorse && l.horseName ? `${l.horseName} · ` : ""}
            {l.raceName}
          </span>
          <span className="t-meta block truncate !text-[0.8125rem]">
            {dateText(l.postTimeMs)} · {l.course ? `${l.course} · ` : ""}
            {formatDistance(l.distanceM)} · {GOING_LABEL[l.going]}
          </span>
        </span>
        <span className="grid shrink-0 justify-items-end text-right">
          <span className="num text-sm text-cream">{l.result ? lengthsText(l.result.beatenMm, l.result.position) : "—"}</span>
          <span className={`num text-xs ${rd.cls}`}>OR {rd.text}</span>
        </span>
        <span className="chev w-4 text-center" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && <Detail l={l} numbers={numbers} showHorse={showHorse} />}
    </li>
  );
}

function TableRow({ l, numbers, showHorse }: { l: FormLineView; numbers: boolean; showHorse: boolean }) {
  const [open, setOpen] = useState(false);
  const r = l.result;
  const rd = ratingDelta(l);
  return (
    <>
      <tr className={`cursor-pointer ${open ? "is-open" : ""}`} onClick={() => setOpen((o) => !o)} data-testid="form-row">
        <td className="whitespace-nowrap">{dateText(l.postTimeMs)}</td>
        <td className="max-w-[16rem]">
          <Link href={`/race/${l.raceId}`} className="block truncate font-extrabold text-cream hover:underline" onClick={(e) => e.stopPropagation()}>
            {showHorse && l.horseName ? `${l.horseName} · ` : ""}
            {l.raceName}
          </Link>
          <span className="caption block truncate">
            {l.course ?? (l.kind === "story" ? "Story" : "—")} · {l.kind === "live" ? classLabel(l.raceClass) : "Story"}
          </span>
        </td>
        <td className="num whitespace-nowrap">{formatDistance(l.distanceM)}</td>
        <td className="whitespace-nowrap">
          {GOING_LABEL[l.going]}
          <span className="caption block">{SURFACE_LABEL[l.surface]}</span>
        </td>
        <td className="num whitespace-nowrap text-center">{drawText(l)}</td>
        <td className="whitespace-nowrap">
          {tacticLabel(l.tactic)}
          <span className="caption block">{jockeyText(l.jockey)}</span>
        </td>
        <td className="num whitespace-nowrap">{l.weightLb === null ? "—" : `${l.weightLb}`}</td>
        {numbers && <td className="num whitespace-nowrap">{l.fatigue === null ? "—" : `${l.fatigue}`}</td>}
        <td className="text-center">
          <Pos l={l} />
        </td>
        <td className="num whitespace-nowrap">{r ? lengthsText(r.beatenMm, r.position) : "—"}</td>
        <td className="num whitespace-nowrap">{r ? raceTimeText(r.timeUs) : "—"}</td>
        <td className={`num whitespace-nowrap ${rd.cls}`}>{rd.text}</td>
        <td className="num whitespace-nowrap text-right">{r && r.prize > 0 ? <span className="text-brass-hi">+{formatCredits(r.prize)}</span> : "—"}</td>
        <td className="chev w-6 text-center" aria-hidden>
          {open ? "▴" : "▾"}
        </td>
      </tr>
      {open && (
        <tr className="form-detail">
          <td colSpan={numbers ? 14 : 13}>
            <Detail l={l} numbers={numbers} showHorse={showHorse} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The form lines, newest first. `numbers`: the page's "Show numbers" toggle (fatigue at the off as
 * a number). `showHorse`: stable views name the horse in each row. `initial`: rows shown before
 * "Show all".
 */
export function FormLines({ lines, numbers = false, showHorse = false, initial = 10 }: { lines: FormLineView[]; numbers?: boolean; showHorse?: boolean; initial?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, initial);
  // Fatigue at the off is the keeper's only: no column for anyone else.
  const fat = numbers && lines.some((l) => l.fatigue !== null);
  return (
    <div className="grid gap-2" data-testid="form-lines">
      <ul className="surface rows md:hidden">
        {shown.map((l) => (
          <PhoneRow key={`${l.raceId}:${l.horseId}`} l={l} numbers={numbers} showHorse={showHorse} />
        ))}
      </ul>
      <div className="surface hidden overflow-x-auto md:block">
        <table className="form-table" data-testid="form-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Race</th>
              <th scope="col">Trip</th>
              <th scope="col">Going</th>
              <th scope="col" className="text-center" title="Gate / runners">
                Draw
              </th>
              <th scope="col">Tactic · jockey</th>
              <th scope="col" title="Weight carried (Live handicaps)">
                Wt
              </th>
              {fat && (
                <th scope="col" title="Fatigue at the off, ‰">
                  Fat.
                </th>
              )}
              <th scope="col" className="text-center">
                Pos
              </th>
              <th scope="col" title="Beaten distance">
                Btn
              </th>
              <th scope="col">Time</th>
              <th scope="col" title="Official rating after (change)">
                OR
              </th>
              <th scope="col" className="text-right">
                Won
              </th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <TableRow key={`${l.raceId}:${l.horseId}`} l={l} numbers={fat} showHorse={showHorse} />
            ))}
          </tbody>
        </table>
      </div>
      {lines.length > initial && (
        <button type="button" className="btn btn-sm w-fit" onClick={() => setAll((a) => !a)} data-testid="form-show-all">
          {all ? "Show fewer" : `Show all ${lines.length} starts`}
        </button>
      )}
    </div>
  );
}
