"use client";
/**
 * Invite friends (2-level affiliate program, closed beta): your personal link, your invitees
 * (level 1 = you invited them, level 2 = they were invited by your invitees) with their
 * activity, your earnings with explorer links, and the rules in plain words.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { txUrl } from "@/lib/chain/chains";
import { formatEth, formatUsdCents } from "@/lib/chain/format";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { WalletLink } from "./WalletLink";
import { EmptyState, HowItWorks, PageHeader } from "@/components/ui/Page";

interface InviteView {
  code: string;
  link: string;
  wallet: string | null;
  isOwner: boolean;
  chainId: number;
  /** Practice mode (T-USDG test money): no commission is paid. */
  practice?: boolean;
  rules: { level1Pct: number; level2Pct: number; windowDays: number; weeklyCapUsdCents: number; activeReward: { credits: number; minRaces: number; minPlayDays: number } };
  invitees: { stableName: string | null; level: 1 | 2; joinedAt: number; races: number; playDays: number; active: boolean; activatedAt: number | null; windowEndsAt: number; revoked: boolean }[];
  earnings: { level: number; amountWei: string; usdCents: number; deferred: boolean; txHash: string; createdAtMs: number }[];
  totals: { level1: number; level2: number; active: number; earnedWei: string; earnedUsdCents: number };
}

