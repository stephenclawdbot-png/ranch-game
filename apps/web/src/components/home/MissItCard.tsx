"use client";
/**
 * The exit question (testers, from day 7, once): "If Post Time disappeared tomorrow, would you
 * miss it?" Very / Somewhat / Not really, plus an optional why. Sent as feedback "miss_it".
 */
import { useEffect, useState } from "react";

const CHOICES = [
  { rating: 3, label: "Very much" },
  { rating: 2, label: "Somewhat" },
  { rating: 1, label: "Not really" },
] as const;

export function MissItCard() {
  const [due, setDue] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [why, setWhy] = useState("");
  const [state, setState] = useState<"ask" | "sending" | "done" | "error">("ask");
  useEffect(() => {
    let live = true;
    fetch("/api/feedback/miss-it", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ due: boolean }>) : { due: false }))
      .then((d) => live && setDue(d.due))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!due) return null;
  if (state === "done")
    return (
      <p className="surface p-3 text-sm font-bold text-positive" role="status" data-testid="miss-it-thanks">
        Thank you. That helps more than you know.
      </p>
    );
  async function send() {
    if (rating === null) return;
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: "miss_it", rating, message: why.trim() || "(no reason given)", route: "/" }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }
  return (
    <section className="surface grid gap-3 p-4" aria-labelledby="miss-it-h" data-testid="miss-it-card">
      <h2 id="miss-it-h" className="t-h2">
        One quick question
      </h2>
      <p className="t-meta">If Post Time disappeared tomorrow, would you miss it?</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Would you miss it?">
        {CHOICES.map((c) => (
          <button key={c.rating} type="button" role="radio" aria-checked={rating === c.rating} className={`btn btn-sm ${rating === c.rating ? "btn-brass" : ""}`} onClick={() => setRating(c.rating)}>
            {c.label}
          </button>
        ))}
      </div>
      {rating !== null && (
        <>
          <label className="grid gap-1">
            <span className="t-meta">Why? (optional)</span>
            <textarea className="field min-h-20" maxLength={1000} value={why} onChange={(e) => setWhy(e.target.value)} />
          </label>
          <button type="button" className="btn btn-brass w-fit" disabled={state === "sending"} onClick={() => void send()} data-testid="miss-it-send">
            {state === "sending" ? "Sending…" : "Send"}
          </button>
          {state === "error" && <p className="text-sm font-bold text-negative">That didn&rsquo;t send. Try again in a moment.</p>}
        </>
      )}
    </section>
  );
}
