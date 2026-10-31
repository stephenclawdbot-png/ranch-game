/**
 * The economy screens' server side against an in-memory PGlite database: breeding barn and
 * preview, stud book, foaling, packs (pull + proof), market (locks, list, cancel, buy).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, createDb, DomainError, getBalance, schema, stableOf, type DbHandle } from "@thoroughbred/db";
import * as gc from "@thoroughbred/game-core";
import {
  breedingPreview,
  breedingView,
  buy,
  cancel,
  coverMare,
  foalAndName,
  friendlyEconomyError,
  listForSale,
  marketView,
  packsView,
  pull,
  pullProof,
  standAtStud,
} from "./economy";
import type { Session } from "./session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 2, 12, 0, 7));
const at = (ms: number) => new Date(T0.getTime() + ms);
const DAY = 86_400_000;

async function player(name: string, startingCredits?: number): Promise<Session> {
  const acc = await createAccount(h.db, { stableName: name, startingCredits, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "Europe/London", now: T0 });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
}

async function retire(horseId: string) {
  await h.db.execute(`update horses set career_status = 'retired', retirement_reason = 'choice', retired_at = now() where id = '${horseId}'`);
}

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

describe("breeding barn", () => {
  it("explains eligibility, previews a pairing, covers, counts down and foals with a name", async () => {
    const p = await player("Barn Stable");
    const v = await breedingView(h.db, p, T0);
    expect(v.mares.length + v.stallions.length).toBe(3);
    expect(v.mares.every((m) => m.block === "not_breeding_eligible" && m.reason?.includes("0/25"))).toBe(true);
    const dam = v.mares[0]!;
    const sire = v.stallions[0]!;
    // The preview shows even while the pairing is blocked.
    const blocked = await breedingPreview(h.db, p, { sireId: sire.id, damId: dam.id }, T0);
    expect(blocked.block).toBe("not_breeding_eligible");
    expect(blocked.reason).toMatch(/: Breeds from 25 starts/);
    expect(blocked.looks).toHaveLength(gc.POSSIBLE_LOOKS);
    expect(Object.values(gc.OUTLOOK_PHRASES)).toContain(blocked.outlook.phrase);
    expect(blocked.fees.studFee).toBe(0);
    await expect(coverMare(h.db, p, { sireId: sire.id, damId: dam.id, key: "cover-blocked" }, T0)).rejects.toMatchObject({ code: "BREEDING_NOT_ELIGIBLE" });

    await retire(dam.id);
    await retire(sire.id);
    const ok = await breedingPreview(h.db, p, { sireId: sire.id, damId: dam.id }, T0);
    expect(ok.block).toBeNull();
    const before = await getBalance(h.db, p.accountId);
    const c = await coverMare(h.db, p, { sireId: sire.id, damId: dam.id, key: "cover-1" }, T0);
    const again = await coverMare(h.db, p, { sireId: sire.id, damId: dam.id, key: "cover-1" }, T0);
    expect(again).toMatchObject({ pregnancyId: c.pregnancyId, duplicate: true });
    expect(await getBalance(h.db, p.accountId)).toBe(before - gc.BREEDING_BASE_FEE);
    expect(c.dueAtMs - T0.getTime()).toBe(gc.PREGNANCY_MS);

    const mid = await breedingView(h.db, p, at(DAY / 2));
    expect(mid.pregnancies).toHaveLength(1);
    expect(mid.pregnancies[0]).toMatchObject({ status: "carrying", seed: null, seedCommitment: c.seedCommitment });
    expect(mid.mares.find((m) => m.id === dam.id)?.block).toMatch(/dam_in_foal|season_limit/);
    await expect(foalAndName(h.db, p, { pregnancyId: c.pregnancyId, name: "Too Soon" }, at(DAY / 2))).rejects.toMatchObject({ code: "TOO_EARLY" });

    const born = await foalAndName(h.db, p, { pregnancyId: c.pregnancyId, name: "Dawn Chorus" }, at(DAY));
    expect(born.foal.horse.name).toBe("Dawn Chorus");
    expect(born.foal.stage).toBe("foal");
    const after = await breedingView(h.db, p, at(DAY));
    expect(after.pregnancies[0]).toMatchObject({ status: "foaled", foal: { id: born.foal.id } });
    expect(after.pregnancies[0]!.seed && gc.commitSeed(after.pregnancies[0]!.seed)).toBe(c.seedCommitment);
  });

  it("stud book: stand a stallion, other stables see him and pay base + stud fee (10% of it burned)", async () => {
    const owner = await player("Stud Farm");
    const visitor = await player("Visitor");
    const stallion = (await breedingView(h.db, owner, T0)).stallions[0]!;
    await retire(stallion.id);
    await standAtStud(h.db, owner, { horseId: stallion.id, fee: 600 });
    await expect(standAtStud(h.db, owner, { horseId: stallion.id, fee: -1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const vv = await breedingView(h.db, visitor, T0);
    const stud = vv.studs.find((s) => s.id === stallion.id);
    expect(stud).toMatchObject({ studFee: 600, stableName: "Stud Farm", block: null });
    const mare = vv.mares[0]!;
    await retire(mare.id);
    const pv = await breedingPreview(h.db, visitor, { sireId: stallion.id, damId: mare.id }, T0);
    expect(pv.fees).toMatchObject({ baseFee: 1500, studFee: 600, toStallionOwner: 540, burned: 1560, totalPaidByMareOwner: 2100 });
    const ownerBefore = await getBalance(h.db, owner.accountId);
    const visitorBefore = await getBalance(h.db, visitor.accountId);
    await coverMare(h.db, visitor, { sireId: stallion.id, damId: mare.id, key: "visit-1" }, T0);
    expect(await getBalance(h.db, visitor.accountId)).toBe(visitorBefore - 2100);
    expect(await getBalance(h.db, owner.accountId)).toBe(ownerBefore + 540);
  });
});

describe("packs", () => {
  it("publishes odds and pity, pulls a Paddock Pack for credits, and proves it", async () => {
    const p = await player("Pack Stable");
    const v = await packsView(h.db, p, T0);
    expect(v.paddock.odds.reduce((a, o) => a + o.bp, 0)).toBe(10_000);
    expect(v.premium.odds.reduce((a, o) => a + o.bp, 0)).toBe(10_000);
    expect(v.paddock.enabled).toBe(true);
    expect(v.premium).toMatchObject({ demo: true, enabled: false, disabledReason: "Coming soon" });
    expect(v.paddock.pity[0]).toMatchObject({ min: "uncommon", within: 5, since: 0, left: 5 });
    expect(v.playDays).toBe(1);
    expect(v.nextFreeAtPlayDay).toBe(3);
    await expect(pull(h.db, p, { packType: "premium", free: false, key: "prem-1234" }, T0)).rejects.toBeInstanceOf(DomainError);

    const r = await pull(h.db, p, { packType: "paddock", free: false, key: "pull-1234" }, T0);
    expect(r.pull.seedCommitment).toBe(v.paddock.nextSeedCommitment);
    expect(gc.commitSeed(r.seedReveal)).toBe(r.pull.seedCommitment);
    expect(["common", "uncommon"]).toContain(r.pull.rarity);
    expect(r.foal?.stage).toBe("foal");
    const dup = await pull(h.db, p, { packType: "paddock", free: false, key: "pull-1234" }, T0);
    expect(dup).toMatchObject({ duplicate: true, pull: { id: r.pull.id } });
    expect(await getBalance(h.db, p.accountId)).toBe(gc.STARTER_GRANT - gc.PADDOCK_PACK_PRICE);

    const proof = await pullProof(h.db, p, r.pull.id);
    expect(proof.verified).toBe(true);
    // The browser repeats the check with game-core alone.
    const again = gc.pullPack("paddock", proof.pityBefore, { serverSeed: proof.seedReveal, accountId: proof.accountId, season: proof.seasonNumber });
    expect(again.pull.rarity).toBe(r.pull.rarity);
    const other = await player("Snoop");
    await expect(pullProof(h.db, other, r.pull.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Free pack: earned on the 3rd play day (play days need not be consecutive).
    await expect(pull(h.db, p, { packType: "paddock", free: true, key: "free-0001" }, T0)).rejects.toMatchObject({ code: "PACK_LIMIT" });
    await packsView(h.db, p, at(2 * DAY));
    const v3 = await packsView(h.db, p, at(5 * DAY));
    expect(v3.paddock.freeAvailable).toBe(1);
    const free = await pull(h.db, p, { packType: "paddock", free: true, key: "free-0002" }, at(5 * DAY));
    expect(free.pull.free).toBe(true);
  });
});

describe("market", () => {
  it("shows locks and missing seller requirements, lists, cancels and sells (5% burned)", async () => {
    const s = await player("Seller");
    const b = await player("Buyer", 50_000);
    const bought = await pull(h.db, s, { packType: "paddock", free: false, key: "mkt-pull-1" }, T0);
    const v0 = await marketView(h.db, s, T0);
    expect(v0.seller.ok).toBe(false);
    expect(v0.seller.missing).toHaveLength(2); // 7 days + 20 races; no email unless MARKET_REQUIRE_VERIFIED_EMAIL
    expect(v0.seller.emailRequired).toBe(false);
    const starter = v0.horses.find((x) => x.lock === "club_bred");
    expect(starter?.lockReason).toMatch(/Club-bred/);
    const foalRow = v0.horses.find((x) => x.id === bought.foal!.id)!;
    expect(foalRow.lock).toBeNull();
    expect(foalRow.floor).toBe(Math.ceil((foalRow.appraisal * 700) / 1000));
    await expect(listForSale(h.db, s, { horseId: foalRow.id, price: foalRow.floor, days: 7 }, T0)).rejects.toMatchObject({ code: "SELLER_REQUIREMENTS" });

    // Meet the requirements (as the e2e fixture does).
    await h.db.execute(`update accounts set created_at = created_at - interval '8 days', email_verified_at = now() where id = '${s.accountId}'`);
    for (let i = 0; i < 20; i++) {
      const [race] = await h.db
        .insert(schema.races)
        .values({ kind: "quick", name: `R${i}`, raceClass: "maiden", conditions: {}, postTime: at(-DAY), entriesCloseAt: at(-DAY - 60_000), status: "settled", seed: "x", seedCommitment: "y" })
        .returning();
      await h.db.insert(schema.raceEntries).values({ raceId: race!.id, horseId: foalRow.id, stableId: s.stable.id, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0 });
    }
    const v1 = await marketView(h.db, s, T0);
    expect(v1.seller).toMatchObject({ ok: true, missing: [] });
    const err = friendlyEconomyError(await listForSale(h.db, s, { horseId: foalRow.id, price: foalRow.floor - 1, days: 7 }, T0).catch((e) => e)) as DomainError;
    expect(err.code).toBe("PRICE_BELOW_FLOOR");
    expect(err.message).toMatch(/minimum price/);
    expect(foalRow.ceiling).toBe(foalRow.appraisal * 3);
    const dear = friendlyEconomyError(await listForSale(h.db, s, { horseId: foalRow.id, price: foalRow.ceiling + 1, days: 7 }, T0).catch((e) => e)) as DomainError;
    expect(dear.code).toBe("PRICE_ABOVE_CEILING");
    expect(dear.message).toMatch(/maximum price/);

    const l1 = await listForSale(h.db, s, { horseId: foalRow.id, price: foalRow.floor, days: 3 }, T0);
    expect(l1.expiresAtMs - T0.getTime()).toBe(3 * DAY);
    const v2 = await marketView(h.db, s, T0);
    expect(v2.mine.map((m) => m.listingId)).toEqual([l1.listingId]);
    expect(v2.horses.find((x) => x.id === foalRow.id)).toMatchObject({ lock: "listed", listingId: l1.listingId });
    await cancel(h.db, s, l1.listingId, T0);
    expect((await marketView(h.db, s, T0)).mine).toHaveLength(0);

    const price = foalRow.floor + 100;
    const l2 = await listForSale(h.db, s, { horseId: foalRow.id, price, days: 7 }, T0);
    const vb = await marketView(h.db, b, T0);
    const listing = vb.listings.find((x) => x.listingId === l2.listingId)!;
    expect(listing).toMatchObject({ price, fee: gc.marketFee(price), sellerReceives: price - gc.marketFee(price), sellerStableName: "Seller", mine: false });
    const sellerBefore = await getBalance(h.db, s.accountId);
    const buyerBefore = await getBalance(h.db, b.accountId);
    await buy(h.db, b, l2.listingId, T0);
    expect(await getBalance(h.db, b.accountId)).toBe(buyerBefore - price);
    expect(await getBalance(h.db, s.accountId)).toBe(sellerBefore + price - gc.marketFee(price));
    // The 72 h resale lock: the buyer's sell tab shows the horse locked with the exact dates.
    const vAfter = await marketView(h.db, b, at(3_600_000));
    const relisted = vAfter.horses.find((x) => x.id === foalRow.id)!;
    expect(relisted).toMatchObject({ lock: "resale_lock", boughtAtMs: T0.getTime(), resaleUntilMs: at(72 * 3_600_000).getTime() });
    expect(relisted.lockReason).toMatch(/Bought on the market/);
    const vOpen = await marketView(h.db, b, at(72 * 3_600_000));
    expect(vOpen.horses.find((x) => x.id === foalRow.id)!.lock).toBeNull();
    const locked = friendlyEconomyError(new DomainError("RESALE_LOCKED", "cannot list", { until: at(72 * 3_600_000).getTime() })) as DomainError;
    expect(locked.message).toMatch(/listed again after/);
    expect((await marketView(h.db, b, T0)).horses.some((x) => x.id === foalRow.id)).toBe(true);
  });
});

