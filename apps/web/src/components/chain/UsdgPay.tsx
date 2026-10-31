"use client";
/**
 * Pays one USDG order (a horse registration, a purchase or a stud fee) on Robinhood Chain:
 *   connect the linked wallet -> switch network -> approve exactly the price (only if the current
 *   allowance is lower) -> HorseMarket.buy / register / payStudFee with the server-signed order ->
 *   the server verifies the event and delivers (moves the horse, registers it, or runs the covering). On the mock chain (WEB3_ENABLED off) the payment is simulated.
 * The contract never holds the money: the seller and the treasury are paid in the same transaction.
 * Practice mode (T-USDG): one button pays from the player's T-USDG balance (no wallet transaction,
 * no network switch, no approval); the server moves the T-USDG and delivers in one transaction.
 */
import { useCallback, useEffect, useState } from "react";
import { erc20Abi, type Hex } from "viem";
import { horseMarketAbi } from "@/lib/chain/contracts.generated";
import { txUrl } from "@/lib/chain/chains";
import { shortAddress } from "@/lib/chain/format";
import { TESTNET_FAUCETS, isTestnet, orderPayer, registrationOrderFromJson, saleOrderFromJson, studOrderFromJson, type UsdgOrderJson } from "@/lib/chain/usdg";
import { clients, ensureChain, walletErrorText } from "@/lib/chain/wallet";
import { PracticeBadge, useUsdg } from "./UsdgMode";
import { WalletPicker } from "./WalletPicker";
import { useWallet } from "./useWallet";

type Settle = { status: "fulfilled"; horseId: string } | { status: "pending" | "paid_waiting" | "rejected"; reason: string };

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data;
}

const left = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function TestnetNote({ chainId, mock, practice = false }: { chainId: number; mock: boolean; practice?: boolean }) {
  // Practice mode: test money in the game ledger. No network, no faucet, nothing to fetch.
  if (practice) return <PracticeBadge />;
  if (mock)
    return (
      <p className="caption" data-testid="usdg-test-mode">
        <span className="tag tag-you mr-1">Test mode</span> Payments are simulated on this server: no wallet transaction, no real USDG.
      </p>
    );
  if (!isTestnet(chainId)) return null;
  return (
    <p className="caption" data-testid="usdg-testnet">
      <span className="tag tag-you mr-1">Testnet</span> Test USDG has no value. Get some from the{" "}
      <a className="underline" href={TESTNET_FAUCETS.usdg} target="_blank" rel="noreferrer">
        Paxos USDG faucet
      </a>{" "}
      and gas from the{" "}
      <a className="underline" href={TESTNET_FAUCETS.eth} target="_blank" rel="noreferrer">
        Robinhood testnet ETH faucet
      </a>
      .
    </p>
  );
}

