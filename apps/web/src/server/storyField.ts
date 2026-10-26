/**
 * Story races on the server (§4e): who the house runners race for, how strong a chapter
 * field is, and what a settled story race pays and unlocks. Server-only; imported by game.ts
 * and horseView.ts (no imports back from them).
 *
 * A story race row carries `conditions.story`:
 *   { chapter, rivals: [rival stable ids], raceKey?: chapter race key, strength?: number }
 * - `rivals`: the named AI stables in the field. Each house runner is assigned one of them
 *   deterministically from its id (game-core `rivalFor`), so cards, silks and results agree.
 * - `raceKey` + `strength` (chapter races): at the field lock the house runners race as that
 *   rival stable's horses at the chapter strength (game-core `storyRivalRunner`), keeping the
 *   house horse's name and look. The locked field (and its hash) holds exactly what races:
 *   we choose the field, never the result.
 */
import type { Horse, RaceReplay, Silks } from "@thoroughbred/shared";
import * as gc from "@thoroughbred/game-core";
import { grantStoryReward, recordStoryResult, type Db, type PublicRace, type RaceEntryRow } from "@thoroughbred/db";
import { houseStableFor } from "./house";

export interface StoryMeta {
  chapter: gc.StoryChapter;
  rivals: string[];
  raceKey?: string;
  strength?: number;
}

export function storyMetaOf(race: Pick<PublicRace, "kind" | "conditions">): StoryMeta | null {
  if (race.kind !== "quick") return null;
  const s = ((race.conditions ?? {}) as { story?: Partial<StoryMeta> }).story;
  if (!s) return null;
  return {
    chapter: gc.isStoryChapter(s.chapter) ? s.chapter : "club",
    rivals: Array.isArray(s.rivals) ? s.rivals.filter((x): x is string => typeof x === "string") : [],
    raceKey: typeof s.raceKey === "string" && gc.storyRaceByKey(s.raceKey) ? s.raceKey : undefined,
    strength: typeof s.strength === "number" ? s.strength : undefined,
  };
}

export interface HouseOwner {
  name: string;
  trainer: string;
  silks: Silks;
  rivalId: string | null;
}

/** The stable a house runner races for in this race (a named rival in Story races). */
export function houseOwnerFor(race: Pick<PublicRace, "kind" | "conditions"> | null | undefined, horseId: string): HouseOwner {
  const meta = race ? storyMetaOf(race) : null;
  const rival = meta ? gc.rivalFor(meta.rivals, horseId) : undefined;
  if (rival) return { name: rival.name, trainer: rival.trainer, silks: rival.silks, rivalId: rival.id };
  const h = houseStableFor(horseId);
  return { name: h.name, trainer: h.trainer, silks: h.silks, rivalId: null };
}

/**
 * The engine Horse for a house runner in a chapter race (null for any other race): the
 * rival stable's honest runner at the chapter strength, with the house horse's id, name and
 * look in the rival's silks.
 */
export function storyHouseHorse(snapshot: Record<string, unknown>, race: Pick<PublicRace, "kind" | "conditions"> & { id: string }): Horse | null {
  const meta = storyMetaOf(race);
  if (!meta?.raceKey || meta.strength === undefined) return null;
  const def = gc.storyRaceByKey(meta.raceKey)!;
  const id = String(snapshot.id);
  const rival = gc.rivalFor(meta.rivals, id);
  const runner = gc.storyRivalRunner({ ...def, strength: meta.strength }, race.id, id, rival);
  const name = typeof snapshot.name === "string" && snapshot.name ? snapshot.name.slice(0, 32) : runner.name;
  const app = snapshot.appearance as Horse["appearance"] | undefined;
  const silks = rival?.silks ?? houseStableFor(id).silks;
  const appearance = app && typeof app === "object" && typeof app.coat === "string" ? { ...app, silks } : { ...runner.appearance, silks };
  return { ...runner, name, appearance };
}

export interface StorySettlement {
  amount: number;
  firstWin: boolean;
  licenceBefore?: number;
  licenceAfter?: number;
}

/**
 * Pays the capped Story reward and records chapter progress for every player runner of a
 * settled story race (idempotent: one reward per race, one first win per chapter race).
 */
export async function settleStoryRace(db: Db, race: PublicRace, entries: RaceEntryRow[], replay: RaceReplay): Promise<void> {
  const meta = storyMetaOf(race) ?? { chapter: "club" as const, rivals: [] };
  const c = (race.conditions ?? {}) as { distanceM?: number };
  for (const e of entries) {
    if (!e.stableId) continue;
    const snap = (e.snapshot ?? {}) as Record<string, unknown>;
    const accountId = typeof snap.accountId === "string" ? snap.accountId : null;
    if (!accountId) continue;
    const won = (replay.result.finishOrder.find((f) => f.horseId === e.horseId)?.position ?? 99) === 1;
    // Chapter races: first-win key = the race key. Open races: the chapter, class and trip.
    const storyKey = meta.raceKey ? `story:${meta.raceKey}` : `${meta.chapter}:${race.raceClass}:${c.distanceM ?? 0}`;
    await grantStoryReward(db, { accountId, raceId: race.id, storyKey, chapter: meta.chapter, won });
    if (meta.raceKey) await recordStoryResult(db, { accountId, raceId: race.id, raceKey: meta.raceKey, won, now: race.postTime });
  }
}
