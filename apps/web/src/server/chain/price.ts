/**
 * ETH/USD for the closed beta (server only). No on-chain oracle is needed: quotes are short
 * (5 min) and the buyer's wallet confirms the exact wei. The PremiumStore can optionally
 * cross-check quotes against a Chainlink feed (docs/web3.md "Pricing").
 *
 * - Fetches several public spot prices in parallel (Coinbase, Kraken, Bitstamp, Binance),
 *   needs at least `minSources` answers, takes the MEDIAN.
 * - Rejects (checkout pauses with a friendly "pricing temporarily unavailable") when the
 *   answers diverge by more than `maxDivergenceBps` (default 2%) or the median is outside the
 *   sanity bounds.
 * - Caches a good answer for `ttlMs` (default 45 s). Every fresh fetch logs the per-source
 *   prices for audit, and the snapshot is stored on each order / epoch row.
 *
 * ETH_USD_PRICE_SOURCE: "auto" (default: all sources) | comma list ("coinbase,kraken,bitstamp")
 * | "fixed:3000" (local dev, tests, the Hardhat e2e). ETH_USD_MIN / ETH_USD_MAX: bounds (USD).
 */

export interface SourcePrice {
  source: string;
  usd: number | null;
  error?: string;
}

export interface EthPrice {
  /** Median USD per ETH, as micro-dollars (integer). */
  micros: number;
  usd: number;
  sources: SourcePrice[];
  fetchedAtMs: number;
  fixed: boolean;
}

export class PriceUnavailableError extends Error {
  constructor(
    message: string,
    readonly sources: SourcePrice[] = [],
  ) {
    super(message);
    this.name = "PriceUnavailableError";
  }
}

type Fetcher = (url: string) => Promise<unknown>;

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new Error("not a positive number");
  return n;
};

export const PRICE_SOURCES: Record<string, { url: string; parse: (j: unknown) => number }> = {
  coinbase: { url: "https://api.coinbase.com/v2/prices/ETH-USD/spot", parse: (j) => num((j as { data: { amount: string } }).data.amount) },
  kraken: {
    url: "https://api.kraken.com/0/public/Ticker?pair=ETHUSD",
    parse: (j) => {
      const r = (j as { result: Record<string, { c: string[] }> }).result;
      return num(Object.values(r)[0]!.c[0]);
    },
  },
  bitstamp: { url: "https://www.bitstamp.net/api/v2/ticker/ethusd/", parse: (j) => num((j as { last: string }).last) },
  // USDT pair; Binance answers 451 from US regions (it then just counts as a failed source).
  binance: { url: "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT", parse: (j) => num((j as { price: string }).price) },
};