export function UsdgPay({ order, onDone, label }: { order: UsdgOrderJson; onDone: (r: { horseId: string }) => void; label?: string }) {
  const w = useWallet();
  const u = useUsdg();
  const [phase, setPhase] = useState<"idle" | "approving" | "paying" | "confirming" | "done">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(order.txHash);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const confirm = useCallback(
    async (hash: string) => {
      setPhase("confirming");
      for (let i = 0; i < 90; i++) {
        try {
          const r = await post<Settle>(`/api/usdg/orders/${order.orderId}/confirm`, { txHash: hash });
          if (r.status === "fulfilled") {
            setPhase("done");
            onDone({ horseId: r.horseId });
            return;
          }
          if (r.status === "rejected") {
            setMsg(`The payment didn't match this order (${r.reason}). If USDG left your wallet, contact the organiser with the transaction link.`);
            setPhase("idle");
            return;
          }
          if (r.status === "paid_waiting") setMsg(`Paid ✓. Waiting for the organiser: ${r.reason}`);
        } catch (e) {
          setMsg((e as Error).message);
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      setMsg("Still waiting for the network. Your order is saved: reopen the market later and it will finish.");
      setPhase("idle");
    },
    [order.orderId, onDone],
  );

  // A payment sent before a reload: keep confirming it.
  useEffect(() => {
    if (order.txHash && phase === "idle" && !msg) void confirm(order.txHash);
  }, [order.txHash]); // eslint-disable-line react-hooks/exhaustive-deps

  const payer = order.signed ? orderPayer(order.kind, order.signed.order) : null;
  const expired = order.deadlineMs <= now;

  async function payMock() {
    setMsg(null);
    setPhase("paying");
    try {
      const r = await post<Settle>(`/api/usdg/orders/${order.orderId}/${order.practice ? "practice-pay" : "mock-pay"}`);
      if (r.status === "fulfilled") {
        setPhase("done");
        onDone({ horseId: r.horseId });
      } else {
        setMsg(`Not settled yet: ${r.reason}`);
        setPhase("idle");
      }
    } catch (e) {
      setMsg((e as Error).message);
      setPhase("idle");
    }
  }

  async function pay() {
    if (!order.signed || !w.provider || !w.address) return;
    setMsg(null);
    try {
      await ensureChain(w.provider, order.chainId);
      const { wallet, pub } = clients(w.provider, order.chainId, w.address);
      const price = BigInt(order.price);
      const allowance = await pub.readContract({ address: order.token, abi: erc20Abi, functionName: "allowance", args: [w.address, order.market] });
      if (allowance < price) {
        setPhase("approving");
        // Exactly this order's amount: never an unlimited approval.
        const ah = await wallet.writeContract({ address: order.token, abi: erc20Abi, functionName: "approve", args: [order.market, price], account: w.address, chain: wallet.chain });
        await pub.waitForTransactionReceipt({ hash: ah });
      }
      setPhase("paying");
      const hash =
        order.kind === "sale"
          ? await wallet.writeContract({ address: order.market, abi: horseMarketAbi, functionName: "buy", args: [saleOrderFromJson(order.signed.order), order.signed.signature], account: w.address, chain: wallet.chain })
          : order.kind === "stud"
            ? await wallet.writeContract({ address: order.market, abi: horseMarketAbi, functionName: "payStudFee", args: [studOrderFromJson(order.signed.order), order.signed.signature], account: w.address, chain: wallet.chain })
            : await wallet.writeContract({ address: order.market, abi: horseMarketAbi, functionName: "register", args: [registrationOrderFromJson(order.signed.order), order.signed.signature], account: w.address, chain: wallet.chain });
      setTx(hash);
      await confirm(hash as Hex);
    } catch (e) {
      setMsg(walletErrorText(e));
      setPhase("idle");
    }
  }

  const amount = (
    <>
      <span className="t-h2">{u.dollars(order.price)}</span>
      {!order.practice && <span className="num caption"> ({u.token(order.price)})</span>}
    </>
  );
  return (
    <div className="inset baize-scope grid gap-2 p-3" data-testid="usdg-pay" data-order={order.orderId}>
      <p className="text-cream">
        {label ?? (order.kind === "sale" ? "Pay for the horse" : order.kind === "stud" ? `Stud fee for ${order.horseName ?? "the stallion"}` : "Registration fee")}: {amount}
      </p>
      {order.practice && order.kind !== "registration" && (
        <p className="caption" data-testid="usdg-practice-split">
          {u.dollars(order.sellerReceives)} goes to {order.kind === "stud" ? (order.payeeName ?? "the stallion's owner") : "the seller"} and {u.dollars(order.fee)} is the market fee, from your T-USDG
          balance. {order.kind === "stud" ? `The covering of ${order.mareName ?? "your mare"} happens as soon as you pay.` : ""}
        </p>
      )}
      {!order.practice && order.kind === "sale" && (
        <p className="caption">
          {u.dollars(order.sellerReceives)} goes straight to the seller and {u.dollars(order.fee)} to the Club (market fee), in the same transaction. The market contract never holds your money.
        </p>
      )}
      {!order.practice && order.kind === "stud" && (
        <p className="caption" data-testid="usdg-stud-split">
          {u.dollars(order.sellerReceives)} goes straight to {order.payeeName ?? "the stallion's owner"} and {u.dollars(order.fee)} to the Club (market fee), in the same transaction. The
          covering of {order.mareName ?? "your mare"} happens as soon as the payment is confirmed. The market contract never holds your money.
        </p>
      )}
      <TestnetNote chainId={order.chainId} mock={order.mock} practice={order.practice} />
      {phase === "done" ? (
        <p className="font-bold text-positive" role="status" data-testid="usdg-paid">
          {order.kind === "stud" ? "✓ Paid. The covering is done." : "✓ Paid and delivered."}
        </p>
      ) : phase === "confirming" ? (
        <p className="text-cream" aria-live="polite" data-testid="usdg-confirming">
          Payment sent. Confirming on Robinhood Chain…{" "}
          {tx && txUrl(order.chainId, tx) && (
            <a className="underline" href={txUrl(order.chainId, tx)!} target="_blank" rel="noreferrer">
              view transaction
            </a>
          )}
        </p>
      ) : expired || (!order.signed && !order.practice) ? (
        <p className="text-sm font-bold text-negative">This order has expired.</p>
      ) : order.practice ? (
        <button type="button" className="btn btn-brass w-fit" onClick={() => void payMock()} disabled={phase !== "idle"} data-testid="usdg-pay-practice">
          {phase === "paying" ? "Paying…" : `Pay ${u.dollars(order.price)}`}
        </button>
      ) : order.mock ? (
        <button type="button" className="btn btn-brass w-fit" onClick={() => void payMock()} disabled={phase !== "idle"} data-testid="usdg-pay-mock">
          {phase === "paying" ? "Paying…" : `Pay ${u.dollars(order.price)} (simulated)`}
        </button>
      ) : !w.address ? (
        <WalletPicker label={`Connect ${shortAddress(payer)} to pay`} />
      ) : payer && w.address.toLowerCase() !== payer.toLowerCase() ? (
        <p className="text-sm font-bold text-negative">Switch your wallet to your linked address {shortAddress(payer)} to pay.</p>
      ) : (
        <button type="button" className="btn btn-brass w-fit" onClick={() => void pay()} disabled={phase !== "idle"} data-testid="usdg-pay-wallet">
          {phase === "approving" ? "Approve in your wallet…" : phase === "paying" ? "Confirm in your wallet…" : `Pay ${u.dollars(order.price)} in USDG`}
        </button>
      )}
      {phase !== "done" && !expired && (order.signed || order.practice) && <p className="caption">Held for you for {left(order.deadlineMs - now)}.</p>}
      {msg && (
        <p role="alert" className="text-sm font-bold text-negative">
          {msg}
        </p>
      )}
    </div>
  );
}
