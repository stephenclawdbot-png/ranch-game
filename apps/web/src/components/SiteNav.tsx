"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatCredits } from "@/lib/format";
import { usePlayerState } from "@/lib/player";
import { PixelIcon, type IconName } from "./icons";
import { Silks } from "./Silks";

type Section = { href: string; label: string; icon: IconName; match: (p: string) => boolean; sub?: { href: string; label: string }[] };

const starts = (p: string, ...prefixes: string[]) => prefixes.some((x) => p === x || p.startsWith(`${x}/`));

/**
 * Five destinations (REDESIGN §3): Estate · Stable · Racing · Club · Sales. Each
 * area's index screens share a one-row sub-nav; detail screens (a horse, a race, a Cup run,
 * a pull proof) are the second and last level.
 */
export const SECTIONS: Section[] = [
  { href: "/", label: "Estate", icon: "home", match: (p) => p === "/" },
  {
    href: "/stable",
    label: "Stable",
    icon: "stable",
    match: (p) => starts(p, "/stable", "/horse", "/nursery", "/facilities", "/breeding"),
    sub: [
      { href: "/stable", label: "Horses" },
      { href: "/nursery", label: "Nursery" },
      { href: "/breeding", label: "Breeding" },
      { href: "/facilities", label: "Facilities" },
    ],
  },
  {
    href: "/races",
    label: "Racing",
    icon: "flag",
    match: (p) => starts(p, "/races", "/race", "/story"),
    sub: [
      { href: "/races", label: "Race card" },
      { href: "/story", label: "Story" },
    ],
  },
  {
    href: "/league",
    label: "Club",
    icon: "trophy",
    match: (p) => starts(p, "/league", "/cup", "/hall", "/pool", "/invite", "/beta"),
    // Beta & wallet pages (/pool, /invite, /beta) stay off the core nav (brand doc §5): they are
    // linked from Profile's "Beta & wallet" section.
    sub: [
      { href: "/league", label: "League" },
      { href: "/cup", label: "Daily Cup" },
      { href: "/hall", label: "Hall of Fame" },
    ],
  },
  {
    href: "/market",
    label: "Sales",
    icon: "coin",
    match: (p) => starts(p, "/market", "/packs"),
    sub: [
      { href: "/market", label: "Horses for sale" },
      { href: "/packs", label: "Packs" },
    ],
  },
];

/** The area sub-nav shows on an area's index screens only (not on detail pages). */
function subNavFor(pathname: string): { section: Section; active: string } | null {
  for (const section of SECTIONS) {
    if (!section.sub || !section.match(pathname)) continue;
    const hit = section.sub.find((x) => x.href === pathname);
    if (hit) return { section, active: hit.href };
  }
  return null;
}

/** The POST TIME lockup (pixel wordmark at 2x); the stopwatch mark alone on very narrow phones. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/post-time-wordmark.svg" width={152} height={32} alt="Post Time" className={`pixelated max-[379px]:hidden ${className ?? ""}`} draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/icon-32.png" width={32} height={32} alt="Post Time" className="pixelated min-[380px]:hidden" draggable={false} />
    </>
  );
}

/** A top-bar purse pill: 32-px icon at 1x plus a Jersey numeral. */
function Pill({ icon, children, title, testId, label }: { icon: IconName; children: React.ReactNode; title: string; testId: string; label: string }) {
  return (
    <span className="pill" title={title}>
      <PixelIcon name={icon} size={32} />
      <span className="score text-[1.375rem] leading-none" data-testid={testId} aria-label={label}>
        {children}
      </span>
    </span>
  );
}

/**
 * Top bar (wordmark, purse pills, your silks -> profile) and the navigation: a bottom tab bar
 * on phones (brass notch on the active tab), text tabs in the top bar on desktop, and one
 * underline sub-nav per area (scrolls sideways with an edge fade, never cut off silently).
 */
export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const state = usePlayerState();
  const sub = subNavFor(pathname);

  const right =
    state === undefined ? (
      <span className="h-9 w-24" aria-hidden />
    ) : state === null ? (
      pathname.startsWith("/play") || pathname === "/" ? null : (
        <Link href="/play" className="btn btn-sm">
          Found a stable
        </Link>
      )
    ) : (
      <div className="flex items-center gap-1.5">
        <Pill
          icon="flag"
          testId="entries"
          title={`Stable entries for Live races: ${state.entries.balance} left (bank holds up to ${state.entries.cap}; +${state.entries.allowance} at local midnight)`}
          label={`${state.entries.balance} of ${state.entries.cap} stable entries left`}
        >
          {state.entries.balance}
          <span className="sr-only">/{state.entries.cap}</span>
        </Pill>
        <Pill icon="coin" testId="credits" title="Stable credits" label={`${formatCredits(state.credits)} credits`}>
          {formatCredits(state.credits)}
        </Pill>
        <Link
          href="/me"
          className={`avatar ${pathname.startsWith("/me") ? "avatar-on" : ""}`}
          aria-label={`${state.stableName}: profile and settings`}
          aria-current={pathname.startsWith("/me") ? "page" : undefined}
        >
          <Silks silks={state.silks} cap={false} className="h-6 w-6" />
        </Link>
      </div>
    );

  return (
    <>
      <a href="#main" className="sr-only z-50 bg-brass px-3 py-2 font-bold text-ink focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
        Skip to content
      </a>
      <header className="topbar sticky top-0 z-40">
        <div className="mx-auto flex h-[var(--topbar-h)] max-w-[75rem] items-center gap-2 px-[var(--gutter)]">
          <Link href="/" className="flex min-h-11 shrink-0 items-center" aria-label="Post Time: your estate">
            <Wordmark />
          </Link>
          <nav className="tabs ml-4 hidden h-full !min-h-0 !gap-1 !p-0 ![mask-image:none] md:flex lg:ml-8" aria-label="Main">
            {SECTIONS.map(({ href, label, match }) => {
              const active = match(pathname);
              return (
                <Link key={href} href={href} aria-current={active ? "page" : undefined} className="!px-3 !text-base !font-extrabold lg:!px-4">
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <Link
              href="/wiki"
              className={`pill ${pathname.startsWith("/wiki") ? "pill-on" : ""}`}
              aria-label="Wiki: how the game works"
              aria-current={pathname.startsWith("/wiki") ? "page" : undefined}
              title="Wiki: how the game works"
              data-testid="nav-wiki"
            >
              <PixelIcon name="papers" size={32} />
              <span className="pr-1 font-extrabold max-sm:hidden">Wiki</span>
            </Link>
            {right}
          </div>
        </div>
        {sub && (
          <nav aria-label={`${sub.section.label} sections`} className="subnav" data-testid="sub-nav">
            <ul className="tabs mx-auto max-w-[75rem] !px-[var(--gutter)]">
              {sub.section.sub!.map((x) => {
                const active = x.href === sub.active;
                return (
                  <li key={x.href}>
                    <Link href={x.href} aria-current={active ? "page" : undefined}>
                      {x.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </header>

      <nav aria-label="Main" className="tabbar md:hidden">
        <ul className="grid h-16 grid-cols-5">
          {SECTIONS.map(({ href, label, icon, match }) => {
            const active = match(pathname);
            return (
              <li key={href}>
                <Link href={href} aria-current={active ? "page" : undefined} className="tabbar-item">
                  <PixelIcon name={icon} size={32} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
