"use client";
/**
 * The foal reveal: a stall door opens on the new foal (pack pull or foaling). One-shot,
 * pixel-stepped, skippable; with reduced motion it shows the end state at once. A modal
 * dialog: focus moves in, Esc closes, focus returns to the trigger. A bred foal's dam and sire
 * stand beside the stall, and "family likeness" lines say which of its looks came from whom
 * (game-core familyLikeness: the three looks only, no genes or odds).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { familyLikeness, likenessText } from "@thoroughbred/game-core";
import { HorsePortrait } from "@/components/HorsePortrait";
import type { EcoHorse, FoalParents, Rarity } from "@/lib/economyTypes";
import { SEX_LABEL } from "@/lib/format";
import { RARITY_COLOR, RarityBadge, calmMotion } from "./kit";
import css from "./reveal.module.css";

const SEQUENCE_MS = 1300;

export function FoalReveal({
  foal,
  rarity,
  eyebrow,
  note,
  parents,
  startDone = false,
  children,
  onClose,
}: {
  foal: EcoHorse;
  rarity?: Rarity;
  eyebrow: string;
  note?: ReactNode;
  /** A bred foal's dam and sire (pack foals have none). */
  parents?: FoalParents | null;
  /** Open on the end state (no door sequence), as reduced motion does. */
  startDone?: boolean;
  /** Next actions (shown once the reveal has finished). */
  children?: ReactNode;
  onClose: () => void;
}) {
  const [done, setDone] = useState(startDone);
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
  const dam = parents?.dam ?? null;
  const sire = parents?.sire ?? null;
  const likeness = useMemo(() => (dam || sire ? familyLikeness(foal.horse.appearance, dam?.appearance ?? null, sire?.appearance ?? null) : []), [foal, dam, sire]);
  const pronoun = foal.horse.sex === "filly" || foal.horse.sex === "mare" ? "her" : "his";
  const from = new Set(likeness.map((l) => l.from));
  const parent = (side: "dam" | "sire", p: NonNullable<FoalParents["dam"]>) => (
    <figure className={`${css.parent} ${done ? css.done : ""} ${from.has(side) || from.has("both") ? css.cited : ""}`} data-testid={`reveal-${side}`}>
      <HorsePortrait appearance={p.appearance} scale="thumb" />
      <figcaption>
        <span className="eyebrow">{side === "dam" ? "Dam" : "Sire"}</span>
        <span className="t-meta block">{p.name}</span>
      </figcaption>
    </figure>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(4,10,6,0.82)] p-0 md:items-center md:p-6" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reveal-title"
        tabIndex={-1}
        className={`surface grid max-h-[94dvh] w-full ${dam || sire ? "max-w-[36rem]" : "max-w-[28rem]"} gap-4 overflow-auto p-4 outline-none`}
        data-testid="foal-reveal"
      >
        <p className="eyebrow text-center">{eyebrow}</p>
        <div className={dam || sire ? css.family : undefined}>
          {dam && parent("dam", dam)}
          <div className={`${css.stage} ${done ? css.done : ""}`} style={{ ["--beam" as string]: `${beam}55` }} aria-hidden>
            <div className={css.beam} />
            <div className={css.foal}>
              <HorsePortrait appearance={foal.horse.appearance} scale={2} />
            </div>
            <div className={`${css.door} ${css.left}`} />
            <div className={`${css.door} ${css.right}`} />
          </div>
          {sire && parent("sire", sire)}
        </div>
        <div className={`${css.banner} ${done ? css.done : ""} grid justify-items-center gap-2 text-center`}>
          <h2 id="reveal-title" ref={headingRef} tabIndex={-1} className="t-hero outline-none" data-testid="reveal-name">
            {foal.horse.name}
          </h2>
          <p className="t-meta">
            {SEX_LABEL[foal.horse.sex]} foal · goes to the nursery
          </p>
          {foal.geneticsLine && (
            <p className="caption" data-testid="genetics-line">
              {foal.geneticsLine}
            </p>
          )}
          {rarity && <RarityBadge rarity={rarity} />}
          {note}
        </div>
        {done && likeness.length > 0 && (
          <section className={css.likeness} aria-label="Family likeness" data-testid="family-likeness">
            <p className="eyebrow text-center">Family likeness</p>
            <ul className="grid gap-1">
              {likeness.map((l) => (
                <li key={l.kind} className={css.line} data-from={l.from}>
                  <span aria-hidden className={css.arrow}>
                    {l.from === "dam" ? "◀" : l.from === "sire" ? "▶" : "◆"}
                  </span>
                  {likenessText(l, pronoun, { dam: dam?.name, sire: sire?.name })}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div aria-live="polite" className="sr-only">
          {done ? `${foal.horse.name}, ${SEX_LABEL[foal.horse.sex]} foal${rarity ? `, ${rarity}` : ""}.${likeness.length ? ` ${likeness.map((l) => likenessText(l, pronoun, { dam: dam?.name, sire: sire?.name })).join(". ")}.` : ""}` : ""}
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
