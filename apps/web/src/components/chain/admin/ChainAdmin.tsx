"use client";
/**
 * /admin/chain: deploy PrizePool + PremiumStore from the OWNER'S WALLET (no deploy key on any
 * server), see the live contracts, run the owner actions (pause, pool share, top-up), and
 * claim the affiliate root. The resulting addresses go into Vercel env.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { isAddress, parseEther, type Address, type Hex } from "viem";
import { adminFetch, useAdminData } from "@/components/admin/adminApi";
import { premiumStoreAbi, prizePoolAbi } from "@/lib/chain/contracts.generated";
import { CHAINS, LOCAL_HARDHAT, ROBINHOOD_MAINNET, ROBINHOOD_TESTNET, addressUrl, chainInfo, txUrl } from "@/lib/chain/chains";
import { deployBetaContracts, envBlock, type DeployResult } from "@/lib/chain/deploy";
import { formatEth, shortAddress } from "@/lib/chain/format";
import { clients, ensureChain, walletErrorText } from "@/lib/chain/wallet";
import { WalletPicker } from "../WalletPicker";
import { useWallet } from "../useWallet";

interface ChainStatus {
  config: { enabled: boolean; chainId: number; rpcConfigured: boolean; store: Address | null; pool: Address | null; signerAddress: Address | null; premiumUsdCents: number; priceSource: string };
  store: null | { error?: string; poolBps?: number; maxRef1Bps?: number; maxRef2Bps?: number; treasury?: Address; paused?: boolean; premiumActive?: boolean; signerHasRole?: boolean; signerCanPost?: boolean };
  pool: null | { error?: string; balanceWei?: string; availableWei?: string; outstandingWei?: string; lastEpochId?: number; maxEpochBps?: number; maxClaimPerEpochWei?: string; paused?: boolean };
  price: { usd?: number; error?: string; sources?: { source: string; usd: number | null }[] } | null;
  owner: { accountId: string; wallet: string | null } | null;
  sales: { orders: number; fulfilled: number; paidWei: string; open: number };
  orders: { orderId: string; status: string; quantity: number; usdCents: number; priceWei: string; txHash: string | null; error: string | null; createdAtMs: number }[];
}

const SAVED = "tb:lastDeploy";

export function ChainAdmin() {
  const { data, error, reload } = useAdminData<ChainStatus>("/api/admin/chain");
  const w = useWallet();
  const [net, setNet] = useState<number>(ROBINHOOD_TESTNET);
  const [treasury, setTreasury] = useState("");
  const [signer, setSigner] = useState("");
  const [poolPct, setPoolPct] = useState(30);
  const [capUsd, setCapUsd] = useState(25);
  const [poster, setPoster] = useState(false);
  const [mainnetOk, setMainnetOk] = useState(false);
  const [log, setLog] = useState<{ step: string; hash?: Hex }[]>([]);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data?.config.signerAddress && !signer) setSigner(data.config.signerAddress);
    if (data?.config.chainId && CHAINS[data.config.chainId]) setNet(data.config.chainId);
  }, [data, signer]);
  useEffect(() => {
    if (w.address && !treasury) setTreasury(w.address);
  }, [w.address, treasury]);
  useEffect(() => {
    try {
      const s = localStorage.getItem(SAVED);
      if (s) setResult(JSON.parse(s));
    } catch {
      /* ignore */
    }
  }, []);

  if (error) return <p className="surface p-3 text-negative">{error}</p>;
  if (!data) return <p className="caption">Loading…</p>;
  const ethUsd = data.price?.usd ?? null;
  const capWei = ethUsd ? parseEther(((capUsd / ethUsd) * 1.0).toFixed(18)) : null;
  const ownerWalletIsTreasury = !!(data.owner?.wallet && treasury && data.owner.wallet.toLowerCase() === treasury.toLowerCase());
  const valid = isAddress(treasury) && isAddress(signer) && poolPct >= 10 && poolPct <= 50 && !!capWei && (net !== ROBINHOOD_MAINNET || mainnetOk);

  async function deploy() {
    if (!w.provider || !w.address || !capWei) return;
    setBusy(true);
    setMsg(null);
    setLog([]);
    try {
      await ensureChain(w.provider, net);
      const { wallet, pub } = clients(w.provider, net, w.address);
      const r = await deployBetaContracts(wallet, pub, { treasury: treasury as Address, signer: signer as Address, poolBps: Math.round(poolPct * 100), maxClaimPerEpochWei: capWei, grantPosterToSigner: poster }, (step, hash) =>
        setLog((l) => [...l, { step, hash }]),
      );
      setResult(r);
      try {
        localStorage.setItem(SAVED, JSON.stringify(r));
      } catch {
        /* ignore */
      }
    } catch (e) {
      setMsg(walletErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function ownerTx(label: string, fn: (wc: ReturnType<typeof clients>["wallet"]) => Promise<Hex>) {
    if (!w.provider || !w.address) return;
    setMsg(null);
    try {
      await ensureChain(w.provider, data!.config.chainId);
      const { wallet, pub } = clients(w.provider, data!.config.chainId, w.address);
      const hash = await fn(wallet);
      await pub.waitForTransactionReceipt({ hash });
      setMsg(`${label} ✓`);
      await reload();
    } catch (e) {
      setMsg(walletErrorText(e));
    }
  }

  const cfg = data.config;
  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <header className="grid gap-1">
        <p>
          <Link href="/admin" className="underline">
            ← Admin
          </Link>
        </p>
        <h1 className="t-page">Chain</h1>
        <p className="t-h2">Deploy &amp; contracts</p>
        <p className="t-meta">
          You deploy from your own wallet (it needs a little ETH on Robinhood Chain for gas). No private key is stored anywhere in the game. After deploying, copy the addresses into Vercel env
          and redeploy.
        </p>
      </header>

      <section className="surface grid gap-2 p-4" aria-label="Status">
        <h2 className="t-h2">Server status</h2>
        <ul className="grid gap-1 text-sm">
          <li>
            WEB3_ENABLED: <strong>{cfg.enabled ? "on" : "off (mock: Premium shows coming soon)"}</strong> · chain {cfg.chainId} ({chainInfo(cfg.chainId).name}) · RPC {cfg.rpcConfigured ? "set" : "missing"}
          </li>
          <li>
            Server signer (QUOTE_SIGNER_PRIVATE_KEY): {cfg.signerAddress ? <span className="font-mono">{cfg.signerAddress}</span> : <strong className="text-negative">not set</strong>} (a dedicated low-value key; only its address is shown)
          </li>
          <li>
            ETH/USD: {data.price?.usd ? `$${data.price.usd.toFixed(2)} (${cfg.priceSource})` : <span className="text-negative">{data.price?.error ?? "unavailable"}</span>}
            {data.price?.sources && <span className="caption block">{data.price.sources.map((s) => `${s.source}: ${s.usd ?? "–"}`).join(" · ")}</span>}
          </li>
          <li>
            Store {cfg.store ? <span className="font-mono">{cfg.store}</span> : "not configured"} · Pool {cfg.pool ? <span className="font-mono">{cfg.pool}</span> : "not configured"}
          </li>
        </ul>
      </section>

      <section className="surface grid gap-3 p-4" aria-label="Deploy" data-testid="chain-deploy">
        <h2 className="t-h2">Deploy PrizePool + PremiumStore</h2>
        <div className="flex flex-wrap items-center gap-3">
          <WalletPicker label="Connect owner wallet" />
          <label className="text-sm">
            Network{" "}
            <select className="field min-h-11" value={net} onChange={(e) => setNet(Number(e.target.value))} data-testid="deploy-network">
              <option value={ROBINHOOD_TESTNET}>Robinhood Chain Testnet (46630)</option>
              <option value={ROBINHOOD_MAINNET}>Robinhood Chain mainnet (4663)</option>
              <option value={LOCAL_HARDHAT}>Local Hardhat (31337)</option>
            </select>
          </label>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            Treasury (receives 70% minus affiliate commissions)
            <input className="field min-h-11 font-mono" value={treasury} onChange={(e) => setTreasury(e.target.value.trim())} placeholder="0x…" />
          </label>
          <label className="grid gap-1 text-sm">
            Server signer address (signs price quotes)
            <input className="field min-h-11 font-mono" value={signer} onChange={(e) => setSigner(e.target.value.trim())} placeholder="0x…" />
          </label>
          <label className="grid gap-1 text-sm">
            Prize Pool share of each sale: {poolPct}%
            <input type="range" min={10} max={50} value={poolPct} onChange={(e) => setPoolPct(Number(e.target.value))} />
          </label>
          <label className="grid gap-1 text-sm">
            Hard cap per player per weekly payout (USD, converted now): ${capUsd} {capWei ? `≈ ${formatEth(capWei, 6)}` : ""}
            <input type="number" className="field min-h-11" min={1} max={1000} value={capUsd} onChange={(e) => setCapUsd(Number(e.target.value))} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={poster} onChange={(e) => setPoster(e.target.checked)} />
          Let the server key post weekly roots (it then needs a little ETH for gas). Otherwise you post them from this wallet in Admin → Prize Pool.
        </label>
        {ownerWalletIsTreasury && <p className="text-sm font-bold text-negative">The treasury equals your affiliate wallet. Allowed, but we recommend separate addresses (clean accounting).</p>}
        {net === ROBINHOOD_MAINNET && (
          <label className="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked={mainnetOk} onChange={(e) => setMainnetOk(e.target.checked)} />
            I understand this deploys to MAINNET with real money, and I tested on testnet first.
          </label>
        )}
        <button type="button" className="btn btn-brass btn-lg" disabled={!w.address || !valid || busy} onClick={deploy} data-testid="deploy-go">
          {busy ? "Confirm each step in your wallet…" : "Deploy (6–7 wallet confirmations)"}
        </button>
        {log.length > 0 && (
          <ol className="inset grid gap-1 p-2 text-sm" data-testid="deploy-log">
            {log.map((l, i) => (
              <li key={i}>
                {l.step}{" "}
                {l.hash && txUrl(net, l.hash) && (
                  <a className="underline" href={txUrl(net, l.hash)!} target="_blank" rel="noreferrer">
                    tx
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}
        {result && (
          <div className="inset grid gap-2 p-3" data-testid="deploy-result">
            <p className="font-bold text-cream">Deployed on {chainInfo(result.chainId).name}. Put these in Vercel (Preview first), then redeploy:</p>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">{envBlock(result)}</pre>
            <p className="text-sm">
              PrizePool{" "}
              <a className="underline font-mono" href={addressUrl(result.chainId, result.prizePool) ?? "#"} target="_blank" rel="noreferrer">
                {result.prizePool}
              </a>
              <br />
              PremiumStore{" "}
              <a className="underline font-mono" href={addressUrl(result.chainId, result.premiumStore) ?? "#"} target="_blank" rel="noreferrer">
                {result.premiumStore}
              </a>
            </p>
          </div>
        )}
      </section>

      {cfg.store && cfg.pool && (
        <section className="surface grid gap-3 p-4" aria-label="Live contracts" data-testid="chain-live">
          <h2 className="t-h2">Live contracts</h2>
          {data.store?.error || data.pool?.error ? (
            <p className="text-negative">{data.store?.error ?? data.pool?.error}</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              <li>
                Store: pool share {(data.store?.poolBps ?? 0) / 100}% · affiliate ceilings {(data.store?.maxRef1Bps ?? 0) / 100}% / {(data.store?.maxRef2Bps ?? 0) / 100}% · treasury{" "}
                {shortAddress(data.store?.treasury)} · {data.store?.paused ? "PAUSED" : "selling"} · signer role {data.store?.signerHasRole ? "✓" : "✗ (grant SIGNER_ROLE)"}
              </li>
              <li>
                Pool: {formatEth(data.pool?.balanceWei ?? "0")} (free {formatEth(data.pool?.availableWei ?? "0")}, promised {formatEth(data.pool?.outstandingWei ?? "0")}) · epochs{" "}
                {data.pool?.lastEpochId} · per-epoch max {(data.pool?.maxEpochBps ?? 0) / 100}% · per-player cap {formatEth(data.pool?.maxClaimPerEpochWei ?? "0")} · {data.pool?.paused ? "PAUSED" : "open"}
              </li>
              <li>
                Sales: {data.sales.fulfilled}/{data.sales.orders} orders fulfilled · {formatEth(data.sales.paidWei)} paid · {data.sales.open} open
              </li>
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {!w.address ? (
              <WalletPicker label="Connect owner wallet for actions" />
            ) : (
              <>
                <button type="button" className="btn btn-sm" onClick={() => ownerTx(data.store?.paused ? "Store unpaused" : "Store paused", (wc) => wc.writeContract({ address: cfg.store!, abi: premiumStoreAbi, functionName: data.store?.paused ? "unpause" : "pause", account: w.address!, chain: wc.chain }))}>
                  {data.store?.paused ? "Unpause store" : "Pause store"}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => ownerTx(data.pool?.paused ? "Pool unpaused" : "Pool paused", (wc) => wc.writeContract({ address: cfg.pool!, abi: prizePoolAbi, functionName: data.pool?.paused ? "unpause" : "pause", account: w.address!, chain: wc.chain }))}>
                  {data.pool?.paused ? "Unpause pool claims" : "Pause pool claims"}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const eth = prompt("Top up the Prize Pool with how much ETH? (owner money; it can never be withdrawn, only paid to players)");
                    if (eth && Number(eth) > 0) void ownerTx("Pool topped up", (wc) => wc.writeContract({ address: cfg.pool!, abi: prizePoolAbi, functionName: "fund", args: [`0x${"00".repeat(32)}`], value: parseEther(eth), account: w.address!, chain: wc.chain }));
                  }}
                >
                  Top up pool
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const pct = Number(prompt("Prize Pool share of future sales (10-50 %)", String((data.store?.poolBps ?? 3000) / 100)));
                    if (pct >= 10 && pct <= 50) void ownerTx("Pool share updated", (wc) => wc.writeContract({ address: cfg.store!, abi: premiumStoreAbi, functionName: "setPoolBps", args: [Math.round(pct * 100)], account: w.address!, chain: wc.chain }));
                  }}
                >
                  Change pool share
                </button>
              </>
            )}
          </div>
          {data.orders.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm">Recent orders ({data.orders.length})</summary>
              <ul className="grid gap-1 pt-2 text-xs">
                {data.orders.map((o) => (
                  <li key={o.orderId} className="font-mono">
                    {new Date(o.createdAtMs).toLocaleString("en-GB")} · {o.status} · {o.quantity}× · ${(o.usdCents / 100).toFixed(2)} · {formatEth(o.priceWei, 6)}
                    {o.txHash && txUrl(cfg.chainId, o.txHash) ? (
                      <>
                        {" "}
                        ·{" "}
                        <a className="underline" href={txUrl(cfg.chainId, o.txHash)!} target="_blank" rel="noreferrer">
                          tx
                        </a>
                      </>
                    ) : null}
                    {o.error ? ` · ${o.error}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <OwnerRoot owner={data.owner} onDone={reload} />
      {msg && <p className="surface p-3 font-bold">{msg}</p>}
    </div>
  );
}

function OwnerRoot({ owner, onDone }: { owner: ChainStatus["owner"]; onDone: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="surface grid gap-2 p-4" aria-label="Owner account">
      <h2 className="t-h2">Owner account (root of the invite tree)</h2>
      <p className="text-sm text-cream-dim">
        Everyone who signs up with an admin invite code becomes your level-1 invitee, and their invitees your level 2. Commissions go to the owner stable&apos;s verified wallet (keep it different
        from the treasury). To claim: open the game in THIS browser with your own stable, verify its wallet on Profile, then press the button.
      </p>
      <p className="text-sm">
        Current owner: {owner ? <span className="font-mono">{owner.accountId.slice(0, 8)}… · wallet {owner.wallet ? shortAddress(owner.wallet) : "none"}</span> : <strong>not set</strong>}
      </p>
      <button
        type="button"
        className="btn w-fit"
        onClick={async () => {
          setMsg(null);
          try {
            const r = await adminFetch<{ wallet: string }>("/api/admin/chain/owner", { body: {} });
            setMsg(`Owner set ✓ (affiliate wallet ${shortAddress(r.wallet)})`);
            onDone();
          } catch (e) {
            setMsg((e as Error).message);
          }
        }}
        data-testid="claim-owner"
      >
        Make the stable on this browser the owner
      </button>
      {msg && <p className="text-sm font-bold">{msg}</p>}
    </section>
  );
}
