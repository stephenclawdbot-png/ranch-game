import { describe, expect, it } from "vitest";
import {
  CLUB_LEASE_OFFERS_MAX,
  CLUB_LEASE_OWNER_SHARE_PCT,
  CLUB_SALE_LISTINGS_MAX,
  CLUB_SALE_LISTINGS_PER_DAY,
  CLUB_SALE_PRICE_PERMILLE,
  clubLeaseCap,
  clubLeaseTermDays,
  clubSaleCap,
  clubSaleLotsToList,
  clubSalePrice,
  clubSaleQuality,
} from "./clubMarket";
import { LEASE_OWNER_SHARE_MAX_PCT, LEASE_OWNER_SHARE_MIN_PCT, LEASE_TERMS_DAYS } from "./leasing";
import { LISTING_CEILING_PERMILLE, LISTING_FLOOR_PERMILLE } from "./economy";

describe("Club market knobs", () => {
  it("has the agreed numbers", () => {
    expect(CLUB_SALE_LISTINGS_PER_DAY).toBe(3);
    expect(CLUB_SALE_LISTINGS_MAX).toBe(6);
    expect(CLUB_SALE_PRICE_PERMILLE).toBe(1100);
    expect(CLUB_LEASE_OFFERS_MAX).toBe(4);
  });

  it("stays inside the player rules (price band, lease terms, owner share)", () => {
    expect(CLUB_SALE_PRICE_PERMILLE).toBeGreaterThanOrEqual(LISTING_FLOOR_PERMILLE);
    expect(CLUB_SALE_PRICE_PERMILLE).toBeLessThanOrEqual(LISTING_CEILING_PERMILLE);
    expect(CLUB_LEASE_OWNER_SHARE_PCT).toBeGreaterThanOrEqual(LEASE_OWNER_SHARE_MIN_PCT);
    expect(CLUB_LEASE_OWNER_SHARE_PCT).toBeLessThanOrEqual(LEASE_OWNER_SHARE_MAX_PCT);
    for (let i = 0; i < 20; i++) expect(LEASE_TERMS_DAYS as readonly number[]).toContain(clubLeaseTermDays("2026-11-01", i));
  });

  it("backs off as players list", () => {
    expect(clubSaleCap(0)).toBe(6);
    expect(clubSaleCap(4)).toBe(2);
    expect(clubSaleCap(9)).toBe(0);
    expect(clubSaleLotsToList(0, 0)).toBe(3);
    expect(clubSaleLotsToList(5, 0)).toBe(1);
    expect(clubSaleLotsToList(0, 5)).toBe(1);
    expect(clubSaleLotsToList(4, 5)).toBe(0);
    expect(clubLeaseCap(0)).toBe(4);
    expect(clubLeaseCap(3)).toBe(1);
    expect(clubLeaseCap(7)).toBe(0);
  });

  it("prices at 110% of appraisal", () => {
    expect(clubSalePrice(1000)).toBe(1100);
    expect(clubSalePrice(1234)).toBe(1357);
    expect(clubSalePrice(0)).toBe(1);
  });

  it("spreads ratings, mostly 30-70, deterministically", () => {
    const qs = Array.from({ length: 400 }, (_, i) => clubSaleQuality("2026-11-01", i));
    const rs = qs.map((q) => q.rating);
    expect(qs.every((q) => (q.rating > 70) === (q.rarity === "uncommon"))).toBe(true);
    expect(rs.every((r) => r >= 30 && r <= 90)).toBe(true);
    const better = rs.filter((r) => r > 70).length;
    expect(better).toBeGreaterThan(20);
    expect(better).toBeLessThan(120);
    expect(clubSaleQuality("2026-11-01", 3)).toEqual(qs[3]);
  });
});
