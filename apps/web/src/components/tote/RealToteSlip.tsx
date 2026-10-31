"use client";

/**
 * The REAL-MONEY bet slip: a DORMANT scaffold (docs/usdg-tote.md). It renders nothing unless the
 * server says a real-money pool is open on this race, which needs REAL_TOTE_ENABLED,
 * WEB3_ENABLED and TOTE_POOLS_ADDRESS (and legal approval) first.
 *
 * Fat-finger guards: a strict amount field (no separators, at most 6 decimals), the per-bet
 * maximum always on show, a second explicit confirmation above REAL_TOTE_CONFIRM_ABOVE, a plain
 * "bets can't be cancelled" line, a final-odds disclaimer, and before the wallet opens the exact
 * amount that will leave the wallet. The server signs a permit for exactly that amount; the
 * wallet sends the bet to the TotePools contract itself (the stake never touches our servers).
 */
import { useEffect, useMemo, useState } from "react";
import { erc20Abi, type Address, type Hex } from "viem";
import * as gc from "@thoroughbred/game-core";
import type { RealToteBoard, ToteBoardRunner } from "@thoroughbred/db";
import { totePoolsAbi } from "@/lib/chain/contracts.generated";
import { clients, connect, ensureChain, listWallets, walletErrorText } from "@/lib/chain/wallet";

type BoardRes = { available: false } | { available: true; board: RealToteBoard };
type Signed = {
  chainId: number;
  totePools: Address;
  bet: { raceId: Hex; runner: number; pool: number; amount: string };
  permit: { bettor: Address; raceId: Hex; runner: number; pool: number; maxAmount: string; nonce: string; issuedAt: string; expiry: string };
  signature: Hex;
  preview: { amount: string; amountLabel: string; expiresAtMs: number };
};

const PROBLEM_TEXT: Record<gc.RealToteStakeProblem, string> = {
  invalid: "Type an amount like 5 or 12.50 (no commas).",
  below_min: `The smallest bet is ${gc.formatRealToteUsdg(gc.REAL_TOTE_MIN_STAKE)}.`,
  above_max: `The most for one bet is ${gc.formatRealToteUsdg(gc.REAL_TOTE_MAX_STAKE_PER_BET)}.`,
  over_allowance: "That's over what you have left for this race or today.",
  needs_confirmation: "That's a big stake: tick the box to confirm the exact amount.",
};

