import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { RULES, sellerPolicy } from "../rules";
import { horses, packPulls } from "../schema";
import { breed } from "../services/breeding";
import { setStudFee } from "../services/horses";
import { listHorse } from "../services/market";
import { pullPack } from "../services/packs";
import {
  breedingStatus,
  checkPull,
  jsonEqual,
  listMarket,
  listPackPulls,
  listStablePregnancies,
  listStuds,
  nameFoal,
  packPullProof,
  previewPairing,
  sellerStatus,
  tradeStatus,
} from "../services/economyViews";
import { at, DAY, floorPrice, getHorseRow, makeHorse, makeSeller, memoryDb, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const retired = { careerStatus: "retired" as const, retirementReason: "choice" as const, retiredAt: T0 };
let k = 0;
const key = () => `ev-${++k}`;

describe("economy views: breeding", () => {
  it("explains eligibility with the same rules breed uses", async () => {
    const p = await newPlayer(h.db, { credits: 20_000 });
    const young = await makeHorse(h.db, p.stableId, { sex: "male", starts: 3 });
    const veteran = await makeHorse(h.db, p.stableId, { sex: "male", starts: 25 });
    const retiredMare = await makeHorse(h.db, p.stableId, { sex: "female", ...retired });
    const spent = await makeHorse(h.db, p.stableId, { sex: "female", ...retired, breedingCount: 4 });
    expect((await breedingStatus(h.db, young, T0)).block).toBe("not_breeding_eligible");
    expect((await breedingStatus(h.db, veteran, T0)).block).toBeNull();
    expect((await breedingStatus(h.db, retiredMare, T0)).block).toBeNull();
    expect((await breedingStatus(h.db, spent, T0)).block).toBe("lifetime_limit");

    await breed(h.db, { accountId: p.accountId, sireId: veteran.id, damId: retiredMare.id, now: T0, idempotencyKey: key() });
    const after = await breedingStatus(h.db, await getHorseRow(h.db, retiredMare.id), at(DAY));
    expect(["dam_in_foal", "season_limit"]).toContain(after.block);
    expect(after.usedThisSeason).toBe(1);
  });

  it("previews a pairing (outlook in words from public facts, fees, kin and stud blocks) without charging", async () => {
    const owner = await newPlayer(h.db, { credits: 20_000 });
    const studOwner = await newPlayer(h.db, { credits: 0 });
    const mare = await makeHorse(h.db, owner.stableId, { sex: "female", ...retired });
    const stud = await makeHorse(h.db, studOwner.stableId, { sex: "male", ...retired });
    // Not at stud yet: the preview still shows, but the pairing is blocked.
    const before = await previewPairing(h.db, { accountId: owner.accountId, sireId: stud.id, damId: mare.id, now: T0 });
    expect(before.block).toBe("not_at_stud");
    await setStudFee(h.db, { accountId: studOwner.accountId, horseId: stud.id, fee: 800 });
    const pv = await previewPairing(h.db, { accountId: owner.accountId, sireId: stud.id, damId: mare.id, now: T0 });
    expect(pv.block).toBeNull();
    expect(pv.ownSire).toBe(false);
    expect(pv.fees).toEqual(gc.breedingFees(800, false));
    expect(pv.fees.burned).toBe(RULES.breedingBaseFee + 80);
    expect(Object.values(gc.OUTLOOK_SENTENCES).flatMap((t) => Object.values(t))).toContain(pv.outlook.outlook.phrase);
    expect(JSON.stringify(pv.outlook)).not.toMatch(/\d/); // words only
    // Built from the public facts alone (the same ones game-core derives from each horse).
    expect(pv.publicSire.id).toBe(stud.id);
    expect(pv.publicDam.genes2.bigHeart).toEqual(["n", "n"]);
    expect(pv.day).toBe(Math.floor(T0.getTime() / 86_400_000));
    const studs = await listStuds(h.db);
    expect(studs.some((s) => s.horse.id === stud.id && s.stableName.length > 0)).toBe(true);

    const sibling = await makeHorse(h.db, owner.stableId, { sex: "male", ...retired, sireId: stud.id, damId: mare.id });
    const kin = await previewPairing(h.db, { accountId: owner.accountId, sireId: sibling.id, damId: mare.id, now: T0 });
    expect(kin.block).toBe("parent_child");
    // Somebody else's mare: blocked.
    const other = await previewPairing(h.db, { accountId: studOwner.accountId, sireId: stud.id, damId: mare.id, now: T0 });
    expect(other.block).toBe("not_your_mare");
  });

  it("names the foal at foaling (owner only, idempotent) and lists pregnancies", async () => {
    const p = await newPlayer(h.db, { credits: 20_000 });
    const intruder = await newPlayer(h.db);
    const mare = await makeHorse(h.db, p.stableId, { sex: "female", ...retired });
    const sire = await makeHorse(h.db, p.stableId, { sex: "male", ...retired });
    const b = await breed(h.db, { accountId: p.accountId, sireId: sire.id, damId: mare.id, now: T0, idempotencyKey: key() });
    const carrying = await listStablePregnancies(h.db, p.stableId, T0);
    expect(carrying).toHaveLength(1);
    expect(carrying[0]!.pregnancy.seedCommitment).toBe(b.seedCommitment);
    await expect(nameFoal(h.db, { accountId: p.accountId, pregnancyId: b.pregnancyId, now: at(DAY / 2), name: "Early" })).rejects.toMatchObject({ code: "TOO_EARLY" });
    await expect(nameFoal(h.db, { accountId: intruder.accountId, pregnancyId: b.pregnancyId, now: at(DAY) })).rejects.toMatchObject({ code: "NOT_OWNER" });
    const f = await nameFoal(h.db, { accountId: p.accountId, pregnancyId: b.pregnancyId, now: at(DAY), name: "Morning Star" });
    expect((await getHorseRow(h.db, f.foalId)).name).toBe("Morning Star");
    const again = await nameFoal(h.db, { accountId: p.accountId, pregnancyId: b.pregnancyId, now: at(DAY), name: "Evening Star" });
    expect(again).toMatchObject({ foalId: f.foalId, alreadyFoaled: true });
    expect((await getHorseRow(h.db, f.foalId)).name).toBe("Evening Star");
    const list = await listStablePregnancies(h.db, p.stableId, T0);
    expect(list[0]!.foal?.id).toBe(f.foalId);
    expect(list[0]!.pregnancy.seedRevealed).toBe(true);
  });
});

describe("economy views: packs", () => {
  it("proves every pull: the revealed seed chain re-derives rarity, pity, genome and sex", async () => {
    const p = await newPlayer(h.db, { credits: 50_000 });
    await h.db.execute(`update stables set stall_slots = 24 where id = '${p.stableId}'`);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await pullPack(h.db, { accountId: p.accountId, packType: "paddock", idempotencyKey: key(), now: at(i * 7 * DAY) })).pullId);
    const pulls = await listPackPulls(h.db, p.accountId);
    expect(pulls).toHaveLength(3);
    expect(pulls.every((x) => x.horseName)).toBe(true);
    for (const id of ids) {
      const proof = await packPullProof(h.db, { accountId: p.accountId, pullId: id });
      expect(proof.checks).toEqual({ commitment: true, chain: true, rarity: true, pity: true, genome: true, sex: true });
      expect(proof.verified).toBe(true);
    }
    const last = await packPullProof(h.db, { accountId: p.accountId, pullId: ids[2]! });
    expect(last.chain).toHaveLength(2);
    expect(last.pityBefore.pulls).toBe(2);
    // Tampering is detected: another seed, another rarity, another genome.
    const bad = checkPull({ packType: "paddock", accountId: p.accountId, chain: last.chain, pull: { ...last.pull, rarity: last.pull.rarity === "common" ? "uncommon" : "common" }, genome: last.genome, sex: last.sex });
    expect(bad.verified).toBe(false);
    const g = structuredClone(last.genome) as gc.Genome;
    g.vigour = [g.vigour[0] + 1, g.vigour[1]];
    expect(checkPull({ packType: "paddock", accountId: p.accountId, chain: last.chain, pull: last.pull, genome: g, sex: last.sex }).checks.genome).toBe(false);
    expect(checkPull({ packType: "paddock", accountId: "someone-else", chain: last.chain, pull: last.pull, genome: last.genome, sex: last.sex }).verified).toBe(false);
    // Only the owner can read a proof.
    const other = await newPlayer(h.db);
    await expect(packPullProof(h.db, { accountId: other.accountId, pullId: ids[0]! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [row] = await h.db.select().from(packPulls).where(eq(packPulls.id, ids[0]!));
    expect(row!.seedReveal).toHaveLength(64);
  });

  it("jsonEqual ignores key order", () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });
});

describe("economy views: market", () => {
  it("lists what is missing for a seller and why a horse can't be listed", async () => {
    const p = await newPlayer(h.db, { credits: 20_000, starters: 1 });
    const s0 = await sellerStatus(h.db, { accountId: p.accountId, stableId: p.stableId, now: T0 });
    expect(s0.ok).toBe(false);
    // Default policy: no email requirement (no email flow yet); 7 days + 20 races.
    expect(s0.missing).toHaveLength(2);
    expect(s0.emailRequired).toBe(false);
    const strict = sellerPolicy({ MARKET_REQUIRE_VERIFIED_EMAIL: "1", MARKET_SELLER_MIN_RACES: "5" });
    expect(strict).toEqual({ minAccountAgeDays: 7, minRaces: 5, requireVerifiedEmail: true });
    const s0s = await sellerStatus(h.db, { accountId: p.accountId, stableId: p.stableId, now: T0, policy: strict });
    expect(s0s.missing).toHaveLength(3);
    expect(s0s.missing.join(" ")).toMatch(/5 races/);
    const lax = await sellerStatus(h.db, { accountId: p.accountId, stableId: p.stableId, now: T0, policy: { minAccountAgeDays: 0, minRaces: 0, requireVerifiedEmail: false } });
    expect(lax).toMatchObject({ ok: true, missing: [] });
    expect(s0.oldEnoughAt?.getTime()).toBe(T0.getTime() + RULES.sellerMinAccountAgeMs);
    await makeSeller(h.db, p.accountId, p.stableId);
    const s1 = await sellerStatus(h.db, { accountId: p.accountId, stableId: p.stableId, now: T0 });
    expect(s1).toMatchObject({ ok: true, races: 20, emailVerified: true, missing: [] });

    const [starter] = await h.db.select().from(horses).where(eq(horses.id, p.horseIds[0]!));
    expect((await tradeStatus(h.db, starter!)).lock).toBe("club_bred");
    const foalOfBound = await makeHorse(h.db, p.stableId, { tradeMinStarts: 5, starts: 2 });
    expect(await tradeStatus(h.db, foalOfBound)).toMatchObject({ lock: "until_starts", startsNeeded: 3 });
    const free = await makeHorse(h.db, p.stableId);
    const ts = await tradeStatus(h.db, free);
    expect(ts.lock).toBeNull();
    expect(ts.floor).toBe(await floorPrice(h.db, free.id));
    expect(ts.floor).toBe(Math.ceil((ts.appraisal * 700) / 1000));

    const listing = await listHorse(h.db, { accountId: p.accountId, horseId: free.id, price: ts.floor, now: T0 });
    expect((await tradeStatus(h.db, await getHorseRow(h.db, free.id))).lock).toBe("listed");
    const market = await listMarket(h.db, { now: at(1000) });
    const mine = market.find((m) => m.listing.id === listing.id);
    expect(mine?.horse.id).toBe(free.id);
    expect(mine?.sellerStableName).toBeTruthy();
    expect((await listMarket(h.db, { now: at(1000), sellerStableId: p.stableId })).map((m) => m.listing.id)).toEqual([listing.id]);
    expect(await listMarket(h.db, { now: at(15 * DAY) })).toHaveLength(0);
  });
});
