"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatCredits } from "@/lib/format";
import { usePlayerState } from "@/lib/player";
import { CoinIcon, Crest, PaddockIcon, RacesIcon, StableIcon } from "./icons";
import { SilksIcon } from "./Silks";

const TABS = [
  { href: "/", label: "Paddock", Icon: PaddockIcon, match: (p: string) => p === "/" },
  { href: "/stable", label: "Stable", Icon: StableIcon, match: (p: string) => p.startsWith("/stable") || p.startsWith("/horse") },
  { href: "/races", label: "Races", Icon: RacesIcon, match: (p: string) => p.startsWith("/races") || p.startsWith("/race/") },
] as const;

export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const state = usePlayerState();

  const pill =
    state === undefined ? (
      <span className="h-9 w-28 rounded-full bg-cream/5" aria-hidden />
    ) : state === null ? (
      <Link href="/play" className="btn btn-brass !min-h-9 !px-4 text-sm">
        Found your stable
      </Link>
    ) : (
      <Link
        href="/stable"
        className="flex h-9 items-center gap-2 rounded-full border border-brass/30 bg-turf-900/80 pl-1.5 pr-3.5 text-sm transition-colors hover:border-brass/60"
        aria-label={`${state.player.stableName}: ${formatCredits(state.progress.credits)} credits`}
      >
        <SilksIcon silks={state.player.silks} className="h-6 w-6" />
        <span className="hidden max-w-[10rem] truncate text-cream-dim lg:inline">{state.player.stableName}</span>
        <span className="flex items-center gap-1 font-semibold text-brass-bright tabular" data-testid="credits">
          <CoinIcon className="h-4 w-4" />
          {formatCredits(state.progress.credits)}
        </span>
      </Link>
    );

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-brass/10 bg-turf-950/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6 md:h-16">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Thoroughbred home">
            <Crest className="h-8 w-8 md:h-9 md:w-9" />
            <span className="leading-none">
              <span className="display block text-[1.05rem] font-semibold tracking-wide text-cream md:text-lg">Thoroughbred</span>
              <span className="block text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-brass/80">Racing Club</span>
            </span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            {TABS.map(({ href, label, match }) => {
              const active = match(pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    active ? "text-cream" : "text-sage hover:text-cream"
                  }`}
                >
                  {label}
                  {active && <span className="absolute inset-x-4 -bottom-[13px] h-[2px] rounded-full bg-brass" />}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">{pill}</div>
        </div>
      </header>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-brass/15 bg-turf-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-3">
          {TABS.map(({ href, label, Icon, match }) => {
            const active = match(pathname);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-16 flex-col items-center justify-center gap-1 text-[0.7rem] font-medium tracking-wide ${
                    active ? "text-brass-bright" : "text-sage"
                  }`}
                >
                  <Icon className="h-6 w-6" />
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