export function RealToteSlip({ raceId, runners }: { raceId: string; runners: ToteBoardRunner[] }) {
  const [res, setRes] = useState<BoardRes | null>(null);
  const [pool, setPool] = useState<"win" | "place">("win");
  const [horseId, setHorseId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [signed, setSigned] = useState<Signed | null>(null);
  const [busy, setBusy] = useState<"permit" | "approve" | "bet" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const r = (await (await fetch(`/api/races/${raceId}/tote/real`)).json()) as BoardRes;
        if (stop) return;
        setRes(r);
        if (r.available && r.board.status === "open") timer = setTimeout(load, gc.TOTE_ODDS_POLL_MS);
      } catch {
        if (!stop) setRes({ available: false });
      }
    };
    void load();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [raceId]);

  const units = text.trim() ? gc.parseRealToteStake(text) : null;
  const problem = text.trim() ? (units === null ? "invalid" : gc.realToteStakeProblem({ stake: units, allowance: gc.REAL_TOTE_MAX_STAKE_PER_BET, confirmed })) : null;
  const view = useMemo(() => (res?.available ? res.board.pools.find((p) => p.kind === pool) ?? null : null), [res, pool]);

  if (!res?.available) return null;
  const board = res.board;
  const open = board.status === "open" && Date.now() < board.betsCloseAtMs;
  const selected = runners.find((r) => r.horseId === horseId) ?? null;

  async function getPermit() {
    if (!selected || units === null || problem) return;
    setMsg(null);
    setBusy("permit");
    try {
      const wallets = await listWallets();
      const provider = wallets.find((w) => w.provider)?.provider;
      if (!provider) throw new Error("Connect a wallet first.");
      const wallet = await connect(provider);
      const r = await fetch(`/api/races/${raceId}/tote/real/permit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ horseId: selected.horseId, pool, amount: String(units), wallet }) });
      const body = (await r.json()) as Signed & { message?: string };
      if (!r.ok) throw new Error(body.message ?? "Couldn't prepare the bet.");
      setSigned(body);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!signed) return;
    setMsg(null);
    try {
      const provider = (await listWallets()).find((w) => w.provider)?.provider;
      if (!provider) throw new Error("Connect a wallet first.");
      const account = await connect(provider);
      await ensureChain(provider, signed.chainId);
      const { wallet, pub } = clients(provider, signed.chainId, account);
      const amount = BigInt(signed.bet.amount);
      const asset = (await pub.readContract({ address: signed.totePools, abi: totePoolsAbi, functionName: "getMarket", args: [signed.bet.raceId] })).asset;
      const allowance = await pub.readContract({ address: asset, abi: erc20Abi, functionName: "allowance", args: [account, signed.totePools] });
      if (allowance < amount) {
        setBusy("approve");
        // Exactly this bet's amount: never an unlimited approval.
        const ah = await wallet.writeContract({ address: asset, abi: erc20Abi, functionName: "approve", args: [signed.totePools, amount], account, chain: wallet.chain });
        await pub.waitForTransactionReceipt({ hash: ah });
      }
      setBusy("bet");
      const p = signed.permit;
      const hash = await wallet.writeContract({
        address: signed.totePools,
        abi: totePoolsAbi,
        functionName: "bet",
        args: [signed.bet.raceId, signed.bet.runner, signed.bet.pool, amount, { bettor: p.bettor, raceId: p.raceId, runner: p.runner, pool: p.pool, maxAmount: BigInt(p.maxAmount), nonce: BigInt(p.nonce), issuedAt: BigInt(p.issuedAt), expiry: BigInt(p.expiry) }, signed.signature],
        account,
        chain: wallet.chain,
      });
      await pub.waitForTransactionReceipt({ hash });
      setSent(signed.preview.amountLabel);
      setSigned(null);
      setText("");
      setConfirmed(false);
    } catch (e) {
      setMsg(walletErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="inset grid gap-2 p-3" data-testid="real-tote-slip">
      <p className="font-extrabold">Real-money pool (USDG)</p>
      <p className="caption" data-testid="real-tote-disclaimer">
        Pool betting in USDG: up to {board.takeoutBps / 100}% take; winners share the rest and always get at least their stake back. A pool with fewer than{" "}
        {gc.TOTE_MIN_POOL_BETTORS} players (or {gc.TOTE_MIN_POOL_RUNNERS} runners backed) is refunded in full. The odds shown move with every bet and are final only when betting closes, before the off.
        Real-money bets can&rsquo;t be cancelled or changed once sent.
      </p>
      {!open ? (
        <p className="text-sm text-cream-dim">Real-money betting is closed for this race.</p>
      ) : (
        <>
          <div className="segmented" role="tablist" aria-label="Real-money pool">
            {board.pools.map((v) => (
              <button key={v.kind} type="button" role="tab" aria-selected={pool === v.kind} onClick={() => setPool(v.kind)}>
                {v.kind === "win" ? "Win" : `Place (first ${v.places})`}
              </button>
            ))}
          </div>
          {view?.thin && (
            <p className="caption" data-testid="real-tote-small-pool">
              Small pool: refunded unless at least {gc.TOTE_MIN_POOL_BETTORS} players bet on {gc.TOTE_MIN_POOL_RUNNERS} different horses.
            </p>
          )}
          <ul className="grid gap-1" role="radiogroup" aria-label="Pick a runner">
            {runners.map((r) => {
              const o = view?.runners.find((x) => x.horseId === r.horseId);
              return (
                <li key={r.horseId}>
                  <label className="flex items-center justify-between gap-2">
                    <span>
                      <input type="radio" name="real-tote-runner" checked={horseId === r.horseId} onChange={() => setHorseId(r.horseId)} /> {r.gate ?? "–"}. {r.name}
                    </span>
                    <span className="num" title="An estimate from the pool now: final when betting closes">
                      {o?.oddsRangeMilli ? `${gc.formatToteOdds(o.oddsRangeMilli[0])}–${gc.formatToteOdds(o.oddsRangeMilli[1])}` : gc.formatToteOdds(o?.oddsMilli ?? null)} est.
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <label className="grid gap-1">
            <span className="caption">
              Stake in USDG · min {gc.formatRealToteUsdg(gc.REAL_TOTE_MIN_STAKE)} · max per bet {gc.formatRealToteUsdg(gc.REAL_TOTE_MAX_STAKE_PER_BET)}
            </span>
            <input
              className="input num"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setConfirmed(false);
                setSigned(null);
              }}
              data-testid="real-tote-stake"
            />
          </label>
          {units !== null && units > gc.REAL_TOTE_CONFIRM_ABOVE && units <= gc.REAL_TOTE_MAX_STAKE_PER_BET && (
            <label className="flex items-center gap-2 text-sm" data-testid="real-tote-confirm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Yes, I mean to stake <b className="num">{gc.formatRealToteUsdg(units)}</b>
            </label>
          )}
          {problem && <p className="text-sm font-bold text-negative">{PROBLEM_TEXT[problem]}</p>}
          {!signed ? (
            <button type="button" className="btn btn-brass w-full sm:w-fit" disabled={!selected || units === null || !!problem || busy !== null} onClick={getPermit} data-testid="real-tote-prepare">
              {busy === "permit" ? "Checking…" : "Review bet"}
            </button>
          ) : (
            <div className="grid gap-2" data-testid="real-tote-preview">
              <p className="text-sm">
                Your wallet will send exactly <b className="num">{signed.preview.amountLabel}</b> to the tote contract <span className="num caption">{signed.totePools}</span> on {selected?.name} ({pool}). This can&rsquo;t be undone.
              </p>
              <button type="button" className="btn btn-brass w-full sm:w-fit" disabled={busy !== null || Date.now() > signed.preview.expiresAtMs} onClick={send} data-testid="real-tote-send">
                {busy === "approve" ? "Approving the exact amount…" : busy === "bet" ? "Sending…" : `Confirm ${signed.preview.amountLabel} in wallet`}
              </button>
            </div>
          )}
        </>
      )}
      {sent && (
        <p className="text-sm font-bold text-positive" role="status">
          Bet sent: {sent}
        </p>
      )}
      {msg && (
        <p className="text-sm font-bold text-negative" role="alert">
          {msg}
        </p>
      )}
    </div>
  );
}
