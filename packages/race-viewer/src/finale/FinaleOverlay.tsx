"use client";
/**
 * The finale over the race stage (both views, live and replay): "Photograph!", the line-scan
 * strip and verdict (with a share button), the slow-motion replay's badges, "Weighed in", and
 * the placed horses' cards sliding in (your horse, 3rd, 2nd, the winner). Presentational: the
 * viewer's FinaleRunner says which step shows; a tap advances, Esc skips the lot.
 * Rendered only once the official result exists (the plan is built from it).
 */
import { useMemo, useState, type ReactNode } from "react";
import { formatRaceTime, type HorseAppearance, type RaceReplay } from "@thoroughbred/shared";
import { PhotoFinish } from "../photo/PhotoFinish";
import { photoFinishModel, type PhotoFinishModel } from "../photo/model";
import { exportPhotoFinishPng } from "../photo/render";
import type { PhotoArt } from "../photo/raster";
import { ordinal, type FinalePlan, type FinaleSlide, type FinaleStep } from "./plan";

/** Connections shown on a horse's card (from the racecard; all optional). */
export interface RunnerConnections {
  stableName?: string;
  /** The stable's photo (same-origin URL), else its silks show. */
  stablePhotoUrl?: string | null;
  /** Jockey line ("Top jockey"), when the racecard has one. */
  jockey?: string | null;
}

/** The horse's genetic 3/4 portrait, supplied by the page (the viewer has no portrait art of its own). */
export type PortraitRenderer = (horse: { horseId: string; name: string; appearance: HorseAppearance }, px: number) => ReactNode;

export type SealState = "checking" | "ok" | "unverified" | "failed";

export interface FinaleOverlayProps {
  replay: RaceReplay;
  plan: FinalePlan;
  step: FinaleStep;
  stepIndex: number;
  narrow: boolean;
  connections?: Readonly<Record<string, RunnerConnections>>;
  renderPortrait?: PortraitRenderer;
  courseName?: string | null;
  photoArt: PhotoArt | null;
  artBase: string;
  seal: SealState;
  onSkip(): void;
  onSkipAll(): void;
  /** The "Share clip" button, built by the viewer (it owns the recording context). */
  clipButton?: ReactNode;
}

