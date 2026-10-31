"use client";
/**
 * Premium Pack checkout in ETH on Robinhood Chain (closed beta).
 *   "Buy for $4.99 (≈ 0.0016 ETH)" -> server quote (exact wei, valid 5 min, countdown,
 *   auto re-quote when it expires) -> the wallet pays exactly that -> the server verifies the
 *   payment on-chain and grants the pulls -> reveal. Pending orders resume after a reload.
 * A share of each sale (poolBps) goes to the on-chain Prize Pool, but the checkout never sells
 * that: prizes need no purchase, and the pool is mostly a fixed weekly budget from the Club.
 * Practice mode (USDG_MODE=practice): the pack costs its USD price in T-USDG test money (1:1),
 * paid from the T-USDG balance in one request (no quote, no ETH, no network).
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { PREMIUM_BETA_LIFETIME_USD_CENTS, practiceUsdgFromUsdCents } from "@thoroughbred/game-core";
import { premiumStoreAbi } from "@/lib/chain/contracts.generated";
import { txUrl } from "@/lib/chain/chains";
import { formatEth, formatUsdCents, shortAddress } from "@/lib/chain/format";
import { quoteFromJson, type EthQuoteJson } from "@/lib/chain/quote";
import { clients, ensureChain, walletErrorText } from "@/lib/chain/wallet";
import { PRACTICE_EXPLAINER, PracticeBadge, WalletChip, usdgDisplay } from "./UsdgMode";
import { WalletLink, useWalletStatus } from "./WalletLink";

const practiceDollars = usdgDisplay(true).dollars;
import { WalletPicker } from "./WalletPicker";
import { useWallet } from "./useWallet";

interface OrderView {
  orderId: string;
  status: string;
  quantity: number;
  usdCents: number;
  priceWei: string;
  txHash: string | null;
  deadlineMs: number;
  error: string | null;
  pullIds: string[];
}
interface CheckoutStatus {
  enabled: boolean;
  /** Practice mode: packs cost T-USDG (POST /api/checkout/practice). */
  practice: boolean;
  /** My T-USDG balance (micro), null without a wallet. */
  practiceBalance: number | null;
  chainId: number;
  store: Address;
  packUsdCents: number;
  /** USD cents left under the $50 beta lifetime cap. */
  lifetimeLeftCents: number;
  orders: OrderView[];
}
interface Quote {
  orderId: Hex;
  quote: EthQuoteJson;
  signature: Hex;
  chainId: number;
  store: Address;
  deadlineMs: number;
  usdCents: number;
  priceWei: string;
  ethUsd: number;
  referral: { level1: boolean; level2: boolean };
}
type SettleResult = { status: "fulfilled"; pullIds: string[] } | { status: "pending" | "paid_waiting" | "rejected"; reason: string };

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data;
}

