"use client";
/**
 * The owner's moment for a first win (V-08): the winner's 3/4 portrait full width in a vignette
 * (the finale's portrait renderer), the rosette, "led in" with the owner's silks, and the share
 * picture (the result card's own share image). Shown once (lib/firstWin), skippable (Continue or
 * Esc), with reduced motion it simply appears.
 */
import { useEffect, useRef } from "react";
import type { HorseAppearance, Silks } from "@thoroughbred/shared";
import { renderFinalePortrait } from "@/components/RaceViewerClient";
import { PixelIcon } from "@/components/icons";
import { firstWinWords, type FirstWinOf } from "@/lib/firstWin";
import css from "./firstWin.module.css";

export function FirstWinMoment({
  of,
  horseId,
  horseName,
  appearance,
  stableName,
  raceName,
  onShare,
  onClose,
}: {
  of: FirstWinOf;
  horseId: string;
  horseName: string;
  appearance: HorseAppearance;
  stableName: string | null;
  raceName: string;
  onShare?: () => void;
  onClose: () => void;
}) {
  const words = firstWinWords(of, horseName, stableName);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const silks: Silks = appearance.silks;
  return (
    <section className={css.moment} aria-labelledby="first-win-title" data-testid="first-win-moment" data-first-win={of}>
      <div className={css.picture}>
        <div className={css.portrait}>{renderFinalePortrait({ horseId, name: horseName, appearance }, 256)}</div>
        <div className={css.vignette} aria-hidden />
        <span className={css.rosette} aria-hidden>
          <PixelIcon name="rosette" size={64} />
        </span>
      </div>
      <div className={css.words}>
        <p className="eyebrow">{words.eyebrow}</p>
        <h2 id="first-win-title" className="t-hero">
          {words.title}
        </h2>
        <p className={css.led}>
          <span className={css.silks} style={{ background: `linear-gradient(135deg, ${silks.primary} 0 55%, ${silks.secondary} 55% 100%)` }} aria-hidden />
          {raceName}
        </p>
        <p className="t-meta">{words.line}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {onShare && (
            <button type="button" className="btn" onClick={onShare} data-testid="first-win-share">
              Save the picture
            </button>
          )}
          <button ref={ref} type="button" className="btn btn-brass" onClick={onClose} data-testid="first-win-continue">
            Continue
          </button>
        </div>
      </div>
    </section>
  );
}
