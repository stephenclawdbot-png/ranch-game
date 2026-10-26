"use client";
/**
 * The foal reveal: a stall door opens on the new foal (pack pull or foaling). One-shot,
 * pixel-stepped, skippable; with reduced motion it shows the end state at once. A modal
 * dialog: focus moves in, Esc closes, focus returns to the trigger.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HorsePortrait } from "@/components/HorsePortrait";
import type { EcoHorse, Rarity } from "@/lib/economyTypes";
import { SEX_LABEL } from "@/lib/format";
import { RARITY_COLOR, RarityBadge, calmMotion } from "./kit";
import css from "./reveal.module.css";

const SEQUENCE_MS = 1300;

export function FoalReveal({
  foal,
  rarity,
  eyebrow,
  note,
  children,
  onClose,
}: {
  foal: EcoHorse;
  rarity?: Rarity;
  eyebrow: string;
  note?: ReactNode;
  /** Next actions (shown once the reveal has finished). */
  children?: ReactNode;
  onClose: () => void;
}) {
  const [done, setDone] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    if (calmMotion()) setDone(true);
    const t = setTimeout(() => setDone(true), SEQUENCE_MS);
    return () => {
      clearTimeout(t);
      prev?.focus?.();
    };
  }, []);
  useEffect(() => {
    if (done) headingRef.current?.focus();
  }, [done]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const beam = rarity ? RARITY_COLOR[rarity] : "#f2c86a";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(4,10,6,0.82)] p-0 md:items-center md:p-6" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reveal-title"
        tabIndex={-1}
        className="surface grid max-h-[94dvh] w-full max-w-[28rem] gap-4 overflow-auto p-4 outline-none"
        data-testid="foal-reveal"
      >
        <p className="eyebrow text-center">{eyebrow}</p>
        <div className={`${css.stage} ${done ? css.done : ""}`} style={{ ["--beam" as string]: `${beam}55` }} aria-hidden>
          <div className={css.beam} />
          <div className={css.foal}>
            <HorsePortrait appearance={foal.horse.appearance} scale={2} />
          </div>
          <div className={`${css.door} ${css.left}`} />
          <div className={`${css.door} ${css.right}`} />
        </div>
        <div className={`${css.banner} ${done ? css.done : ""} grid justify-items-center gap-2 text-center`}>
          <h2 id="reveal-title" ref={headingRef} tabIndex={-1} className="t-display-l outline-none" data-testid="reveal-name">
            {foal.horse.name}
          </h2>
          <p className="t-meta">
            {SEX_LABEL[foal.horse.sex]} foal · goes to the nursery
          </p>
          {rarity && <RarityBadge rarity={rarity} />}
          {note}
        </div>
        <div aria-live="polite" className="sr-only">
          {done ? `${foal.horse.name}, ${SEX_LABEL[foal.horse.sex]} foal${rarity ? `, ${rarity}` : ""}.` : ""}
        </div>
        {done ? (
          <div className="grid gap-2">{children}</div>
        ) : (
          <button type="button" className="btn btn-ghost mx-auto" onClick={() => setDone(true)}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
}