export function InviteScreen() {
  const [v, setV] = useState<InviteView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetch("/api/referrals", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? `HTTP ${r.status}`);
        setV(d);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  if (err) return <p className="surface p-3 text-negative">{err === "Found a stable first." ? "Found a stable first, then invite your friends." : err}</p>;
  if (!v) return <p className="surface caption p-3" aria-busy>Loading…</p>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(v!.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the link is selectable */
    }
  }
  async function share() {
    if (navigator.share) await navigator.share({ title: "Post Time", text: "Run a racing stable with me on Post Time", url: v!.link }).catch(() => null);
    else await copy();
  }

  const r = v.rules;
  return (
    <div className="grid gap-5" data-testid="invite">
      <PageHeader scene="grandstand" back={{ href: "/me", label: "Profile" }} eyebrow="Closed beta" title="Invite friends" meta="Invite friends to the beta, and earn a share when they buy packs." />

      <section className="frame-hero grid gap-3 p-4 sm:p-5" aria-labelledby="link-h">
        <h2 id="link-h" className="t-hero">
          Your invite link
        </h2>
        <p className="t-meta">Inviting and playing are free. You get {r.activeReward.credits} credits when a friend settles in.</p>
        <input className="field min-h-11 font-mono text-sm" readOnly value={v.link} onFocus={(e) => e.currentTarget.select()} data-testid="invite-link" aria-label="Your invite link" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-brass" onClick={copy} data-testid="invite-copy">
            {copied ? "Copied ✓" : "Copy link"}
          </button>
          <button type="button" className="btn" onClick={share}>
            Share
          </button>
          <span className="tag tag-locked self-center font-mono normal-case" data-testid="invite-code">
            {v.code}
          </span>
        </div>
      </section>

      {!v.wallet && (
        <section className="surface grid gap-2 p-4">
          <h2 className="t-h2">Your share goes to your wallet</h2>
          <p className="t-meta">Link one to receive it. Without a wallet your share stays with the game (past purchases aren&apos;t paid later).</p>
          <WalletLink compact />
        </section>
      )}

      <section className="surface grid grid-cols-3 divide-x-2 divide-dotted divide-paper-rule p-2" aria-label="Totals">
        <Stat label="Friends" value={v.totals.level1 + v.totals.level2} />
        <Stat label="Active" value={v.totals.active} />
        <Stat label="Your share" value={`${formatEth(v.totals.earnedWei, 4)}`} sub={formatUsdCents(v.totals.earnedUsdCents)} />
      </section>

      <section aria-labelledby="inv-h">
        <SectionHeader id="inv-h" title="Your invitees" />
        {v.invitees.length === 0 ? (
          <EmptyState icon="ticket" title="Nobody yet" text="Send your link to a friend who'd enjoy running a stable." />
        ) : (
          <ul className="surface rows !p-0" data-testid="invitees">
            {v.invitees.map((i, k) => (
              <li key={k} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>
                  <span className="font-bold text-cream">{i.stableName ?? "A new stable"}</span>{" "}
                  <span className="caption">{i.level === 1 ? "invited by you · Level 1" : "invited by a friend · Level 2"}</span>
                  <span className="caption block">
                    Joined {new Date(i.joinedAt).toLocaleDateString("en-GB")} · {i.races} races · {i.playDays} days played
                    {i.revoked ? " · referral revoked" : Date.now() > i.windowEndsAt ? " · commission window ended" : ` · commissions until ${new Date(i.windowEndsAt).toLocaleDateString("en-GB")}`}
                  </span>
                </span>
                <span className={i.active ? "tag tag-good" : "tag"}>{i.active ? "Active ✓" : `Getting started (${Math.min(i.races, r.activeReward.minRaces)}/${r.activeReward.minRaces} races)`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="earn-h">
        <SectionHeader id="earn-h" title="Your share" />
        {v.earnings.length === 0 ? (
          <p className="t-meta">Nothing yet. When a friend buys a pack, your share shows here with its receipt.</p>
        ) : (
          <ul className="surface rows !p-0" data-testid="earnings">
            {v.earnings.map((e, k) => (
              <li key={k} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span>
                  {formatEth(e.amountWei, 6)} <span className="caption">({formatUsdCents(e.usdCents)} at the time · level {e.level})</span>
                  {e.deferred && <span className="caption block">Your wallet refused the instant payment: collect it with withdrawReferral on the store contract.</span>}
                </span>
                <span className="caption">
                  {new Date(e.createdAtMs).toLocaleDateString("en-GB")}{" "}
                  {txUrl(v.chainId, e.txHash) && (
                    <a className="underline" href={txUrl(v.chainId, e.txHash)!} target="_blank" rel="noreferrer">
                      tx
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-1" data-testid="invite-rules">
      <p className="t-meta">You never need to buy anything to invite or to earn: inviting is free, and so is playing.</p>
      <HowItWorks label="How rewards work">
        <ul className="grid list-disc gap-1 pl-5 text-sm">
          <li>
            <strong>You never need to buy anything to invite or to earn.</strong> Inviting is free, and so is playing.
          </li>
          <li>
            When someone you invited becomes active ({r.activeReward.minRaces} races and {r.activeReward.minPlayDays} days played), you get {r.activeReward.credits} Stable Credits and the
            Recruiter badge. Credits stay in the game.
          </li>
          {v.practice ? (
            <li data-testid="invite-practice">
              <strong>During the beta no commission is paid:</strong> Premium Packs are bought with T-USDG test money, which pays nobody. Inviting still earns the credits reward above.
            </li>
          ) : (
          <li>
            If they buy a Premium Pack with ETH, you receive {r.level1Pct}% of the price, instantly, from the store contract. If someone THEY invited buys, you receive {r.level2Pct}%. Two levels,
            no more.
          </li>
          )}
          <li>Commissions are paid for purchases within {r.windowDays} days of your invitee joining, up to {formatUsdCents(r.weeklyCapUsdCents)} a week in total.</li>
          <li>Commissions come out of the game&apos;s share of the sale. The Prize Pool&apos;s share is never touched.</li>
          <li>
            Fair play: your invitees must use their own wallet. Invites between linked accounts (same device, network or wallet) earn nothing and are flagged for review; the organiser can
            revoke a referral. Payments already made on-chain are final.
          </li>
        </ul>
      </HowItWorks>
      </div>
      <p className="caption">
        <Link href="/pool" className="underline">
          Prize Pool
        </Link>
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="grid justify-items-center gap-0.5 p-2 text-center">
      <span className="label">{label}</span>
      <span className="score text-[1.875rem] leading-none">{value}</span>
      {sub && <span className="caption">{sub}</span>}
    </div>
  );
}
