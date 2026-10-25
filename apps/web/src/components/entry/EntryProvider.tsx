"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { STYLE_LABEL, SURFACE_LABEL, formatClock, formatDistance } from "@/lib/format";
import { api, recommendHorse, usePlayerState, type PlayerState } from "@/lib/player";
import type { RacePlan, RaceSummary, RiskView } from "@/lib/types";
import { Countdown } from "../Countdown";
import { HorsePortrait } from "../HorsePortrait";
import { raceMetaLine } from "../RaceMeta";
import { PixelIcon } from "../icons";
import { ErrorNote } from "../ui/ErrorNote";
import { EntryForm, HorsePicker, PlanPicker, quickPickRace, type QuickPickResult } from "./EntryForm";

interface EntryApi {
  /** Story entry sheet for a horse (no stable yet -> onboarding). */
  open: (horseId?: string | null, opts?: { picker?: boolean }) => void;
  /** Story Quick Pick: the pick card (best-suited fresh horse), then watch / skip / later. */
  quickPick: () => void;
  /** Live entry sheet for a card race. */
  enterLive: (raceId: string) => void;
  /** Live Quick Pick: best-fit fresh horse into the next suitable race on the card, one tap. */
  quickPickLive: () => void;
}

const EntryContext = createContext<EntryApi>({
  open: () => undefined,
  quickPick: () => undefined,
  enterLive: () => undefined,
  quickPickLive: () => undefined,
});

export function useEntry(): EntryApi {
  return useContext(EntryContext);
}

type WatchMode = "watch" | "instant" | "later";

export interface LivePickResult {
  raceId: string;
  raceName: string;
  horseId: string;
  horseName: string;
  postTimeMs: number;
  reason: string;
}

type Target =
  | { kind: "entry"; horseId: string | null; picker: boolean; nonce: number }
  | { kind: "pick"; status: "choose" | "error"; busy?: WatchMode; error?: unknown }
  | { kind: "pick"; status: "later"; result: QuickPickResult }
  | { kind: "live"; raceId: string; nonce: number }
  | { kind: "livePick"; status: "busy" | "error"; error?: unknown }
  | { kind: "livePick"; status: "done"; result: LivePickResult };

/**
 * The entry sheet (modal over any route). Modes:
 * - entry: a Story race for one horse, plan preselected to its natural style;
 * - pick: the Story Quick Pick card, then "Watch" / "Skip to result" / "Watch later";
 * - live: enter a horse in a shared Live card race (eligibility and injury risk per horse);
 * - livePick: Live Quick Pick, entered in one tap, with where and when it runs.
 * Native <dialog>: focus is trapped, Esc closes and focus returns to the opener.
 */
