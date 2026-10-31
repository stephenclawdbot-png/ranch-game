"use client";
/**
 * Sales → USDG: registered horses for dollars (docs/usdg-market.md). Fixed-price lots and a live
 * auction board, each price in dollars with the token amount, the market fee and what the seller
 * receives. Buying pays straight from your wallet to the seller (HorseMarket never holds funds);
 * bids are free signatures and money moves only when an auction closes and the winner pays.
 * Stable Credits are never involved: they can't be bought or cashed out.
 */
import Link from "next/link";
import { useState } from "react";
import { usdgFromDecimal } from "@thoroughbred/game-core";
import { WalletLink } from "@/components/chain/WalletLink";
import { WalletPicker } from "@/components/chain/WalletPicker";
import { TestnetNote, UsdgPay } from "@/components/chain/UsdgPay";
import { useWallet } from "@/components/chain/useWallet";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { EmptyState, HowItWorks } from "@/components/ui/Page";
import { shortAddress } from "@/lib/chain/format";
import { bidTypedData, type UsdgOrderJson } from "@/lib/chain/usdg";
import { clients, ensureChain, signTypedDataOnCurrentChain, walletErrorText } from "@/lib/chain/wallet";
import { PRACTICE_EXPLAINER, PracticeBalance, WalletChip, useUsdg } from "@/components/chain/UsdgMode";
import { api } from "@/lib/player";
import type { UsdgLotView, UsdgMarketView } from "@/lib/usdgTypes";
import { HorseLine, Skeleton, stageLabel, useEcoView } from "./kit";
import { pedigreeLine } from "./SalesRing";
import { UsdgListForm } from "./UsdgListForm";

function endsIn(ms: number): string {
  if (ms <= 0) return "closing";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h >= 48 ? `${Math.round(h / 24)} days` : `${h} h ${m % 60} min`;
}

export function Usd({ micro, className }: { micro: number; className?: string }) {
  const u = useUsdg();
  if (u.practice)
    return (
      <span className={className}>
        <span className="lot-price">{u.dollars(micro)}</span>
      </span>
    );
  return (
    <span className={className}>
      <span className="lot-price">{u.dollars(micro)}</span> <span className="caption num">{u.token(micro)}</span>
    </span>
  );
}

