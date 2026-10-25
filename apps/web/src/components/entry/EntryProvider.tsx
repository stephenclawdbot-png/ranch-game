"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { RaceConfig } from "@thoroughbred/shared";
import { recommendIndex } from "@/lib/aptitude";
import { STYLE_LABEL, SURFACE_LABEL, formatClock, formatDistance } from "@/lib/format";
import { recentlyRun, usePlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";
import { HorsePortrait } from "../HorsePortrait";
import { raceMetaLine } from "../RaceMeta";
import { PixelIcon } from "../icons";
import { EntryForm, quickPickRace, type QuickPickResult } from "./EntryForm";

interface EntryApi {
  /** Opens the entry sheet for horse `index` (no player yet -> onboarding). */
  open: (index: number, opts?: { picker?: boolean }) => void;
  /** Quick Pick: shows the pick card (best-suited fresh horse); the race is entered on the watch choice. */
  quickPick: () => void;
}

const EntryContext = createContext<EntryApi>({ open: () => undefined, quickPick: () => undefined });

export function useEntry(): EntryApi {
  return useContext(EntryContext);
}

type WatchMode = "watch" | "instant" | "later";
type RaceInfo = Pick<RaceConfig, "name" | "distanceM" | "surface" | "going" | "raceClass">;
type Target =
  | { kind: "entry"; index: number; picker: boolean; nonce: number }
  | { kind: "pick"; status: "choose" | "error"; busy?: WatchMode; error?: string }
  | { kind: "pick"; status: "later"; result: QuickPickResult; race: RaceInfo | null };

/**
 * The entry sheet (modal over any route). Two modes:
 * - entry: one horse, a plan preselected to its natural style, and "Go to the gates";
 * - pick: the Quick Pick card (who and why), then "Watch" / "Skip to result" / "Watch later".
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

  // Quick Pick opens the pick card first (who and why, computed with the same rule as the
  // server); the race is created when the player chooses how to watch it.
  const quickPick = useCallback(() => {
    if (!state) return router.push("/play");
    setTarget({ kind: "pick", status: "choose" });
  }, [state, router]);

  const enterPicked = useCallback(
    (mode: WatchMode) => {
      if (!state) return;
      setTarget({ kind: "pick", status: "choose", busy: mode });
      quickPickRace(state, horses, { instant: mode === "instant" })
        .then(async (result) => {
          if (mode !== "later") {
            dialog.current?.close();
            router.push(`/race/${result.raceId}`);
            return;
          }
          // Show which race it went into (today a Story race; the same card works for a shared race).
          let race: RaceInfo | null = null;
          try {
            const r = await fetch(`/api/races/${encodeURIComponent(result.raceId)}`);
            if (r.ok) race = ((await r.json()) as { race: { config: RaceConfig } }).race.config;
          } catch {
            /* the card still works without the race details */
          }
          setTarget({ kind: "pick", status: "later", result, race });
        })
        .catch((e: Error) => setTarget({ kind: "pick", status: "error", error: e.message }));
    },
    [state, horses, router],
  );

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
            ) : target.status === "later" ? (
              <EnteredLater result={target.result} race={target.race} horses={horses} onClose={close} />
            ) : target.status === "error" ? (
              <>
                <SheetHeader eyebrow="Quick Pick" title="Couldn’t enter" onClose={close} />
                <div className="grid gap-3">
                  <p className="text-cream-dim">Couldn&rsquo;t reach the track ({target.error}). Your stable is safe on this device.</p>
                  <button type="button" className="btn btn-brass btn-lg" onClick={quickPick}>
                    Try again
                  </button>
                </div>
              </>
            ) : (
              <PickCard state={state} horses={horses} busy={target.busy} onChoose={enterPicked} onClose={close} />
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

/** The pick card: who Quick Pick chose and why, then how to watch (Story races can skip to the result). */
function PickCard({
  state,
  horses,
  busy,
  onChoose,
  onClose,
}: {
  state: NonNullable<ReturnType<typeof usePlayerState>>;
  horses: ReturnType<typeof usePlayerHorses>["horses"];
  busy?: WatchMode;
  onChoose: (mode: WatchMode) => void;
  onClose: () => void;
}) {
  const exclude = recentlyRun(state, Date.now());
  const index = horses ? recommendIndex(horses, exclude) : -1;
  const horse = horses?.[index];
  return (
    <div className="grid gap-4" data-testid="pick-card">
      <SheetHeader eyebrow="Story · Quick Pick" title={horse ? `${horse.name} runs next` : "Picking your horse…"} onClose={onClose} />
      {horse && (
        <div className="surface-2 -mt-1 flex items-center gap-3 p-2">
          <span className="bg-inset">
            <HorsePortrait appearance={horse.appearance} scale={1} />
          </span>
          <div className="min-w-0">
            <p className="text-cream" data-testid="pick-reason">
              Best fit at {formatDistance(horse.preferredDistanceM)} on {SURFACE_LABEL[horse.preferredSurface].toLowerCase()}
              {exclude.length > 0 ? ", and fresh (your other horses ran in the last hour)" : ""}.
            </p>
            <p className="mt-1 text-sm font-bold text-cream-dim">
              Plan: <span className="chip text-cream">{STYLE_LABEL[horse.style]}</span> (natural)
            </p>
          </div>
        </div>
      )}
      <p className="text-sm text-cream-dim">Next Story race against the club&rsquo;s rival stables. The field and conditions are drawn when you enter.</p>
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
      <p className="caption">Watch: gates open in 10 seconds. Skip to result: see how it went right away. Watch later: it waits in Your races, result unseen.</p>
    </div>
  );
}

function EnteredLater({ result, race, horses, onClose }: { result: QuickPickResult; race: RaceInfo | null; horses: ReturnType<typeof usePlayerHorses>["horses"]; onClose: () => void }) {
  const horse = horses?.[result.pick.horseIndex];
  return (
    <div className="grid gap-3" data-testid="entered-later">
      <SheetHeader eyebrow="Entered · watch later" title={race?.name ?? "Story race"} onClose={onClose} />
      <p className="text-cream-dim">
        {horse?.name ?? "Your horse"} runs at {formatClock(result.postTimeMs)}
        {race ? ` (${raceMetaLine(race)})` : ""}. It&rsquo;s in <strong className="text-cream">Your races</strong> on Home, result unseen until you open it.
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
