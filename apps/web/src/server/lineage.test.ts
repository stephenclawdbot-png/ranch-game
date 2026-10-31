/**
 * Lineage end to end (owner: "make sure ranches + genetics breed horses kind works ok"): real
 * pairings through the server (cover, foal, name) across breeds and seasons, then the next
 * generation from those foals. Checks the family limits (game-core familyRange) on the real
 * database path, the family limits (internal exact odds), the player's preview in words, the foals' genetics (breed mix, coat appearance) and that
 * the Ranch can lay them out and recolour them. RANCH_EXPORT=<file> writes the foals' stable
 * views (for a visual check of the Ranch).
 */
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, createDb, getHorse, schema, stableOf, toHorseState, type DbHandle } from "@thoroughbred/db";
import * as gc from "@thoroughbred/game-core";
import { HorseSchema } from "@thoroughbred/shared";
import { recolorMap } from "@/components/diorama/recolor";
import { layoutHerd } from "@/components/stable/RanchStage";
import { breedingPreview, breedingView, coverMare, foalAndName, standAtStud } from "./economy";
import { geneticsView, parseSilks, stableHorseView } from "./horseView";
import type { Session } from "./session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 2, 12, 0, 7));
const DAY = 86_400_000;
const SEASON = 28 * DAY + 3_600_000;
const at = (ms: number) => new Date(T0.getTime() + ms);
const NAMES = ["Amber Lane", "Bright Fable", "Cider Moon", "Dusk Hollow", "Elder Rose", "Fen Lantern", "Gilt Meadow", "Hazel Vow", "Iron Brook"];

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

const sql = (q: string) => h.db.execute(q);
/** Make a horse breeding-ready: retired from racing, grown up (care done). */
async function readyToBreed(id: string) {
  await sql(`update horses set career_status = 'retired', retirement_reason = 'choice', retired_at = now(), care_sessions = ${gc.CARE_TO_RACING} where id = '${id}'`);
}

