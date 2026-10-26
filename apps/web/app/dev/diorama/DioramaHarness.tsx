"use client";

import { useState } from "react";
import { Diorama } from "@/components/diorama/Diorama";
import { DIORAMA_SCENES, SCENES, type DioramaSceneId } from "@/components/diorama/scenes";
import type { EngineStats } from "@/components/diorama/engine";

const isScene = (s?: string): s is DioramaSceneId => !!s && (DIORAMA_SCENES as readonly string[]).includes(s);

export function DioramaHarness(props: { scene?: string; motion?: string; quality?: string; h?: string; poster?: string }) {
  const [motion, setMotion] = useState<"auto" | "still" | "live">(props.motion === "still" || props.motion === "live" ? props.motion : "auto");
  const [stats, setStats] = useState<Partial<Record<DioramaSceneId, EngineStats>>>({});
  const quality = props.quality === "low" ? "low" : props.quality === "high" ? "high" : undefined;
  const scenes = isScene(props.scene) ? [props.scene] : [...DIORAMA_SCENES];
  const h = Number(props.h) > 0 ? Number(props.h) : null;

  if (props.poster === "1") {
    return (
      <div style={{ display: "grid", gap: 16, padding: 16, background: "#08150e" }}>
        {scenes.map((s) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={s} src={`/art/${SCENES[s].poster}`} alt={s} style={{ width: SCENES[s].width * 2, imageRendering: "pixelated" }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ background: "#08150e", color: "#f3e7c9", minHeight: "100vh", paddingBottom: 48 }} data-testid="diorama-harness">
      <div style={{ display: "flex", gap: 16, alignItems: "center", padding: "12px 16px", flexWrap: "wrap" }}>
        <strong style={{ fontWeight: 800 }}>HD-2D dioramas</strong>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={motion === "still"} onChange={(e) => setMotion(e.target.checked ? "still" : "auto")} data-testid="reduced-toggle" />
          Reduced motion (static frame)
        </label>
        <span style={{ opacity: 0.7, fontSize: 13 }}>motion: {motion}</span>
      </div>
      <div style={{ display: "grid", gap: 24 }}>
        {scenes.map((s) => {
          const st = stats[s];
          return (
            <section key={s} data-testid={`diorama-${s}`}>
              <Diorama
                scene={s}
                motion={motion}
                quality={quality}
                priority={s === scenes[0]}
                aspect={h ? null : "21 / 9"}
                style={h ? { height: h, width: "100%" } : undefined}
                label={SCENES[s].label}
                onStats={(x) => setStats((p) => ({ ...p, [s]: x }))}
              />
              <div style={{ display: "flex", gap: 16, padding: "6px 16px", fontSize: 13, opacity: 0.85 }}>
                <span>
                  <b>{SCENES[s].label}</b> <code>scene=&quot;{s}&quot;</code>
                </span>
                {st ? (
                  <span data-testid={`fps-${s}`}>
                    {st.fps.toFixed(0)} fps · draw {st.frameMs.toFixed(1)} ms · k={st.k} m={st.m} · {st.quality}
                  </span>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
