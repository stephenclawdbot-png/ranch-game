"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ART_SLOTS, artUrl } from "@/lib/art";
import { useArt } from "../pixel/ArtProvider";
import { PixelIcon, type IconName } from "../icons";
import { DioramaSlot } from "../diorama/DioramaSlot";

/**
 * Design System v2 page kit (docs/brand-and-design-v2.md §4.5): the scene band at the top of
 * each area, the plain header for detail pages, section heads, "How it works" disclosures and
 * empty states that point somewhere.
 */

export type SceneName = "stable" | "barn" | "grandstand" | "paddock";

/** Where to centre each scene vertically (fraction of the art height) so its subject shows. */
const FOCUS: Record<SceneName, number> = { stable: 0.42, barn: 0.5, grandstand: 0.58, paddock: 0.55 };

/**
 * The scene art at an integer scale (1x phones, 2x desktop), centred and cropped, never
 * stretched. This is the slot the HD-2D diorama replaces (`data-slot="diorama"`): keep the
 * wrapper and swap the <img> for the live scene.
 */
export function SceneArt({ scene, alt }: { scene: SceneName; alt: string }) {
  const art = useArt(ART_SLOTS.scene[scene]);
  if (!art) return <div className="absolute inset-0 bg-[linear-gradient(180deg,#2d5a78_0_22%,#4f86a0_22%_40%,#86b4b8_40%_56%,#d9c48a_56%_68%,#3e6e52_68%)]" aria-hidden />;
  const style = { ["--aw" as string]: `${art.w}px`, ["--ah" as string]: `${art.h}px`, ["--fy" as string]: FOCUS[scene] } as CSSProperties;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="scene-art" src={artUrl(art)} alt={alt} style={style} draggable={false} />;
}

/**
 * Full-bleed scene band with the page's one pixel title. `size`: "home" (216/288), "index"
 * (152/216) or "crop" (120/160, detail pages).
 */
export function SceneBand({
  scene,
  alt,
  eyebrow,
  title,
  meta,
  size = "index",
  aside,
  children,
  testId,
}: {
  scene: SceneName;
  alt: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  size?: "home" | "index" | "crop";
  aside?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <section className={`scene-band bleed ${size === "home" ? "" : size === "crop" ? "crop" : "short"}`} data-testid={testId ?? "scene-band"}>
      <div className="absolute inset-0" data-slot="diorama" data-scene={scene}>
        <DioramaSlot scene={scene} alt={alt} />
      </div>
      <div className="overlay">
        <div className="mx-auto flex max-w-[75rem] items-end justify-between gap-3 px-[var(--gutter)]">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow !text-on-baize-2 [text-shadow:0_1px_0_#050d08]">{eyebrow}</p>}
            <h1 className="t-page text-on-baize">{title}</h1>
            {meta && <p className="t-meta !text-on-baize-2 [text-shadow:0_1px_0_#050d08]">{meta}</p>}
          </div>
          {aside && <div className="shrink-0">{aside}</div>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Detail pages: back link + the one pixel title on baize (no scene), optional art on the right. */
export function PageHeader({
  back,
  eyebrow,
  title,
  meta,
  aside,
  className,
}: {
  back?: { href: string; label: string };
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`grid gap-1 ${className ?? ""}`}>
      {back && (
        <Link href={back.href} className="link w-fit !text-on-baize-2 hover:!text-on-baize">
          ‹ {back.label}
        </Link>
      )}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 className="t-page">{title}</h1>
          {meta && <p className="t-meta mt-1">{meta}</p>}
        </div>
        {aside}
      </div>
    </header>
  );
}

/** A section: Nunito 800 head, 12 px to content, 32 px (48 desktop) above. */
export function Section({
  id,
  title,
  href,
  linkLabel,
  aside,
  children,
  className,
  testId,
}: {
  id?: string;
  title: ReactNode;
  href?: string;
  linkLabel?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section aria-labelledby={id} className={`section ${className ?? ""}`} data-testid={testId}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={id} className="t-h2">
          {title}
        </h2>
        {href ? (
          <Link href={href} className="link shrink-0">
            {linkLabel} ›
          </Link>
        ) : (
          aside
        )}
      </div>
      {children}
    </section>
  );
}

/** "How it works": the rules, folded away (they never open a page). */
export function HowItWorks({ children, label = "How it works", className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <details className={`how ${className ?? ""}`} data-testid="how-it-works">
      <summary>{label}</summary>
      <div className="surface mt-2 grid gap-2 p-4 text-[0.9375rem] leading-6">{children}</div>
    </details>
  );
}

/** Empty state: a 64-px illustration in a well, a one-line title, why or what next, one action. */
export function EmptyState({
  icon = "horseshoe",
  title,
  text,
  action,
  className,
  testId,
}: {
  icon?: IconName;
  title: ReactNode;
  text: ReactNode;
  action?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={`surface flex items-center gap-4 p-4 ${className ?? ""}`} data-testid={testId ?? "empty-state"}>
      <span className="empty-slot" aria-hidden>
        <PixelIcon name={icon} size={64} />
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="t-title">{title}</p>
        <p className="t-meta">{text}</p>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
