"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ART_SLOTS, artUrl } from "@/lib/art";
import { useArt } from "./ArtProvider";
import { SCENE_H, SCENE_W, drawLayer, type LayerName, type SceneVariant } from "./scenes";
import { useTilt } from "./useTilt";
import { GallopSprite } from "./GallopSprite";
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
          className="parallax pixelated absolute -inset-x-6 -inset-y-3"
          style={{
            ["--depth" as string]: 10,
            backgroundImage: `url(${artUrl(art)})`,
            backgroundSize: `${art.w * scale}px ${art.h * scale}px`,
            backgroundPosition: "center bottom",
            backgroundRepeat: "repeat-x",
          }}
        />
      ) : (
        LAYERS.map(({ name, depth }) =>
          urls[name] ? (
            <div
              key={name}
              className="parallax pixelated absolute -inset-x-8 -bottom-2 top-[-8px]"
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

/** Page header: framed scene with a 3D tilt, parallax layers and a title plate. */
export function SceneHero({
  variant,
  children,
  className,
  height = "min-h-[13.5rem] sm:min-h-[16rem] md:min-h-[18rem]",
  runner,
  overlay = true,
}: {
  /** false: the scene is a clean window and children render on a panel strip beneath it. */
  overlay?: boolean;
  /** A horse galloping across the scene (PixelLab gallop strip, recoloured). */
  runner?: HorseAppearance;
  variant: SceneVariant;
  children?: ReactNode;
  className?: string;
  height?: string;
}) {
  const ref = useTilt<HTMLDivElement>(2.5);
  return (
    <section ref={ref} className={`tilt px-panel overflow-hidden !p-0 ${className ?? ""}`}>
      <div className={`relative flex flex-col justify-end ${height}`}>
        <SceneBackdrop variant={variant} />
        {runner && (
          <div aria-hidden className="parallax pointer-events-none absolute inset-x-0 bottom-[3%] h-36" style={{ ["--depth" as string]: 14 }}>
            <div className="gallop-across absolute bottom-0 left-0">
              <GallopSprite appearance={runner} scale={2} className="drop-shadow-[0_6px_0_rgba(0,0,0,0.25)]" />
            </div>
          </div>
        )}
        {/* stepped shade so text reads over the scene */}
        {overlay && <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[78%]"
          style={{
            background:
              "linear-gradient(180deg, rgba(8,21,14,0) 0 12%, rgba(8,21,14,.3) 12% 34%, rgba(8,21,14,.58) 34% 58%, rgba(8,21,14,.8) 58%)",
          }}
        />}
        {overlay && (
          <div className="parallax relative flex flex-col justify-end p-3 pt-16 sm:p-5 sm:pt-20" style={{ ["--depth" as string]: -6 }}>
            {children}
          </div>
        )}
      </div>
      {!overlay && <div className="relative border-t-[3px] border-[#050906] p-3 sm:p-4">{children}</div>}
    </section>
  );
}
