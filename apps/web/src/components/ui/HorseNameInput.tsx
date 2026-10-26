"use client";

import { useEffect, useState } from "react";
import { HORSE_NAME_MAX, validateHorseName } from "@thoroughbred/game-core";

export interface NameCheck {
  ok: boolean;
  message?: string;
}

/**
 * Live, friendly feedback for a horse name: the format rules locally (2-18 characters,
 * letters, no profanity: game-core `validateHorseName`), then availability from the registry
 * (`/api/names/check`, debounced; advisory: the save claims the name under a lock).
 */
export function useHorseNameCheck(name: string, opts: { horseId?: string; current?: string; allowBlank?: boolean } = {}): NameCheck | null {
  const [remote, setRemote] = useState<{ name: string; res: NameCheck } | null>(null);
  const trimmed = name.replace(/\s+/g, " ").trim();
  const local = trimmed === "" && opts.allowBlank ? { ok: true as const, name: "" } : validateHorseName(name);
  const unchanged = opts.current !== undefined && trimmed === opts.current;

  useEffect(() => {
    if (!local.ok || unchanged || trimmed === "") return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const q = new URLSearchParams({ name: trimmed, ...(opts.horseId ? { horseId: opts.horseId } : {}) });
      fetch(`/api/names/check?${q}`, { signal: ctrl.signal, cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<NameCheck>) : null))
        .then((res) => res && setRemote({ name: trimmed, res }))
        .catch(() => undefined);
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [trimmed, local.ok, unchanged, opts.horseId]);

  if (!local.ok) return trimmed === "" ? null : { ok: false, message: local.message };
  if (unchanged || trimmed === "") return null;
  if (remote?.name === trimmed) return remote.res.ok ? { ok: true, message: "✓ Available" } : remote.res;
  return null;
}

/** A horse-name field with the live check underneath. */
export function HorseNameInput({
  id,
  value,
  onChange,
  check,
  testId,
  placeholder,
  label = "Name",
  showLabel = false,
  className,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  check: NameCheck | null;
  testId?: string;
  placeholder?: string;
  label?: string;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <div className={`grid gap-1 ${className ?? ""}`}>
      <label className={showLabel ? "font-extrabold" : "sr-only"} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field min-h-11 w-full"
        value={value}
        maxLength={HORSE_NAME_MAX + 6}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={check && !check.ok ? true : undefined}
        aria-describedby={`${id}-hint`}
        data-testid={testId}
      />
      <p id={`${id}-hint`} className={`text-[0.8125rem] font-bold ${check ? (check.ok ? "text-positive" : "text-negative") : "text-sage"}`} role="status">
        {check?.message ?? `2–${HORSE_NAME_MAX} characters, letters and spaces. Names are unique.`}
      </p>
    </div>
  );
}
