"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { recentClientErrors } from "@/lib/clientErrors";
import { PixelIcon } from "../icons";

const CATEGORIES = [
  { key: "bug", label: "Bug", hint: "Something broke" },
  { key: "idea", label: "Idea", hint: "Something to add" },
  { key: "confusing", label: "Confusing", hint: "Hard to understand" },
  { key: "fun", label: "Fun", hint: "Something you enjoyed" },
] as const;
type Category = (typeof CATEGORIES)[number]["key"];

/**
 * Feedback on every page: a small button in the top bar opens a dialog (category, optional
 * 1-5 rating, message). The route, screen size, browser and recent client errors are attached.
 */
export function FeedbackButton({ variant = "button" }: { variant?: "button" | "fab" }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      {variant === "fab" ? (
        <button ref={button} type="button" className="fab" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Send feedback" data-testid="feedback-open">
          ?
        </button>
      ) : (
        <button ref={button} type="button" className="btn btn-outline w-fit" onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="feedback-open">
          <PixelIcon name="pencil" className="h-4 w-4" /> Send feedback
        </button>
      )}
      {open &&
        // Portal: the top bar is its own stacking context; the dialog must sit above the tab bar too.
        createPortal(
          <FeedbackDialog
            onClose={() => {
              setOpen(false);
              button.current?.focus();
            }}
          />,
          document.body,
        )}
    </>
  );
}

function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const [category, setCategory] = useState<Category | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && dialog.current) {
        // Keep focus inside the dialog.
        const items = [...dialog.current.querySelectorAll<HTMLElement>("button, textarea, input, [href]")].filter((x) => !x.hasAttribute("disabled"));
        if (!items.length) return;
        const [a, b] = [items[0]!, items[items.length - 1]!];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send() {
    if (!category || !message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          rating,
          message: message.trim(),
          route: pathname ?? window.location.pathname,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          errors: recentClientErrors(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(data.message ?? `Couldn't send (HTTP ${res.status}).`);
      setSent(true);
    } catch (e) {
      setError((e as Error).message || "Couldn't send. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fb-h"
        className="surface max-h-[90vh] w-full max-w-lg overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4"
        data-testid="feedback-dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="fb-h" className="t-h2">
            {sent ? "Thank you!" : "Send feedback"}
          </h2>
          <button type="button" className="flex h-11 w-11 items-center justify-center text-xl text-cream-dim hover:text-cream" onClick={onClose} aria-label="Close" ref={sent ? first : undefined}>
            ✕
          </button>
        </div>
        {sent ? (
          <div className="grid gap-3" data-testid="feedback-sent">
            <p className="text-cream-dim">We read every note. It goes straight to the team with the page you were on.</p>
            <button type="button" className="btn btn-brass w-fit" onClick={onClose}>
              Back to the game
            </button>
          </div>
        ) : (
          <form
            className="mt-2 grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <fieldset className="grid gap-2">
              <legend className="mb-1 font-extrabold">What is it about?</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CATEGORIES.map((c, i) => (
                  <button
                    key={c.key}
                    ref={i === 0 ? first : undefined}
                    type="button"
                    role="radio"
                    aria-checked={category === c.key}
                    className={`${category === c.key ? "surface-2 ring-2 ring-brass" : "inset"} grid min-h-11 p-2 text-left`}
                    onClick={() => setCategory(c.key)}
                    data-testid={`feedback-cat-${c.key}`}
                  >
                    <span className="font-extrabold text-cream">{c.label}</span>
                    <span className="text-xs text-cream-dim">{c.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="grid gap-1">
              <span className="font-extrabold">Tell us more</span>
              <textarea
                className="field min-h-28 p-2"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={4000}
                placeholder={category === "bug" ? "What happened, and what did you expect?" : "Your thoughts…"}
                data-testid="feedback-message"
              />
            </label>
            <fieldset>
              <legend className="mb-1 font-extrabold">
                How is the game so far? <span className="font-normal text-cream-dim">(optional)</span>
              </legend>
              <div className="flex gap-1" role="radiogroup" aria-label="Rating, 1 to 5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={rating === n}
                    aria-label={`${n} of 5`}
                    className={`num h-11 w-11 text-lg ${rating !== null && n <= rating ? "bg-brass text-ink" : "inset text-cream"}`}
                    onClick={() => setRating(rating === n ? null : n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </fieldset>
            <p className="caption">We attach the page, your screen size, browser and any recent errors. Nothing else.</p>
            {error && (
              <p role="alert" className="font-bold text-negative">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-brass w-fit" disabled={!category || !message.trim() || busy} data-testid="feedback-send">
              {busy ? "Sending…" : "Send feedback"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
