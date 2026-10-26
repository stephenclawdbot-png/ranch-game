import { describe, expect, it } from "vitest";
import { divergenceBps, median, PRICE_SOURCES, PriceService, PriceUnavailableError, usdCentsToWeiCeil } from "./price";

const payload: Record<string, (usd: number) => unknown> = {
  coinbase: (usd) => ({ data: { amount: String(usd) } }),
  kraken: (usd) => ({ result: { XETHZUSD: { c: [String(usd), "1"] } } }),
  bitstamp: (usd) => ({ last: String(usd) }),
  binance: (usd) => ({ price: String(usd) }),
};

function fetcherFor(prices: Record<string, number | Error>) {
  let calls = 0;
  const fetcher = async (url: string) => {
    calls++;
    const name = Object.keys(PRICE_SOURCES).find((k) => PRICE_SOURCES[k]!.url === url)!;
    const p = prices[name];
    if (p === undefined || p instanceof Error) throw p ?? new Error("down");
    return payload[name]!(p);
  };
  return { fetcher, calls: () => calls };
}

const quiet = () => {};

describe("ETH/USD price service", () => {
  it("median and divergence helpers", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(divergenceBps([3000, 3030, 3015])).toBe(100);
  });

  it("takes the median of the answering sources and caches it", async () => {
    let t = 1_000_000;
    const f = fetcherFor({ coinbase: 3000, kraken: 3010, bitstamp: 3005, binance: new Error("HTTP 451") });
    const svc = new PriceService({ fetcher: f.fetcher, now: () => t, log: quiet, ttlMs: 45_000 });
    const p = await svc.get();
    expect(p.usd).toBe(3005);
    expect(p.micros).toBe(3_005_000_000);
    expect(p.sources.find((s) => s.source === "binance")?.usd).toBeNull();
    expect(f.calls()).toBe(4);
    t += 30_000;
    await svc.get();
    expect(f.calls()).toBe(4); // cached
    t += 20_000;
    await svc.get();
    expect(f.calls()).toBe(8); // refreshed after the TTL
  });

  it("rejects when sources diverge by more than 2%", async () => {
    const f = fetcherFor({ coinbase: 3000, kraken: 3100, bitstamp: 3050 });
    const svc = new PriceService({ fetcher: f.fetcher, source: "coinbase,kraken,bitstamp", log: quiet });
    await expect(svc.get()).rejects.toBeInstanceOf(PriceUnavailableError);
    await expect(svc.get()).rejects.toThrow(/diverge/);
  });

  it("rejects with fewer than 2 answers, out-of-bounds medians and unknown sources", async () => {
    await expect(new PriceService({ fetcher: fetcherFor({ coinbase: 3000 }).fetcher, log: quiet }).get()).rejects.toThrow(/only 1/);
    await expect(new PriceService({ fetcher: fetcherFor({ coinbase: 50, kraken: 50 }).fetcher, source: "coinbase,kraken", log: quiet }).get()).rejects.toThrow(/sanity/);
    await expect(new PriceService({ source: "nope", log: quiet }).get()).rejects.toThrow(/unknown/);
  });

  it("does not cache failures", async () => {
    const prices: Record<string, number | Error> = { coinbase: 3000, kraken: 3500 };
    const svc = new PriceService({ fetcher: fetcherFor(prices).fetcher, source: "coinbase,kraken", log: quiet });
    await expect(svc.get()).rejects.toThrow();
    prices.kraken = 3001;
    expect((await svc.get()).usd).toBe(3000.5);
  });

  it("supports a fixed price for dev and tests", async () => {
    const p = await new PriceService({ source: "fixed:2500.5" }).get();
    expect(p).toMatchObject({ usd: 2500.5, micros: 2_500_500_000, fixed: true });
    await expect(new PriceService({ source: "fixed:abc" }).get()).rejects.toThrow();
  });

  it("converts USD to wei rounding up to a whole gwei", () => {
    const wei = usdCentsToWeiCeil(499, 3_000_000_000); // $4.99 at $3,000
    expect(wei % 10n ** 9n).toBe(0n);
    expect(wei >= 1_663_333_333_333_333n).toBe(true);
    expect(wei - 1_663_333_333_333_333n < 10n ** 9n).toBe(true);
  });
});
