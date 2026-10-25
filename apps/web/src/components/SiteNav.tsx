"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatCredits } from "@/lib/format";
import { usePlayerState } from "@/lib/player";
import { Crest, PixelIcon, type IconName } from "./icons";
import { SilksIcon } from "./Silks";

const TABS: { href: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { href: "/", label: "Home", icon: "home", match: (p) => p === "/" },
  { href: "/stable", label: "Stable", icon: "stable", match: (p) => p.startsWith("/stable") || p.startsWith("/horse") },
  { href: "/races", label: "Races", icon: "flag", match: (p) => p.startsWith("/races") || p.startsWith("/race/") },
];

/**
 * Top bar (crest, purse, your silks -> profile & settings) and the navigation:
 * a flat bottom tab bar on phones (brass notch on the active tab, not a filled button),
 * text tabs in the top bar on desktop.
 */
export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const state = usePlayerState();

  const right =
    state === undefined ? (
      <span className="h-11 w-24" aria-hidden />
    ) : state === null ? (
      pathname.startsWith("/play") ? null : (
        <Link href="/play" className="btn btn-sm hidden md:inline-flex">
          Found a stable
        </Link>
      )
    ) : (
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1.5 px-2" title="Stable credits">
          <PixelIcon name="coin" size={16} />
          <span className="num text-base text-cream" data-testid="credits" aria-label={`${formatCredits(state.progress.credits)} credits`}>
            {formatCredits(state.progress.credits)}
          </span>
        </span>
        <Link
          href="/me"
          className={`flex h-11 w-11 items-center justify-center ${pathname.startsWith("/me") ? "bg-surface-2" : "hover:bg-surface-2"}`}
          aria-label={`${state.player.stableName}: profile and settings`}
          aria-current={pathname.startsWith("/me") ? "page" : undefined}
        >
          <SilksIcon silks={state.player.silks} className="h-8 w-8" />
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
            <span className="display text-2xl leading-none text-cream max-[359px]:hidden">Thoroughbred</span>
          </Link>
          <nav className="ml-6 hidden h-full items-stretch gap-1 md:flex" aria-label="Main">
            {TABS.map(({ href, label, match }) => {
              const active = match(pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center px-4 text-base font-extrabold ${active ? "text-cream" : "text-cream-dim hover:text-cream"}`}
                >
                  {label}
                  {active && <span aria-hidden className="absolute inset-x-3 bottom-0 h-[3px] bg-brass" />}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">{right}</div>
        </div>
      </header>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-surface-2 bg-[#0a1b12] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid h-14 grid-cols-3">
          {TABS.map(({ href, label, icon, match }) => {
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