export function EntryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const state = usePlayerState();
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<Target | null>(null);

  const open = useCallback<EntryApi["open"]>(
    (horseId, opts) => {
      if (!state) return router.push("/play");
      setTarget({ kind: "entry", horseId: horseId ?? null, picker: opts?.picker ?? !horseId, nonce: Date.now() });
    },
    [state, router],
  );

  const quickPick = useCallback(() => {
    if (!state) return router.push("/play");
    setTarget({ kind: "pick", status: "choose" });
  }, [state, router]);

  const enterLive = useCallback(
    (raceId: string) => {
      if (!state) return router.push("/play");
      setTarget({ kind: "live", raceId, nonce: Date.now() });
    },
    [state, router],
  );

  const quickPickLive = useCallback(() => {
    if (!state) return router.push("/play");
    setTarget({ kind: "livePick", status: "busy" });
    api<{ pick: LivePickResult }>("/api/races/live-pick")
      .then(({ pick }) => {
        setTarget({ kind: "livePick", status: "done", result: pick });
        router.refresh();
      })
      .catch((error: unknown) => setTarget({ kind: "livePick", status: "error", error }));
  }, [state, router]);

  const enterPicked = useCallback(
    (mode: WatchMode) => {
      setTarget({ kind: "pick", status: "choose", busy: mode });
      quickPickRace({ instant: mode === "instant" })
        .then((result) => {
          if (mode !== "later") {
            dialog.current?.close();
            router.push(`/race/${result.raceId}`);
            return;
          }
          setTarget({ kind: "pick", status: "later", result });
        })
        .catch((error: unknown) => setTarget({ kind: "pick", status: "error", error }));
    },
    [router],
  );

  useEffect(() => {
    const d = dialog.current;
    if (target && d && !d.open) d.showModal();
  }, [target]);

  const close = () => dialog.current?.close();

  return (
    <EntryContext.Provider value={{ open, quickPick, enterLive, quickPickLive }}>
      {children}
      <dialog
        ref={dialog}
        className="sheet"
        aria-labelledby="entry-title"
        onClose={() => setTarget(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        data-testid="entry-sheet"
      >
        {target && state && (
          <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] sm:p-5">
            <div aria-hidden className="mx-auto -mt-1 mb-3 h-1.5 w-12 bg-surface-2 md:hidden" />
            {target.kind === "entry" ? (
              <>
                <SheetHeader
                  eyebrow="Story race"
                  title={target.picker ? "Enter a Story race" : `Race ${state.horses.find((h) => h.id === target.horseId)?.horse.name ?? "your horse"}`}
                  onClose={close}
                />
                <EntryForm key={target.nonce} state={state} initialHorseId={target.horseId} showPicker={target.picker} autoFocusSubmit />
              </>
            ) : target.kind === "live" ? (
              <LiveEntry key={target.nonce} state={state} raceId={target.raceId} onClose={close} />
            ) : target.kind === "livePick" ? (
              <LivePickCard target={target} state={state} onClose={close} onRetry={quickPickLive} />
            ) : target.status === "later" ? (
              <EnteredLater result={target.result} onClose={close} />
            ) : target.status === "error" ? (
              <>
                <SheetHeader eyebrow="Quick Pick" title="Couldn’t enter" onClose={close} />
                <ErrorNote error={target.error} onRetry={quickPick} />
              </>
            ) : (
              <PickCard state={state} busy={target.busy} onChoose={enterPicked} onClose={close} />
            )}
          </div>
        )}
      </dialog>
    </EntryContext.Provider>
  );
}

function SheetHeader({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="entry-title" className="t-display-m">
          {title}
        </h2>
      </div>
      <button type="button" onClick={onClose} className="btn btn-sm shrink-0" aria-label="Close">
        ✕
      </button>
    </div>
  );
}

/** The Story pick card: who Quick Pick chose and why, then how to watch (Story races can skip to the result). */
function PickCard({ state, busy, onChoose, onClose }: { state: PlayerState; busy?: WatchMode; onChoose: (mode: WatchMode) => void; onClose: () => void }) {
  const s = recommendHorse(state);
  const horse = s?.horse;
  const othersRan = state.horses.some((h) => h.id !== s?.id && h.ranToday > 0);
  return (
    <div className="grid gap-4" data-testid="pick-card">
      <SheetHeader eyebrow="Story · Quick Pick" title={horse ? `${horse.name} runs next` : "No horse ready"} onClose={onClose} />
      {horse ? (
        <div className="surface-2 -mt-1 flex items-center gap-3 p-2">
          <span className="bg-inset">
            <HorsePortrait appearance={horse.appearance} scale={1} />
          </span>
          <div className="min-w-0">
            <p className="text-cream" data-testid="pick-reason">
              Best fit at {formatDistance(horse.preferredDistanceM)} on {SURFACE_LABEL[horse.preferredSurface].toLowerCase()}
              {s?.ranToday === 0 ? (othersRan ? ", and fresh (your other horses have raced today)" : ", and fresh") : ""}.
            </p>
            <p className="mt-1 text-sm font-bold text-cream-dim">
              Plan: <span className="chip text-cream">{STYLE_LABEL[horse.style]}</span> (natural) · normal ride
            </p>
          </div>
        </div>
      ) : (
        <p className="text-cream-dim">None of your horses can race right now (injured, entered elsewhere, or already raced 3 times today). Check the stable.</p>
      )}
      <p className="text-sm text-cream-dim">Next Story race against the Club&rsquo;s rival stables. Free: no stable entries used. The field and conditions are drawn when you enter.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <button type="button" className="btn btn-brass btn-lg" disabled={!horse || !!busy} onClick={() => onChoose("watch")} data-testid="watch-live" autoFocus>
          <PixelIcon name="play" className="h-4 w-4" /> {busy === "watch" ? "Entering…" : "Watch"}
        </button>
        <button type="button" className="btn btn-lg" disabled={!horse || !!busy} onClick={() => onChoose("instant")} data-testid="skip-to-result">
          {busy === "instant" ? "Running it…" : "Skip to result"}
        </button>
        <button type="button" className="btn btn-lg" disabled={!horse || !!busy} onClick={() => onChoose("later")} data-testid="watch-later">
          {busy === "later" ? "Entering…" : "Watch later"}
        </button>
      </div>
      <p className="caption">
        Watch: gates open in 10 seconds. Skip to result: see how it went right away. Watch later: it waits in Your races, result unseen.
      </p>
    </div>
  );
}