export function UsdgMarket() {
  const { data, error, reload } = useEcoView<UsdgMarketView>("/api/usdg");
  const u = useUsdg();
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  const v = data;
  if (v.network.mode === "off")
    return (
      <EmptyState
        icon="coin"
        title={u.t("The USDG market is coming soon")}
        text={u.t("Registered horses will trade for USDG, Robinhood Chain's dollar stablecoin. Credits stay in the game: they are never bought or cashed out.")}
        testId="usdg-off"
      />
    );
  const fixed = v.lots.filter((l) => l.kind === "fixed");
  const auctions = v.lots.filter((l) => l.kind === "auction");
  const practice = v.network.mode === "practice";
  return (
    <div className="grid gap-5" data-testid="usdg-market">
      {practice && (
        <section className="surface-2 grid gap-2 p-3" aria-label="Test money" data-testid="tusdg-explainer">
          <PracticeBalance micro={v.practice?.balance ?? null} />
          <p className="text-sm">{PRACTICE_EXPLAINER}</p>
        </section>
      )}
      <HowItWorks label={u.t("How the USDG market works")}>
        {practice ? (
          <p>
            Horses registered for the T-USDG market change hands for T-USDG, the beta&rsquo;s test money. Every wallet that signs in gets {u.dollars(v.practice?.grant ?? 0)} once. The price moves
            from the buyer&rsquo;s balance to the seller&rsquo;s, minus a {v.policy.feeBps / 100}% market fee. Bids are free wallet signatures. Stable Credits are never involved.
          </p>
        ) : (
        <p>
          Horses registered for the USDG market change hands for USDG, a dollar stablecoin ({v.network.networkName}). The price goes straight from the buyer&rsquo;s wallet to the seller&rsquo;s, minus a{" "}
          {v.policy.feeBps / 100}% market fee to the Club. Stable Credits are never involved.
        </p>
        )}
        <p>
          Any horse with {v.policy.minLiveStarts} Live starts that isn&rsquo;t Club-bred, a starter or a Premium pull can register, once, for {u.dollars(v.policy.registrationFee)}. A
          registered horse sells only for {u.name} from then on. Auction bids are free signatures; the winner has {v.policy.paymentWindowHours} h to pay, or the next bidder gets the chance and the
          non-payer can&rsquo;t bid for {v.policy.nonPayerBarDays} days. <Link href="/wiki/usdg-market" className="underline">Read the rules</Link>.
        </p>
      </HowItWorks>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TestnetNote chainId={v.network.chainId} mock={v.network.mode === "mock"} practice={practice} />
        {v.wallet ? (
          practice ? (
            <WalletChip address={v.wallet} />
          ) : (
            <span className="chip text-sm font-bold text-cream" title={v.wallet} data-testid="usdg-wallet">
              Wallet {shortAddress(v.wallet)}
            </span>
          )
        ) : null}
      </div>
      {!v.wallet && (
        <section className="surface grid gap-2 p-3" aria-label="Wallet">
          <p className="font-bold">{practice ? "Sign in with your wallet to get your T-USDG and buy, bid or sell. Signing is free and sends no transaction." : "Link a wallet to buy, bid or sell for USDG."}</p>
          <WalletLink compact />
        </section>
      )}
      {v.barredUntilMs && (
        <p className="surface-2 p-3 text-sm font-bold text-negative" role="status" data-testid="usdg-barred">
          You didn&rsquo;t pay for an auction you won, so you can&rsquo;t bid in {u.name} auctions until {new Date(v.barredUntilMs).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.
        </p>
      )}
      {v.orders.length > 0 && <OpenOrders orders={v.orders} onChange={reload} />}

      <section aria-labelledby="usdg-auctions-h" className="grid gap-2">
        <h2 id="usdg-auctions-h" className="t-h2">
          Live auctions ({auctions.length})
        </h2>
        {auctions.length ? (
          <ul className="lots-grid">
            {auctions.map((l) => (
              <AuctionLot key={l.listingId} l={l} v={v} onChange={reload} />
            ))}
          </ul>
        ) : (
          <p className="caption">No auctions running. Start one from a registered horse below or from its horse page.</p>
        )}
      </section>

      <section aria-labelledby="usdg-fixed-h" className="grid gap-2">
        <h2 id="usdg-fixed-h" className="t-h2">
          Fixed price ({fixed.length})
        </h2>
        {fixed.length ? (
          <ul className="lots-grid">
            {fixed.map((l) => (
              <FixedLot key={l.listingId} l={l} v={v} onChange={reload} />
            ))}
          </ul>
        ) : (
          <p className="caption">No fixed-price lots right now.</p>
        )}
      </section>

      <MySide v={v} onChange={reload} />
    </div>
  );
}

function OpenOrders({ orders, onChange }: { orders: UsdgOrderJson[]; onChange: () => void }) {
  return (
    <section aria-labelledby="usdg-orders-h" className="grid gap-2" data-testid="usdg-orders">
      <h2 id="usdg-orders-h" className="t-h2">
        To pay
      </h2>
      {orders.map((o) => (
        <div key={o.orderId} className="surface grid gap-2 p-3">
          <p className="font-extrabold">
            {o.kind === "registration"
              ? `Register ${o.horseName ?? "your horse"}`
              : o.kind === "stud"
                ? `Covering ${o.mareName ?? "your mare"} with ${o.horseName ?? "a stallion"}`
                : o.auction
                  ? `You won ${o.horseName ?? "the auction"}`
                  : `Buying ${o.horseName ?? "a horse"}`}
          </p>
          <UsdgPay order={o} onDone={onChange} label={o.auction ? `Pay your winning bid within the window` : undefined} />
        </div>
      ))}
    </section>
  );
}

function LotHead({ l }: { l: UsdgLotView }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-line pb-2">
        <span className="lot-no">Lot {l.lot}</span>
        <span className="truncate text-xs font-bold text-cream-dim">Vendor · {l.sellerStableName}</span>
      </div>
      <HorseLine
        h={l}
        meta={
          <>
            {stageLabel(l.stage)} · {l.starts} starts · OR {l.rating}
          </>
        }
      />
      <p className="lot-ped">{pedigreeLine(l)}</p>
    </>
  );
}

