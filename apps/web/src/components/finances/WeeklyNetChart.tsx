import { formatCredits } from "@/lib/format";
import type { WeeklyNet } from "@thoroughbred/db";

/**
 * The season's net by UTC week, as a hand-rolled inline SVG (no chart library): thin bars
 * from a zero baseline, brass-rounded at the data end, square at the line. Weeks in credit
 * stand above it in the positive token, weeks in the red below it in the negative token —
 * the sign and the position carry the polarity, so colour is never the only channel. Each
 * bar has a native <title> tooltip, the current week is direct-labelled, and a visually
 * hidden table carries every value.
 */

const W = 640;
const H = 232;
const PAD = { l: 56, r: 16, t: 28, b: 26 };
const BAR_MAX = 24; // dataviz mark spec: never fill the slot
const RADIUS = 4;

const WEEK = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const weekLabel = (weekStart: string) => WEEK.format(new Date(`${weekStart}T00:00:00.000Z`));

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatCredits(Math.abs(n))}`;

/** A clean axis top for `max`: a 1/1.25/1.5/…×10^k ceiling (never 0). */
function niceTop(max: number): number {
  if (max <= 0) return 100;
  const mag = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= max) return m * mag;
  return 10 * mag;
}

export function WeeklyNetChart({ weekly, testId }: { weekly: WeeklyNet[]; testId?: string }) {
  const weeks = weekly;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const posTop = niceTop(Math.max(0, ...weeks.map((w) => w.net)));
  const negTop = niceTop(Math.max(0, ...weeks.map((w) => -w.net)));
  const y0 = PAD.t + (plotH * posTop) / (posTop + negTop);
  const tick = (v: number) => y0 - (v / posTop) * (y0 - PAD.t);
  const tickDown = (v: number) => y0 + (v / negTop) * (PAD.t + plotH - y0);

  // Hairline gridlines at clean half-steps of each arm; the zero baseline is stronger.
  // An arm earns gridlines only when some week actually lands on it, and only once its
  // pixels fit the labels (~16 px of line height each) — a token arm of a one-sided season
  // must not crowd a label onto the baseline. Half-steps are labelled only when the half is
  // a whole number of credits (a "−12.5" line would read worse than no line).
  const posH = y0 - PAD.t;
  const negH = PAD.t + plotH - y0;
  const hasPos = weeks.some((w) => w.net > 0);
  const hasNeg = weeks.some((w) => w.net < 0);
  const lines: { y: number; label: number }[] = [];
  if (hasPos && posH >= 18) {
    if (posH >= 40 && Number.isInteger(posTop / 2)) lines.push({ y: tick(posTop / 2), label: posTop / 2 });
    lines.push({ y: tick(posTop), label: posTop });
  }
  if (hasNeg && negH >= 18) {
    if (negH >= 40 && Number.isInteger(negTop / 2)) lines.push({ y: tickDown(negTop / 2), label: -negTop / 2 });
    lines.push({ y: tickDown(negTop), label: -negTop });
  }

  const slot = weeks.length ? plotW / weeks.length : plotW;
  const barW = Math.min(BAR_MAX, slot * 0.6);
  const last = weeks[weeks.length - 1];

  return (
    <figure className="surface p-4" data-testid={testId ?? "weekly-net-chart"}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Bar chart: the stable's net credits for each week of the season, above the line for weeks in credit and below it for weeks in the red. Values follow in a hidden table."
      >
        {lines.map((l) => (
          <g key={l.label}>
            <line x1={PAD.l} x2={W - PAD.r} y1={l.y} y2={l.y} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.l - 8} y={l.y + 4} textAnchor="end" fontSize={11} fill="var(--color-sage)" className="tabular-nums">
              {formatCredits(l.label)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y0} y2={y0} stroke="var(--color-line-strong)" strokeWidth={1} />
        <text x={PAD.l - 8} y={y0 + 4} textAnchor="end" fontSize={11} fill="var(--color-cream-dim)" className="tabular-nums">
          0
        </text>
        {weeks.map((w, i) => {
          const x = PAD.l + slot * i + (slot - barW) / 2;
          const up = w.net >= 0;
          const h = up ? ((w.net / posTop) * (y0 - PAD.t)) : ((-w.net / negTop) * (PAD.t + plotH - y0));
          const r = Math.min(RADIUS, h);
          const y = up ? y0 - h : y0;
          const title = w.net === 0 ? `Week of ${weekLabel(w.weekStart)}: no movement` : `Week of ${weekLabel(w.weekStart)}: ${signed(w.net)} credits`;
          return (
            <g key={w.weekStart} tabIndex={0} className="rounded-sm transition-[filter] hover:brightness-110 focus-visible:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass">
              <title>{title}</title>
              {w.net !== 0 && (
                <path
                  d={
                    up
                      ? `M${x} ${y0} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} L${x + barW - r} ${y} Q${x + barW} ${y} ${x + barW} ${y + r} L${x + barW} ${y0} Z`
                      : `M${x} ${y0} L${x} ${y + h - r} Q${x} ${y + h} ${x + r} ${y + h} L${x + barW - r} ${y + h} Q${x + barW} ${y + h} ${x + barW} ${y + h - r} L${x + barW} ${y0} Z`
                  }
                  style={{ fill: up ? "var(--color-positive)" : "var(--color-negative)" }}
                />
              )}
              {/* The current week is direct-labelled when the label fits inside the plot
                  (otherwise the tooltip and the hidden table carry it). */}
              {w === last && w.net !== 0 && (up ? y - 6 >= PAD.t + 10 : y + h + 15 <= H - PAD.b) && (
                <text
                  x={x + barW / 2}
                  y={up ? y - 6 : y + h + 15}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={700}
                  fill="var(--color-cream)"
                  className="tabular-nums"
                >
                  {signed(w.net)}
                </text>
              )}
            </g>
          );
        })}
        {weeks.map((w, i) => (
          <text
            key={`l-${w.weekStart}`}
            x={PAD.l + slot * i + slot / 2}
            y={H - 6}
            textAnchor="middle"
            fontSize={11}
            fill="var(--color-sage)"
          >
            {weekLabel(w.weekStart)}
          </text>
        ))}
      </svg>
      <figcaption className="caption mt-1">
        This season, week by week (UTC). Hover or focus a bar for its value; weeks in credit stand above the line, weeks in the red below it.
      </figcaption>
      <table className="sr-only">
        <caption>Net credits by week this season</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Net credits</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.weekStart}>
              <th scope="row">{weekLabel(w.weekStart)}</th>
              <td>{signed(w.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}