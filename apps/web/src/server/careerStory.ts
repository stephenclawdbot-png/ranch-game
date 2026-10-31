/**
 * The career story on the horse page and GET /api/horses/[id]/story: packages/db careerStory.ts
 * reads (one fixed query set, public results only), game-core careerStory writes the lines.
 * Public like the horse page itself: nothing private is read.
 */
import { careerStoryOf, getHorse, type Db, type HorseRow } from "@thoroughbred/db";
import type { CareerStoryView } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The story of a horse row already loaded (the horse page). */
export async function horseCareerStory(db: Db, row: HorseRow, now: Date): Promise<CareerStoryView> {
  const entries = await careerStoryOf(db, row, now);
  return { entries: entries.map((e) => ({ key: e.key, kind: e.kind, atMs: e.atMs, text: e.text, raceId: e.raceId, horseId: e.horseId, highlight: e.highlight })) };
}

/** The story by horse id; null when there is no such horse. */
export async function careerStoryById(db: Db, horseId: string, now: Date): Promise<CareerStoryView | null> {
  if (!UUID_RE.test(horseId)) return null;
  const row = await getHorse(db, horseId);
  return row ? horseCareerStory(db, row, now) : null;
}