function FixedLot({ l, v, onChange }: { l: UsdgLotView; v: UsdgMarketView; onChange: () => void }) {
  const u = useUsdg();
  const [order, setOrder] = useState<UsdgOrderJson | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  async function buy() {
    setBusy(true);
    setError(null);
    try {
      setOrder(await api<UsdgOrderJson>(`/api/usdg/listings/${l.listingId}/buy`));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const full = v.stalls.free <= 0;
  return (
    <li className="lot-card print grid gap-2 p-4" data-testid="usdg-lot" data-kind="fixed">
      <LotHead l={l} />
      <Usd micro={l.price} />
      <p className="caption">
        Seller receives {u.dollars(l.sellerReceives)} · market fee {u.dollars(l.fee)} · ends in {endsIn(l.endsAtMs - v.serverNowMs)}
      </p>
      {done ? (
        <p className="font-bold text-positive" role="status">
          ✓ {l.horse.name} is yours.
        </p>
      ) : order ? (
        <UsdgPay
          order={order}
          onDone={() => {
            setDone(true);
            onChange();
          }}
        />
      ) : (
        <button type="button" className="btn w-fit" onClick={() => void buy()} disabled={busy || !v.wallet || full || l.reserved} data-testid="usdg-buy">
          {!v.wallet ? "Link a wallet to buy" : full ? "No free stall" : l.reserved ? "Someone is paying for this lot" : busy ? "Reserving…" : `Buy for ${u.dollars(l.price)}`}
        </button>
      )}
      {error ? <ErrorNote error={error} /> : null}
    </li>
  );
}

function AuctionLot({ l, v, onChange }: { l: UsdgLotView; v: UsdgMarketView; onChange: () => void }) {
  const u = useUsdg();
  const w = useWallet();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [placed, setPlaced] = useState<number | null>(null);
  const micro = usdgFromDecimal(amount);
  const open = l.status === "active" && l.minNextBid !== null;
  const valid = micro !== null && l.minNextBid !== null && micro >= l.minNextBid;

  async function placeBid() {
    if (!valid || !w.provider || !w.address) return;
    setBusy(true);
    setError(null);
    try {
      const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
      const theBid = { listingId: l.listingId, amount: BigInt(micro!), bidder: w.address, nonce };
      if (u.practice) {
        // Practice: the same free signature, on whatever network the wallet is on (no switch, no chain).
        const { signature, chainId } = await signTypedDataOnCurrentChain(w.provider, w.address, (id) => bidTypedData(theBid, id, v.network.market as `0x${string}`));
        await api(`/api/usdg/listings/${l.listingId}/bid`, { body: { amount: micro, nonce: nonce.toString(), signature, chainId } });
      } else {
        await ensureChain(w.provider, v.network.chainId);
        const { wallet } = clients(w.provider, v.network.chainId, w.address);
        const signature = await wallet.signTypedData({ account: w.address, ...bidTypedData(theBid, v.network.chainId, v.network.market as `0x${string}`) });
        await api(`/api/usdg/listings/${l.listingId}/bid`, { body: { amount: micro, nonce: nonce.toString(), signature } });
      }
      setPlaced(micro);
      setAmount("");
      onChange();
    } catch (e) {
      setError(e instanceof Error && "status" in e ? e : new Error(walletErrorText(e)));
    } finally {
      setBusy(false);
    }
  }

  const wrongWallet = !!(v.wallet && w.address && w.address.toLowerCase() !== v.wallet.toLowerCase());
  return (
    <li className="lot-card print grid gap-2 p-4" data-testid="usdg-lot" data-kind="auction">
      <LotHead l={l} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <span className="ring-board-label">{l.bestBid ? "Best bid" : "Reserve"}</span> <Usd micro={l.bestBid ?? l.price} />
        </span>
        <span className="caption">
          {l.bidCount} {l.bidCount === 1 ? "bid" : "bids"} · {open ? `closes in ${endsIn(l.endsAtMs - v.serverNowMs)}` : "bidding closed"}
        </span>
      </div>
      {l.myBestBid !== null && <p className="caption font-bold">Your best bid: {u.dollars(l.myBestBid)}{l.bestBid === l.myBestBid ? " (leading)" : ""}</p>}
      {!open ? (
        <p className="caption" data-testid="usdg-offering">
          {l.offeredToMe ? "You won: pay from “To pay” above before the window ends." : "Closed: the winner is paying. If they don't, the next bidder is offered the horse."}
        </p>
      ) : !v.wallet ? (
        <p className="caption">Link a wallet to bid.</p>
      ) : v.barredUntilMs ? (
        <p className="caption">{u.name} bidding is closed to you for now.</p>
      ) : !w.address ? (
        <WalletPicker label="Connect your wallet to bid" />
      ) : wrongWallet ? (
        <p className="text-sm font-bold text-negative">Switch your wallet to your linked address {shortAddress(v.wallet)} to bid.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="label">Your bid ({u.name})</span>
            <input className="field w-32" inputMode="decimal" placeholder={String(l.minNextBid! / 1_000_000)} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="usdg-bid-amount" />
          </label>
          <button type="button" className="btn btn-brass" onClick={() => void placeBid()} disabled={!valid || busy} data-testid="usdg-bid">
            {busy ? "Sign in your wallet…" : "Sign bid"}
          </button>
          <span className="caption basis-full">
            At least {u.dollars(l.minNextBid!)}. A bid is a free signature, no transaction; you pay only if you win ({v.policy.paymentWindowHours} h to pay).
          </span>
        </div>
      )}
      {placed !== null && <p className="text-sm font-bold text-positive">✓ Bid of {u.dollars(placed)} placed.</p>}
      {error ? <ErrorNote error={error} /> : null}
    </li>
  );
}

function MySide({ v, onChange }: { v: UsdgMarketView; onChange: () => void }) {
  const u = useUsdg();
  const [listing, setListing] = useState<string | null>(null);
  return (
    <section aria-labelledby="usdg-mine-h" className="grid gap-2" data-testid="usdg-mine">
      <h2 id="usdg-mine-h" className="t-h2">
        Your registered horses
      </h2>
      {v.registered.length === 0 ? (
        <p className="caption">
          None yet. Register a horse from its horse page (&ldquo;Register for the {u.name} market&rdquo;) once it has {v.policy.minLiveStarts} Live starts.
        </p>
      ) : (
        <ul className="grid gap-2">
          {v.registered.map((h) => {
            const lot = v.mine.find((l) => l.id === h.id);
            return (
              <li key={h.id} className="surface grid gap-2 p-3" data-testid="usdg-registered">
                <HorseLine h={h} meta={<>{stageLabel(h.stage)} · {h.starts} starts · registered for {u.name}</>} />
                {lot ? (
                  <MyLot l={lot} v={v} onChange={onChange} />
                ) : h.block ? (
                  <p className="text-sm font-bold text-cream-dim">🔒 {h.block}</p>
                ) : listing === h.id ? (
                  <UsdgListForm
                    horseId={h.id}
                    horseName={h.horse.name}
                    policy={v.policy}
                    onCancel={() => setListing(null)}
                    onListed={() => {
                      setListing(null);
                      onChange();
                    }}
                  />
                ) : (
                  <button type="button" className="btn w-fit" onClick={() => setListing(h.id)} data-testid="usdg-list-open">
                    List for {u.name}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MyLot({ l, v, onChange }: { l: UsdgLotView; v: UsdgMarketView; onChange: () => void }) {
  const u = useUsdg();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function delist() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/usdg/listings/${l.listingId}/delist`);
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-1" data-testid="usdg-my-lot">
      <p className="text-sm">
        {l.kind === "fixed" ? (
          <>
            Listed at <b>{u.dollars(l.price)}</b>: you receive {u.dollars(l.sellerReceives)} · ends in {endsIn(l.endsAtMs - v.serverNowMs)}
            {l.reserved ? " · a buyer is paying now" : ""}
          </>
        ) : l.status === "closed" ? (
          <>Auction closed: the top bidder is paying ({l.bestBid ? u.dollars(l.bestBid) : "–"}).</>
        ) : (
          <>
            Auction: reserve {u.dollars(l.price)} · {l.bidCount} {l.bidCount === 1 ? "bid" : "bids"}
            {l.bestBid ? `, best ${u.dollars(l.bestBid)}` : ""} · closes in {endsIn(l.endsAtMs - v.serverNowMs)}
          </>
        )}
      </p>
      {l.status === "active" && !(l.kind === "auction" && l.bidCount > 0) && !l.reserved && (
        <button type="button" className="btn btn-sm w-fit" onClick={() => void delist()} disabled={busy} data-testid="usdg-delist">
          {busy ? "Taking it down…" : "Take it off the market"}
        </button>
      )}
      {error ? <ErrorNote error={error} /> : null}
    </div>
  );
}
