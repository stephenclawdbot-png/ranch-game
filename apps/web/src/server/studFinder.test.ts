/**
 * The stallion finder (src/server/economy.ts `studFinder`) against an in-memory PGlite
 * database: the ranking order (default: the best outlook by the internal public-facts score,
 * ties by fee; or the fee), that rows carry only words, one possible look and the fee (the
 * single preview's own words), the exclusion rules (the mare's close kin, stallions at a cover
 * limit, locked or leased-out studs), the per-(mare, day) cache, and the rate limit on fresh
 * computes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, createDb, insertHorse, previewPairing, seasonNumberAt, specFromGenome, stableOf, type DbHandle } from "@thoroughbred/db";
import * as gc from "@thoroughbred/game-core";
import { breedingPreview, standAtStud, STUD_FINDER_RUNS_PER_HOUR, studFinder } from "./economy";
import type { Session } from "./session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 2, 12, 0, 7));
const at = (ms: number) => new Date(T0.getTime() + ms);
const DAY = 86_400_000;
const SEASON = seasonNumberAt(T0);

async function player(name: string): Promise<Session> {
  const acc = await createAccount(h.db, { stableName: name, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "Europe/London", now: T0 });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
}

async function rows<T>(q: string): Promise<T[]> {
  const res = await h.db.execute(q);
  return (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];
}

/**
 * A mare for this stable, straight at breeding age (`retired`, the default) or still under the
 * 25-start rule (`racing`): the finder works for either.
 */
async function mareOf(p: Session, name: string, career: "retired" | "racing" = "retired"): Promise<string> {
  const genome = gc.generateFoundationGenome(gc.seedFrom("finder-mare", name), { season: SEASON });
  const id = await insertHorse(h.db, {
    stableId: p.stable.id,
    spec: specFromGenome({ genome, name, sex: "filly", careSessions: gc.CARE_TO_RACING, season: SEASON }),
    origin: "admin",
    now: T0,
  });
  if (career === "retired") await h.db.execute(`update horses set career_status = 'retired', retirement_reason = 'choice', retired_at = now() where id = '${id}'`);
  return id;
}

/** A retired entire stallion standing at stud (his own colt, or `stableId` null for the Club's). */
async function studOf(p: Session, name: string, fee: number): Promise<string> {
  const genome = gc.generateFoundationGenome(gc.seedFrom("finder-stud", name), { season: SEASON });
  const id = await insertHorse(h.db, {
    stableId: p.stable.id,
    spec: specFromGenome({ genome, name, sex: "colt", careSessions: gc.CARE_TO_RACING, season: SEASON }),
    origin: "admin",
    now: T0,
  });
  await h.db.execute(`update horses set career_status = 'retired', retirement_reason = 'choice', retired_at = now() where id = '${id}'`);
  await standAtStud(h.db, p, { horseId: id, fee });
  return id;
}

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

