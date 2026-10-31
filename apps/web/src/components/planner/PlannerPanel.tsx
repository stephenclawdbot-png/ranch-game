"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { PlanCandidate, PlanTargetView, PlanView } from "@/lib/socialTypes";
import { LocalTime } from "../competition/LocalTime";
import { useEntry } from "../entry/EntryProvider";
import { Section } from "../ui/Page";

const PHASE_TAG: Record<PlanTargetView["freshness"]["phase"], { label: string; cls: string }> = {
  peak: { label: "At peak", cls: "tag-good" },
  building: { label: "Building", cls: "" },
  fading: { label: "Fading", cls: "" },
  flat: { label: "No peak", cls: "tag-locked" },
};

/**
 * The campaign planner (horse page and /week): each target with its checks (eligibility now, the
 * freshness peak against the off, clashes inside the minimum rest, the entry window) and a one-tap
 * "Enter now" through the usual entry sheet once entries are open. Targets leave by themselves
 * with a note when the horse runs, is scratched, or can no longer run in the race.
 */
export function PlannerPanel({ initial, horses, horseId }: { initial: PlanView; horses: { id: string; name: string }[]; horseId?: string }) {
  const entry = useEntry();
  const [plan, setPlan] = useState(initial);
  const [pick, setPick] = useState<string>(horseId ?? horses[0]?.id ?? "");
  const [candidates, setCandidates] = useState<PlanCandidate[] | null>(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/plans${horseId ? `?horseId=${horseId}` : ""}`, { cache: "no-store" });
    if (r.ok) setPlan((await r.json()) as PlanView);
  }, [horseId]);

  const loadCandidates = useCallback(async (id: string) => {
    setCandidates(null);
    setChoice("");
    if (!id) return;
    const r = await fetch(`/api/plans/candidates?horseId=${id}`, { cache: "no-store" });
    setCandidates(r.ok ? ((await r.json()) as { races: PlanCandidate[] }).races : []);
  }, []);

  useEffect(() => {
    void loadCandidates(pick);
  }, [pick, loadCandidates]);

  async function send(method: "POST" | "DELETE", body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/plans", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) setError(((await r.json().catch(() => ({}))) as { message?: string }).message ?? "That didn't work. Try again.");
      await refresh();
      return r.ok;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const c = candidates?.find((x) => `${x.slotIndex}:${x.raceId ?? ""}` === choice);
    if (!c || !pick) return;
    if (await send("POST", { horseId: pick, ...(c.raceId ? { raceId: c.raceId } : { slotIndex: c.slotIndex }) })) setChoice("");
  }

  const count = plan.targets.filter((t) => t.horseId === pick).length;
  return (
    <Section id="plan-h" title="Campaign plan" testId="planner">
      <div className="grid gap-3">
        {plan.targets.length === 0 ? (
          <p className="surface t-meta p-4" data-testid="plan-empty">
            No targets yet. Aim {horseId ? "this horse" : "a horse"} at a race on the card or a Qualifier, the Weekend Feature or a Season Final: the plan checks the rating band, the freshness peak, clashes and when entries open.
          </p>
        ) : (
          <ul className="surface rows" data-testid="plan-targets">
            {plan.targets.map((t) => (
              <TargetRow key={t.id} t={t} showHorse={!horseId} busy={busy} onRemove={() => send("DELETE", { id: t.id })} onEnter={() => t.raceId && entry.enterLive(t.raceId)} />
            ))}
          </ul>
        )}
        {plan.removed.length > 0 && (
          <ul className="caption grid gap-1" data-testid="plan-removed" aria-label="Recently off the plan">
            {plan.removed.map((r) => (
              <li key={r.id}>
                Off the plan: {r.horseName}, {r.name}: {r.note}.
              </li>
            ))}
          </ul>
        )}
        <div className="surface grid gap-2 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end" data-testid="plan-add">
          {!horseId && (
            <label className="grid gap-1 text-sm font-bold">
              Horse
              <select
                className="field min-h-11"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
              >
                {horses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="grid min-w-0 gap-1 text-sm font-bold">
            Aim at
            <select className="field min-h-11 min-w-0" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={!pick} data-testid="plan-race">
              <option value="">{candidates === null ? "Loading races…" : candidates.length ? "Choose a race…" : "No races to aim at"}</option>
              {candidates?.map((c) => (
                <option key={`${c.slotIndex}:${c.raceId ?? ""}`} value={`${c.slotIndex}:${c.raceId ?? ""}`}>
                  {new Date(c.postTimeMs).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })} · {c.name}
                  {c.calendar ? " (calendar)" : ""}
                  {c.reason ? ` (not yet: ${c.reason})` : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" disabled={busy || !choice || count >= plan.max} onClick={() => void add()} data-testid="plan-pin">
            Pin target
          </button>
          <p className="caption sm:col-span-3">
            Up to {plan.max} targets per horse. You get an inbox reminder when entries open and two hours before they close.{" "}
            <Link href="/wiki/planning" className="underline">
              How planning works
            </Link>
          </p>
          {error && (
            <p className="text-sm font-bold text-negative sm:col-span-3" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </Section>
  );
}

function TargetRow({ t, showHorse, busy, onRemove, onEnter }: { t: PlanTargetView; showHorse: boolean; busy: boolean; onRemove: () => void; onEnter: () => void }) {
  const tag = PHASE_TAG[t.freshness.phase];
  const canEnter = t.entry.state === "open" && !t.entered && !!t.raceId;
  return (
    <li className="grid gap-1.5 px-4 py-3" data-testid="plan-target">
      <p className="t-title">
        {showHorse && <span className="text-cream-dim">{t.horseName} · </span>}
        Aiming at:{" "}
        {t.raceId ? (
          <Link href={`/race/${t.raceId}`} className="underline-offset-2 hover:underline">
            {t.name}
          </Link>
        ) : (
          t.name
        )}
        , <LocalTime ms={t.postTimeMs} withDate />
      </p>
      <ul className="caption grid gap-0.5">
        <li data-testid="plan-eligibility" className={t.eligibility ? "text-negative" : ""}>
          {t.eligibility ? `Not eligible now: ${t.eligibility}` : "Eligible now"}
        </li>
        <li data-testid="plan-freshness">
          <span className={`tag !h-[18px] !px-1.5 !text-[0.625rem] !leading-[18px] ${tag.cls}`}>{tag.label}</span> {t.freshness.text}
          {t.freshness.peakFromMs && t.freshness.peakToMs && t.freshness.phase !== "peak" && (
            <>
              {" "}
              (peak <LocalTime ms={t.freshness.peakFromMs} withDate /> to <LocalTime ms={t.freshness.peakToMs} withDate />)
            </>
          )}
        </li>
        {t.clashes.map((c) => (
          <li key={c} className="text-negative" data-testid="plan-clash">
            Clash with {c}
          </li>
        ))}
        <li data-testid="plan-window">
          {t.entered ? (
            "Entered ✓"
          ) : t.entry.state === "not_open" ? (
            <>
              Entries open <LocalTime ms={t.entry.opensAtMs} withDate />
            </>
          ) : t.entry.state === "open" ? (
            <>
              Entries open now, close <LocalTime ms={t.entry.closesAtMs} withDate />
            </>
          ) : (
            "Entries closed"
          )}
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        {canEnter && (
          <button type="button" className="btn btn-brass btn-sm" onClick={onEnter} data-testid="plan-enter">
            Enter now
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onRemove} data-testid="plan-remove">
          Remove
        </button>
      </div>
    </li>
  );
}
