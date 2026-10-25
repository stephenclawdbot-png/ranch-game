"use client";
/**
 * DEV ONLY: inspect the procedural horse rig. Shows a large galloping horse on a
 * scrolling ground line plus a contact sheet of frozen stride phases.
 */
import { useEffect, useRef } from "react";
import type { ReplayHorse } from "@thoroughbred/shared";

export interface HorseStudioProps {
  horses: ReplayHorse[];
  /** Freeze the big horse at this stride phase (0..1) instead of animating. */
  phase?: number;
  speedMs?: number;
  /** 0 standing .. 1 gallop. */
  gallop?: number;
  drive?: number;
}

export function HorseStudio({ horses, phase, speedMs = 16, gallop = 1, drive = 0 }: HorseStudioProps) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const PIXI = await import("pixi.js");
      const { ProceduralHorseRenderer } = await import("../scene/horse/ProceduralHorseRenderer");
      const { silksTexture } = await import("../scene/textures");
      const { strideLengthM } = await import("../scene/horse/gait");
      const app = new PIXI.Application();
      await app.init({ width: 1200, height: 760, background: "#d9dfe4", antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
      if (disposed) {
        app.destroy(true, { children: true });
        return;
      }
      host.current?.appendChild(app.canvas);
      const r = new ProceduralHorseRenderer();
      const ground = new PIXI.Graphics();
      app.stage.addChild(ground);
      const big = r.create(horses[0]!, { silksTexture: silksTexture(horses[0]!.appearance.silks), quality: "high" });
      big.view.position.set(820, 420);
      big.view.scale.set(2.1);
      app.stage.addChild(big.view);
      const sheet = horses.slice(0, 8).map((h, i) => {
        const v = r.create(h, { silksTexture: silksTexture(h.appearance.silks), quality: "high" });
        v.view.position.set(170 + (i % 4) * 290, 590 + Math.floor(i / 4) * 150);
        v.view.scale.set(0.55);
        app.stage.addChild(v.view);
        return v;
      });
      const stride = strideLengthM(speedMs);
      let dist = 0;
      const tick = (t: { deltaMS: number }) => {
        dist += (speedMs * t.deltaMS) / 1000;
        const ph = phase ?? dist / stride;
        big.update({ phase: ph, strideM: stride, gallop, drive, time: performance.now() / 1000, speedMs });
        sheet.forEach((v, i) => v.update({ phase: phase ?? i / 8, strideM: stride, gallop, drive, time: 0, speedMs }));
        ground.clear();
        ground.rect(0, 420, 1200, 3).fill(0x6b5a44);
        // Ground ticks scroll at ground speed (2.1 px per cm) to judge foot sliding.
        const off = ((dist * 100 * 2.1) % 60 + 60) % 60;
        for (let x = -off; x < 1200; x += 60) ground.rect(x, 423, 2, 10).fill(0x6b5a44);
      };
      app.ticker.add(tick);
      cleanup = () => {
        app.ticker.remove(tick);
        app.destroy(true, { children: true });
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [horses, phase, speedMs, gallop, drive]);
  return <div ref={host} />;
}
