"use client";

/**
 * "What if?" for your runner in a settled race: a button that opens a small sheet to pick ONE
 * change (tactic, ride, race-day extras or jockey), re-runs the race on the server with the same
 * seed and field, and shows the outcome next to the official result. Free, cached, rate-limited;
 * never a result (no credits, rating or form).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { STYLE_LABEL, ordinal } from "@/lib/format";
import { ApiFailure, api } from "@/lib/player";
import { INTENSITY_WORD, WHAT_IF_PER_HOUR, changeKey, parseChangeKey, type WhatIfChange, type WhatIfExtra, type WhatIfOptionsView, type WhatIfView } from "@/lib/whatIf";
import { WhatIfResult, WhatIfTag, whatIfHref } from "./WhatIfResult";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "pick"; options: WhatIfOptionsView; busy: boolean; error: string | null }
  | { kind: "result"; options: WhatIfOptionsView | null; view: WhatIfView };

const EXTRA_LABEL: Record<WhatIfExtra, string> = { soft_shoes: "Soft-ground shoes", physio: "Physio session" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function WhatIfButton({ raceId, horseId, horseName, className = "btn btn-sm" }: { raceId: string; horseId: string; horseName: string; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/races/${encodeURIComponent(raceId)}/what-if?horseId=${encodeURIComponent(horseId)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as WhatIfOptionsView & { message?: string };
      if (!res.ok) throw new Error(data.message ?? "What if? isn't available for this race.");
      setState({ kind: "pick", options: data, busy: false, error: null });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }, [raceId, horseId]);

  useEffect(() => {
    const d = dialog.current;
    if (open && d && !d.open) {
      d.showModal();
      void load();
    }
  }, [open, load]);

  const run = async (options: WhatIfOptionsView, change: WhatIfChange) => {
    setState({ kind: "pick", options, busy: true, error: null });
    try {
      const view = await api<WhatIfView>(`/api/races/${encodeURIComponent(raceId)}/what-if`, { body: { horseId, change } });
      setState({ kind: "result", options, view });
    } catch (e) {
      setState({ kind: "pick", options, busy: false, error: e instanceof ApiFailure ? e.message : "Couldn't re-run it. Try again." });
    }
  };

  const close = () => dialog.current?.close();

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} data-testid="what-if-open" aria-haspopup="dialog">
        What if?
      </button>
      <dialog
        ref={dialog}
        className="sheet"
        aria-labelledby="what-if-title"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        data-testid="what-if-sheet"
      >
        {open && (
          <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] sm:p-5">
            <div aria-hidden className="mx-auto -mt-1 mb-3 h-1.5 w-12 bg-surface-2 md:hidden" />
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">What if? · same race, same luck</p>
                <h2 id="what-if-title" className="t-h2">
                  {horseName}
                </h2>
              </div>
              <button type="button" onClick={close} className="btn btn-sm shrink-0" aria-label="Close">
                ✕
              </button>
            </div>
            {state.kind === "loading" ? (
              <p className="t-meta">Checking the race…</p>
            ) : state.kind === "error" ? (
              <p className="font-bold" data-testid="what-if-error">
                {state.message}
              </p>
            ) : state.kind === "pick" ? (
              <Picker options={state.options} busy={state.busy} error={state.error} onRun={(c) => void run(state.options, c)} onOpenDone={(c) => void run(state.options, c)} />
            ) : (
              <WhatIfResult v={state.view} watchHref={whatIfHref(state.view)} onAnother={() => (state.options ? setState({ kind: "pick", options: { ...state.options, remaining: state.view.remaining }, busy: false, error: null }) : void load())} />
            )}
          </div>
        )}
      </dialog>
    </>
  );
}

function Choice({ on, label, sub, onClick, testId, disabled }: { on: boolean; label: string; sub?: string; onClick: () => void; testId: string; disabled?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onClick} data-testid={testId} className={`${on ? "surface-2 ring-2 ring-brass" : "inset"} grid min-h-11 content-center px-2.5 py-1.5 text-left disabled:opacity-50`}>
      <span className="font-extrabold leading-5">{label}</span>
      {sub && <span className="text-xs text-cream-dim">{sub}</span>}
    </button>
  );
}

function Group({ title, ran, children }: { title: string; ran: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1 flex w-full items-baseline justify-between gap-2">
        <span className="font-extrabold">{title}</span>
        <span className="text-xs text-cream-dim">ran: {ran}</span>
      </legend>
      {children}
    </fieldset>
  );
}

function Picker({ options: o, busy, error, onRun, onOpenDone }: { options: WhatIfOptionsView; busy: boolean; error: string | null; onRun: (c: WhatIfChange) => void; onOpenDone: (c: WhatIfChange) => void }) {
  const [change, setChange] = useState<WhatIfChange | null>(null);
  const [extras, setExtras] = useState<WhatIfExtra[]>(o.current.extras);
  const key = change ? changeKey(change) : null;
  const doneKeys = new Set(o.done.map((d) => d.changeKey));
  const pick = (c: WhatIfChange) => {
    setExtras(o.current.extras);
    setChange(key === changeKey(c) ? null : c);
  };
  const toggleExtra = (x: WhatIfExtra) => {
    const next = extras.includes(x) ? extras.filter((y) => y !== x) : [...extras, x];
    setExtras(next);
    const same = next.length === o.current.extras.length && next.every((y) => o.current.extras.includes(y));
    setChange(same ? null : { kind: "extras", extras: next });
  };
  if (o.unavailable) return <p className="font-bold">{o.unavailable}</p>;
  const free = doneKeys.has(key ?? "");
  const out = o.remaining <= 0 && !free;
  return (
    <div className="grid gap-4" data-testid="what-if-picker">
      <p className="text-sm text-cream-dim">
        Pick <b className="text-cream">one</b> change. The race runs again with the same field, gates, going and sealed seed, so every horse has the same luck as on the day.
        It&rsquo;s a what-if, not a result.
      </p>

      <Group title="Tactic" ran={STYLE_LABEL[o.current.tactic]}>
        <div className="grid grid-cols-2 gap-1.5">
          {o.tactics.map((t) => (
            <Choice key={t} on={key === `tactic:${t}`} label={STYLE_LABEL[t]} onClick={() => pick({ kind: "tactic", tactic: t })} testId={`what-if-tactic-${t}`} />
          ))}
        </div>
      </Group>

      {o.intensities.length > 0 && (
        <Group title="Ride" ran={cap(INTENSITY_WORD[o.current.intensity ?? "normal"]!)}>
          <div className="grid grid-cols-2 gap-1.5">
            {o.intensities.map((i) => (
              <Choice key={i} on={key === `intensity:${i}`} label={cap(INTENSITY_WORD[i]!)} onClick={() => pick({ kind: "intensity", intensity: i })} testId={`what-if-intensity-${i}`} />
            ))}
          </div>
        </Group>
      )}

      {o.extras.length > 0 && (
        <Group title="Race-day extras" ran={o.current.extras.length ? o.current.extras.map((x) => EXTRA_LABEL[x]).join(", ") : "none"}>
          <div className="grid grid-cols-2 gap-1.5">
            {o.extras.map((x) => (
              <button
                key={x}
                type="button"
                role="checkbox"
                aria-checked={(change?.kind === "extras" ? extras : o.current.extras).includes(x)}
                onClick={() => toggleExtra(x)}
                data-testid={`what-if-extra-${x}`}
                className={`${(change?.kind === "extras" ? extras : o.current.extras).includes(x) ? "surface-2 ring-2 ring-brass" : "inset"} grid min-h-11 content-center px-2.5 py-1.5 text-left ${change?.kind === "extras" ? "" : "opacity-90"}`}
              >
                <span className="font-extrabold leading-5">
                  {(change?.kind === "extras" ? extras : o.current.extras).includes(x) ? "✓ " : ""}
                  {EXTRA_LABEL[x]}
                </span>
                <span className="text-xs text-cream-dim">{x === "physio" ? "Fresher at the off" : "Half the going's drag"}</span>
              </button>
            ))}
          </div>
        </Group>
      )}

      {(o.jockeys.length > 0 || o.grades.length > 0) && (
        <Group title="Jockey" ran={o.current.jockeyName ?? "—"}>
          {o.jockeys.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {o.jockeys.map((j) => (
                <Choice key={j.id} on={key === `jockey:${j.id}`} label={j.name} sub={`Yours · grade ${j.grade}`} onClick={() => pick({ kind: "jockey", jockeyId: j.id })} testId={`what-if-jockey-${j.id}`} />
              ))}
            </div>
          )}
          <p className="text-xs text-cream-dim">Or a typical Club freelancer of a grade:</p>
          <div className="grid grid-cols-5 gap-1.5">
            {o.grades.map((g) => (
              <Choice key={g} on={key === `jockey_grade:${g}`} label={g} onClick={() => pick({ kind: "jockey_grade", grade: g })} testId={`what-if-grade-${g}`} />
            ))}
          </div>
        </Group>
      )}

      {o.notes.length > 0 && (
        <ul className="grid gap-0.5 text-xs text-cream-dim">
          {o.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {o.done.length > 0 && (
        <div className="grid gap-1">
          <p className="caption">Already tried (free to look at again)</p>
          <div className="flex flex-wrap gap-1.5">
            {o.done.map((d) => {
              const c = parseChangeKey(d.changeKey);
              return c ? (
                <button key={d.changeKey} type="button" className="chip" onClick={() => onOpenDone(c)} disabled={busy}>
                  {d.label}: {ordinal(d.position)}
                </button>
              ) : null;
            })}
          </div>
        </div>
      )}

      {error && (
        <p className="font-bold text-negative" role="alert" data-testid="what-if-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-brass" disabled={!change || busy || out} onClick={() => change && onRun(change)} data-testid="what-if-run">
          {busy ? "Re-running…" : "Re-run the race"}
        </button>
        <span className="text-xs text-cream-dim" data-testid="what-if-remaining">
          Free · {free ? "already run" : `${o.remaining} of ${WHAT_IF_PER_HOUR} left this hour`}
        </span>
      </div>
      <WhatIfTag className="w-fit" />
    </div>
  );
}
