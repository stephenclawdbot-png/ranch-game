"use client";

/**
 * <Diorama scene="yard" />: a living HD-2D pixel scene (parallax layers, tilt-shift depth of
 * field, light shafts, bloom, motes, animated horses).
 *
 * - SSR renders only the static poster <img> (instant, no layout shift: the box size comes
 *   from the caller's CSS or `aspect`).
 * - The Canvas2D engine is code-split (`import("./engine")`) and only loaded when the box
 *   comes near the viewport. It pauses offscreen (IntersectionObserver) and while the tab is
 *   hidden, and draws one still frame under prefers-reduced-motion.
 * - If the canvas or any art fails, the poster simply stays.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { computeFrame } from "./frame";
import { SCENES, type DioramaSceneId, type SceneDef } from "./scenes";
import type { DioramaEngine, EngineStats } from "./engine";

export interface DioramaProps {
  scene: DioramaSceneId;
  className?: string;
  style?: CSSProperties;
  /** CSS aspect-ratio for the box when the caller doesn't size it (default 21 / 9). `null` = caller sizes it. */
  aspect?: string | null;
  /** "auto" follows prefers-reduced-motion; "still" forces the static frame; "live" forces motion. */
  motion?: "auto" | "still" | "live";
  quality?: "high" | "low";
  /** Eager-load the poster (above the fold). */
  priority?: boolean;
  /** Accessible description; the scene is decorative (aria-hidden) when omitted. */
  label?: string;
  /** Content layered over the scene (titles, CTAs). */
  children?: ReactNode;
  /**
   * Camera framing override for boxes much shorter than the art (page banners): centre on
   * `focusY` (art px) and, with `ground: false`, drop the "keep the feet in view" rule that would
   * otherwise push a short view down to the floor and crop the subject's head.
   */
  framing?: { focusY?: number; ground?: boolean };
  /** A scene built at runtime (the Ranch herd); memoise it, a new object rebuilds the engine. */
  sceneDef?: SceneDef;
  onStats?: (s: EngineStats) => void;
  /** The live engine once it has loaded (null when it goes away), e.g. to read sprite anchors. */
  onEngine?: (e: DioramaEngine | null) => void;
}

type State = "poster" | "loading" | "live" | "still" | "fallback";

