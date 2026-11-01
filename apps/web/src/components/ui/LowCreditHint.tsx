"use client";
/**
 * One calm line before a spend that would leave little (game-core LOW_CREDITS_LINE: about a Live
 * entry and a session of training). Never blocks; "Got it" hides it for the rest of the day.
 */
import { useEffect, useState } from "react";
import { lowCreditsAfter } from "@thoroughbred/game-core";
import { formatCredits } from "@/lib/format";

const KEY = "tb-low-credits-dismissed";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export function LowCreditHint({ balance, cost, className = "" }: { balance: number; cost: number; className?: string }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(KEY) === today());
    } catch {
      setHidden(false);
    }
  }, []);
  const left = lowCreditsAfter(balance, cost);
  if (left === null || hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(KEY, today());
    } catch {
      /* this browser keeps no notes: it just hides for now */
    }
  };
  return (
    <p className={`flex items-start gap-2 text-sm text-cream-dim ${className}`} role="note" data-testid="low-credits">
      <span className="min-w-0 flex-1">
        This leaves you <b className="text-cream">{formatCredits(left)} credits</b>. Story races are free, and the Daily Cup and daily goals pay.
      </span>
      <button type="button" className="link shrink-0 text-sm" onClick={dismiss} data-testid="low-credits-dismiss">
        Got it
      </button>
    </p>
  );
}
