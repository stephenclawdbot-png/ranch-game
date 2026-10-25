"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatCredits } from "@/lib/format";
import { usePlayerState } from "@/lib/player";
import { Crest, PixelIcon, type IconName } from "./icons";
import { SilksIcon } from "./Silks";

const TABS: { href: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { href: "/", label: "Paddock", icon: "paddock", match: (p) => p === "/" },
  { href: "/stable", label: "Stable", icon: "stable", match: (p) => p.startsWith("/stable") || p.startsWith("/horse") },
  { href: "/races", label: "Races", icon: "flag", match: (p) => p.startsWith("/races") || p.startsWith("/race/") },
];

/** Brass pixel trim under the top bar: a 2-row stepped stripe. */
function Trim() {
  return (
    <div aria-hidden className="h-[6px] w-full" style={{ background: "linear-gradient(#d9a441 0 2px, #9a6b22 2px 4px, #050906 4px 6px)" }} />
  );
}

export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const state = usePlayerState();

  const purse =
    state === undefined ? (
      <span className="h-10 w-28" aria-hidden />
    ) : state === null ? (
      <Link href="/play" className="btn btn-brass btn-sm">
        Found your stable
      </Link>
    ) : (
      <Link
        href="/stable"
        className="chip !gap-2 !py-1 !pl-1 !pr-2.5 hover:brightness-110"
        aria-label={`${state.player.stableName}: ${formatCredits(state.progress.credits)} credits`}
      >
        <SilksIcon silks={state.player.silks} className="h-7 w-7" />
        <span className="hidden max-w-[10rem] truncate font-sans text-sm text-cream-dim lg:inline">{state.player.stableName}</span>
        <span className="num flex items-center gap-1.5 text-lg leading-none text-brass-bright" data-testid="credits">
          <PixelIcon name="coin" className="h-5 w-5" />
          {formatCredits(state.progress.credits)}
        </span>
      </Link>
    );

  return (
    <>
      <header className="sticky top-0 z-40 bg-[#0c2117]/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-3 sm:px-6 md:h-16">
          <Link href="/" className="group flex items-center gap-2.5" aria-label="Thoroughbred home">
            <Crest className="h-9 w-9 transition-transform group-hover:-translate-y-0.5 md:h-10 md:w-10" />
            <span className="leading-none">
              <span className="display block text-[1.15rem] tracking-wide text-cream md:text-[1.35rem]">THOROUGHBRED</span>
              <span className="mt-0.5 block font-[family-name:var(--font-pixel)] text-[8px] uppercase tracking-[0.3em] text-brass">Racing Club</span>
            </span>
          </Link>
          <nav className="ml-4 hidden items-end gap-1 self-end md:flex" aria-label="Main">
            {TABS.map(({ href, label, icon, match }) => {
              const active = match(pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`display flex items-center gap-2 px-4 pb-2.5 pt-2 text-[1.05rem] transition-colors ${
                    active ? "bg-[#d9a441] text-[#241505] [text-shadow:none]" : "text-sage hover:bg-[#163a28] hover:text-cream"
                  }`}
                  style={{
                    clipPath: "polygon(0 6px, 3px 6px, 3px 3px, 6px 3px, 6px 0, calc(100% - 6px) 0, calc(100% - 6px) 3px, calc(100% - 3px) 3px, calc(100% - 3px) 6px, 100% 6px, 100% 100%, 0 100%)",
                  }}
                >
                  <PixelIcon name={icon} className="h-5 w-5" />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">{purse}</div>
        </div>
        <Trim />
      </header>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 md:hidden">
        <div aria-hidden className="h-[6px]" style={{ background: "linear-gradient(#050906 0 2px, #9a6b22 2px 4px, #d9a441 4px 6px)" }} />
        <ul className="grid grid-cols-3 gap-1.5 bg-[#0c2117] px-2 pb-[calc(env(safe-area-inset-bottom)+6px)] pt-1.5">
          {TABS.map(({ href, label, icon, match }) => {
            const active = match(pathname);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`btn !flex h-[3.6rem] w-full !flex-col !gap-0.5 !px-1 !text-[0.8rem] ${active ? "btn-brass" : ""}`}
                >
                  <PixelIcon name={icon} className={`h-6 w-6 ${active ? "animate-bob" : ""}`} />
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
