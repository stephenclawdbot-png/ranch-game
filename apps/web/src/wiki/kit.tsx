/**
 * Wiki building blocks. Pages are server components built from these, so the article reads the
 * same everywhere: a lead, headed sections, figures from the game's own art, rule tables whose
 * numbers come from game-core, and real horses (portraits from real genomes).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import * as gc from "@thoroughbred/game-core";
import type { HorseAppearance } from "@thoroughbred/shared";
import { HorsePortrait } from "@/components/HorsePortrait";
import { PixelIcon, type IconName } from "@/components/icons";
import { pageMeta } from "./registry";

/** Opening paragraph, larger than body text. */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="wiki-lead">{children}</p>;
}

/** A section heading with an anchor (the contents list links to it). */
export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="wiki-h2">
      <a href={`#${id}`} className="wiki-anchor" aria-hidden tabIndex={-1}>
        #
      </a>
      {children}
    </h2>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="wiki-h3">{children}</h3>;
}

/** Body paragraph. */
export function P({ children }: { children: ReactNode }) {
  return <p className="wiki-p">{children}</p>;
}

/** Game art, pixel-crisp, cropped to a band, with a caption. */
export function Figure({ src, alt, caption, height = 200, focus = 0.5, contain }: { src: string; alt: string; caption?: ReactNode; height?: number; focus?: number; contain?: boolean }) {
  return (
    <figure className="wiki-figure">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="pixelated" style={{ height, objectFit: contain ? "contain" : "cover", objectPosition: `50% ${focus * 100}%` }} draggable={false} loading="lazy" />
      {caption && <figcaption className="caption">{caption}</figcaption>}
    </figure>
  );
}

const TONE: Record<"tip" | "warn" | "rule" | "gamble", { icon: IconName; label: string }> = {
  tip: { icon: "rosette-green", label: "Tip" },
  warn: { icon: "bell", label: "Watch out" },
  rule: { icon: "papers", label: "The rule" },
  gamble: { icon: "coin", label: "The gamble" },
};

/** A boxed aside: a tip, a warning, a hard rule or a gamble. */
export function Callout({ tone = "tip", title, children }: { tone?: keyof typeof TONE; title?: ReactNode; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <aside className={`wiki-callout wiki-callout-${tone}`}>
      <PixelIcon name={t.icon} size={32} />
      <div className="min-w-0">
        <p className="label">{title ?? t.label}</p>
        <div className="wiki-callout-body">{children}</div>
      </div>
    </aside>
  );
}