function Swatch({ primary, secondary, size }: { primary: string; secondary: string; size: number }) {
  return (
    <span
      className="rv-fin-silks"
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${primary} 0 55%, ${secondary} 55% 100%)` }}
      aria-hidden
    />
  );
}

/** "4 1/2 lengths" -> "4½ lengths", "1/2" stays words elsewhere. */
export function prettyLengths(s: string): string {
  return s.replace(/(\d+) 1\/4/g, "$1¼").replace(/(\d+) 1\/2/g, "$1½").replace(/(\d+) 3\/4/g, "$1¾");
}

export function FinaleOverlay(p: FinaleOverlayProps) {
  const { replay, plan, step, narrow } = p;
  const model = useMemo<PhotoFinishModel | null>(() => (plan.photo ? photoFinishModel(replay) : null), [plan.photo, replay]);
  const byId = useMemo(() => new Map(replay.horses.map((h) => [h.horseId, h])), [replay]);
  const shownSlides = plan.steps.slice(0, p.stepIndex).filter((s) => s.kind === "slide" && s.slide!.position <= 3).map((s) => s.slide!);
  return (
    <div
      className={`rv-fin rv-fin-s-${step.kind}`}
      data-finale-step={step.kind === "slide" ? `slide-${step.slide!.position <= 3 ? step.slide!.position : "mine"}` : step.kind}
      onClick={(e) => {
        e.stopPropagation();
        p.onSkip();
      }}
      role="region"
      aria-label="The finish"
    >
      {step.kind === "photograph" && (
        <div className="rv-center">
          <div className="rv-fin-call">
            <div className="rv-photo">PHOTOGRAPH</div>
            <div className="rv-fin-sub">The judge is studying the print</div>
          </div>
        </div>
      )}
      {step.kind === "strip" && model && <StripPanel model={model} replay={replay} art={p.photoArt} artBase={p.artBase} narrow={narrow} courseName={p.courseName} connections={p.connections} clipButton={p.clipButton} />}
      {step.kind === "replay" && (
        <>
          <div className="rv-fin-badges">
            <span className="rv-fin-badge rv-fin-badge-red">Replay</span>
            <span className="rv-fin-badge">Slow motion</span>
          </div>
          <div className="rv-fin-lower">
            <span className="rv-fin-lower-k">The finish again</span>
            <span className="rv-fin-lower-t">{prettyLengths(model ? model.verdict : `${byId.get(plan.steps.find((s) => s.slide?.winner)?.slide?.horseId ?? "")?.name ?? "The winner"} ${plan.steps.find((s) => s.slide?.winner)?.slide?.marginText ?? ""}`)}</span>
          </div>
        </>
      )}
      {step.kind === "weighed" && <WeighedIn seal={p.seal} photo={plan.photo} />}
      {step.kind === "slide" && step.slide && (
        <SlideCard
          key={step.slide.horseId}
          slide={step.slide}
          replay={replay}
          narrow={narrow}
          conn={p.connections?.[step.slide.horseId]}
          renderPortrait={p.renderPortrait}
          shown={shownSlides}
          names={byId}
        />
      )}
      <div className="rv-fin-skip" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="rv-btn" onClick={p.onSkip} title="Next (tap)">
          Next ›
        </button>
        <button type="button" className="rv-btn" onClick={p.onSkipAll} title="Skip to the result (Esc)">
          Skip
        </button>
      </div>
    </div>
  );
}

function StripPanel({
  model,
  replay,
  art,
  artBase,
  narrow,
  courseName,
  connections,
  clipButton,
}: {
  model: PhotoFinishModel;
  replay: RaceReplay;
  art: PhotoArt | null;
  artBase: string;
  narrow: boolean;
  courseName?: string | null;
  connections?: Readonly<Record<string, RunnerConnections>>;
  clipButton?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState(false);
  const share = async () => {
    if (!art || busy) return;
    setBusy(true);
    try {
      const stables: Record<string, string> = {};
      for (const r of model.runners) {
        const s = connections?.[r.horseId]?.stableName;
        if (s) stables[r.horseId] = s;
      }
      const blob = await exportPhotoFinishPng(model, art, { course: courseName ?? replay.race.name, raceName: replay.race.name, stables });
      const file = new File([blob], `photo-finish-${replay.race.id.slice(0, 8)}.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: `Photo finish: ${replay.race.name}` }).catch(() => undefined);
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rv-fin-panel rv-fin-strip" onClick={(e) => e.stopPropagation()}>
      <div className="rv-fin-panel-h">
        <span className="rv-fin-k">Photo finish · judge&rsquo;s verdict</span>
        <span className="rv-fin-actions">
          {clipButton}
          <button type="button" className="rv-btn rv-fin-share" onClick={() => void share()} disabled={!art || busy} data-rv-share="">
            {busy ? "…" : "Share"}
          </button>
        </span>
      </div>
      {/* Phones: the verdict sits above the strip (the strip fills the panel). */}
      {narrow && <div className={`rv-fin-verdict${verdict ? " rv-fin-verdict-on" : ""}`}>{prettyLengths(model.verdict)}</div>}
      <PhotoFinish model={model} art={art ?? undefined} artBase={artBase} animate onVerdict={() => setVerdict(true)} className={narrow ? "rv-fin-photo rv-fin-photo-n" : "rv-fin-photo"} fitHeight={narrow} />
    </div>
  );
}

