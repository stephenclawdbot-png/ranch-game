import { eq, sql } from "drizzle-orm";
import { createDb, type DbHandle } from "../client";
import { accounts, horses, raceEntries, races, type HorseRow } from "../schema";
import { createAccount, insertHorse } from "../services/accounts";
import { gc, specFromGenome, toHorseState } from "../gameCore";
import { createRace } from "../services/races";
import type { Db } from "../types";

export const T0 = new Date("2026-11-02T12:00:00.000Z");
export const MIN = 60_000;
export const DAY = 24 * 60 * MIN;
export const at = (ms: number) => new Date(T0.getTime() + ms);

export async function memoryDb(): Promise<DbHandle> {
  return createDb({ url: null, pglite: "memory" });
}

let n = 0;
export async function newPlayer(db: Db, opts: { credits?: number; starters?: number; now?: Date } = {}) {
  n++;
  return createAccount(db, {
    stableName: `Stable ${n}`,
    silks: { primary: "#112233", secondary: "#445566", pattern: "solid", cap: "#778899" },
    startingCredits: opts.credits ?? 5_000,
    starterHorses: opts.starters ?? 0,
    now: opts.now ?? T0,
  });
}

/** Inserts an unbound, racing-age horse with arbitrary overrides (test fixture). */
export async function makeHorse(
  db: Db,
  stableId: string | null,
  overrides: Partial<HorseRow> & { sex?: "male" | "female" } = {},
): Promise<HorseRow> {
  const name = overrides.name ?? `Horse ${++n}`;
  const genome = gc.generateFoundationGenome(gc.seedFrom("db-test", n, name), { season: 1 });
  const spec = specFromGenome({ genome, name, sex: (overrides.sex ?? "male") === "female" ? "filly" : "colt", careSessions: 19, season: 1 });
  const id = await insertHorse(db, {
    stableId,
    spec: { ...spec, rating: 0 },
    origin: "admin",
    sireId: overrides.sireId ?? null,
    damId: overrides.damId ?? null,
    now: T0,
  });
  const { id: _i, sex: _s, name: _n, sireId: _si, damId: _di, ...rest } = overrides;
  if (Object.keys(rest).length) await db.update(horses).set(rest).where(eq(horses.id, id));
  const [h] = await db.select().from(horses).where(eq(horses.id, id));
  return h!;
}

export async function getHorseRow(db: Db, id: string): Promise<HorseRow> {
  const [h] = await db.select().from(horses).where(eq(horses.id, id));
  return h!;
}

/** Makes an account an eligible seller: 8 days old, verified email, 20 settled races. */
export async function makeSeller(db: Db, accountId: string, stableId: string): Promise<void> {
  await db
    .update(accounts)
    .set({ createdAt: new Date(T0.getTime() - 8 * DAY), emailVerifiedAt: T0 })
    .where(eq(accounts.id, accountId));
  const house = await makeHorse(db, null);
  for (let i = 0; i < 20; i++) {
    const race = await createRace(db, {
      kind: "quick",
      name: `History ${i}`,
      raceClass: "maiden",
      conditions: {},
      postTime: new Date(T0.getTime() - (i + 1) * DAY),
      entriesCloseAt: new Date(T0.getTime() - (i + 1) * DAY - MIN),
    });
    await db.update(races).set({ status: "settled" }).where(eq(races.id, race.id));
    await db.insert(raceEntries).values({ raceId: race.id, horseId: house.id, stableId, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0 });
  }
}

export async function count(db: Db, table: string, where = "true"): Promise<number> {
  const res = await db.execute(sql.raw(`select count(*)::int as n from ${table} where ${where}`));
  const rows = (Array.isArray(res) ? res : (res as { rows: { n: number }[] }).rows) as { n: number }[];
  return Number(rows[0]!.n);
}

export async function settledAll<T>(ps: Promise<T>[]): Promise<{ ok: T[]; errors: unknown[] }> {
  const rs = await Promise.allSettled(ps);
  return {
    ok: rs.filter((r): r is PromiseFulfilledResult<Awaited<T>> => r.status === "fulfilled").map((r) => r.value as T),
    errors: rs.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason),
  };
}

/** Message chain of an error (drizzle wraps driver errors in `cause`). */
export function errorText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    parts.push(String((cur as Error).message ?? cur));
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.join(" <- ");
}

export async function expectDbError(p: Promise<unknown>, re: RegExp): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (!re.test(errorText(e))) throw new Error(`expected ${re}, got: ${errorText(e)}`);
    return;
  }
  throw new Error(`expected rejection matching ${re}`);
}

/** game-core listing floor for a horse (minimum legal listing price). */
export async function floorPrice(db: Db, horseId: string): Promise<number> {
  return gc.listingFloor(toHorseState(await getHorseRow(db, horseId)));
}
