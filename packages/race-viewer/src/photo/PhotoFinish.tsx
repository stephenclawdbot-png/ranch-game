"use client";
/**
 * <PhotoFinish>: the line-scan photograph for a finish. Holds on the photo, slides the
 * judge's line from the winner's nose to the runner-up's, shows the margin, then the
 * verdict. The canvas is scaled by whole device pixels per native pixel so the sprites
 * stay crisp; when even 1x is wider than the container it scrolls (following the line).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { fitScale } from "./layout";
import type { PhotoFinishModel } from "./model";
import { rasterPhotoFinish, type PhotoArt } from "./raster";
import { drawPhotoFinish, loadPhotoFinishArt } from "./render";

export interface PhotoFinishProps {
  model: PhotoFinishModel;
  /** Run the judge's line and reveal the verdict (default true). Off = the final state at once. */
  animate?: boolean;
  /** Decoded art; loaded from `artBase` when absent. */
  art?: PhotoArt;
  artBase?: string;
  /** Called once the verdict is showing. */
  onVerdict?: () => void;
  className?: string;
}

const HOLD_MS = 700;
const SLIDE_MS = 1400;

export function PhotoFinish({ model, animate = true, art: artProp, artBase = "/art", onVerdict, className }: PhotoFinishProps) {
  const [art, setArt] = useState<PhotoArt | null>(artProp ?? null);
  const [failed, setFailed] = useState(false);
  const [box, setBox] = useState({ w: 0, dpr: 1 });
  const [judge, setJudge] = useState(animate ? 0 : 1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const verdictCb = useRef(onVerdict);
  verdictCb.current = onVerdict;

  useEffect(() => {
    if (artProp) return setArt(artProp);
    let live = true;
    loadPhotoFinishArt(artBase).then(
      (a) => live && setArt(a),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [artProp, artBase]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, dpr: window.devicePixelRatio || 1 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const raster = useMemo(() => (art ? rasterPhotoFinish(model, art) : null), [model, art]);
  const fit = raster && box.w > 0 ? fitScale(raster.width, box.w, box.dpr) : null;

  // Judge's line: hold, slide (ease out), done.
  useEffect(() => {
    if (!raster) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduce || model.runners.length < 2) {
      setJudge(1);
      return;
    }
    setJudge(0);
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const u = Math.min(1, Math.max(0, (now - t0 - HOLD_MS) / SLIDE_MS));
      setJudge(1 - (1 - u) * (1 - u) * (1 - u));
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [raster, animate, model.runners.length]);

  useEffect(() => {
    if (judge >= 1 && raster) verdictCb.current?.();
  }, [judge >= 1, raster]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !raster || !fit) return;
    const s = fit.scale;
    if (c.width !== raster.width * s) c.width = raster.width * s;
    if (c.height !== raster.height * s) c.height = raster.height * s;
    drawPhotoFinish(c.getContext("2d")!, model, raster, s, judge, Math.round(10 * box.dpr));
    // Keep the judge's line in view when the strip scrolls.
    const wrap = wrapRef.current;
    const r2 = raster.layout.placements[1];
    if (wrap && r2 && wrap.scrollWidth > wrap.clientWidth) {
      const lineX = (raster.layout.winnerX + (r2.noseX - raster.layout.winnerX) * judge) * (fit.cssWidth / raster.width);
      wrap.scrollLeft = Math.max(0, lineX - wrap.clientWidth * 0.6);
    }
  }, [raster, fit?.scale, fit?.cssWidth, judge, model, box.dpr]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = judge >= 1;
  return (
    <figure className={className} style={{ margin: 0 }} data-photo-finish={done ? "verdict" : "judging"}>
      <div ref={wrapRef} style={{ overflowX: "auto", overflowY: "hidden", width: "100%", background: "#16120c" }}>
        {raster && fit ? (
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Photo finish: ${model.verdict}`}
            style={{ display: "block", width: fit.cssWidth, height: (raster.height * fit.cssWidth) / raster.width, imageRendering: "pixelated", margin: "0 auto" }}
          />
        ) : (
          <div style={{ padding: 16, color: "#f3e7c9", font: "14px ui-sans-serif, system-ui, sans-serif" }}>{failed ? "Photograph unavailable" : "Photograph…"}</div>
        )}
      </div>
      <figcaption
        style={{
          marginTop: 8,
          color: "#f3e7c9",
          font: "600 15px/1.35 ui-sans-serif, system-ui, sans-serif",
          opacity: done ? 1 : 0,
          transform: done ? "none" : "translateY(4px)",
          transition: "opacity 400ms ease, transform 400ms ease",
        }}
      >
        {model.verdict}
      </figcaption>
    </figure>
  );
}
