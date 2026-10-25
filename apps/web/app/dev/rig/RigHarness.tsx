"use client";

import { useEffect, useRef, useState } from "react";
import type { HarnessHandle } from "@thoroughbred/pixel-rig/dev";

export function RigHarness() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<HarnessHandle | null>(null);
  const [stats, setStats] = useState("loading...");
  const [paused, setPaused] = useState(false);
  const [drive, setDrive] = useState(-1);

  useEffect(() => {
    let disposed = false;
    const params = new URLSearchParams(window.location.search);
    setPaused(params.get("paused") === "1");
    void import("@thoroughbred/pixel-rig/dev").then(({ startRigHarness }) => {
      if (disposed || !canvas.current) return;
      handle.current = startRigHarness(canvas.current, params);
    });
    const id = window.setInterval(() => {
      const s = handle.current?.stats();
      if (s) setStats(`${s.rigs} rigs · update ${s.updateMs.toFixed(2)} ms · frame ${s.frameMs.toFixed(1)} ms · art: ${s.source}`);
    }, 500);
    return () => {
      disposed = true;
      window.clearInterval(id);
      handle.current?.dispose();
      handle.current = null;
    };
  }, []);

  return (
    <main style={{ background: "#0b0f0c", minHeight: "100vh", color: "#f3e7c9", padding: 12, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <strong>pixel-rig harness</strong>
        <span data-testid="rig-stats">{stats}</span>
        <button
          onClick={() => {
            handle.current?.setPaused(!paused);
            setPaused(!paused);
          }}
        >
          {paused ? "play" : "pause"}
        </button>
        <label>
          drive{" "}
          <input
            type="range"
            min={-0.1}
            max={1}
            step={0.05}
            value={drive}
            onChange={(e) => {
              const d = Number(e.target.value);
              setDrive(d);
              handle.current?.setDrive(d);
            }}
          />{" "}
          {drive < 0 ? "per horse" : drive.toFixed(2)}
        </label>
        <span>drag on the canvas to move the sun</span>
        <span>
          modes: <a href="?mode=grid">grid</a> · <a href="?mode=strip">strip</a> · <a href="?mode=morph">morph</a> ·{" "}
          <a href="?mode=bench&n=16">bench</a> · <a href="?gen=1">generated parts</a>
        </span>
      </div>
      <canvas ref={canvas} width={1320} height={610} style={{ imageRendering: "pixelated", display: "block", maxWidth: "100%" }} />
    </main>
  );
}