export function Diorama({ scene, className, style, aspect = "21 / 9", motion = "auto", quality, priority, label, children, onStats, framing, sceneDef, onEngine }: DioramaProps) {
  const focusY = framing?.focusY;
  const ground = framing?.ground;
  // One adjusted scene for the poster and the engine, so both frame the same view.
  const def = useMemo(() => {
    const base = sceneDef ?? SCENES[scene];
    if (focusY === undefined && ground !== false) return base;
    return { ...base, focusY: focusY ?? base.focusY, groundY: ground === false ? undefined : base.groundY };
  }, [scene, sceneDef, focusY, ground]);
  const box = useRef<HTMLDivElement>(null);
  const cnv = useRef<HTMLCanvasElement>(null);
  const poster = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<State>("poster");
  const [prefersReduced, setPrefersReduced] = useState(false);
  const statsCb = useRef(onStats);
  statsCb.current = onStats;
  const engineCb = useRef(onEngine);
  engineCb.current = onEngine;

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setPrefersReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  const still = motion === "still" || (motion === "auto" && prefersReduced);

  // Place the poster exactly where the canvas will draw the world: same integer scale, same
  // camera (the SSR fallback is object-fit: cover until this runs).
  useIsoLayoutEffect(() => {
    const el = box.current;
    const img = poster.current;
    if (!el || !img) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const dpr = window.devicePixelRatio || 1;
      const f = computeFrame(def, r.width, r.height, dpr, quality);
      const u = f.s / dpr; // css px per art px
      Object.assign(img.style, {
        objectFit: "fill",
        inset: "auto",
        left: `${-f.vx * u}px`,
        top: `${-f.vy * u}px`,
        width: `${def.width * u}px`,
        height: `${def.height * u}px`,
        maxWidth: "none",
      });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [def, quality]);

  useEffect(() => {
    const el = box.current;
    const canvas = cnv.current;
    if (!el || !canvas) return;
    let engine: DioramaEngine | null = null;
    let visible = false;
    let disposed = false;
    let loading: Promise<void> | null = null;
    let statsTimer = 0;

    const run = () => {
      if (!engine || disposed) return;
      if (still) {
        engine.stop();
        engine.renderStill();
        return;
      }
      if (visible && document.visibilityState === "visible") engine.start();
      else engine.stop();
    };

    const ensure = () => {
      if (loading) return loading;
      setState("loading");
      loading = import("./engine")
        .then(async (mod) => {
          if (disposed) return;
          if (!mod.dioramaSupported()) throw new Error("canvas unsupported");
          const e = new mod.DioramaEngine(canvas, def, { reducedMotion: still, quality });
          await e.load();
          if (disposed) {
            e.destroy();
            return;
          }
          engine = e;
          const r = el.getBoundingClientRect();
          e.resize(r.width, r.height, window.devicePixelRatio || 1);
          if (still) e.renderStill();
          setState(still ? "still" : "live");
          registry.add(e);
          engineCb.current?.(e);
          run();
        })
        .catch((err: unknown) => {
          if (!disposed) setState("fallback");
          if (process.env.NODE_ENV !== "production") console.warn("[diorama]", err);
        });
      return loading;
    };

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) void ensure();
        run();
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);

    const ro = new ResizeObserver(() => {
      if (!engine) return;
      const r = el.getBoundingClientRect();
      engine.resize(r.width, r.height, window.devicePixelRatio || 1);
      if (still) engine.renderStill();
    });
    ro.observe(el);

    const onVis = () => run();
    document.addEventListener("visibilitychange", onVis);

    let pending = false;
    let lastPointer = { x: 0, y: 0 };
    const flush = () => {
      pending = false;
      if (!engine || still || !visible) return;
      const r = el.getBoundingClientRect();
      engine.setPointer((lastPointer.x - (r.left + r.width / 2)) / (r.width / 2), (lastPointer.y - (r.top + r.height / 2)) / Math.max(1, window.innerHeight / 2));
    };
    const onPointer = (e: PointerEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      if (!pending) {
        pending = true;
        requestAnimationFrame(flush);
      }
    };
    const onScroll = () => {
      if (!engine || still || !visible) return;
      const r = el.getBoundingClientRect();
      engine.setScroll((r.top + r.height / 2 - window.innerHeight / 2) / Math.max(1, window.innerHeight));
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    if (statsCb.current) statsTimer = window.setInterval(() => engine && statsCb.current?.(engine.stats()), 1000);

    return () => {
      disposed = true;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", onScroll);
      window.clearInterval(statsTimer);
      if (engine) {
        registry.delete(engine);
        engineCb.current?.(null);
        engine.destroy();
      }
    };
  }, [def, still, quality]);

  const ready = state === "live" || state === "still";
  const focus = `${Math.round((def.focusX / def.width) * 100)}% ${Math.round((def.focusY / def.height) * 100)}%`;
  return (
    <div
      ref={box}
      className={className}
      data-diorama={scene}
      data-diorama-state={state}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ position: "relative", overflow: "hidden", isolation: "isolate", background: `linear-gradient(${def.sky.top}, ${def.sky.bottom})`, ...(aspect ? { aspectRatio: aspect, width: "100%" } : null), ...style }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={poster}
        src={`/art/${def.poster}`}
        alt=""
        draggable={false}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: focus, imageRendering: "pixelated", pointerEvents: "none" }}
      />
      <canvas
        ref={cnv}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          imageRendering: "pixelated",
          opacity: ready ? 1 : 0,
          transition: still ? "none" : "opacity 220ms ease-out",
          pointerEvents: "none",
        }}
      />
      {children ? <div style={{ position: "relative", zIndex: 1, height: "100%" }}>{children}</div> : null}
    </div>
  );
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Live engines (dev harness / e2e fps probes read `window.__dioramas`). */
const registry = new Set<DioramaEngine>();
if (typeof window !== "undefined") (window as unknown as { __dioramas?: Set<DioramaEngine> }).__dioramas = registry;
