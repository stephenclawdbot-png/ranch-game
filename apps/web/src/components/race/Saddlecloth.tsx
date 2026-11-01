import { SADDLE_CLOTHS } from "@thoroughbred/art-pipeline";

/**
 * Saddlecloth number tile in the gate colours. The colours are the single definition the track
 * uses too (art-pipeline SADDLE_CLOTHS: Trackside, 3D, photo finish, paddock and the race HUD),
 * so the racecard, the chips and the cloth on the horse match.
 */
export function Saddlecloth({ gate, className }: { gate: number; className?: string }) {
  const { cloth: bg, number: fg } = SADDLE_CLOTHS[(Math.max(1, gate) - 1) % SADDLE_CLOTHS.length]!;
  return (
    <span
      className={`num inline-flex h-7 w-7 shrink-0 items-center justify-center text-[0.95rem] leading-none ${className ?? ""}`}
      style={{ background: bg, color: fg, boxShadow: "inset 0 -3px 0 rgba(0,0,0,.25), 0 0 0 2px #0b0f0c" }}
      aria-label={`Gate ${gate}`}
    >
      {gate}
    </span>
  );
}
