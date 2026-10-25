"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ART_SLOTS, artUrl } from "@/lib/art";
import { useArt } from "./ArtProvider";
import { SCENE_H, SCENE_W, drawLayer, type LayerName, type SceneVariant } from "./scenes";
import type { HorseAppearance } from "@thoroughbred/shared";

const LAYERS: { name: LayerName; depth: number }[] = [
  { name: "sky", depth: 2 },
  { name: "far", depth: 5 },
  { name: "mid", depth: 10 },
  { name: "near", depth: 18 },
];

const cache = new Map<string, string>();
function layerUrl(variant: SceneVariant, layer: LayerName): string {
  const key = `${variant}:${layer}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = SCENE_W;
  c.height = SCENE_H;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  drawLayer(ctx, variant, layer);
  const url = c.toDataURL("image/png");
  cache.set(key, url);
  return url;
}

/** Integer upscale that covers the box height (pixels stay square and crisp). */
function useCoverScale(ref: React.RefObject<HTMLElement | null>, nativeH: number) {
  const [scale, setScale] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(Math.max(1, Math.ceil(el.clientHeight / nativeH)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, nativeH]);
  return scale;
}

/** Blank (white) rows at the bottom of a scene PNG, in art pixels. */
const SCENE_CROP_BOTTOM: Record<string, number> = { "scenes/grandstand.png": 10 };

const FALLBACK_SKY = "linear-gradient(180deg, #2d5a78 0 22%, #4f86a0 22% 40%, #86b4b8 40% 56%, #d9c48a 56% 68%, #3e6e52 68%)";

/**
 * Layered pixel-art scene: the PixelLab backdrop for this place when it exists, otherwise
 * four code-drawn layers. Layers drift at different rates with the pointer (parallax).
 */
export function SceneBackdrop({ variant, className }: { variant: SceneVariant; className?: string }) {
  const art = useArt(ART_SLOTS.scene[variant]);
  const box = useRef<HTMLDivElement>(null);
  const scale = useCoverScale(box, art ? art.h : SCENE_H);
  const [urls, setUrls] = useState<Partial<Record<LayerName, string>>>({});

  useEffect(() => {
    if (art) return;
    setUrls(Object.fromEntries(LAYERS.map((l) => [l.name, layerUrl(variant, l.name)])));
  }, [variant, art]);

  return (
    <div ref={box} className={`absolute inset-0 overflow-hidden ${className ?? ""}`} style={{ background: FALLBACK_SKY }} aria-hidden>
      {art ? (
        <div
          className="pixelated absolute inset-0"
          style={{
            ["--depth" as string]: 10,
            backgroundImage: `url(${artUrl(art)})`,
            backgroundSize: `${art.w * scale}px ${art.h * scale}px`,
            // Hide blank rows some PixelLab scenes carry along the bottom edge.
            backgroundPosition: `center calc(100% + ${(SCENE_CROP_BOTTOM[art.path] ?? 0) * scale}px)`,
            backgroundRepeat: "repeat-x",
          }}
        />
      ) : (
        LAYERS.map(({ name, depth }) =>
          urls[name] ? (
            <div
              key={name}
              className="pixelated absolute inset-0"
              style={{
                ["--depth" as string]: depth,
                backgroundImage: `url(${urls[name]})`,
                backgroundSize: `${SCENE_W * scale}px ${SCENE_H * scale}px`,
                backgroundPosition: "center bottom",
                backgroundRepeat: "repeat-x",
              }}
            />
          ) : null,
        )
      )}
    </div>
  );
}

/**
 * A scene window: pixel backdrop at an integer scale, no tilt and no idle motion.
 * `hero` gives it the ornate brass frame (use at most one hero per screen).
 */
export function SceneHero({
  variant,
  children,
  className,
  height = "min-h-[9rem] sm:min-h-[11rem]",
  hero = false,
}: {
  variant: SceneVariant;
  children?: ReactNode;
  className?: string;
  height?: string;
  hero?: boolean;
  /** @deprecated idle runners were removed (no endless motion). */
  runner?: HorseAppearance;
  /** @deprecated children always render on a plate beneath the scene. */
  overlay?: boolean;
}) {
  return (
    <section className={`${hero ? "frame-hero" : "surface"} overflow-hidden !p-0 ${className ?? ""}`}>
      <div className={`relative ${height}`}>
        <SceneBackdrop variant={variant} />
      </div>
      {children && <div className="relative p-4">{children}</div>}
    </section>
  );
}