function useEthPrice(on: boolean): number | null {
  const [usd, setUsd] = useState<number | null>(null);
  useEffect(() => {
    if (!on) return; // practice mode: no ETH price at all
    let live = true;
    const load = () =>
      fetch("/api/price", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => live && setUsd(p?.usd ?? null))
        .catch(() => null);
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [on]);
  return usd;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function PremiumCheckout({ weeklyLeft, stallsFree, onFulfilled }: { weeklyLeft: number; stallsFree: number; onFulfilled: (pullIds: string[]) => void }) {
  const [st, setSt] = useState<CheckoutStatus | null>(null);
  const [qty, setQty] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [phase, setPhase] = useState<"idle" | "quoting" | "quoted" | "paying" | "confirming" | "done">("idle");
  const [tx, setTx] = useState<Hex | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const ethUsd = useEthPrice(!!st?.enabled && !st.practice);
  const w = useWallet();
  const { status: wallet, reload: reloadWallet } = useWalletStatus();
  const requoted = useRef<string | null>(null);

  const confirm = useCallback(
    async (orderId: string, txHash: string) => {
      setPhase("confirming");
      for (let i = 0; i < 90; i++) {
        try {
          const r = await call<SettleResult>("/api/checkout/confirm", { orderId, txHash });
          if (r.status === "fulfilled") {
            setPhase("done");
            setQuote(null);
            onFulfilled(r.pullIds);
            return;
          }
          if (r.status === "rejected") {
            setMsg(`The payment didn't match this order (${r.reason}). If ETH left your wallet, contact the organiser with the transaction link.`);
            setPhase("idle");
            return;
          }
          if (r.status === "paid_waiting") setMsg(`Paid ✓. Your pack is waiting: ${r.reason}`);
        } catch (e) {
          setMsg((e as Error).message);
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      setMsg("Still waiting for the network. Your order is saved: reload this page later and it will finish.");
      setPhase("idle");
    },
    [onFulfilled],
  );

  // Status + resume pending orders after a reload.
  useEffect(() => {
    void call<CheckoutStatus>("/api/checkout/orders")
      .then((s) => {
        setSt(s);
        const pending = s.orders.find((o) => (o.status === "submitted" || o.status === "paid") && o.txHash);
        if (pending) {
          setTx(pending.txHash as Hex);
          void confirm(pending.orderId, pending.txHash!);
        }
      })
      .catch(() => setSt(null));
  }, [confirm]);

  useEffect(() => {
    if (phase !== "quoted") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase]);

  const getQuote = useCallback(async () => {
    setMsg(null);
    setPhase("quoting");
    try {
      const q = await call<Quote>("/api/checkout/quote", { sku: "premium_pack", quantity: qty });
      setQuote(q);
      setNow(Date.now());
      setPhase("quoted");
    } catch (e) {
      setMsg((e as Error).message);
      setPhase("idle");
    }
  }, [qty]);

  // Auto re-quote once when the quote expires (the price may have moved).
  useEffect(() => {
    if (phase === "quoted" && quote && now >= quote.deadlineMs && requoted.current !== quote.orderId && document.visibilityState === "visible") {
      requoted.current = quote.orderId;
      void getQuote();
    }
  }, [phase, quote, now, getQuote]);

  async function pay() {
    if (!quote || !w.provider || !w.address) return;
    setMsg(null);
    setPhase("paying");
    try {
      await ensureChain(w.provider, quote.chainId);
      const { wallet: wc } = clients(w.provider, quote.chainId, w.address);
      const hash = await wc.writeContract({
        address: quote.store,
        abi: premiumStoreAbi,
        functionName: "purchaseWithEth",
        args: [quoteFromJson(quote.quote), quote.signature],
        value: BigInt(quote.priceWei),
        account: w.address,
        chain: wc.chain,
      });
      setTx(hash);
      await confirm(quote.orderId, hash);
    } catch (e) {
      setMsg(walletErrorText(e));
      setPhase(Date.now() < quote.deadlineMs ? "quoted" : "idle");
    }
  }

  if (!st) return null;
  if (st.practice) return <PracticePackCheckout st={st} weeklyLeft={weeklyLeft} stallsFree={stallsFree} wallet={wallet?.address ?? null} onLinked={() => void reloadWallet()} onFulfilled={onFulfilled} />;
  if (!st.enabled) return null; // the pack card shows "coming soon"

  const lifetimeLeft = Math.floor(st.lifetimeLeftCents / st.packUsdCents); // packs the beta allowance still covers
  const maxQty = Math.max(0, Math.min(10, weeklyLeft, stallsFree, lifetimeLeft));
  const estimate = ethUsd ? `≈ ${(((st.packUsdCents * qty) / 100) / ethUsd).toFixed(5)} ETH` : "";
  const left = quote ? quote.deadlineMs - now : 0;
  const wrongWallet = !!(quote && w.address && w.address.toLowerCase() !== quote.quote.buyer.toLowerCase());

  return (
    <div className="inset grid gap-3 p-3" data-testid="premium-checkout">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="label">Buy with ETH · Robinhood Chain</span>
        <span className="caption">No purchase needed to play or win prizes</span>
      </div>

      {!wallet?.address ? (
        <WalletLink onLinked={() => void reloadWallet()} />
      ) : phase === "done" ? (
        <p className="font-bold text-cream" data-testid="checkout-done">
          ✓ Paid and delivered. Your foal{qty > 1 ? "s are" : " is"} in the nursery.{" "}
          <button type="button" className="underline" onClick={() => setPhase("idle")}>
            Buy another
          </button>
        </p>
      ) : phase === "confirming" ? (
        <p className="text-cream" data-testid="checkout-confirming" aria-live="polite">
          Payment sent. Confirming on Robinhood Chain…{" "}
          {tx && txUrl(st.chainId, tx) && (
            <a className="underline" href={txUrl(st.chainId, tx)!} target="_blank" rel="noreferrer">
              view transaction
            </a>
          )}
        </p>
      ) : quote && phase !== "idle" && phase !== "quoting" ? (
        <div className="grid gap-2" data-testid="checkout-quote">
          <p className="text-cream">
            <span className="t-h2">{formatUsdCents(quote.usdCents)}</span> ≈ <span className="num">{formatEth(quote.priceWei, 6)}</span>
            <span className="caption block">
              Exact amount your wallet will show: {quote.priceWei} wei · ETH at ≈ ${quote.ethUsd.toFixed(2)} (median of public prices) · price held for{" "}
              <span className="num" data-testid="quote-countdown">
                {mmss(left)}
              </span>
            </span>
          </p>
          {!w.address ? (
            <WalletPicker label={`Connect ${shortAddress(wallet.address)} to pay`} />
          ) : wrongWallet ? (
            <p className="text-sm font-bold text-negative">Switch your wallet to your linked address {shortAddress(quote.quote.buyer)} to pay.</p>
          ) : (
            <button type="button" className="btn btn-brass btn-lg" onClick={pay} disabled={phase === "paying" || left <= 0} data-testid="checkout-pay">
              {phase === "paying" ? "Confirm in your wallet…" : left <= 0 ? "Refreshing the price…" : `Pay ${formatEth(quote.priceWei, 6)}`}
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">
            <span className="sr-only">Quantity</span>
            <select className="field min-h-11" value={qty} onChange={(e) => setQty(Number(e.target.value))} disabled={maxQty === 0} data-testid="checkout-qty">
              {Array.from({ length: Math.max(1, maxQty) }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1} pack{i ? "s" : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-brass" onClick={getQuote} disabled={phase === "quoting" || maxQty === 0} data-testid="checkout-buy">
            {phase === "quoting" ? "Getting a price…" : maxQty === 0 ? (weeklyLeft <= 0 ? "Weekly limit reached" : lifetimeLeft <= 0 ? "Beta limit reached" : "No free stall") : `Buy for ${formatUsdCents(st.packUsdCents * qty)} ${estimate ? `(${estimate})` : ""}`}
          </button>
        </div>
      )}

      {msg && (
        <p role="alert" className="text-sm font-bold text-negative" data-testid="checkout-error">
          {msg}
        </p>
      )}
      <p className="caption">
        Max 5 Premium Packs a week and {formatUsdCents(PREMIUM_BETA_LIFETIME_USD_CENTS)} over the beta — {formatUsdCents(st.lifetimeLeftCents)} left. Not sold where paid loot boxes are restricted. Paid packs can&apos;t be refunded on-chain; contact the organiser if anything goes wrong.{" "}
        <Link href="/pool" className="underline">
          Prize Pool
        </Link>
      </p>
    </div>
  );
}

/** Practice mode: "Buy for 4.99 T-USDG" from the test balance, pulled in the same request. */
function PracticePackCheckout({
  st,
  weeklyLeft,
  stallsFree,
  wallet,
  onLinked,
  onFulfilled,
}: {
  st: CheckoutStatus;
  weeklyLeft: number;
  stallsFree: number;
  wallet: string | null;
  onLinked: () => void;
  onFulfilled: (pullIds: string[]) => void;
}) {
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(st.practiceBalance);
  const [done, setDone] = useState(false);
  const price = (n: number) => practiceDollars(practiceUsdgFromUsdCents(st.packUsdCents * n));
  const lifetimeLeft = Math.floor(st.lifetimeLeftCents / st.packUsdCents);
  const affordable = balance === null ? 0 : Math.floor(balance / practiceUsdgFromUsdCents(st.packUsdCents));
  const maxQty = Math.max(0, Math.min(10, weeklyLeft, stallsFree, lifetimeLeft, affordable));

  async function buy() {
    setBusy(true);
    setMsg(null);
    try {
      const key = `pp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const r = await call<{ pullIds: string[]; balance: number }>("/api/checkout/practice", { sku: "premium_pack", quantity: qty, clientKey: key });
      setBalance(r.balance);
      setDone(true);
      onFulfilled(r.pullIds);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inset grid gap-3 p-3" data-testid="premium-checkout" data-mode="practice">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label">Buy with T-USDG</span>
        <PracticeBadge />
      </div>
      {!wallet ? (
        <>
          <p className="text-sm">Sign in with your wallet to get your T-USDG (one free signature, no transaction).</p>
          <WalletLink onLinked={onLinked} />
        </>
      ) : (
        <>
          <span className="flex flex-wrap items-center gap-2">
            <WalletChip address={wallet} />
            {balance !== null && (
              <span className="text-sm" data-testid="tusdg-pack-balance">
                Your T-USDG: <b className="num text-cream">{practiceDollars(balance)}</b>
              </span>
            )}
          </span>
          {done ? (
            <p className="font-bold text-cream" data-testid="checkout-done">
              ✓ Paid with T-USDG. Your foal{qty > 1 ? "s are" : " is"} in the nursery.{" "}
              <button type="button" className="underline" onClick={() => setDone(false)}>
                Buy another
              </button>
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm">
                <span className="sr-only">Quantity</span>
                <select className="field min-h-11" value={qty} onChange={(e) => setQty(Number(e.target.value))} disabled={maxQty === 0} data-testid="checkout-qty">
                  {Array.from({ length: Math.max(1, maxQty) }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1} pack{i ? "s" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn btn-brass" onClick={() => void buy()} disabled={busy || maxQty === 0} data-testid="checkout-buy-tusdg">
                {busy
                  ? "Opening…"
                  : maxQty === 0
                    ? weeklyLeft <= 0
                      ? "Weekly limit reached"
                      : lifetimeLeft <= 0
                        ? "Beta limit reached"
                        : stallsFree <= 0
                          ? "No free stall"
                          : "Not enough T-USDG"
                    : `Buy for ${price(qty)}`}
              </button>
            </div>
          )}
        </>
      )}
      {msg && (
        <p role="alert" className="text-sm font-bold text-negative" data-testid="checkout-error">
          {msg}
        </p>
      )}
      <p className="caption">
        {PRACTICE_EXPLAINER} Max 5 Premium Packs a week and {practiceDollars(practiceUsdgFromUsdCents(PREMIUM_BETA_LIFETIME_USD_CENTS))} over the beta, {practiceDollars(practiceUsdgFromUsdCents(st.lifetimeLeftCents))} left.
      </p>
    </div>
  );
}
