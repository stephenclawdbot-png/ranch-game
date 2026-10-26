/**
 * The horse registry: unique names and public registration numbers.
 *
 * Rules (game-core `naming.ts` has the format rules and the profanity list):
 *  - A name is *in use* while any active horse carries it (case-insensitive, trimmed): every
 *    horse that isn't a Legend on the Legacy Farm. Horses never die in this game, so a Legacy
 *    Farm Legend is the closest thing to "no longer racing or breeding", and frees its name.
 *  - Hall of Fame names are retired for good: any horse inducted into the Hall keeps its name
 *    to itself forever.
 *  - Player-chosen names (foals, renames before the first start) are validated (2-18
 *    characters, letters, no profanity) and rejected with a friendly message when taken.
 *  - System-chosen names (starters, packs, Club horses, gift foals) quietly pick a free
 *    alternative when the first choice is taken.
 *
 * Enforcement is a transactional check under a per-name advisory lock rather than a unique
 * index: production and preview share one database, older code paths still insert horses,
 * and a few historical duplicates are grandfathered. Concurrent claims of the same name
 * serialise on the lock; system names use try-locks so two transactions can never deadlock.
 */
import { sql } from "drizzle-orm";
import { gc } from "../gameCore";
import { DomainError } from "../errors";
import type { Executor } from "../types";
import { rowsOf } from "./tx";

export type NameUse = "active" | "hall_of_fame";

export interface NameCheckResult {
  ok: boolean;
  /** Normalised name (when the format is valid). */
  name?: string;
  problem?: gc.HorseNameProblem | "TAKEN" | "RETIRED";
  message?: string;
}

const lockKey = (key: string) => sql`hashtext(${"horse-name:" + key})`;

/** Who (if anyone) holds this name: an active horse, or a retired Hall of Fame name. */
export async function nameInUse(ex: Executor, name: string, opts: { exceptHorseId?: string } = {}): Promise<NameUse | null> {
  const key = gc.nameKey(name);
  const except = opts.exceptHorseId ?? "00000000-0000-0000-0000-000000000000";
  const rows = rowsOf<{ hall: boolean; active: boolean }>(
    await ex.execute(sql`
      select
        exists (select 1 from hall_of_fame hf join horses h on h.id = hf.horse_id
                 where lower(h.name) = ${key} and h.id <> ${except}::uuid) as hall,
        exists (select 1 from horses h
                 where lower(h.name) = ${key} and h.career_status <> 'pasture' and h.id <> ${except}::uuid) as active`),
  );
  const r = rows[0];
  if (r?.hall) return "hall_of_fame";
  if (r?.active) return "active";
  return null;
}

function takenMessage(name: string, use: NameUse): string {
  return use === "hall_of_fame"
    ? `“${name}” is a Hall of Fame name, retired for good. Try another.`
    : `There’s already a horse called “${name}”. Names are unique, so try another.`;
}

/** Format + availability check for the naming forms (no lock: advisory only). */
export async function checkHorseName(ex: Executor, raw: string, opts: { exceptHorseId?: string } = {}): Promise<NameCheckResult> {
  const v = gc.validateHorseName(raw);
  if (!v.ok) return { ok: false, problem: v.problem, message: v.message };
  const use = await nameInUse(ex, v.name, opts);
  if (use) return { ok: false, name: v.name, problem: use === "hall_of_fame" ? "RETIRED" : "TAKEN", message: takenMessage(v.name, use) };
  return { ok: true, name: v.name };
}

/**
 * Claims a player-chosen name inside the caller's transaction: validates it, takes the
 * per-name lock (held until commit) and rejects it when in use. Returns the normalised name.
 */
export async function claimChosenName(ex: Executor, raw: string, opts: { exceptHorseId?: string } = {}): Promise<string> {
  const v = gc.validateHorseName(raw);
  if (!v.ok) throw new DomainError("INVALID_INPUT", v.message, { problem: v.problem });
  await ex.execute(sql`select pg_advisory_xact_lock(${lockKey(gc.nameKey(v.name))})`);
  const use = await nameInUse(ex, v.name, opts);
  if (use) throw new DomainError("NAME_TAKEN", takenMessage(v.name, use), { problem: use === "hall_of_fame" ? "RETIRED" : "TAKEN" });
  return v.name;
}

/**
 * Picks a free name for a system-named horse: the preferred name if free, else the first
 * free deterministic alternative (game-core `alternativeNames`). Never throws for lack of
 * names: in the (practically impossible) case that every candidate is taken, the preferred
 * name is used as a grandfathered duplicate.
 */
export async function claimSystemName(ex: Executor, preferred: string, seed: string): Promise<string> {
  const base = gc.normalizeHorseName(preferred).slice(0, 32) || "Kestrel Lad";
  const candidates = [base];
  for (let round = 0; round < 4; round++) candidates.push(...gc.alternativeNames(base, `${seed}|${round}`));
  // One query to drop the obviously taken ones, then lock + re-check the survivors in order.
  const keys = [...new Set(candidates.map((c) => gc.nameKey(c)))];
  const taken = new Set(
    rowsOf<{ k: string }>(
      await ex.execute(sql`
        select lower(h.name) as k from horses h
         where lower(h.name) in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)}) and h.career_status <> 'pasture'
        union
        select lower(h.name) from hall_of_fame hf join horses h on h.id = hf.horse_id
         where lower(h.name) in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`),
    ).map((r) => r.k),
  );
  for (const c of candidates) {
    const key = gc.nameKey(c);
    if (taken.has(key)) continue;
    const got = rowsOf<{ ok: boolean }>(await ex.execute(sql`select pg_try_advisory_xact_lock(${lockKey(key)}) as ok`))[0];
    if (!got?.ok) continue;
    if (!(await nameInUse(ex, c))) return c;
  }
  return base;
}
