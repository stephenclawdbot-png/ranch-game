"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { RaceConfig } from "@thoroughbred/shared";
import { STYLE_LABEL, formatClock } from "@/lib/format";
import { usePlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";
import { Countdown } from "../Countdown";
import { HorsePortrait } from "../HorsePortrait";
import { raceMetaLine } from "../RaceMeta";
import { PixelIcon } from "../icons";
import { EntryForm, quickPickRace, type QuickPickResult } from "./EntryForm";

interface EntryApi {
  /** Opens the entry sheet for horse `index` (no player yet -> onboarding). */
  open: (index: number, opts?: { picker?: boolean }) => void;
  /** Quick Pick: enters the best-suited fresh horse into the next race, then shows the pick card. */
  quickPick: () => void;
}

const EntryContext = createContext<EntryApi>({ open: () => undefined, quickPick: () => undefined });

export function useEntry(): EntryApi {
  return useContext(EntryContext);
}

type Target =
  | { kind: "entry"; index: number; picker: boolean; nonce: number }
  | { kind: "pick"; status: "entering" | "error"; error?: string }
  | { kind: "pick"; status: "entered"; result: QuickPickResult; race: Pick<RaceConfig, "name" | "distanceM" | "surface" | "going" | "raceClass"> | null };

/**
 * The entry sheet (modal over any route). Two modes:
 * - entry: one horse, a plan preselected to its natural style, and "Go to the gates";
 * - pick: the Quick Pick card (who was picked and why, which race), "Watch live" / "Watch later".
 * Native <dialog>: focus is trapped, Esc closes and focus returns to the opener.
 */
export function EntryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const state = usePlayerState();
  const { horses } = usePlayerHorses(state?.player.playerId, state?.player.silks);
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<Target | null>(null);

  const open = useCallback<EntryApi["open"]>(
    (index, opts) => {
      if (!state) return router.push("/play");
      setTarget({ kind: "entry", index, picker: opts?.picker ?? false, nonce: Date.now() });
    },
    [state, router],
  );

  const quickPick = useCallback(() => {
    if (!state) return router.push("/play");
    setTarget({ kind: "pick", status: "entering" });
    quickPickRace(state, horses)
      .then(async (result) => {
        // The card shows which race it is (today a solo quick race; later the next shared race on the card).
        let race = null;
        try {
          const r = await fetch(`/api/races/${encodeURIComponent(result.raceId)}`);
          if (r.ok) race = ((await r.json()) as { race: { config: RaceConfig } }).race.config;
        } catch {
          /* the card still works without the race details */
        }
        setTarget({ kind: "pick", status: "entered", result, race });
      })
      .catch((e: Error) => setTarget({ kind: "pick", status: "error", error: e.message }));
  }, [state, horses, router]);

  useEffect(() => {
    const d = dialog.current;
    if (target && d && !d.open) d.showModal();
  }, [target]);

  const close = () => dialog.current?.close();

  return (
    <EntryContext.Provider value={{ open, quickPick }}>
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
                  eyebrow="Quick race"
                  title={target.picker || !horses?.[target.index] ? "Enter a race" : `Race ${horses[target.index]!.name}`}
                  onClose={close}
                />
                <EntryForm key={target.nonce} state={state} horses={horses} initialIndex={target.index} showPicker={target.picker} autoFocusSubmit />
              </>
            ) : target.status === "entered" ? (
              <PickCard result={target.result} race={target.race} horses={horses} onLater={close} />
            ) : (
              <>
                <SheetHeader eyebrow="Quick Pick" title={target.status === "error" ? "Couldn’t enter" : "Picking your horse…"} onClose={close} />
                {target.status === "error" ? (
                  <div className="grid gap-3">
                    <p className="text-cream-dim">Couldn&rsquo;t reach the track ({target.error}). Your stable is safe on this device.</p>
                    <button type="button" className="btn btn-brass btn-lg" onClick={quickPick}>
                      Try again
                    </button>
                  </div>
                ) : (
                  <p className="text-cream-dim" aria-busy>
                    Finding your best-suited fresh horse and the next race…
                  </p>
                )}
              </>
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

function PickCard({
  result,
  race,
  horses,
  onLater,
}: {
  result: QuickPickResult;
  race: Pick<RaceConfig, "name" | "distanceM" | "surface" | "going" | "raceClass"> | null;
  horses: ReturnType<typeof usePlayerHorses>["horses"];
  onLater: () => void;
}) {
  const horse = horses?.[result.pick.horseIndex];
  const reason = result.pick.reason.includes(": ") ? result.pick.reason.slice(result.pick.reason.indexOf(": ") + 2) : result.pick.reason;
  return (
    <div className="grid gap-4" data-testid="pick-card">
      <SheetHeader eyebrow="Quick Pick · entered" title={race?.name ?? "Next race"} onClose={onLater} />
      <p className="t-meta -mt-3">
        {race ? `${raceMetaLine(race)} · ` : ""}off at {formatClock(result.postTimeMs)} (in <Countdown targetMs={result.postTimeMs} doneLabel="now" className="text-cream" />)
      </p>
      <div className="surface-2 flex items-center gap-3 p-2">
        {horse && (
          <span className="bg-inset">
            <HorsePortrait appearance={horse.appearance} scale={1} />
          </span>
        )}
        <div className="min-w-0">
          <p className="t-title">{horse?.name ?? "Your horse"}</p>
          <p className="text-cream-dim" data-testid="pick-reason">
            Picked because: {reason}.
          </p>
          <p className="mt-1 text-sm font-bold">
            Plan: <span className="chip text-cream">{STYLE_LABEL[result.pick.tactic]}</span>
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Link href={`/race/${result.raceId}`} className="btn btn-brass btn-lg" data-testid="watch-live" onClick={onLater} autoFocus>
          <PixelIcon name="play" className="h-4 w-4" /> Watch live
        </Link>
        <button type="button" className="btn btn-lg" onClick={onLater} data-testid="watch-later">
          Watch later
        </button>
      </div>
      <p className="caption">The race runs whether you watch or not. Watch later puts it in Your races on Home, result unseen.</p>
    </div>
  );
}
