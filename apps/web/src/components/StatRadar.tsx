import type { HorseStats } from "@thoroughbred/shared";
import { STAT_LABELS } from "./StatBars";

/** Hexagonal stat radar, 0..1000 per axis. */
export function StatRadar({ stats, className }: { stats: HorseStats; className?: string }) {
  const cx = 150;
  const cy = 132;
  const R = 92;
  const pt = (i: number, r: number) => {
    const a = (Math.PI * 2 * i) / STAT_LABELS.length - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  const ring = (f: number) => STAT_LABELS.map((_, i) => pt(i, R * f).join(",")).join(" ");
  const shape = STAT_LABELS.map(({ key }, i) => pt(i, (R * stats[key]) / 1000).join(",")).join(" ");
  return (
    <svg viewBox="0 0 300 264" className={className} role="img" aria-label={STAT_LABELS.map(({ key, label }) => `${label} ${stats[key]}`).join(", ")}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill={f === 1 ? "rgba(243,236,218,0.03)" : "none"} stroke="rgba(243,236,218,0.12)" strokeWidth="1" />
      ))}
      {STAT_LABELS.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(243,236,218,0.1)" />;
      })}
      <polygon points={shape} fill="rgba(201,162,74,0.28)" stroke="#e6c877" strokeWidth="2" strokeLinejoin="round" />
      {STAT_LABELS.map(({ key }, i) => {
        const [x, y] = pt(i, (R * stats[key]) / 1000);
        return <circle key={key} cx={x} cy={y} r="3" fill="#e6c877" />;
      })}
      {STAT_LABELS.map(({ key, label }, i) => {
        const [x, y] = pt(i, R + 22);
        return (
          <text key={key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#cdc4ad" fontFamily="var(--font-sans)">
            {label}
            <tspan x={x} dy="13" fill="#f3ecda" fontWeight="600">
              {stats[key]}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
