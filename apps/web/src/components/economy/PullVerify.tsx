"use client";
/**
 * "Verify this pull": the browser re-derives a pack pull from its revealed seed with the same
 * game-core code the server ran: the seal (sha256 of the seed) published before the pull, the
 * pity counters (replayed from every earlier revealed seed), the rarity roll and the foal's
 * genome and sex. Nothing here trusts the server's own verdict.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { commitSeed, pullPack, pullSex, NEW_PITY, type PackType, type PityState } from "@thoroughbred/game-core";
import { ErrorNote } from "@/components/ui/ErrorNote";
import type { PullProofView } from "@/lib/economyTypes";
import { Check, RARITY_LABEL, RarityBadge, Skeleton, useEcoView } from "./kit";

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((v, i) => jsonEqual(v, (b as unknown[])[i]));
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ka = Object.keys(ao).filter((k) => ao[k] !== undefined);
  return ka.length === Object.keys(bo).filter((k) => bo[k] !== undefined).length && ka.every((k) => jsonEqual(ao[k], bo[k]));
}

interface LocalCheck {
  commitment: boolean;
  chain: boolean;
  pity: PityState;
  rarity: boolean;
  rolled: string;
  roll: number;
  pityRule: boolean;
  genome: boolean;
  sex: boolean;
}

export function recheck(p: PullProofView): LocalCheck {
  const type = p.pull.packType as PackType;
  let pity: PityState = { ...NEW_PITY };
  let chain = true;
  for (const c of p.chain) {
    try {
      const r = pullPack(type, pity, { serverSeed: c.seedReveal, accountId: p.accountId, season: c.seasonNumber });
      if (r.pull.rarity !== c.rarity || c.pullIndex !== pity.pulls + 1) chain = false;
      pity = r.pity;
    } catch {
      chain = false;
    }
  }
  let commitment = false;
  try {
    commitment = commitSeed(p.seedReveal) === p.pull.seedCommitment;
  } catch {
    commitment = false;
  }
  const { pull } = pullPack(type, pity, { serverSeed: p.seedReveal, accountId: p.accountId, season: p.seasonNumber });
  return {
    commitment,
    chain,
    pity,
    rarity: pull.rarity === p.pull.rarity && p.pull.pullIndex === pity.pulls + 1,
    rolled: pull.rarity,
    roll: pull.roll,
    pityRule: (pull.pityTriggered === "none" ? null : pull.pityTriggered) === p.pull.pityApplied,
    genome: p.genome === null || jsonEqual(pull.genome, p.genome),
    sex: p.sex === null || pullSex(pull) === p.sex,
  };
}

export function PullVerify({ id }: { id: string }) {
  const { data, error, reload } = useEcoView<PullProofView>(`/api/packs/pulls/${encodeURIComponent(id)}`);
  const [local, setLocal] = useState<LocalCheck | null>(null);
  const [failed, setFailed] = useState(false);
  const [runs, setRuns] = useState(0);
  useEffect(() => {
    if (!data) return;
    try {
      setLocal(recheck(data));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [data, runs]);

  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={3} />;
  const p = data;
  const ok = !!local && local.commitment && local.chain && local.rarity && local.pityRule && local.genome && local.sex;
  return (
    <div className="grid gap-5">
      <header className="grid gap-2">
        <Link href="/packs" className="t-meta w-fit underline decoration-2 underline-offset-4 hover:text-cream">
          ← Packs
        </Link>
        <h1 className="t-page">Pull integrity</h1>
        <div className="flex flex-wrap items-center gap-2">
          <RarityBadge rarity={p.pull.rarity} />
          <span className="t-meta">
            {p.pull.packType === "premium" ? "Premium" : "Paddock"} Pack #{p.pull.pullIndex}
            {p.pull.horseName ? ` · ${p.pull.horseName}` : ""}
          </span>
        </div>
      </header>

      <section className={`${ok ? "surface-2" : "inset"} grid gap-2 p-4`} aria-live="polite" data-testid="verify-result" data-verified={ok ? "true" : "false"}>
        <h2 className="t-h2">{local ? (ok ? "✓ Verified in your browser" : "✗ Doesn't match") : failed ? "Couldn't re-check" : "Checking…"}</h2>
        {local && (
          <ul className="grid gap-1">
            <Check ok={local.commitment}>The seal published before the pull is the sha256 fingerprint of the revealed seed.</Check>
            <Check ok={local.chain}>Your {p.chain.length} earlier {p.chain.length === 1 ? "pull replays" : "pulls replay"} to the same results (that sets the pity counters).</Check>
            <Check ok={local.rarity}>
              The roll is {local.roll} of 10,000, which gives <b>{RARITY_LABEL[local.rolled as keyof typeof RARITY_LABEL] ?? local.rolled}</b>
              {local.pityRule && p.pull.pityApplied ? " after the pity guarantee" : ""}.
            </Check>
            <Check ok={local.pityRule}>Pity: {p.pull.pityApplied ? "the guarantee applied, as the rules say" : "no guarantee was needed"}.</Check>
            <Check ok={local.genome}>The foal&apos;s genes are exactly the ones this seed produces.</Check>
            <Check ok={local.sex}>So is the foal&apos;s sex.</Check>
          </ul>
        )}
        <button type="button" className="btn btn-sm w-fit" onClick={() => setRuns((n) => n + 1)}>
          Re-check
        </button>
      </section>

      <section className="surface grid gap-2 p-3 text-sm" aria-labelledby="seal-h">
        <h2 id="seal-h" className="label">
          The seal
        </h2>
        <dl className="grid gap-2">
          <div>
            <dt className="label">Fingerprint published before the pull</dt>
            <dd className="break-all font-mono text-xs text-cream" data-testid="seal-commitment">
              {p.pull.seedCommitment}
            </dd>
          </div>
          <div>
            <dt className="label">Seed revealed with the result</dt>
            <dd className="break-all font-mono text-xs text-cream">{p.seedReveal}</dd>
          </div>
          <div>
            <dt className="label">Pity before this pull</dt>
            <dd className="text-cream">
              {local ? `${local.pity.pulls} earlier pulls · ${local.pity.sinceRare} since ${p.pull.packType === "paddock" ? "Uncommon" : "Rare"}+${p.pull.packType === "premium" ? ` · ${local.pity.sinceEpic} since Epic+` : ""}` : "–"}
            </dd>
          </div>
        </dl>
      </section>

      <details className="surface p-3 text-sm">
        <summary className="font-bold text-cream">How it works</summary>
        <div className="mt-2 grid gap-2 text-cream-dim">
          <p>Before every pull the server picks a secret random seed and shows you only its fingerprint (the seal). It can't change the seed afterwards without breaking the seal.</p>
          <p>
            When you open the pack the seed is revealed. The pull&apos;s own seed is derived from it with your account id and pull number, rolled against the published odds, then the pity
            rule is applied. The same seed also fixes the foal&apos;s genes.
          </p>
          <p>Your browser just ran that same code. The seal proves this pull wasn&apos;t altered after it was sealed; the published odds and pity are the rules every pull follows.</p>
        </div>
      </details>
    </div>
  );
}
