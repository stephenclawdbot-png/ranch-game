"use client";
/**
 * DEV ONLY: art QA for horse sprites. Shows every horse's recoloured gallop strip
 * (PixelLab strip if the art manifest has one, else the code-drawn placeholder),
 * scaled with nearest-neighbour, plus a live animated preview.
 */
import { useEffect, useRef } from "react";
import type { ReplayHorse } from "@thoroughbred/shared";

export interface SpriteSheetProps {
  horses: ReplayHorse[];
  artBaseUrl?: string | null;
  scale?: number;
}

export function SpriteSheet({ horses, artBaseUrl = "/art", scale = 3 }: SpriteSheetProps) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let raf = 0;
    const disposeRef = { current: () => {} };
    (async () => {
      const T = await import("three");
      const { loadArt } = await import("../three/art");
      const { createRigFactory } = await import("../three/horseRig");
      const art = await loadArt(artBaseUrl);
      const { factory, kind } = await createRigFactory(T, artBaseUrl, art);
      if (disposed || !host.current) return factory.dispose();
      const el = host.current;
      el.innerHTML = `<div style="font:12px monospace;color:#cfe;margin-bottom:8px">source: ${kind}</div>`;
      const rows = horses.map((h) => {
        const rig = factory.create(h.appearance, { gate: h.gate });
        const img = rig.texture.image as HTMLCanvasElement | undefined;
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:12px;align-items:flex-end;margin:6px 0";
        const live = document.createElement("canvas");
        live.width = rig.width;
        live.height = rig.height;
        live.style.cssText = `width:${rig.width * scale}px;height:${rig.height * scale}px;image-rendering:pixelated;background:#5a9136`;
        const label = document.createElement("div");
        label.textContent = `${h.gate}. ${h.name} — ${h.appearance.coat}, ${h.appearance.silks.pattern}`;
        label.style.cssText = "font:12px monospace;color:#f3e7c9;width:220px";
        row.append(label, live);
        if (img instanceof HTMLCanvasElement) {
          const strip = img.cloneNode() as HTMLCanvasElement;
          strip.getContext("2d")!.drawImage(img, 0, 0);
          strip.style.cssText = `height:${rig.height * 1.5}px;image-rendering:pixelated;background:#5a9136`;
          row.append(strip);
        }
        el.appendChild(row);
        return { rig, live, img };
      });
      let phase = 0;
      let last = performance.now();
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        phase += ((now - last) / 1000) * 2.2;
        last = now;
        for (const r of rows) {
          r.rig.update(null as never, { phase, speedMs: 16, drive: 0, lightDir: new T.Vector3(-0.5, 0.5, -0.7), time: now / 1000 });
          const ctx = r.live.getContext("2d")!;
          ctx.clearRect(0, 0, r.live.width, r.live.height);
          if (r.img instanceof HTMLCanvasElement) {
            const frames = Math.round(r.img.width / r.rig.width);
            const f = Math.floor((phase % 1) * frames);
            ctx.drawImage(r.img, f * r.rig.width, 0, r.rig.width, r.rig.height, 0, 0, r.rig.width, r.rig.height);
          }
        }
      };
      raf = requestAnimationFrame(tick);
      const prev = disposeRef.current;
      disposeRef.current = () => {
        prev();
        factory.dispose();
      };
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      disposeRef.current();
    };
  }, [horses, artBaseUrl, scale]);
  return <div ref={host} style={{ background: "#0f2a1d", padding: 12 }} />;
}
