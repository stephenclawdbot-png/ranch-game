"use client";
/**
 * Bring a rival: your rival invite link. A friend who founds a stable through it becomes your
 * rival at once (both Rivals panels say who invited whom) and you both get a one-time credits
 * welcome. Credits only; linked accounts (same browser, wallet, email ...) get no welcome.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { deviceId } from "@/lib/deviceId";
import { api } from "@/lib/player";
import { EmptyState, HowItWorks, PageHeader, Section } from "../ui/Page";

interface RivalInviteView {
  link: string;
  code: string;
  credits: number;
  weeklyWelcomes: number;
  accepted: number;
  thisWeek: number;
  declared: { stableId: string; stableName: string; direction: "invited" | "invited_by"; atMs: number }[];
}

export function BringRival() {
  const [v, setV] = useState<RivalInviteView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api<RivalInviteView>("/api/rivals/invite", { body: { deviceId: deviceId() } })
      .then(setV)
      .catch((e: Error) => setErr(e.message));
  }, []);
  if (err) return <p className="surface p-3 text-negative">{err}</p>;
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
    if (navigator.share) await navigator.share({ title: "Post Time", text: "Run a racing stable and be my rival on Post Time", url: v!.link }).catch(() => null);
    else await copy();
  }

  return (
    <div className="grid gap-5" data-testid="bring-rival">
      <PageHeader scene="grandstand" back={{ href: "/", label: "Home" }} eyebrow="Rivals" title="Bring a rival" meta="Challenge a friend: when they found a stable through your link, you're rivals from day one." />
      <section className="frame-hero grid gap-3 p-4 sm:p-5" aria-labelledby="rival-link-h">
        <h2 id="rival-link-h" className="t-hero">
          Your rival link
        </h2>
        <p className="t-meta">You both get {v.credits} credits once, when they found their stable. Free to play, nothing to buy.</p>
        <input className="field min-h-11 font-mono text-sm" readOnly value={v.link} onFocus={(e) => e.currentTarget.select()} data-testid="rival-link" aria-label="Your rival link" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-brass" onClick={copy} data-testid="rival-copy">
            {copied ? "Copied ✓" : "Copy link"}
          </button>
          <button type="button" className="btn" onClick={share}>
            Share
          </button>
        </div>
      </section>

      <Section id="declared-h" title="Your invited rivals" aside={<span className="eyebrow">{v.accepted} took up the challenge</span>}>
        {v.declared.length === 0 ? (
          <EmptyState icon="silks-sash" title="No one yet" text="Send your link to a friend who'd enjoy beating you." />
        ) : (
          <ul className="surface rows !p-0" data-testid="declared-rivals">
            {v.declared.map((d) => (
              <li key={d.stableId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <Link href={`/stables/${d.stableId}`} className="font-bold text-cream underline-offset-2 hover:underline">
                  {d.stableName}
                </Link>
                <span className="tag">{d.direction === "invited" ? `You invited ${d.stableName}` : `${d.stableName} invited you`}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <HowItWorks>
        <p>Your friend opens your link and founds a stable. From then on you&apos;re rivals: each of you sees the other on your Rivals panel, with your head-to-head as your horses meet in Live races.</p>
        <p>
          You both get {v.credits} Stable Credits, once per new stable. Your side of the welcome is paid for up to {v.weeklyWelcomes} new rivals a week ({v.thisWeek} so far this week); your friends always get theirs.
        </p>
        <p>Accounts that share a browser, wallet or email are linked: they still become rivals, but nobody gets the welcome. Credits are never cashed out and nothing here pays USDG.</p>
        <p>
          <Link href="/wiki/rivals-and-news#bring-a-rival" className="link">
            More in the wiki
          </Link>
        </p>
      </HowItWorks>
    </div>
  );
}
