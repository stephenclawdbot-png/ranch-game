"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { HomeTiles } from "@/lib/homeTypes";
import { formatCountdown, ordinal } from "@/lib/format";
import { useNow } from "@/lib/clock";
import { PixelIcon, type IconName } from "../icons";
import { SectionHeader } from "../ui/SectionHeader";

interface Tile {
  key: string;
  icon: IconName;
  title: string;
  text: string;
  href: string;
  cta: string;
  /** Highlighted (something is waiting for you). */
  ready?: boolean;
}

/** Re-check the tiles this often while Home is open (and whenever the tab regains focus). */
const POLL_MS = 60_000;

/**
 * "Today" on Home: the few things worth doing, in priority order (the Daily Cup, the gift foal,
 * care, a free pack, a mare ready to foal, the next Story race). Secondary to the hero action.
 */
export function TodayTiles({ refreshKey }: { refreshKey?: string }) {
  const [tiles, setTiles] = useState<HomeTiles | null | undefined>(undefined);
  const now = useNow(1000);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/home", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setTiles(((await res.json()) as { tiles: HomeTiles }).tiles);
    } catch {
      setTiles((t) => (t === undefined ? null : t));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, refreshKey]);

  if (tiles === undefined) {
    return (
      <section aria-labelledby="today-h" aria-busy>
        <SectionHeader id="today-h" title="Today" />
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="surface h-[4.75rem]" aria-hidden />
          ))}
        </ul>
      </section>
    );
  }
  if (tiles === null) return null;

  const skew = now === null ? 0 : tiles.serverNowMs - Date.now();
  const list: Tile[] = [];
  if (tiles.cup) {
    const c = tiles.cup;
    const left = now === null ? null : c.closesAtMs - (now + skew);
    const closes = left === null ? "" : left > 0 ? `closes in ${formatCountdown(left)}` : "closed";
    list.push(
      c.mine
        ? {
            key: "cup",
            icon: "trophy",
            title: `Daily Cup: you're ${ordinal(c.mine.rank)} of ${c.entrants}`,
            text: `${c.name} · ${closes}`,
            href: `/cup/run/${c.mine.entryId}`,
            cta: "Watch your run",
          }
        : {
            key: "cup",
            icon: "trophy",
            title: c.canRun ? `Take your Cup Run (+${c.participationCredits})` : "Daily Cup",
            text: `${c.name} · ${c.entrants} ${c.entrants === 1 ? "entrant" : "entrants"} · ${closes}`,
            href: "/cup",
            cta: c.canRun ? "Run" : "See the board",
            ready: c.canRun,
          },
    );
  }
  if (tiles.giftFoal) {
    list.push({
      key: "gift",
      icon: "rosette",
      title: `A gift from the Club: ${tiles.giftFoal.name}`,
      text: "A foal from the Club's broodmare. Foals grow through daily care, never by the clock.",
      href: `/horse/${tiles.giftFoal.id}/care`,
      cta: "Care for the foal",
      ready: true,
    });
  }
  if (tiles.care) {
    const n = tiles.care.count;
    list.push({
      key: "care",
      icon: "horseshoe",
      title: `Care today: ${n} ${n === 1 ? "horse" : "horses"}`,
      text: tiles.care.foals > 0 ? `${tiles.care.foals} ${tiles.care.foals === 1 ? "foal grows" : "foals grow"} with each day's care. Missing a day never hurts.` : "Feed, groom and turn out: bond and condition. Missing a day never hurts.",
      href: tiles.care.href,
      cta: tiles.care.href === "/nursery" ? "Open the nursery" : "Care",
    });
  }
  if (tiles.freePacks > 0) {
    list.push({
      key: "pack",
      icon: "paddock",
      title: tiles.freePacks > 1 ? `${tiles.freePacks} free Paddock Packs ready` : "Free Paddock Pack ready",
      text: "Earned by playing. Published odds; every pull is verifiable.",
      href: "/packs",
      cta: "Open",
      ready: true,
    });
  }
  if (tiles.foaling) {
    list.push({
      key: "foaling",
      icon: "star",
      title: `${tiles.foaling.damName} is ready to foal`,
      text: `By ${tiles.foaling.sireName}. Name the foal and meet it in the barn.`,
      href: "/breeding",
      cta: "Meet the foal",
      ready: true,
    });
  }
  if (tiles.story) {
    const s = tiles.story;
    list.push({
      key: "story",
      icon: "flag",
      title: `Story: ${s.raceName}`,
      text: `Chapter ${s.chapter}, ${s.chapterTitle} · ${s.wins}/${s.winsToComplete} wins${s.bestHorse ? ` · suits ${s.bestHorse}` : ""}`,
      href: `/story#race-${s.raceKey}`,
      cta: "Race",
    });
  }
  if (!tiles.foaling && tiles.carrying && now !== null) {
    const left = tiles.carrying.dueAtMs - (now + skew);
    list.push({ key: "carrying", icon: "star", title: `${tiles.carrying.damName} is in foal`, text: left > 0 ? `Due in ${formatCountdown(left)}` : "Due now", href: "/breeding", cta: "Barn" });
  }
  if (list.length === 0) return null;

  return (
    <section aria-labelledby="today-h" data-testid="today">
      <SectionHeader id="today-h" title="Today" />
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              className={`${t.ready ? "surface-2 ring-2 ring-brass/60" : "surface"} group flex h-full items-center gap-3 p-3 hover:brightness-110`}
              data-testid={`tile-${t.key}`}
            >
              <PixelIcon name={t.icon} size={32} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold leading-tight text-cream group-hover:underline">{t.title}</span>
                <span className="t-meta mt-0.5 block">{t.text}</span>
              </span>
              <span className="shrink-0 text-sm font-extrabold text-cream" aria-hidden>
                <span className="hidden sm:inline">{t.cta} </span>›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
