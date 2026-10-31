/**
 * Radio commentary name clips (docs/commentary.md). Each horse name is voiced once per caster
 * at three intensities by the commentary-names GitHub workflow, uploaded here and kept for good;
 * the race viewer fetches a race's names from a long-cached public route. Until a name has a
 * clip the caster says the horse's saddle-cloth number instead.
 *
 * Nothing here knows about races: clips are keyed by the normalised name, the listing of
 * missing names reads horse names only, and the clips carry no race, horse or result data.
 */
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { DomainError } from "../errors";
import { commentaryNames, horses, raceEntries } from "../schema";
import type { Db } from "../types";

/** The voice recipe version (tools/commentary/recipe.py RECIPE_VERSION). */
export const COMMENTARY_RECIPE = 1;
/** The radio casters (race-viewer call/voice/casters.ts). */
export const COMMENTARY_CASTERS = ["bm_george", "bm_lewis", "bm_daniel"] as const;
export const COMMENTARY_INTENSITIES = ["calm", "building", "climax"] as const;
export type CommentaryIntensity = (typeof COMMENTARY_INTENSITIES)[number];
/** Largest accepted clip (a name is about 1 s: ~4 KB at 32 kbps). */
export const COMMENTARY_CLIP_MAX_BYTES = 32 * 1024;
export const COMMENTARY_CLIP_MIN_BYTES = 200;
/** Longest name voiced (game names are 3-18 characters; leaves room for older names). */
export const COMMENTARY_NAME_MAX = 40;
/** Horses that raced this recently are voiced even if retired (ghost races replay them). */
const RECENT_RACE_DAYS = 30;

/** The clip key for a name: Unicode-normalised, trimmed, single spaces, lowercase. */
export function commentaryNameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** True for bytes that start like an MP3 (an ID3 tag or an MPEG audio frame sync). */
export function looksLikeMp3(b: Uint8Array): boolean {
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true;
  return b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0;
}

export interface CommentaryClipUpload {
  name: string;
  caster: string;
  recipe: number;
  clips: Record<CommentaryIntensity, Buffer>;
}

/**
 * Stores one name's three clips for one caster (replacing any older render). Refuses unknown
 * casters, another recipe version, clips that are too small, too big or not MP3, and names no
 * horse has.
 */
export async function saveCommentaryName(db: Db, u: CommentaryClipUpload): Promise<{ key: string; bytes: number }> {
  const name = u.name.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name || name.length > COMMENTARY_NAME_MAX) throw new DomainError("INVALID_INPUT", "Bad name.");
  if (!(COMMENTARY_CASTERS as readonly string[]).includes(u.caster)) throw new DomainError("INVALID_INPUT", "Unknown caster.");
  if (u.recipe !== COMMENTARY_RECIPE) throw new DomainError("INVALID_INPUT", `Recipe ${u.recipe} is not the current recipe ${COMMENTARY_RECIPE}.`);
  let bytes = 0;
  for (const i of COMMENTARY_INTENSITIES) {
    const c = u.clips[i];
    if (!c || c.length < COMMENTARY_CLIP_MIN_BYTES || c.length > COMMENTARY_CLIP_MAX_BYTES || !looksLikeMp3(c)) {
      throw new DomainError("INVALID_INPUT", `The ${i} clip must be an MP3 of ${COMMENTARY_CLIP_MIN_BYTES}-${COMMENTARY_CLIP_MAX_BYTES} bytes.`);
    }
    bytes += c.length;
  }
  const key = commentaryNameKey(name);
  const [horse] = await db
    .select({ id: horses.id })
    .from(horses)
    .where(sql`lower(${horses.name}) = ${key}`)
    .limit(1);
  if (!horse) throw new DomainError("NOT_FOUND", "No horse has that name.");
  const row = { nameKey: key, caster: u.caster, name, recipe: u.recipe, calm: u.clips.calm, building: u.clips.building, climax: u.clips.climax, bytes };
  await db
    .insert(commentaryNames)
    .values(row)
    .onConflictDoUpdate({ target: [commentaryNames.nameKey, commentaryNames.caster], set: { name, recipe: u.recipe, calm: row.calm, building: row.building, climax: row.climax, bytes, createdAt: sql`now()` } });
  return { key, bytes };
}

