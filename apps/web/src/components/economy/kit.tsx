"use client";
/**
 * Small shared pieces for the economy screens (breeding barn, packs, market): data loading,
 * idempotency keys, rarity badges, a compact horse row and a credits figure.
 */
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { HorsePortrait } from "@/components/HorsePortrait";
import { PixelIcon } from "@/components/icons";
import { SEX_LABEL, formatCredits } from "@/lib/format";
import type { EcoHorse, Rarity } from "@/lib/economyTypes";
import { ApiFailure, refreshPlayer } from "@/lib/player";

/** GETs a JSON view; `reload` refetches. Errors carry the server's friendly message. */
export function useEcoView<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string; details?: Record<string, unknown> };
      if (!res.ok) throw new ApiFailure(res.status, body.error ?? `http_${res.status}`, body.message ?? `Something went wrong (HTTP ${res.status}).`, body.details);
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiFailure ? e : new ApiFailure(0, "network", "Couldn't reach the track. Check your connection and try again."));
    }
  }, [url]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, reload };
}

/** A fresh idempotency key for one confirmed action (retries of the same action reuse it). */
export function newKey(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

/** After a credit-moving action: refresh the purse in the header. */
export function refreshPurse(): void {
  refreshPlayer().catch(() => undefined);
}

export const RARITY_LABEL: Record<Rarity, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary" };
/** Rarity colours (always shown with the word; >= 4.5:1 on surface-1). */
export const RARITY_COLOR: Record<Rarity, string> = { common: "#a9bda9", uncommon: "#9fe0a8", rare: "#7fc3ee", epic: "#d3a6ff", legendary: "#f2c86a" };
const RARITY_PIPS: Record<Rarity, number> = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };

export function RarityBadge({ rarity, className }: { rarity: Rarity; className?: string }) {
  const c = RARITY_COLOR[rarity];
  return (
    <span className={`inline-flex items-center gap-1.5 bg-[#050b08] px-2 py-0.5 text-sm font-extrabold ${className ?? ""}`} style={{ color: c }} data-rarity={rarity}>
      <span aria-hidden className="flex gap-[2px]">
        {Array.from({ length: RARITY_PIPS[rarity] }, (_, i) => (
          <span key={i} className="h-2 w-2" style={{ background: c }} />
        ))}
      </span>
      {RARITY_LABEL[rarity]}
    </span>
  );
}

/** Credits with the coin icon. */
export function Credits({ value, className }: { value: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      <PixelIcon name="coin" size={16} />
      <span className="num">{formatCredits(value)}</span>
    </span>
  );
}

const STAGE_LABEL: Record<string, string> = {
  foal: "Foal",
  weanling: "Weanling",
  yearling: "Yearling",
  juvenile: "Juvenile",
  prime: "Prime",
  veteran: "Veteran",
  stud: "Retired · breeding",
  pasture: "Legacy Farm",
  retired: "Retired",
};
export function stageLabel(s: string): string {
  return STAGE_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

/** One horse in a compact row: portrait, name (links to the horse page), meta line. */
export function HorseLine({ h, meta, aside, link = true }: { h: EcoHorse; meta?: ReactNode; aside?: ReactNode; link?: boolean }) {
  const name = <span className="t-title block">{h.horse.name}</span>;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="well grid shrink-0 place-items-center">
        <HorsePortrait appearance={h.horse.appearance} scale="thumb" />
      </span>
      <span className="min-w-0 flex-1">
        {link ? (
          <Link href={`/horse/${h.id}`} className="block hover:underline">
            {name}
          </Link>
        ) : (
          name
        )}
        <span className="t-meta block">
          {meta ?? (
            <>
              {SEX_LABEL[h.horse.sex]} · {stageLabel(h.stage)} · {h.starts} {h.starts === 1 ? "start" : "starts"}
            </>
          )}
        </span>
      </span>
      {aside}
    </div>
  );
}

/** A short status line under a heading: ✓ / ✗ plus words (never colour alone). */
export function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className={`mt-0.5 font-extrabold ${ok ? "text-positive" : "text-negative"}`}>
        {ok ? "✓" : "✗"}
      </span>
      <span className={ok ? "text-cream" : "text-cream-dim"}>
        <span className="sr-only">{ok ? "Done: " : "Missing: "}</span>
        {children}
      </span>
    </li>
  );
}

/** Reduced motion: the OS setting (unless overridden in-app) or the in-app "calm" setting. */
export function calmMotion(): boolean {
  if (typeof window === "undefined") return true;
  const m = document.documentElement.dataset.motion;
  if (m === "reduce") return true;
  if (m === "full") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Loading placeholder shaped like content (static, no shimmer). */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-3" aria-busy aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="surface flex items-center gap-3 p-4" aria-hidden>
          <span className="skel h-16 w-16 shrink-0" />
          <span className="grid min-w-0 flex-1 gap-2">
            <span className="skel h-4 w-1/2" />
            <span className="skel h-3 w-2/3" />
          </span>
        </div>
      ))}
    </div>
  );
}
