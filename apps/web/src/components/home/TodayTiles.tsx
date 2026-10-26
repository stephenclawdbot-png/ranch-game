"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { HomeTiles } from "@/lib/homeTypes";
import { formatCountdown, ordinal } from "@/lib/format";
import { useNow } from "@/lib/clock";
import { PixelIcon, type IconName } from "../icons";
import { Section } from "../ui/Page";

interface Tile {
  key: string;
  icon: IconName;
  title: string;
  text: string;
  href: string;
  cta: string;
  /** Something is waiting for you. */
  ready?: boolean;
  /** Reward numeral shown on the right ("+80"). */
  reward?: string;
  /** Not available yet: dimmed, with its timer. */
  locked?: boolean;
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
      <Section id="today-h" title="Today">
        <div className="surface h-[8rem]" aria-busy />
      </Section>
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
            title: `Daily Cup: ${ordinal(c.mine.rank)} of ${c.entrants}`,
            text: `${c.name} · ${closes}`,
            href: `/cup/run/${c.mine.entryId}`,
            cta: "Watch your run",
          }
        : {
            key: "cup",
            icon: "trophy",
            title: c.canRun ? "Daily Cup" : "Daily Cup board",
            text: `${c.name.replace(/^Daily Cup · /, "")} · ${closes}`,
            href: "/cup",
            cta: c.canRun ? "Run" : "See the board",
            ready: c.canRun,
            reward: c.canRun ? `+${c.participationCredits}` : undefined,
          },
    );
  }
  if (tiles.giftFoal) {
    list.push({
      key: "gift",
      icon: "rosette",
      title: `A gift foal: ${tiles.giftFoal.name}`,
      text: "From the Club's broodmare. Foals grow with daily care.",
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
      title: `Groom ${n} ${n === 1 ? "horse" : "horses"}`,
      text: tiles.care.foals > 0 ? `${tiles.care.foals} ${tiles.care.foals === 1 ? "foal grows" : "foals grow"} with care. Skipping never hurts.` : "Builds bond. Skipping never hurts.",
      href: tiles.care.href,
      cta: tiles.care.href === "/nursery" ? "Open the nursery" : "Care",
    });
  }
  if (tiles.freePacks > 0) {
    list.push({
      key: "pack",
      icon: "paddock",
      title: tiles.freePacks > 1 ? `${tiles.freePacks} free Paddock Packs ready` : "Free Paddock Pack ready",
      text: "Earned by playing. Odds published.",
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
      text: `By ${tiles.foaling.sireName}. Name the foal.`,
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
      title: s.raceName,
      text: `Story · Chapter ${s.chapter}${s.bestHorse ? ` · suits ${s.bestHorse}` : ""}`,
      href: `/story#race-${s.raceKey}`,
      cta: "Race",
    });
  }
  if (!tiles.foaling && tiles.carrying && now !== null) {
    const left = tiles.carrying.dueAtMs - (now + skew);
    list.push({ key: "carrying", icon: "star", title: `${tiles.carrying.damName} is in foal`, text: left > 0 ? `Due in ${formatCountdown(left)}` : "Due now", href: "/breeding", cta: "Barn", locked: left > 0 });
  }
  if (list.length === 0) return null;

  const left = list.filter((t) => !t.locked).length;
  return (
    <Section id="today-h" title="Today" testId="today" aside={<span className="eyebrow">{left} to do</span>}>
      <ul className="surface rows">
        {list.map((t) => (
          <li key={t.key} className={t.locked ? "opacity-60" : ""}>
            <Link href={t.href} className="row-link gap-3 px-4 py-3" data-testid={`tile-${t.key}`} aria-label={`${t.title}: ${t.cta}`}>
              <PixelIcon name={t.icon} size={32} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="t-title block">{t.title}</span>
                <span className="t-meta block">{t.text}</span>
              </span>
              {t.reward ? (
                <span className="reward shrink-0">{t.reward}</span>
              ) : t.ready ? (
                <span className="tag tag-ready shrink-0">{t.cta}</span>
              ) : (
                <span className="chev shrink-0" aria-hidden>
                  ›
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
