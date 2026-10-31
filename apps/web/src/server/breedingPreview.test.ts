/**
 * The breeding preview's answer (owner decision 2026-10-31: possible looks, an outlook in words,
 * warnings in words; no genes, odds or numbers but the fees) against an in-memory PGlite
 * database: the response shape, no numeric odds anywhere, the same samples all day, and that a
 * horse's hidden alleles can't move it (so previewing can't reveal them). The finder's rows are
 * checked the same way in studFinder.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, createDb, getHorse, insertHorse, seasonNumberAt, specFromGenome, stableOf, type DbHandle } from "@thoroughbred/db";
import * as gc from "@thoroughbred/game-core";
import { breedingPreview, standAtStud } from "./economy";
import type { Session } from "./session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 2, 12, 0, 7));
const at = (ms: number) => new Date(T0.getTime() + ms);
const DAY = 86_400_000;
const SEASON = seasonNumberAt(T0);

/** Key names that would carry odds, genes or the numbers behind the words. */
const FORBIDDEN_KEY = /permille|percent|odds|prob|^p\d0$|grade|score|coi|allele|genome|genes|^stats$|overall|beats|below|limits|mutation|quality|centre|spread|parents|population|^mstn$|^size$|^traits$|^coats$|hidden|distance|surface|^style$|maturity/i;

/**
 * Every path in `x` holding a number, and every key name in it, except inside a portrait's
 * `appearance` (what the renderer draws: coat, layered colour, markings, silks).
 */
function scan(x: unknown, path = ""): { numbers: string[]; keys: string[] } {
  const out = { numbers: [] as string[], keys: [] as string[] };
  const walk = (v: unknown, p: string) => {
    if (typeof v === "number") out.numbers.push(p);
    else if (Array.isArray(v)) v.forEach((e, i) => walk(e, `${p}.${i}`));
    else if (v && typeof v === "object")
      for (const [k, e] of Object.entries(v)) {
        if (k === "appearance") continue;
        out.keys.push(k);
        walk(e, p ? `${p}.${k}` : k);
      }
  };
  walk(x, path);
  return out;
}

async function player(name: string): Promise<Session> {
  const acc = await createAccount(h.db, { stableName: name, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "Europe/London", now: T0 });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
}

async function horse(p: Session, name: string, sex: "colt" | "filly"): Promise<string> {
  const genome = gc.generateFoundationGenome(gc.seedFrom("preview-test", name), { season: SEASON, rarity: "rare" });
  const id = await insertHorse(h.db, { stableId: p.stable.id, spec: specFromGenome({ genome, name, sex, careSessions: gc.CARE_TO_RACING, season: SEASON }), origin: "admin", now: T0 });
  await h.db.execute(`update horses set career_status = 'retired', retirement_reason = 'choice', retired_at = now() where id = '${id}'`);
  return id;
}

/**
 * Rewrites a horse's hidden genes in place, keeping everything public: each stat pair becomes a
 * homozygous pair of the same expressed value, vigour likewise, quirks flipped, a recessive
 * big-heart copy added, body shape and rig variants changed.
 */
async function rewriteHiddenGenes(id: string): Promise<void> {
  const g = gc.upgradeGenome((await getHorse(h.db, id))!.genome)!;
  const stats = {} as gc.Genome["stats"];
  for (const k of gc.STAT_KEYS) {
    const v = gc.locusValue(g.stats[k]);
    stats[k] = [v, v];
  }
  const vg = gc.vigourValue(g.vigour);
  const flip = (q: readonly [0 | 1, 0 | 1]): [0 | 1, 0 | 1] => [q[0] ? 0 : 1, q[1] ? 0 : 1];
  const twin: gc.Genome = {
    ...g,
    stats,
    vigour: [vg, vg],
    quirks: { mudlark: flip(g.quirks.mudlark), gateShy: flip(g.quirks.gateShy), lateKick: flip(g.quirks.lateKick), crowdShy: flip(g.quirks.crowdShy) },
    genes2: { ...g.genes2, bigHeart: g.genes2.bigHeart[0] === "bh" && g.genes2.bigHeart[1] === "bh" ? g.genes2.bigHeart : ["bh", "n"] },
    morph: { ...g.morph, legLength: [-g.morph.legLength[0], -g.morph.legLength[1]], girth: [g.morph.girth[1], g.morph.girth[0]] },
    variants: { head: [7, 7], mane: [6, 6], tail: [5, 5], build: [4, 4] },
  };
  expect(gc.potentials(twin)).toEqual(gc.potentials(g)); // nothing public moved
  await h.db.execute(`update horses set genome = '${JSON.stringify(twin)}'::jsonb where id = '${id}'`);
}

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