describe("lineage: breeding generations through the server", () => {
  it("foals stay inside their family limits, show their genes, and turn out on the Ranch", async () => {
    const acc = await createAccount(h.db, { stableName: "Lineage Stud", startingCredits: 200_000, silks: { pattern: "hoops", primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#1f4e9c" }, timezone: "Europe/London", now: T0 });
    const p: Session = { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
    const v0 = await breedingView(h.db, p, T0);
    const mares = v0.mares;
    const studs = v0.studs.filter((s) => s.club);
    expect(mares.length).toBeGreaterThan(0);
    expect(studs.length).toBeGreaterThan(1);
    for (const m of mares) await readyToBreed(m.id);

    // Generation 1: each mare to a different Club stud, a season apart, until a colt and a filly.
    const foals: { id: string; sex: string; damId: string; sireId: string }[] = [];
    let t = 0;
    for (let round = 0; round < 2 && !(foals.some((f) => f.sex === "colt") && foals.some((f) => f.sex === "filly")); round++) {
      for (const [i, m] of mares.entries()) {
        const stud = studs[(round + i) % studs.length]!;
        const c = await coverMare(h.db, p, { sireId: stud.id, damId: m.id, key: `g1-${round}-${i}` }, at(t));
        const born = await foalAndName(h.db, p, { pregnancyId: c.pregnancyId, name: NAMES[foals.length % NAMES.length]! }, at(t + DAY));
        foals.push({ id: born.foal.id, sex: born.foal.horse.sex, damId: m.id, sireId: stud.id });
      }
      t += SEASON;
    }
    // Generation 2 from a first-generation foal (the draw decides the sexes): a filly goes to the
    // stable's own stallion or a Club stud that isn't her sire; colts only, the colt stands at stud
    // and another stable sends him a mare. Either way the foal has recorded grandparents.
    const fillyFoal = foals.find((f) => f.sex === "filly");
    let breeder = p;
    let sireId: string;
    let damId: string;
    if (fillyFoal) {
      damId = fillyFoal.id;
      sireId = foals.find((f) => f.sex === "colt" && f.damId !== fillyFoal.damId)?.id ?? (v0.stallions[0] ?? studs.find((s) => s.id !== fillyFoal.sireId)!).id;
    } else {
      sireId = foals[0]!.id;
      await readyToBreed(sireId);
      await standAtStud(h.db, p, { horseId: sireId, fee: 0 });
      const acc2 = await createAccount(h.db, { stableName: "Visiting Mares", startingCredits: 50_000, silks: { pattern: "solid", primary: "#8e2323", secondary: "#d9a441", cap: "#d9a441" }, timezone: "Europe/London", now: T0 });
      breeder = { accountId: acc2.accountId, stable: await stableOf(h.db, acc2.accountId) };
      damId = (await breedingView(h.db, breeder, at(t))).mares[0]!.id;
    }
    await readyToBreed(sireId);
    await readyToBreed(damId);
    const pv = await breedingPreview(h.db, breeder, { sireId, damId }, at(t));
    expect(pv.block).toBeNull();
    // The player's preview: words only, and this line has grandparents on record.
    expect(Object.values(gc.OUTLOOK_PHRASES)).toContain(pv.outlook.phrase);
    expect(pv.warnings.map((w) => w.key)).not.toContain("foundation");
    expect(pv.looks).toHaveLength(gc.POSSIBLE_LOOKS);
    const c2 = await coverMare(h.db, breeder, { sireId, damId, key: "g2" }, at(t));
    const g2 = await foalAndName(h.db, breeder, { pregnancyId: c2.pregnancyId, name: "Second Generation" }, at(t + DAY));

    // The foal's alleles sit inside the family range computed from its real grandparents.
    const row = (await getHorse(h.db, g2.foal.id))!;
    const sireRow = (await getHorse(h.db, sireId))!;
    const damRow = (await getHorse(h.db, damId))!;
    const grandIds = [sireRow.sireId, sireRow.damId, damRow.sireId, damRow.damId].filter((x): x is string => !!x);
    const grand = await Promise.all(grandIds.map((id) => getHorse(h.db, id)));
    expect(grand.length).toBeGreaterThanOrEqual(2);
    const g = (r: { genome: unknown }) => gc.upgradeGenome(r.genome)!;
    const range = gc.familyRange(g(sireRow), g(damRow), grand.map((r) => g(r!)), g(row).coi);
    // The family limits of the exact (internal, never sent) odds, from the real grandparents.
    const ped: Record<string, gc.PedigreeEntry> = {};
    for (const r of [sireRow, damRow, ...grand.map((x) => x!)]) ped[r.id] = { sireId: r.sireId, damId: r.damId, generation: r.generation };
    const exact = gc.previewBreeding(toHorseState(sireRow), toHorseState(damRow), ped, 1, grand.map((r) => g(r!)));
    const lim = exact.limits;
    expect(lim.lineage).not.toBe("foundation");
    expect(lim.overall.floor).toBeLessThanOrEqual(exact.overall.p10);
    expect(lim.overall.ceiling).toBeGreaterThanOrEqual(exact.overall.p90);
    for (const k of gc.STAT_KEYS) for (const a of g(row).stats[k]) {
      expect(a).toBeGreaterThanOrEqual(range[k].floor);
      expect(a).toBeLessThanOrEqual(range[k].ceiling);
    }
    // The limits hold on expressed potentials too (size, MSTN and big heart included).
    expect(gc.overallPotential(g(row))).toBeLessThanOrEqual(lim.overall.ceiling);
    expect(gc.overallPotential(g(row))).toBeGreaterThanOrEqual(lim.overall.floor);
    for (const k of gc.STAT_KEYS) {
      expect(gc.potentials(g(row))[k]).toBeLessThanOrEqual(lim.stats[k].ceiling);
      expect(gc.potentials(g(row))[k]).toBeGreaterThanOrEqual(lim.stats[k].floor);
    }
    // The preview's foal breed is the named blend of the parents; its sample looks are valid appearances.
    expect(pv.breed).toBe(gc.breedLabel(gc.blendBreeds(g(sireRow).breed, g(damRow).breed)));
    for (const l of pv.looks) expect(HorseSchema.shape.appearance.safeParse(l.appearance).success).toBe(true);

    // Genetics on every foal: a breed mix that adds up, a valid coat appearance the Ranch can recolour.
    const silks = parseSilks(p.stable.silks);
    const nowMs = at(t + DAY).getTime();
    const allFoals = [...foals.map((f) => f.id), g2.foal.id];
    const views = [];
    const report: { id: string; label: string; mix: string; overall: number; pot: gc.StatRecord<number>; size: string; mstn: string; traits: string[]; coat: string }[] = [];
    for (const id of allFoals) {
      const r = (await getHorse(h.db, id))!;
      const gv = geneticsView(r, nowMs)!;
      expect(gv).not.toBeNull();
      const total = gv.breed.reduce((a, b) => a + b.share, 0);
      expect(total).toBeGreaterThanOrEqual(98);
      expect(total).toBeLessThanOrEqual(102);
      // Foals inherit the exact average of their parents' breed shares (12 breeds), and every
      // genetics-v2 locus shows on the horse page.
      const fg = g(r);
      expect(fg.version).toBe(2);
      expect(fg.breed).toEqual(gc.blendBreeds(g((await getHorse(h.db, r.sireId!))!).breed, g((await getHorse(h.db, r.damId!))!).breed));
      expect(gv.genes2).toHaveLength(14);
      expect(gv.breedLabel.length).toBeGreaterThan(3);
      report.push({ id, label: gv.breedLabel, mix: gv.breed.map((b) => `${b.share}% ${b.label}`).join(" · "), overall: gc.overallPotential(fg), pot: gc.potentials(fg), size: gv.size.text, mstn: gc.mstnType(fg), traits: gv.traits, coat: gv.coat.name });
      const sh = stableHorseView(r, silks, nowMs);
      expect(HorseSchema.safeParse(sh.horse).success).toBe(true);
      expect(recolorMap({ coat: sh.horse.appearance.coat, appearance: sh.horse.appearance }).size).toBeGreaterThan(10);
      views.push(sh);
    }
    // Foal stats across breeds (read them in the test log).
    console.log(
      ["foal | breed | mix | overall | spd/sta/bur/dur/ada/tem | size | MSTN | v2 traits | coat"]
        .concat(report.map((f) => `${f.id.slice(0, 8)} | ${f.label} | ${f.mix} | ${f.overall} | ${gc.STAT_KEYS.map((k) => f.pot[k]).join("/")} | ${f.size} | ${f.mstn} | ${f.traits.join(", ") || "-"} | ${f.coat}`))
        .join("\n"),
    );

    // Generation numbers follow the line.
    expect((await getHorse(h.db, g2.foal.id))!.generation).toBe(Math.max(sireRow.generation, damRow.generation) + 1);

    // The Ranch lays the whole family out, recoloured from each horse's own genes.
    const herd = layoutHerd(views, 0, 880);
    expect(herd.placed.length + herd.inBarn).toBe(views.length);
    for (const pl of herd.placed) expect(pl.item.look?.appearance).toEqual(pl.s.horse.appearance);
    if (process.env.RANCH_EXPORT) writeFileSync(process.env.RANCH_EXPORT, JSON.stringify({ horses: views, limits: lim, schema: Object.keys(schema).length }));
  }, 120_000);

  it("a horse stored before genetics v2 (version-1 genome) reads, previews and breeds as v2", async () => {
    const acc = await createAccount(h.db, { stableName: "Old Bloodlines", startingCredits: 200_000, silks: { pattern: "solid", primary: "#2b5f3a", secondary: "#f3e7c9", cap: "#2b5f3a" }, timezone: "Europe/London", now: T0 });
    const p: Session = { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
    const v0 = await breedingView(h.db, p, T0);
    const mare = v0.mares[0]!;
    const stud = v0.studs.find((s) => s.club)!;
    // Store the mare's genome exactly as the v1 code wrote it.
    const v1 = gc.generateFoundationGenomeV1("lineage-v1-mare", { season: 1, rarity: "uncommon" });
    await sql(`update horses set genome = '${JSON.stringify(v1)}'::jsonb where id = '${mare.id}'`);
    await readyToBreed(mare.id);
    const row = (await getHorse(h.db, mare.id))!;
    expect((row.genome as { version: number }).version).toBe(1);
    const gv = geneticsView(row, T0.getTime())!;
    expect(gv.genes2).toHaveLength(14);
    expect(gv.traits).toEqual([]);
    expect(gv.size.effect).toMatch(/no effect/);
    // It races exactly as before: v1 potentials (alleles, vigour, inbreeding).
    const up = gc.upgradeGenome(v1)!;
    for (const k of gc.STAT_KEYS) expect(gc.potentials(up)[k]).toBe(gc.expressStat(gc.locusValue(v1.stats[k]), gc.vigourValue(v1.vigour), k, v1.coi));
    const pv = await breedingPreview(h.db, p, { sireId: stud.id, damId: mare.id }, T0);
    expect(pv.block).toBeNull();
    const c = await coverMare(h.db, p, { sireId: stud.id, damId: mare.id, key: "v1-cover" }, T0);
    const born = await foalAndName(h.db, p, { pregnancyId: c.pregnancyId, name: "Old Line Foal" }, at(DAY));
    const foal = gc.upgradeGenome((await getHorse(h.db, born.foal.id))!.genome)!;
    expect(foal.version).toBe(2);
    expect(foal.upgradedFrom).toBeUndefined();
    expect(foal.breed).toEqual(gc.blendBreeds(up.breed, gc.upgradeGenome((await getHorse(h.db, stud.id))!.genome)!.breed));
  }, 60_000);
});
