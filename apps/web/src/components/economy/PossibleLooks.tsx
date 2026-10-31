"use client";
/**
 * Possible looks of a pairing: sample foals as genetic 3/4 portraits (owner decision
 * 2026-10-31: "just what maybe it looks like but its still a chance"). The samples come from
 * the server (game-core possibleLooks, public facts only, the same all day); this only draws
 * them. Portraits mount when they scroll near the viewport, so a long stallion list doesn't
 * render every recolour at once.
 */
import { useEffect, useRef, useState } from "react";
import { HorsePortrait, type PortraitScale } from "@/components/HorsePortrait";
import type { PossibleLookView } from "@/lib/economyTypes";

/** A portrait that mounts once it is near the viewport (same box before and after: no shift). */
export function LazyPortrait({ look, scale, label }: { look: PossibleLookView; scale: PortraitScale; label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  const px = scale === "thumb" ? 64 : 128 * scale;
  return (
    <span ref={ref} className="grid shrink-0 place-items-center" style={{ width: px, height: px }} data-testid="possible-look">
      {shown ? <HorsePortrait appearance={look.appearance} scale={scale} title={label} /> : <span className="sr-only">{label}</span>}
    </span>
  );
}

/** The strip of sample foals with their captions and the "still a chance" note. */
export function PossibleLooks({ looks, note }: { looks: PossibleLookView[]; note: string }) {
  return (
    <figure className="inset grid gap-3 p-3" data-testid="possible-looks">
      <figcaption className="grid gap-0.5">
        <span className="label">Possible looks</span>
        <span className="t-serif text-[1.05rem] leading-snug text-cream" data-testid="looks-note">
          {note}
        </span>
      </figcaption>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {looks.map((l, i) => (
          <li key={i} className="well grid content-start justify-items-center gap-1.5 p-2 text-center">
            <LazyPortrait look={l} scale={1} label={`Possible foal ${i + 1}: ${l.caption}`} />
            <span className="text-sm font-bold leading-tight text-cream">{l.caption}</span>
          </li>
        ))}
      </ul>
      <p className="caption">Samples, not promises: the real foal is drawn at the cover and revealed at birth. New samples each day.</p>
    </figure>
  );
}