/** One stored clip, or null (unknown name / caster, or rendered with another recipe). */
export async function getCommentaryClip(db: Db, key: string, caster: string, intensity: CommentaryIntensity, recipe = COMMENTARY_RECIPE): Promise<Buffer | null> {
  const [row] = await db
    .select({ clip: commentaryNames[intensity], recipe: commentaryNames.recipe })
    .from(commentaryNames)
    .where(and(eq(commentaryNames.nameKey, key), eq(commentaryNames.caster, caster)))
    .limit(1);
  if (!row || row.recipe !== recipe) return null;
  return Buffer.from(row.clip);
}

export interface MissingCommentaryName {
  name: string;
  key: string;
  /** Casters still without a clip of this name at the current recipe. */
  casters: string[];
}

/**
 * Names still to voice: horses that can race (or raced in the last 30 days: ghost races replay
 * them), most recently entered first, then the newest horses. Each with the casters missing.
 */
export async function missingCommentaryNames(db: Db, opts: { limit?: number; now?: Date } = {}): Promise<MissingCommentaryName[]> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  const since = new Date((opts.now ?? new Date()).getTime() - RECENT_RACE_DAYS * 86_400_000);
  const lastEntry = sql<Date | null>`(select max(${raceEntries.enteredAt}) from ${raceEntries} where ${raceEntries.horseId} = ${horses.id})`;
  const out: MissingCommentaryName[] = [];
  const seen = new Set<string>();
  // Scan candidates in pages until enough names are missing clips.
  for (let offset = 0; out.length < limit; offset += 1000) {
    const rows = await db
      .select({ name: horses.name })
      .from(horses)
      .where(
        or(
          eq(horses.careerStatus, "racing"),
          sql`exists (select 1 from ${raceEntries} where ${raceEntries.horseId} = ${horses.id} and ${raceEntries.enteredAt} >= ${since.toISOString()})`,
        ),
      )
      .orderBy(desc(sql`coalesce(${lastEntry}, 'epoch'::timestamptz)`), desc(horses.createdAt), horses.id)
      .limit(1000)
      .offset(offset);
    if (!rows.length) break;
    const fresh: Array<{ name: string; key: string }> = [];
    for (const r of rows) {
      const key = commentaryNameKey(r.name);
      if (!key || key.length > COMMENTARY_NAME_MAX || seen.has(key)) continue;
      seen.add(key);
      fresh.push({ name: r.name.trim().replace(/\s+/g, " "), key });
    }
    if (!fresh.length) continue;
    const have = await db
      .select({ key: commentaryNames.nameKey, caster: commentaryNames.caster })
      .from(commentaryNames)
      .where(and(inArray(commentaryNames.nameKey, fresh.map((f) => f.key)), eq(commentaryNames.recipe, COMMENTARY_RECIPE)));
    const done = new Set(have.map((h) => `${h.key}|${h.caster}`));
    for (const f of fresh) {
      const casters = COMMENTARY_CASTERS.filter((c) => !done.has(`${f.key}|${c}`));
      if (casters.length) out.push({ ...f, casters });
      if (out.length >= limit) break;
    }
    if (rows.length < 1000) break;
  }
  return out;
}

/** How many names have clips, and their total size (docs / admin). */
export async function commentaryNameStats(db: Db): Promise<{ rows: number; bytes: number }> {
  const [r] = await db.select({ rows: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${commentaryNames.bytes}), 0)::int` }).from(commentaryNames);
  return { rows: r?.rows ?? 0, bytes: r?.bytes ?? 0 };
}
