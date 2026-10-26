"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatCredits } from "@/lib/format";
import { usePlayerState } from "@/lib/player";
import { Crest, PixelIcon, type IconName } from "./icons";
import { SilksIcon } from "./Silks";
import { FeedbackButton } from "./playtest/FeedbackButton";

type Section = { href: string; label: string; icon: IconName; match: (p: string) => boolean; sub?: { href: string; label: string }[] };

const starts = (p: string, ...prefixes: string[]) => prefixes.some((x) => p === x || p.startsWith(`${x}/`));

/**
 * Five destinations (design-research §11.1-11.2): Home · Stable · Races · Club · Market. Each
 * area's index screens share a one-row sub-nav; detail screens (a horse, a race, a Cup run,
 * a pull proof) are the second and last level.
 */
export const SECTIONS: Section[] = [
  { href: "/", label: "Home", icon: "home", match: (p) => p === "/" },
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
    label: "Races",
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
    sub: [
      { href: "/league", label: "League" },
      { href: "/cup", label: "Daily Cup" },
      { href: "/hall", label: "Hall of Fame" },
      // Beta money (web3 agent): the on-chain weekly Prize Pool and the referral page.
      { href: "/pool", label: "Prize Pool" },
      { href: "/invite", label: "Invite" },
    ],
  },
  {
    href: "/market",
    label: "Market",
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

/**
 * Top bar (crest, purse, your silks -> profile & settings) and the navigation:
 * a flat bottom tab bar on phones (brass notch on the active tab, not a filled button),
 * text tabs in the top bar on desktop.
 */
export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const state = usePlayerState();
  const sub = subNavFor(pathname);

  const right =
    state === undefined ? (
      <span className="h-11 w-24" aria-hidden />
    ) : state === null ? (
      pathname.startsWith("/play") || pathname === "/" ? null : (
        <Link href="/play" className="btn btn-sm hidden md:inline-flex">
          Found a stable
        </Link>
      )
    ) : (
      <div className="flex items-center gap-1">
        <span
          className="flex items-center gap-1 px-1 sm:gap-1.5 sm:px-2"
          title={`Stable entries for Live races: ${state.entries.balance} left (bank holds up to ${state.entries.cap}; +${state.entries.allowance} at local midnight)`}
        >
          <PixelIcon name="flag" size={16} />
          <span className="num text-base text-cream" data-testid="entries" aria-label={`${state.entries.balance} of ${state.entries.cap} stable entries left`}>
            {state.entries.balance}
            <span className="text-cream-dim">/{state.entries.cap}</span>
          </span>
        </span>
        <span className="flex items-center gap-1.5 px-2" title="Stable credits">
          <PixelIcon name="coin" size={16} />
          <span className="num text-base text-cream" data-testid="credits" aria-label={`${formatCredits(state.credits)} credits`}>
            {formatCredits(state.credits)}
          </span>
        </span>
        <Link
          href="/me"
          className={`flex h-11 w-11 items-center justify-center ${pathname.startsWith("/me") ? "bg-surface-2" : "hover:bg-surface-2"}`}
          aria-label={`${state.stableName}: profile and settings`}
          aria-current={pathname.startsWith("/me") ? "page" : undefined}
        >
          <SilksIcon silks={state.silks} className="h-8 w-8" />
        </Link>
      </div>
    );

  return (
    <>
      <a href="#main" className="sr-only z-50 bg-brass px-3 py-2 font-bold text-ink focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b-2 border-surface-2 bg-[#0a1b12]">
        <div className="mx-auto flex h-12 max-w-[75rem] items-center gap-3 px-4 md:h-14 md:px-6">
          <Link href="/" className="flex min-h-11 items-center gap-2" aria-label="Thoroughbred home">
            <Crest className="h-8 w-9" />
            <span className="display text-2xl leading-none text-cream max-[439px]:hidden md:max-lg:hidden">Thoroughbred</span>
          </Link>
          <nav className="ml-2 hidden h-full items-stretch gap-0.5 md:flex lg:ml-6 lg:gap-1" aria-label="Main">
            {SECTIONS.map(({ href, label, match }) => {
              const active = match(pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center px-3 text-base font-extrabold lg:px-4 ${active ? "text-cream" : "text-cream-dim hover:text-cream"}`}
                >
                  {label}
                  {active && <span aria-hidden className="absolute inset-x-3 bottom-0 h-[3px] bg-brass" />}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
            <FeedbackButton />
            {right}
          </div>
        </div>
        {sub && (
          <nav aria-label={`${sub.section.label} sections`} className="border-t-2 border-surface-2" data-testid="sub-nav">
            <ul className="mx-auto flex max-w-[75rem] gap-1 overflow-x-auto px-2 md:px-4">
              {sub.section.sub!.map((x) => {
                const active = x.href === sub.active;
                return (
                  <li key={x.href} className="shrink-0">
                    <Link
                      href={x.href}
                      aria-current={active ? "page" : undefined}
                      className={`relative flex min-h-11 items-center whitespace-nowrap px-2.5 text-sm font-extrabold sm:px-3 ${active ? "text-cream" : "text-cream-dim hover:text-cream"}`}
                    >
                      {x.label}
                      {active && <span aria-hidden className="absolute inset-x-2 bottom-0 h-[3px] bg-brass" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </header>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-surface-2 bg-[#0a1b12] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid h-14 grid-cols-5">
          {SECTIONS.map(({ href, label, icon, match }) => {
            const active = match(pathname);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex h-full flex-col items-center justify-center gap-0.5 text-xs font-extrabold ${active ? "text-cream" : "text-cream-dim"}`}
                >
                  {active && <span aria-hidden className="absolute left-1/2 top-[-2px] h-1 w-8 -translate-x-1/2 bg-brass" />}
                  <PixelIcon name={icon} size={32} className={`-my-1 ${active ? "" : "opacity-70 grayscale-[35%]"}`} />
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
