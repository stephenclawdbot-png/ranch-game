import { useId, type ReactNode } from "react";
import type { Silks as SilksT } from "@thoroughbred/shared";

/** Jersey outline in a 64x72 box (cap sits above it). */
const JERSEY =
  "M23 18 Q32 24 41 18 L51 21.5 Q57 30 61 39 L53.5 43 L48.5 34 L48.5 66 Q32 70 15.5 66 L15.5 34 L10.5 43 L3 39 Q7 30 13 21.5 Z";

function stripesFor(pattern: SilksT["pattern"], color: string): ReactNode {
  switch (pattern) {
    case "hoops":
      return [26, 38, 50, 62].map((y) => <rect key={y} x="0" y={y} width="64" height="6" fill={color} />);
    case "stripes":
      return [8, 18, 28, 38, 48, 58].map((x) => <rect key={x} x={x} y="14" width="5" height="60" fill={color} />);
    case "chevron":
      return [0, 14].map((d) => (
        <path key={d} d={`M14 ${32 + d} L32 ${44 + d} L50 ${32 + d} L50 ${40 + d} L32 ${52 + d} L14 ${40 + d} Z`} fill={color} />
      ));
    case "diamonds": {
      const out: ReactNode[] = [];
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 4; col++) {
          const cx = 14 + col * 12 + (row % 2) * 6;
          const cy = 30 + row * 11;
          out.push(<path key={`${row}-${col}`} d={`M${cx} ${cy - 5} L${cx + 5} ${cy} L${cx} ${cy + 5} L${cx - 5} ${cy} Z`} fill={color} />);
        }
      return out;
    }
    case "sash":
      return <path d="M13 18 L23 18 L52 62 L52 72 L42 72 L13 30 Z" fill={color} />;
    case "quartered":
      return (
        <>
          <rect x="32" y="14" width="32" height="26" fill={color} />
          <rect x="0" y="40" width="32" height="34" fill={color} />
        </>
      );
    case "stars": {
      const star = (cx: number, cy: number, r: number) => {
        const pts: string[] = [];
        for (let i = 0; i < 10; i++) {
          const a = (Math.PI / 5) * i - Math.PI / 2;
          const rr = i % 2 === 0 ? r : r * 0.45;
          pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
        }
        return pts.join(" ");
      };
      return [
        [24, 32],
        [40, 32],
        [32, 45],
        [24, 58],
        [40, 58],
        [8, 34],
        [56, 34],
      ].map(([x, y]) => <polygon key={`${x}-${y}`} points={star(x!, y!, 4.6)} fill={color} />);
    }
    default:
      return null;
  }
}

export function Silks({ silks, className, cap = true, title }: { silks: SilksT; className?: string; cap?: boolean; title?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox={cap ? "0 0 64 72" : "0 12 64 60"} className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={`j${id}`}>
          <path d={JERSEY} />
        </clipPath>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".22" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".28" />
        </linearGradient>
      </defs>
      {cap && (
        <g>
          <path d="M22.5 14.5 Q22.5 3 32 3 Q41.5 3 41.5 14.5 Z" fill={silks.cap} stroke="rgba(0,0,0,.35)" strokeWidth=".8" />
          <path d="M40 13.2 Q48 12.6 52 15.2 L40.5 15.6 Z" fill={silks.cap} stroke="rgba(0,0,0,.35)" strokeWidth=".8" />
          <path d="M22.5 14.5 Q22.5 3 32 3 Q41.5 3 41.5 14.5 Z" fill={`url(#s${id})`} />
        </g>
      )}
      <g clipPath={`url(#j${id})`}>
        <rect x="0" y="14" width="64" height="60" fill={silks.primary} />
        {stripesFor(silks.pattern, silks.secondary)}
        <rect x="0" y="14" width="64" height="60" fill={`url(#s${id})`} />
        {/* Collar and cuffs */}
        <path d="M23 18 Q32 24 41 18" fill="none" stroke={silks.secondary} strokeWidth="3" />
      </g>
      <path d={JERSEY} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth="1" />
    </svg>
  );
}

/** Small round badge with just the jersey. */
export function SilksIcon({ silks, className }: { silks: SilksT; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-cream/90 ring-1 ring-black/20 ${className ?? ""}`}>
      <Silks silks={silks} cap={false} className="h-[78%] w-[78%]" />
    </span>
  );
}
