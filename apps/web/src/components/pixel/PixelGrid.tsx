import type { CSSProperties } from "react";

export type PixelPalette = Record<string, string | undefined>;

/**
 * Renders an ASCII pixel map as a crisp SVG: one <rect> per horizontal run of the
 * same colour. `.` (or any char missing from the palette) is transparent.
 * Pixel art drawn in code: scales cleanly at any size, never anti-aliased.
 */
export function PixelGrid({
  rows,
  palette,
  className,
  style,
  title,
  pixel = (x, y, ch) => palette[ch],
  testId,
}: {
  rows: readonly string[];
  palette: PixelPalette;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Per-pixel colour override (for patterns, markings, dithering). */
  pixel?: (x: number, y: number, ch: string) => string | undefined;
  testId?: string;
}) {
  const h = rows.length;
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const rects: React.ReactNode[] = [];
  for (let y = 0; y < h; y++) {
    const row = rows[y]!;
    let runStart = 0;
    let runColor: string | undefined;
    for (let x = 0; x <= row.length; x++) {
      const c = x < row.length ? pixel(x, y, row[x]!) : undefined;
      if (x === row.length || c !== runColor) {
        if (runColor && x > runStart) {
          rects.push(<rect key={`${y}-${runStart}`} x={runStart} y={y} width={x - runStart} height={1} fill={runColor} />);
        }
        runStart = x;
        runColor = c;
      }
    }
  }
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      style={style}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-testid={testId}
      preserveAspectRatio="xMidYMid meet"
    >
      {rects}
    </svg>
  );
}

/** Mix two #rrggbb colours (t = 0 -> a, 1 -> b). */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const m = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `#${((1 << 24) | (m(16) << 16) | (m(8) << 8) | m(0)).toString(16).slice(1)}`;
}

/** Relative luminance 0..1 (sRGB approx) — used to pick readable outline/contrast. */
export function luma(hex: string): number {
  const p = parseInt(hex.slice(1), 16);
  return (0.299 * ((p >> 16) & 255) + 0.587 * ((p >> 8) & 255) + 0.114 * (p & 255)) / 255;
}
