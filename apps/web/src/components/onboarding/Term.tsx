"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { glossaryEntry } from "@/lib/glossary";
import { usePlain } from "./guide";

/**
 * A racing word with its meaning a tap away (plain-language mode). The meaning comes from the
 * one glossary (lib/glossary.ts, also the wiki's Glossary page). Outside plain-language mode,
 * or for a word the glossary doesn't know, it is just the word.
 */
export function Term({ k, children, force = false }: { k: string; children?: ReactNode; force?: boolean }) {
  const plain = usePlain();
  const entry = glossaryEntry(k);
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    // Keep the popover on screen (phones): nudge it left or right inside the viewport.
    const r = pop.current?.getBoundingClientRect();
    if (r) {
      const gutter = 12;
      if (r.right > window.innerWidth - gutter) setShift(window.innerWidth - gutter - r.right);
      else if (r.left < gutter) setShift(gutter - r.left);
    }
    const close = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const label = children ?? entry?.[0] ?? k;
  if (!entry || (!plain && !force)) return <>{label}</>;
  return (
    <span ref={ref} className="term relative inline">
      <button
        type="button"
        className="term-word"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setShift(0);
          setOpen((v) => !v);
        }}
        data-testid={`term-${entry[0].toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      >
        {label}
      </button>
      {open && (
        <span ref={pop} id={id} role="tooltip" className="term-pop" style={{ transform: `translateX(${shift}px)` }}>
          <b className="block">{entry[0]}</b>
          <span className="block">{entry[1]}</span>
          <Link href={`/wiki/${entry[2]}`} className="link mt-1 inline-block">
            More in the wiki ›
          </Link>
        </span>
      )}
    </span>
  );
}

/** A plainer sentence on a key screen, shown only in plain-language mode. */
export function PlainNote({ children, className = "" }: { children: ReactNode; className?: string }) {
  const plain = usePlain();
  if (!plain) return null;
  return (
    <p className={`plain-note text-[0.875rem] leading-5 ${className}`} data-testid="plain-note">
      <span className="tag tag-ready mr-2 align-middle">In plain words</span>
      {children}
    </p>
  );
}
