"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GrowthView, RangeView } from "@/lib/horseLife";
import { api } from "@/lib/player";
import { GRADE_COLOR } from "../StatBars";

/**
 * Runs a horse-life action on the server, then re-renders the page from the server's state
 * (router.refresh). The response's `player` updates the header credits.
 */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function run<T>(key: string, url: string, init: { method?: string; body?: unknown } = {}): Promise<T | null> {
    setBusy(key);
    setError(null);
    try {
      const out = await api<T>(url, init);
      router.refresh();
      return out;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, run, clearError: () => setError(null) };
}

/** Segmented bar (art-pixel cells), with an accessible meter. */
export function CellBar({ value, max, cells, label, tone = "brass", className }: { value: number; max: number; cells?: number; label: string; tone?: "brass" | "positive" | "negative" | "sky"; className?: string }) {
  const n = cells ?? Math.min(max, 20);
  const lit = max > 0 ? (value / max) * n : 0;
  const color = tone === "positive" ? "#9fe0a8" : tone === "negative" ? "#ff8a7a" : tone === "sky" ? "#7fc3ee" : "#d9a441";
  return (
    <div className={`flex h-3 gap-[2px] bg-[#050b08] p-[2px] ${className ?? ""}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      {Array.from({ length: n }, (_, i) => {
        const on = i < Math.floor(lit);
        const part = !on && i < lit;
        return <span key={i} className="h-full flex-1" style={{ background: on ? color : part ? `${color}66` : "#173025" }} />;
      })}
    </div>
  );
}

/** Growth towards racing age: 19 care sessions in three stages (5 / 7 / 7). */
export function GrowthTrack({ growth, compact = false }: { growth: GrowthView; compact?: boolean }) {
  const parts = [
    { label: "Foal", len: 5 },
    { label: "Weanling", len: 7 },
    { label: "Yearling", len: 7 },
  ];
  let start = 0;
  return (
    <div className="grid gap-1.5" data-testid="growth">
      <div className="flex gap-1" role="meter" aria-label={`Growth: ${growth.sessions} of ${growth.racingAt} care sessions`} aria-valuemin={0} aria-valuemax={growth.racingAt} aria-valuenow={growth.sessions}>
        {parts.map((p) => {
          const from = start;
          start += p.len;
          return (
            <div key={p.label} className="grid flex-1 gap-1" style={{ flexGrow: p.len }}>
              <div className="flex h-3 gap-[2px] bg-[#050b08] p-[2px]">
                {Array.from({ length: p.len }, (_, i) => (
                  <span key={i} className="h-full flex-1" style={{ background: from + i < growth.sessions ? "#9fe0a8" : "#173025" }} />
                ))}
              </div>
              {!compact && <span className={`text-xs font-bold ${growth.stageLabel === p.label ? "text-cream" : "text-sage"}`}>{p.label}</span>}
            </div>
          );
        })}
      </div>
      <p className="text-sm text-cream-dim">
        <span className="font-extrabold text-cream">{growth.stageLabel}</span> · {growth.sessions}/{growth.racingAt} care sessions ·{" "}
        {growth.toNext} to {growth.nextLabel.toLowerCase()}
        {growth.nextLabel !== "Racing age" && `, ${growth.toRacing} to racing age`}
      </p>
    </div>
  );
}

/** Revealed potential ranges: a lo-hi band per stat on a 0-1000 scale, graded. */
export function RangeList({ ranges }: { ranges: RangeView[] }) {
  return (
    <dl className="grid gap-2" data-testid="ranges">
      {ranges.map((r) => (
        <div key={r.key} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-2">
          <dt className="text-sm font-bold text-cream-dim">{r.label}</dt>
          <dd className="relative h-3 bg-[#050b08]" aria-label={`${r.label} potential ${r.exact ? r.lo : `${r.lo} to ${r.hi}`} of 1000`}>
            <span className="absolute inset-y-[2px] block" style={{ left: `${r.lo / 10}%`, width: `${Math.max(1, (r.hi - r.lo) / 10)}%`, background: GRADE_COLOR[r.hiGrade] ?? "#cdbf9c" }} />
          </dd>
          <dd className="text-right text-sm font-extrabold">
            <span style={{ color: GRADE_COLOR[r.loGrade] }}>{r.loGrade}</span>
            {r.loGrade !== r.hiGrade && (
              <>
                <span className="text-sage"> to </span>
                <span style={{ color: GRADE_COLOR[r.hiGrade] }}>{r.hiGrade}</span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A two-tap confirm for permanent decisions (no browser dialogs). */
export function ConfirmButton({
  label,
  confirmLabel,
  warning,
  onConfirm,
  busy,
  disabled,
  danger = false,
  testId,
}: {
  label: string;
  confirmLabel: string;
  warning: string;
  onConfirm: () => void;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" className="btn btn-sm w-fit" onClick={() => setArmed(true)} disabled={disabled || busy} data-testid={testId}>
        {label}
      </button>
    );
  }
  return (
    <div className="surface-2 grid gap-2 p-3" role="group" aria-label={label}>
      <p className="text-sm text-cream">{warning}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`btn btn-sm ${danger ? "btn-oxblood" : ""}`} onClick={onConfirm} disabled={busy} data-testid={testId ? `${testId}-confirm` : undefined}>
          {busy ? "Working…" : confirmLabel}
        </button>
        <button type="button" className="btn-ghost min-h-11 text-sm font-bold" onClick={() => setArmed(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <nav aria-label="Breadcrumb">
      <Link href={href} className="inline-flex min-h-11 items-center gap-1 font-bold text-cream-dim hover:text-cream">
        ‹ {label}
      </Link>
    </nav>
  );
}