function WeighedIn({ seal, photo }: { seal: SealState; photo: boolean }) {
  const sealText =
    seal === "ok"
      ? "Sealed ✓ the seed matches the fingerprint published before the off"
      : seal === "failed"
        ? "Seal check failed: see the fairness panel"
        : seal === "checking"
          ? "Checking the seal…"
          : "Sealed: the seed is now public";
  return (
    <div className="rv-center">
      <div className="rv-fin-weighed" role="status">
        <div className="rv-fin-weighed-t">
          <span className="rv-fin-tick" aria-hidden>
            ✓
          </span>
          Weighed in
        </div>
        <div className="rv-fin-weighed-s">{photo ? "Photograph confirmed · result official" : "Result official"}</div>
        <div className={`rv-fin-seal${seal === "failed" ? " rv-fin-seal-bad" : ""}`}>{sealText}</div>
      </div>
    </div>
  );
}

function SlideCard({
  slide,
  replay,
  narrow,
  conn,
  renderPortrait,
  shown,
  names,
}: {
  slide: FinaleSlide;
  replay: RaceReplay;
  narrow: boolean;
  conn?: RunnerConnections;
  renderPortrait?: PortraitRenderer;
  shown: FinaleSlide[];
  names: Map<string, RaceReplay["horses"][number]>;
}) {
  const h = names.get(slide.horseId);
  if (!h) return null;
  const silks = h.appearance.silks;
  // The 3/4 portraits are 128 px art: the frame's inside (3 px border) is exactly 1x on phones and
  // 2x on wider screens, so the animated pixel art scales by whole pixels (no uneven pixels).
  const px = (narrow ? 128 : 256) + 6;
  const eyebrow = slide.winner ? (slide.mine ? "Winner · your horse" : "Winner") : slide.mine ? (slide.position <= 3 ? `Your horse · ${ordinal(slide.position)} place` : "Your horse") : `${ordinal(slide.position)} place`;
  return (
    <div className={`rv-fin-slide${slide.winner ? " rv-fin-win" : ""}${slide.mine ? " rv-fin-mine" : ""}`}>
      {shown.length > 0 && (
        <div className="rv-fin-podium" aria-hidden>
          {shown.map((s) => (
            <span key={s.horseId} className="rv-fin-pod">
              <b>{ordinal(s.position)}</b> {names.get(s.horseId)?.name}
            </span>
          ))}
        </div>
      )}
      <div className="rv-fin-card">
        <div className="rv-fin-portrait" style={{ width: px, height: px }}>
          {renderPortrait ? renderPortrait({ horseId: h.horseId, name: h.name, appearance: h.appearance }, px) : <Swatch primary={silks.primary} secondary={silks.secondary} size={Math.round(px * 0.6)} />}
          <span className="rv-fin-place">{ordinal(slide.position)}</span>
        </div>
        <div className="rv-fin-body">
          <div className="rv-fin-eyebrow">{eyebrow}</div>
          <div className="rv-fin-name">{h.name}</div>
          {conn?.stableName ? (
          <div className="rv-fin-stable">
            {conn.stablePhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={conn.stablePhotoUrl} alt="" className="rv-fin-stable-img" loading="lazy" decoding="async" />
            ) : (
              <Swatch primary={silks.primary} secondary={silks.secondary} size={narrow ? 18 : 24} />
            )}
            <span>{conn.stableName}</span>
          </div>
          ) : null}
          <div className="rv-fin-line">
            <Swatch primary={silks.primary} secondary={silks.secondary} size={narrow ? 12 : 14} />
            <span>{conn?.jockey ? `${conn.jockey} · gate ${h.gate}` : `Gate ${h.gate}`}</span>
          </div>
          <div className="rv-fin-margin">{prettyLengths(slide.mine && !slide.winner ? `Your horse: ${slide.marginText}` : slide.marginText)}</div>
          <div className="rv-fin-time">{formatRaceTime(slide.finishTimeUs)}</div>
        </div>
      </div>
    </div>
  );
}

/** sha256(seed) === seedCommitment, in the browser (the fairness panel's own check). */
export async function checkSeal(replay: Pick<RaceReplay, "seed" | "seedCommitment">): Promise<SealState> {
  try {
    const hex = replay.seed;
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return "unverified";
    const bytes = new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const out = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    return out === replay.seedCommitment.toLowerCase() ? "ok" : "failed";
  } catch {
    return "unverified";
  }
}
