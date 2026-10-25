"use client";
// TEMPORARY client shim until race-viewer / art-pipeline land. DELETE before finishing.
import { useEffect, useState } from "react";
import type { HorseAppearance, RaceReplay } from "@thoroughbred/shared";
const COATS: Record<string, [string, string]> = {
  bay: ["#8a4b26", "#1c120c"], dark_bay: ["#4a2a18", "#120b07"], chestnut: ["#a65a2a", "#7a3b18"], liver_chestnut: ["#6a3a20", "#3a1f10"],
  black: ["#24211f", "#0d0c0b"], grey: ["#b9b6b0", "#e9e6e0"], dapple_grey: ["#9fa2a3", "#d8d8d8"], palomino: ["#d9b46a", "#f3ead2"],
  buckskin: ["#c9a066", "#1c140e"], roan: ["#7e6a64", "#2a1e18"],
};
export function resolveHorseColors(a: HorseAppearance) {
  const [body, mane] = COATS[a.coat] ?? COATS.bay!;
  return { body, shade: "#00000055", highlight: "#ffffff33", mane: a.maneColor ?? mane, hoof: "#2a2420" };
}
export function RaceViewer(props: { replay: RaceReplay; startAtMs?: number; highlightHorseId?: string; onFinished?: () => void; height?: number }) {
  const { replay, startAtMs, onFinished } = props;
  const [now, setNow] = useState(() => Date.now());
  const [done, setDone] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t); }, []);
  const elapsed = Math.max(0, now - (startAtMs ?? now)) * 4;
  const f = Math.min(replay.frames.length - 1, Math.floor((elapsed / 1000) * (replay.tickHz / replay.sampleEvery)));
  useEffect(() => { if (f >= replay.frames.length - 1 && !done) { setDone(true); onFinished?.(); } }, [f, done, onFinished, replay.frames.length]);
  return (
    <div style={{ height: props.height ?? 360, background: "#0b2a1d", padding: 12, position: "relative" }}>
      <canvas width={10} height={10} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0 }} />
      {replay.horses.map((h, i) => (
        <div key={h.horseId} style={{ height: 18, margin: 4, position: "relative", fontSize: 11, color: "#fff" }}>
          <div style={{ position: "absolute", left: `${((replay.frames[f]![i * 4]! / replay.trackLengthMm) * 90).toFixed(2)}%`, background: h.horseId === props.highlightHorseId ? "#e2b33c" : h.appearance.silks.primary, padding: "0 4px" }}>{h.name}</div>
        </div>
      ))}
    </div>
  );
}