function EnteredLater({ result, onClose }: { result: QuickPickResult; onClose: () => void }) {
  return (
    <div className="grid gap-3" data-testid="entered-later">
      <SheetHeader eyebrow="Entered · watch later" title={`${result.pick.horseName}’s Story race`} onClose={onClose} />
      <p className="text-cream-dim">
        {result.pick.horseName} runs at {formatClock(result.postTimeMs)}. It&rsquo;s in <strong className="text-cream">Your races</strong> on Home, result unseen
        until you open it.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" className="btn btn-brass btn-lg" onClick={onClose} autoFocus>
          Done
        </button>
        <Link href={`/race/${result.raceId}`} className="btn btn-lg" onClick={onClose}>
          Watch it now
        </Link>
      </div>
    </div>
  );
}

interface EntryOptionView {
  horseId: string;
  reason: string | null;
  fitLoss: number;
  risk: Record<RacePlan["intensity"], RiskView | null>;
}

/** Live entry: pick an eligible horse and a plan for a shared card race; shows cost, close time and risk. */
function LiveEntry({ state, raceId, onClose }: { state: PlayerState; raceId: string; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<{ race: RaceSummary; options: EntryOptionView[] } | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [horseId, setHorseId] = useState<string | null>(null);
  const [plan, setPlan] = useState<RacePlan>({ tactic: "stalker", intensity: "normal" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [entered, setEntered] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/races/${encodeURIComponent(raceId)}/options`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.message ?? `HTTP ${r.status}`);
        return body as { race: RaceSummary; options: EntryOptionView[] };
      })
      .then((d) => {
        setData(d);
        // Preselect the best fit among eligible horses, resting tired ones (as Quick Pick does).
        const tiredPenalty = (id: string) => (state.horses.find((x) => x.id === id)?.condition === "tired" ? 1000 : 0);
        const best = [...d.options].filter((o) => !o.reason).sort((a, b) => a.fitLoss + tiredPenalty(a.horseId) - (b.fitLoss + tiredPenalty(b.horseId)))[0];
        if (best) {
          setHorseId(best.horseId);
          const h = state.horses.find((x) => x.id === best.horseId);
          if (h) setPlan({ tactic: h.horse.style, intensity: "normal" });
        }
      })
      .catch(setLoadError);
  }, [raceId, state.horses]);

  const racing = state.horses.filter((h) => h.careerStatus === "racing");
  const reasons = Object.fromEntries((data?.options ?? []).map((o) => [o.horseId, o.reason]));
  const horse = racing.find((h) => h.id === horseId);
  const option = data?.options.find((o) => o.horseId === horseId);

  async function go() {
    if (!horse) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/races/${encodeURIComponent(raceId)}/enter`, { body: { horseId: horse.id, plan } });
      setEntered(horse.horse.name);
      router.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const race = data?.race;
  if (entered && race) {
    return (
      <div className="grid gap-3" data-testid="live-entered">
        <SheetHeader eyebrow="Entered · Live" title={race.name} onClose={onClose} />
        <p className="text-cream-dim">
          {entered} is in. The field locks at {formatClock(race.entriesCloseAtMs)} and goes off at {formatClock(race.postTimeMs)}, live for everyone. If you&rsquo;re
          away, the result waits in Your races.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link href={`/race/${raceId}`} className="btn btn-brass btn-lg" onClick={onClose} data-testid="go-to-race">
            <PixelIcon name="play" className="h-4 w-4" /> Go to the race
          </Link>
          <button type="button" className="btn btn-lg" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5" data-testid="live-entry">
      <SheetHeader eyebrow="Live race" title={race?.name ?? "Enter a Live race"} onClose={onClose} />
      {race && (
        <p className="-mt-3 text-sm text-cream-dim">
          {raceMetaLine(race)} · off {formatClock(race.postTimeMs)} · entries close in <Countdown targetMs={race.entriesCloseAtMs} doneLabel="now" className="text-cream" /> ·{" "}
          {race.entryCost} {race.entryCost === 1 ? "entry" : "entries"} ({state.entries.balance} left)
        </p>
      )}
      {loadError !== null && <ErrorNote error={loadError} />}
      {data && <HorsePicker horses={racing} selectedId={horseId} onSelect={(id) => {
        setHorseId(id);
        const h = racing.find((x) => x.id === id);
        if (h) setPlan((p) => ({ ...p, tactic: h.horse.style }));
      }} reasons={reasons} />}
      {data && <PlanPicker horse={horse} plan={plan} onChange={setPlan} risk={(i) => option?.risk[i] ?? null} />}
      {error !== null && <ErrorNote error={error} onRetry={go} />}
      <div className="grid [&>.btn]:w-full">
        <button type="button" className="btn btn-brass btn-lg" disabled={!horse || !!reasons[horse?.id ?? ""] || busy || !data} onClick={go} data-testid="enter-live">
          <PixelIcon name="flag" size={32} className="-my-2" />
          {busy ? "Entering…" : `Enter ${horse?.horse.name ?? ""} · ${race?.entryCost ?? 1} ${race?.entryCost === 2 ? "entries" : "entry"}`}
        </button>
      </div>
    </div>
  );
}

function LivePickCard({
  target,
  state,
  onClose,
  onRetry,
}: {
  target: Extract<Target, { kind: "livePick" }>;
  state: PlayerState;
  onClose: () => void;
  onRetry: () => void;
}) {
  if (target.status === "busy") {
    return (
      <div className="grid gap-3" aria-busy>
        <SheetHeader eyebrow="Live · Quick Pick" title="Finding the next suitable race…" onClose={onClose} />
      </div>
    );
  }
  if (target.status === "error") {
    return (
      <div className="grid gap-3">
        <SheetHeader eyebrow="Live · Quick Pick" title="Couldn’t enter" onClose={onClose} />
        <ErrorNote error={target.error} onRetry={onRetry} />
      </div>
    );
  }
  if (target.status !== "done") return null;
  const r = target.result;
  const s = state.horses.find((h) => h.id === r.horseId);
  return (
    <div className="grid gap-3" data-testid="live-pick">
      <SheetHeader eyebrow="Live · entered" title={r.raceName} onClose={onClose} />
      <div className="surface-2 flex items-center gap-3 p-2">
        {s && (
          <span className="bg-inset">
            <HorsePortrait appearance={s.horse.appearance} scale={1} />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-cream" data-testid="live-pick-reason">
            {r.reason}.
          </p>
          <p className="mt-1 text-sm text-cream-dim">
            Off at {formatClock(r.postTimeMs)} (in <Countdown targetMs={r.postTimeMs} doneLabel="now" className="text-cream" />). {state.entries.balance} stable{" "}
            {state.entries.balance === 1 ? "entry" : "entries"} left today.
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Link href={`/race/${r.raceId}`} className="btn btn-brass btn-lg" onClick={onClose} data-testid="go-to-race">
          <PixelIcon name="play" className="h-4 w-4" /> Go to the race
        </Link>
        <button type="button" className="btn btn-lg" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