describe("stallion finder", () => {
  it("ranks every available stallion by the internal outlook score and shows only words, a look and the fee", async () => {
    const p = await player("Finder Home");
    const mare = await mareOf(p, "Ranked Mare");
    // A rival's stallions at stud, one of them standing for USDG only.
    const rival = await player("Finder Rival");
    const cheap = await studOf(rival, "Finder Cheap", 100);
    const dear = await studOf(rival, "Finder Dear", 200);
    await h.db.execute(`update horses set stud_fee = null, stud_fee_usdg = 40000000 where id = '${dear}'`);

    const f = await studFinder(h.db, p, { mareId: mare, pageSize: 50 }, T0);
    expect(f.mareName).toBe("Ranked Mare");
    expect(f.sort).toBe("outlook");
    const credits = f.rows.filter((r) => !r.usdgOnly);
    const usdg = f.rows.filter((r) => r.usdgOnly);
    // The Club's four house studs and the rival's credits stud are all ranked; the USDG-only
    // stud is listed too, but after every credits stud, with a USDG fee instead of a credits one.
    expect(credits.length).toBeGreaterThanOrEqual(5);
    expect(credits.some((r) => r.club)).toBe(true);
    expect(usdg.map((r) => r.id)).toEqual([dear]);
    expect(usdg[0]!).toMatchObject({ studFeeUsdg: 40_000_000, feeCredits: null });
    const cheapRow = credits.find((r) => r.id === cheap)!;
    expect(cheapRow).toMatchObject({ own: false, stableName: "Finder Rival", feeCredits: gc.BREEDING_BASE_FEE + 100 });
    // His ineligible stablemates (racing, under 25 starts) are not ranked: the stallion's block.
    expect(f.rows.some((r) => r.own)).toBe(false);
    expect(f.excluded).toBeGreaterThanOrEqual(2);

    // Every row: words, one possible look and the fee, nothing else; the single preview's own words.
    const score = new Map<string, number>();
    for (const row of f.rows) {
      expect(Object.keys(row).sort()).toEqual(["club", "feeCredits", "id", "look", "name", "nick", "outlook", "own", "stableName", "studFeeUsdg", "usdgOnly", "warnings"]);
      expect(Object.keys(row.look).sort()).toEqual(["appearance", "caption"]);
      expect(Object.keys(row.outlook).sort()).toEqual(["phrase", "tone"]);
      for (const w of [row.outlook.phrase, row.nick, row.look.caption, ...row.warnings]) expect(w).not.toMatch(/\d/);
      const pv = await breedingPreview(h.db, p, { sireId: row.id, damId: mare }, T0);
      expect(pv.block).toBeNull();
      expect(row.feeCredits).toBe(pv.usdgStudFee !== null ? null : pv.fees.totalPaidByMareOwner);
      expect(row.outlook).toEqual(pv.outlook); // the same sentence as the single preview
      expect(row.nick).toBe(pv.nick);
      expect(row.look).toEqual(pv.looks[0]);
      expect(row.warnings).toEqual(pv.warnings.filter((w) => w.tone === "warn").map((w) => w.text));
      // The internal score the ranking uses (server-side only).
      score.set(row.id, (await previewPairing(h.db, { accountId: p.accountId, sireId: row.id, damId: mare, now: T0 })).quality.score);
    }

    // Default sort: best outlook (internal score) first, ties by fee; credits before USDG.
    const fee = (r: (typeof f.rows)[number]) => r.feeCredits ?? r.studFeeUsdg ?? 0;
    const best = [...f.rows].sort((a, b) => (a.usdgOnly ? 1 : 0) - (b.usdgOnly ? 1 : 0) || score.get(b.id)! - score.get(a.id)! || fee(a) - fee(b) || (a.id < b.id ? -1 : 1));
    expect(f.rows.map((r) => r.id)).toEqual(best.map((r) => r.id));
    // The fee sort is a fresh request over the same cached day: cheapest credits stud first.
    const feeView = await studFinder(h.db, p, { mareId: mare, sort: "fee", pageSize: 50 }, at(3_600_000));
    expect(feeView.sort).toBe("fee");
    const feeExpected = [...f.rows].sort((a, b) => (a.usdgOnly ? 1 : 0) - (b.usdgOnly ? 1 : 0) || fee(a) - fee(b) || (a.id < b.id ? -1 : 1));
    expect(feeView.rows.map((r) => r.id)).toEqual(feeExpected.map((r) => r.id));
    expect(feeView.rows.filter((r) => !r.usdgOnly)[0]!.feeCredits).toBeLessThanOrEqual(gc.BREEDING_BASE_FEE + 100);
    // Old numeric sorts fall back to the best outlook.
    expect((await studFinder(h.db, p, { mareId: mare, sort: "coi", pageSize: 50 }, T0)).sort).toBe("outlook");
  });

  it("paginates the ranking and clamps out-of-range pages", async () => {
    const p = await player("Finder Pages");
    const mare = await mareOf(p, "Paged Mare");
    const full = await studFinder(h.db, p, { mareId: mare, pageSize: 50 }, T0);
    expect(full.total).toBeGreaterThan(2); // the house studs alone
    const half = Math.ceil(full.total / 2);
    const a = await studFinder(h.db, p, { mareId: mare, pageSize: half, page: 0 }, T0);
    const b = await studFinder(h.db, p, { mareId: mare, pageSize: half, page: 1 }, T0);
    expect([...a.rows, ...b.rows].map((r) => r.id)).toEqual(full.rows.map((r) => r.id));
    // Far beyond the last page: clamped to it, not empty.
    const last = await studFinder(h.db, p, { mareId: mare, pageSize: half, page: 99 }, T0);
    expect(last.page).toBe(Math.max(0, Math.ceil(full.total / half) - 1));
    expect(last.rows.map((r) => r.id)).toEqual(full.rows.slice(last.page * half).map((r) => r.id));
  });

  it("leaves out her close kin and stallions that cannot cover her", async () => {
    const p = await player("Finder Kin");
    const mare = await mareOf(p, "Kin Mare");
    const rival = await player("Finder Sires");
    const sire = await studOf(rival, "Her Own Sire", 100);
    const limit = await studOf(rival, "Cover Limit", 100);
    const listed = await studOf(rival, "Listed Stud", 100);
    const leased = await studOf(rival, "Leased Stud", 100);
    const plain = await studOf(rival, "Plain Stud", 100);
    // Her own sire: the pairing is parent-child kinship.
    await h.db.execute(`update horses set sire_id = '${sire}' where id = '${mare}'`);
    // At his cover limit: four covers this season.
    for (let i = 0; i < 4; i++) {
      const dam = await mareOf(rival, `Cover Dam ${i}`);
      await h.db.execute(
        `insert into breeding_events (sire_id, dam_id, requested_by, season_number, idempotency_key) values ('${limit}', '${dam}', '${rival.accountId}', ${SEASON}, 'finder-limit-${i}')`,
      );
    }
    // Locked (listed for sale) and away on lease. A market lock carries its listing's id.
    await h.db.execute(`update horses set lock_kind = 'market', lock_ref = '00000000-0000-0000-0000-0000000000ff' where id = '${listed}'`);
    await h.db.execute(`update horses set lessee_stable_id = '${p.stable.id}' where id = '${leased}'`);

    const f = await studFinder(h.db, p, { mareId: mare, pageSize: 50 }, T0);
    const ids = f.rows.map((r) => r.id);
    expect(ids).not.toContain(sire); // parent_child
    expect(ids).not.toContain(limit); // his per-season cover limit
    expect(ids).not.toContain(listed); // listed for sale
    expect(ids).not.toContain(leased); // away on lease
    expect(ids).toContain(plain); // nothing wrong with him
    expect(f.excluded).toBeGreaterThanOrEqual(4);
    // The single preview agrees about each one.
    for (const id of [sire, limit, listed, leased]) {
      expect((await breedingPreview(h.db, p, { sireId: id, damId: mare }, T0)).block).not.toBeNull();
    }
  });

  it("keeps her stallions ranked while she cannot be covered yet (her block is not his)", async () => {
    const p = await player("Finder Young");
    const mare = await mareOf(p, "Young Mare", "racing"); // of breeding age, but 0 of 25 starts
    const f = await studFinder(h.db, p, { mareId: mare, pageSize: 50 }, T0);
    expect(f.total).toBeGreaterThan(0);
    for (const row of f.rows) {
      const pv = await breedingPreview(h.db, p, { sireId: row.id, damId: mare }, T0);
      expect(pv.block).toBe("not_breeding_eligible"); // the mare's, so the row stays
    }
  });

  it("caches the day's ranking per mare: a fee change shows tomorrow, not today", async () => {
    const p = await player("Finder Cache");
    const mare = await mareOf(p, "Cached Mare");
    const rival = await player("Finder Fee");
    const stud = await studOf(rival, "Fee Stud", 100);
    const first = await studFinder(h.db, p, { mareId: mare, pageSize: 50 }, T0);
    expect(first.rows.find((r) => r.id === stud)!.feeCredits).toBe(gc.BREEDING_BASE_FEE + 100);
    await standAtStud(h.db, rival, { horseId: stud, fee: 200 });
    const sameDay = await studFinder(h.db, p, { mareId: mare, pageSize: 50 }, at(3_600_000));
    expect(sameDay.rows.find((r) => r.id === stud)!.feeCredits).toBe(gc.BREEDING_BASE_FEE + 100); // the day's cached answer
    const nextDay = await studFinder(h.db, p, { mareId: mare, pageSize: 50 }, at(DAY));
    expect(nextDay.rows.find((r) => r.id === stud)!.feeCredits).toBe(gc.BREEDING_BASE_FEE + 200);
  });

  it("rate-limits fresh computes per hour; cached answers always answer", { timeout: 60_000 }, async () => {
    const p = await player("Finder Limit");
    const mares: string[] = [];
    for (let i = 0; i <= STUD_FINDER_RUNS_PER_HOUR; i++) mares.push(await mareOf(p, `Limit Mare ${i}`));
    for (let i = 0; i < STUD_FINDER_RUNS_PER_HOUR; i++) {
      const f = await studFinder(h.db, p, { mareId: mares[i]! }, T0);
      expect(f.total + f.excluded).toBeGreaterThan(0);
    }
    // One more fresh compute this hour is over the limit.
    await expect(studFinder(h.db, p, { mareId: mares[STUD_FINDER_RUNS_PER_HOUR]! }, T0)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // The cached answers still come back, and don't count.
    const cached = await studFinder(h.db, p, { mareId: mares[0]!, sort: "fee" }, T0);
    expect(cached.sort).toBe("fee");
    expect(cached.total + cached.excluded).toBeGreaterThan(0);
    // The next window computes again (two windows on, the over-limit count has fully decayed).
    const later = await studFinder(h.db, p, { mareId: mares[STUD_FINDER_RUNS_PER_HOUR]! }, at(2 * 3_600_000));
    expect(later.total + later.excluded).toBeGreaterThan(0);
  });

  it("only ranks a mare of the stable", async () => {
    const p = await player("Finder Owner");
    const other = await player("Finder Other");
    await expect(studFinder(h.db, p, { mareId: await mareOf(other, "Other Mare") }, T0)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const colt = await mareOf(p, "Actually A Colt");
    await h.db.execute(`update horses set sex = 'male', gelded = false where id = '${colt}'`);
    await expect(studFinder(h.db, p, { mareId: colt }, T0)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(studFinder(h.db, p, { mareId: await mareOf(p, "Fine Mare") }, T0)).resolves.toMatchObject({ mareName: "Fine Mare" });
  });
});