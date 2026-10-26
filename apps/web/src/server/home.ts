/**
 * Home tiles (design-research §11.9): the few things worth doing today, in priority order,
 * built from the area views. Signed-in only; each tile is null when there is nothing to do.
 * No race outcome is ever in here (the Live/result hero stays on the inbox, without spoilers).
 */
import { careDayOf, lastCareDays, listStableHorses } from "@thoroughbred/db";
import type { HomeTiles } from "@/lib/homeTypes";
import { cupView } from "./competition";
import type { Db } from "./db";
import { breedingView, packsView } from "./economy";
import { nurseryView } from "./horseLife";
import type { Session } from "./session";
import { storyView } from "./story";

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error(`home tile ${label}`, err);
    return null;
  }
}

export async function homeTiles(db: Db, session: Session, now: Date): Promise<HomeTiles> {
  const nowMs = now.getTime();
  const [cup, nursery, packs, breeding, story] = [
    await safe("cup", () => cupView(db, session, now)),
    await safe("nursery", () => nurseryView(db, session, now)),
    await safe("packs", () => packsView(db, session, now)),
    await safe("breeding", () => breedingView(db, session, now)),
    await safe("story", () => storyView(db, session, now)),
  ];

  // Care: every horse can have one care session per local day (foals grow only through it).
  const rows = (await listStableHorses(db, session.stable.id)).filter((r) => r.careerStatus !== "pasture");
  let care: HomeTiles["care"] = null;
  if (nursery && nursery.uncared > 0) {
    const day = await careDayOf(db, session.accountId, now);
    const last = await lastCareDays(db, rows.map((r) => r.id));
    const uncared = rows.filter((r) => !((last.get(r.id) ?? "") >= day));
    const foals = nursery.foals.filter((f) => !f.care.caredToday).length;
    // One grown horse left: straight to its care tab. Otherwise the nursery ("Care for all").
    const href = uncared.length === 1 && foals === 0 ? `/horse/${uncared[0]!.id}/care` : "/nursery";
    care = { count: uncared.length, foals, href };
  }

  // The Club's day-2 gift foal, until its first care session.
  const giftRow = rows.find((r) => r.origin === "gift" && r.careSessions === 0) ?? null;

  const due = breeding?.pregnancies.find((p) => p.status === "carrying" && p.dueAtMs <= nowMs) ?? null;
  const carrying = breeding?.pregnancies.find((p) => p.status === "carrying" && p.dueAtMs > nowMs) ?? null;

  let storyTile: HomeTiles["story"] = null;
  if (story) {
    const ch = story.chapters.find((c) => c.id === story.current) ?? story.chapters.find((c) => c.current) ?? null;
    const race = ch?.races.find((r) => !r.won) ?? null;
    if (ch && race) {
      storyTile = { chapter: ch.number, chapterTitle: ch.title, raceKey: race.key, raceName: race.name, wins: ch.wins, winsToComplete: ch.winsToComplete, bestHorse: race.bestHorse?.name ?? null };
    }
  }

  return {
    serverNowMs: nowMs,
    cup: cup
      ? {
          name: cup.conditions.name,
          closesAtMs: cup.closesAtMs,
          entrants: cup.entrants,
          participationCredits: cup.participationCredits,
          mine: cup.mine ? { rank: cup.mine.rank, entryId: cup.mine.entryId, badge: cup.mine.badge } : null,
          canRun: !cup.mine && !!cup.horses?.some((h) => h.block === null),
        }
      : null,
    care,
    freePacks: packs && packs.paddock.freeAvailable > 0 ? packs.paddock.freeAvailable : 0,
    foaling: due ? { pregnancyId: due.id, damName: due.damName, sireName: due.sireName } : null,
    carrying: carrying ? { damName: carrying.damName, dueAtMs: carrying.dueAtMs } : null,
    story: storyTile,
    giftFoal: giftRow ? { id: giftRow.id, name: giftRow.name } : null,
  };
}