describe("breeding preview answer", () => {
  it("is looks, words and fees: no genes, odds or numbers behind the words", async () => {
    const p = await player("Preview Shape");
    const rival = await player("Preview Rival");
    const mare = await horse(p, "Shape Mare", "filly");
    const stud = await horse(rival, "Shape Stud", "colt");
    await standAtStud(h.db, rival, { horseId: stud, fee: 400 });
    const pv = await breedingPreview(h.db, p, { sireId: stud, damId: mare }, T0);
    expect(pv.block).toBeNull();
    expect(Object.keys(pv).sort()).toEqual(
      ["block", "breed", "certainty", "credits", "damId", "damName", "fees", "looks", "looksNote", "nick", "outlook", "ownSire", "reason", "sireId", "sireName", "stallionOwner", "usdgFee", "usdgStudFee", "versusMare", "warnings"].sort(),
    );
    const { numbers, keys } = scan(pv);
    // The only numbers: fees and the purse.
    expect(numbers.filter((n) => !/^fees\.|^credits$|^usdgStudFee$|^usdgFee$/.test(n))).toEqual([]);
    expect(keys.filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
    // Words: none of them carries a digit.
    const words = [pv.outlook.phrase, pv.versusMare.phrase, pv.certainty.phrase, pv.nick, pv.breed, pv.looksNote, ...pv.warnings.map((w) => w.text), ...pv.looks.map((l) => l.caption)];
    for (const w of words) expect(w).not.toMatch(/\d/);
    expect(Object.values(gc.OUTLOOK_PHRASES)).toContain(pv.outlook.phrase);
    expect(pv.looksNote).toBe("Foals from this pairing could look like this. It's still a chance.");
    expect(pv.looks).toHaveLength(4);
    for (const l of pv.looks) expect(l.appearance.coat).toBeTruthy();
    expect(pv.fees).toMatchObject({ studFee: 400, totalPaidByMareOwner: gc.BREEDING_BASE_FEE + 400 });
  });

  it("shows the same samples all day and new ones the next day", async () => {
    const p = await player("Preview Day");
    const mare = await horse(p, "Day Mare", "filly");
    const stud = await horse(p, "Day Stud", "colt");
    const morning = await breedingPreview(h.db, p, { sireId: stud, damId: mare }, T0);
    const evening = await breedingPreview(h.db, p, { sireId: stud, damId: mare }, at(8 * 3_600_000));
    expect(evening.looks).toEqual(morning.looks);
    expect(evening.outlook).toEqual(morning.outlook);
    const later = await Promise.all([1, 2, 3].map((d) => breedingPreview(h.db, p, { sireId: stud, damId: mare }, at(d * DAY))));
    expect(later.some((v) => JSON.stringify(v.looks) !== JSON.stringify(morning.looks))).toBe(true);
  });

  it("doesn't move when only a horse's hidden alleles change (nothing to read off it)", async () => {
    const p = await player("Preview Twins");
    const rival = await player("Preview Twin Stud");
    const mare = await horse(p, "Twin Mare", "filly");
    const stud = await horse(rival, "Twin Stud", "colt");
    await standAtStud(h.db, rival, { horseId: stud, fee: 100 });
    const before = await breedingPreview(h.db, p, { sireId: stud, damId: mare }, T0);
    await rewriteHiddenGenes(stud);
    await rewriteHiddenGenes(mare);
    const after = await breedingPreview(h.db, p, { sireId: stud, damId: mare }, T0);
    expect(after).toEqual(before);
  });
});