export function median(values: number[]): number {
  if (!values.length) throw new Error("median of nothing");
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Max spread across sources relative to the median, in bps. */
export function divergenceBps(values: number[]): number {
  const m = median(values);
  return Math.round(((Math.max(...values) - Math.min(...values)) / m) * 10_000);
}

export interface PriceOptions {
  source?: string;
  minSources?: number;
  maxDivergenceBps?: number;
  minUsd?: number;
  maxUsd?: number;
  ttlMs?: number;
  timeoutMs?: number;
  fetcher?: Fetcher;
  now?: () => number;
  log?: (msg: string, data: unknown) => void;
}

export function priceOptionsFromEnv(env: Record<string, string | undefined> = process.env): PriceOptions {
  const n = (k: string) => (env[k] ? Number(env[k]) : undefined);
  return {
    source: env.ETH_USD_PRICE_SOURCE?.trim() || "auto",
    minUsd: n("ETH_USD_MIN"),
    maxUsd: n("ETH_USD_MAX"),
    maxDivergenceBps: n("ETH_USD_MAX_DIVERGENCE_BPS"),
  };
}

async function defaultFetcher(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export class PriceService {
  private cache: EthPrice | null = null;
  private inflight: Promise<EthPrice> | null = null;
  private readonly o: Required<Omit<PriceOptions, "fetcher" | "log">> & { fetcher?: Fetcher; log: (m: string, d: unknown) => void };

  constructor(opts: PriceOptions = {}) {
    this.o = {
      source: opts.source ?? "auto",
      minSources: opts.minSources ?? 2,
      maxDivergenceBps: opts.maxDivergenceBps ?? 200,
      minUsd: opts.minUsd ?? 100,
      maxUsd: opts.maxUsd ?? 100_000,
      ttlMs: opts.ttlMs ?? 45_000,
      timeoutMs: opts.timeoutMs ?? 4_000,
      now: opts.now ?? Date.now,
      fetcher: opts.fetcher,
      log: opts.log ?? ((m, d) => console.info(m, JSON.stringify(d))),
    };
  }

  /** A cached (<= ttl) or fresh median price. Throws PriceUnavailableError. */
  async get(): Promise<EthPrice> {
    const now = this.o.now();
    if (this.cache && now - this.cache.fetchedAtMs < this.o.ttlMs) return this.cache;
    if (!this.inflight) {
      this.inflight = this.fetchFresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async fetchFresh(): Promise<EthPrice> {
    const src = this.o.source;
    const now = this.o.now();
    if (src.startsWith("fixed:")) {
      const usd = Number(src.slice(6));
      if (!Number.isFinite(usd) || usd <= 0) throw new PriceUnavailableError("ETH_USD_PRICE_SOURCE fixed price is invalid");
      this.cache = { usd, micros: Math.round(usd * 1e6), sources: [{ source: "fixed", usd }], fetchedAtMs: now, fixed: true };
      return this.cache;
    }
    const names = src === "auto" ? Object.keys(PRICE_SOURCES) : src.split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = names.filter((n) => !PRICE_SOURCES[n]);
    if (unknown.length) throw new PriceUnavailableError(`unknown price source(s): ${unknown.join(", ")}`);
    const fetcher = this.o.fetcher ?? ((u: string) => defaultFetcher(u, this.o.timeoutMs));
    const sources: SourcePrice[] = await Promise.all(
      names.map(async (name) => {
        try {
          return { source: name, usd: PRICE_SOURCES[name]!.parse(await fetcher(PRICE_SOURCES[name]!.url)) };
        } catch (e) {
          return { source: name, usd: null, error: (e as Error).message.slice(0, 80) };
        }
      }),
    );
    const ok = sources.filter((s): s is SourcePrice & { usd: number } => s.usd !== null).map((s) => s.usd);
    this.o.log("eth_usd_price", { sources, at: new Date(now).toISOString() });
    if (ok.length < Math.min(this.o.minSources, names.length)) throw new PriceUnavailableError(`only ${ok.length} price source(s) answered`, sources);
    const div = divergenceBps(ok);
    if (div > this.o.maxDivergenceBps) throw new PriceUnavailableError(`price sources diverge by ${(div / 100).toFixed(2)}%`, sources);
    const usd = median(ok);
    if (usd < this.o.minUsd || usd > this.o.maxUsd) throw new PriceUnavailableError(`ETH/USD ${usd} is outside the sanity bounds`, sources);
    this.cache = { usd, micros: Math.round(usd * 1e6), sources, fetchedAtMs: now, fixed: false };
    return this.cache;
  }
}

const G = globalThis as typeof globalThis & { __tbPrice?: PriceService };

/** The process-wide price service (env-configured). */
export function priceService(): PriceService {
  if (!G.__tbPrice) G.__tbPrice = new PriceService(priceOptionsFromEnv());
  return G.__tbPrice;
}

/** USD cents -> wei, rounded UP to a whole gwei (the buyer pays at least the USD price). */
export function usdCentsToWeiCeil(usdCents: number, micros: number): bigint {
  const exact = BigInt(usdCents) * 10n ** 22n;
  const m = BigInt(micros);
  const wei = (exact + m - 1n) / m;
  const gwei = 10n ** 9n;
  return ((wei + gwei - 1n) / gwei) * gwei;
}
