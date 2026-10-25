"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePlayerState } from "@/lib/player";
import { usePlayerHorses } from "@/lib/useStable";
import { EntryForm } from "./EntryForm";

interface EntryApi {
  /** Opens the entry sheet for horse `index` (no player yet -> onboarding). */
  open: (index: number, opts?: { picker?: boolean }) => void;
}

const EntryContext = createContext<EntryApi>({ open: () => undefined });

export function useEntry(): EntryApi {
  return useContext(EntryContext);
}

/**
 * The entry sheet (modal over any route): one horse, a plan preselected to its natural
 * style, and "Go to the gates". Native <dialog>: focus is trapped, Esc closes and focus
 * returns to the button that opened it.
 */
export function EntryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const state = usePlayerState();
  const { horses } = usePlayerHorses(state?.player.playerId, state?.player.silks);
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<{ index: number; picker: boolean; nonce: number } | null>(null);

  const open = useCallback<EntryApi["open"]>(
    (index, opts) => {
      if (!state) {
        router.push("/play");
        return;
      }
      setTarget({ index, picker: opts?.picker ?? false, nonce: Date.now() });
    },
    [state, router],
  );

  useEffect(() => {
    const d = dialog.current;
    if (target && d && !d.open) d.showModal();
  }, [target]);

  const close = () => dialog.current?.close();
  const horse = target ? horses?.[target.index] : undefined;

  return (
    <EntryContext.Provider value={{ open }}>
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
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">Quick race</p>
                <h2 id="entry-title" className="t-display-m truncate">
                  {target.picker || !horse ? "Enter a race" : `Race ${horse.name}`}
                </h2>
              </div>
              <button type="button" onClick={close} className="btn btn-sm shrink-0" aria-label="Close">
                ✕
              </button>
            </div>
            <EntryForm key={target.nonce} state={state} horses={horses} initialIndex={target.index} showPicker={target.picker} autoFocusSubmit />
          </div>
        )}
      </dialog>
    </EntryContext.Provider>
  );
}
