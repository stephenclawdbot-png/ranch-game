"use client";
/**
 * The build-up's captions over both views (stage/preoff.ts): the paddock (the host's paddock
 * scene, or a runner list), "Going down to post", the stalls filling one by one (who is being
 * led in, how many are in), "Under starter's orders", a small countdown, and the skip button.
 * The same overlay whatever the view, so switching views keeps the same picture.
 */
import type { ReactNode } from "react";
import type { ReplayHorse } from "@thoroughbred/shared";
import type { PreOffKind } from "../stage/preoff";
import { Swatch, clockLabel } from "./Hud";

export interface PreOffHud {
  kind: PreOffKind;
  /** Seconds to the off. */
  toOff: number;
  loaded: number;
  total: number;
  /** Runner being led in now (index into the horses), or -1. */
  walking: number;
}

export function PreOffOverlay({
  pre,
  horses,
  raceName,
  paddock,
  highlightHorseId,
  onSkip,
}: {
  pre: PreOffHud;
  horses: readonly ReplayHorse[];
  raceName: string;
  paddock?: ReactNode;
  highlightHorseId?: string;
  onSkip(): void;
}) {
  const w = pre.walking >= 0 ? horses[pre.walking] : undefined;
  const caption =
    pre.kind === "parade"
      ? { k: "In the paddock", t: raceName }
      : pre.kind === "post"
        ? { k: "Going down to post", t: raceName }
        : pre.kind === "loading"
          ? { k: `Loading · ${pre.loaded} of ${pre.total} in`, t: w ? null : "Into the stalls" }
          : { k: "Under starter's orders", t: "All in, gates shut" };
  return (
    <>
      {pre.kind === "parade" && (
        <div className="rv-pre-paddock" data-preoff="parade">
          {paddock ? (
            <div className="rv-pre-paddock-in">{paddock}</div>
          ) : (
            <ul className="rv-pre-field" aria-label="The runners in the paddock">
              {[...horses]
                .sort((a, b) => a.gate - b.gate)
                .map((h) => (
                  <li key={h.horseId} className={h.horseId === highlightHorseId ? "rv-me" : undefined}>
                    <span className="rv-pre-cloth">{h.gate}</span>
                    <Swatch primary={h.appearance.silks.primary} secondary={h.appearance.silks.secondary} />
                    <span className="rv-pre-name">{h.name}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      <div className={`rv-pre-lower${pre.kind === "parade" ? " rv-pre-top" : ""}`} data-preoff={pre.kind} aria-live="off">
        <span className="rv-pre-k">{caption.k}</span>
        {w ? (
          <span className={`rv-pre-t rv-pre-led${w.horseId === highlightHorseId ? " rv-me" : ""}`} key={w.horseId}>
            <span className="rv-pre-cloth">{w.gate}</span>
            <Swatch primary={w.appearance.silks.primary} secondary={w.appearance.silks.secondary} />
            {w.name}
          </span>
        ) : (
          caption.t && <span className="rv-pre-t">{caption.t}</span>
        )}
      </div>
      <div className="rv-pre-count" aria-hidden>
        <span className="rv-pre-count-k">Off in</span>
        <span className="rv-pre-count-v">{clockLabel(Math.ceil(pre.toOff))}</span>
      </div>
      <button
        type="button"
        className="rv-btn rv-pre-skip"
        onClick={(e) => {
          e.stopPropagation();
          onSkip();
        }}
        data-rv-preoff-skip=""
      >
        Skip build-up ›
      </button>
    </>
  );
}