/** Key numbers, straight from the rules (game-core), so they are always current. */
export function Facts({ title = "By the numbers", rows }: { title?: string; rows: [ReactNode, ReactNode][] }) {
  return (
    <section className="wiki-facts inset" aria-label={typeof title === "string" ? title : undefined}>
      <p className="label">
        {title} <span className="wiki-live" title="Read from the game rules, so these always match the game">live from the rules</span>
      </p>
      <dl>
        {rows.map(([k, v], i) => (
          <div key={i}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A plain data table. */
export function Table({ head, rows, caption }: { head: ReactNode[]; rows: ReactNode[][]; caption?: ReactNode }) {
  return (
    <div className="wiki-table-wrap">
      <table className="wiki-table">
        {caption && <caption className="caption">{caption}</caption>}
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Numbered how-to steps. */
export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="wiki-steps">
      {items.map((s, i) => (
        <li key={i}>
          <span className="wiki-step-n score" aria-hidden>
            {i + 1}
          </span>
          <div>{s}</div>
        </li>
      ))}
    </ol>
  );
}

/** A bulleted list. */
export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="wiki-list">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

/** Link to another wiki page by slug (title from the registry). */
export function WikiLink({ slug, children }: { slug: string; children?: ReactNode }) {
  const m = pageMeta(slug);
  return (
    <Link href={`/wiki/${slug}`} className="link">
      {children ?? m?.title ?? slug}
    </Link>
  );
}

/** Link to a game screen. */
export function GameLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="link">
      {children}
    </Link>
  );
}

/** A number in the score face. */
export function Num({ children }: { children: ReactNode }) {
  return <span className="score wiki-num">{children}</span>;
}

/** Inline icon. */
export function Icon({ name, size = 32 }: { name: IconName; size?: 16 | 32 | 48 | 64 }) {
  return <PixelIcon name={name} size={size} />;
}

// ---------------------------------------------------------------------------
// Real horses (from real genomes) for illustrations
// ---------------------------------------------------------------------------

const WIKI_SILKS = { pattern: "hoops", primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#1f4e9c" } as const;
const ADULT = { racingAge: true, starts: 5, retired: false };

/** A real foundation genome for an illustration (deterministic per seed). */
export function sampleGenome(seed: string, season = 1): gc.Genome {
  return gc.generateFoundationGenome(gc.seedFrom("wiki", seed), { season });
}

export function appearanceOfGenome(g: gc.Genome): HorseAppearance {
  return gc.appearanceOf(g, ADULT, WIKI_SILKS as Parameters<typeof gc.appearanceOf>[2]);
}

/** The first seeded horse (from `prefix`-0, -1, ...) whose coat matches. */
export function sampleOfCoat(coat: string, prefix = "coat"): { genome: gc.Genome; appearance: HorseAppearance } | null {
  for (let i = 0; i < 400; i++) {
    const genome = sampleGenome(`${prefix}-${coat}-${i}`);
    const appearance = appearanceOfGenome(genome);
    if (appearance.coat === coat) return { genome, appearance };
  }
  return null;
}

/** An animated 3/4 portrait card with a name and a line under it. */
export function HorseCard({ appearance, name, line, size = "md" }: { appearance: HorseAppearance; name: ReactNode; line?: ReactNode; size?: "sm" | "md" }) {
  return (
    <figure className={`wiki-horse wiki-horse-${size}`}>
      <div className="wiki-horse-frame">
        <HorsePortrait appearance={appearance} title={typeof name === "string" ? name : undefined} />
      </div>
      <figcaption>
        <span className="t-title block">{name}</span>
        {line && <span className="caption block">{line}</span>}
      </figcaption>
    </figure>
  );
}

/** A row or grid of horse cards. */
export function HorseRow({ children }: { children: ReactNode }) {
  return <div className="wiki-horse-row">{children}</div>;
}

/** A horizontal stacked bar of shares (permille or percent), e.g. below / between / above. */
export function ShareBar({ parts, total, label }: { parts: { label: string; value: number; color: string }[]; total?: number; label: string }) {
  const sum = total ?? parts.reduce((a, p) => a + p.value, 0);
  return (
    <div className="wiki-sharebar">
      <div className="wiki-sharebar-track" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${Math.round((p.value / sum) * 100)}%`).join(", ")}`}>
        {parts.map((p) => (
          <span key={p.label} style={{ width: `${(p.value / sum) * 100}%`, background: p.color }} />
        ))}
      </div>
      <ul className="wiki-sharebar-legend">
        {parts.map((p) => (
          <li key={p.label}>
            <span className="wiki-swatch" style={{ background: p.color }} aria-hidden />
            {p.label} <span className="score">{Math.round((p.value / sum) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A single labelled meter (0..max). */
export function Meter({ label, value, max, color = "var(--color-brass)", suffix }: { label: ReactNode; value: number; max: number; color?: string; suffix?: ReactNode }) {
  return (
    <div className="wiki-meter">
      <span className="wiki-meter-label">{label}</span>
      <span className="wiki-meter-track" aria-hidden>
        <span style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color }} />
      </span>
      <span className="score wiki-meter-value">
        {value}
        {suffix}
      </span>
    </div>
  );
}

/** "one Live race" / "2 Live races": a rule number in words that reads right if the rule changes. */
export const count = (n: number, noun: string, plural = `${noun}s`) => `${n === 1 ? "one" : n} ${n === 1 ? noun : plural}`;

/** Format permille as a percentage. */
export const pct = (permille: number, digits = 0) => `${(permille / 10).toFixed(digits)}%`;
