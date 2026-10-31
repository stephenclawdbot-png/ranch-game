"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import * as gc from "@thoroughbred/game-core";
import type { MyToteBet, MyToteHistory } from "@thoroughbred/db";
import { PlayerGate } from "@/components/PlayerGate";
import { EmptyState, PageHeader } from "@/components/ui/Page";
import { CURRENCY_LABEL } from "@/components/tote/TotePanel";
import type { PlayerState } from "@/lib/player";

const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function statusLine(b: MyToteBet): { text: string; tone: string } {
  const amt = (n: number) => gc.formatToteAmount(b.currency, n);
  switch (b.status) {
    case "open":
      return {
        text: b.potentialReturn !== null ? `Open · returns about ${amt(b.potentialReturn)} if it ${b.pool === "win" ? "wins" : "places"} at the current pool (changes until the off)` : "Open · waiting for the result",
        tone: "text-cream-dim",
      };
    case "won":
      return { text: `Won · ${amt(b.payout)} back (${b.payout - b.stake >= 0 ? "+" : "−"}${amountOnly(b.currency, Math.abs(b.payout - b.stake))})`, tone: "text-positive" };
    case "lost":
      return { text: `Lost · −${amountOnly(b.currency, b.stake)}`, tone: "text-negative" };
    case "returned":
      return { text: `Returned ${amt(b.payout)} · nobody backed a paying runner`, tone: "text-cream-dim" };
    case "void":
      return { text: `Refunded ${amt(b.payout)}${b.voidReason ? ` · ${b.voidReason.replace(/^void: /, "")}` : ""}`, tone: "text-cream-dim" };
  }
}

function amountOnly(c: gc.ToteCurrency, n: number) {
  return gc.formatToteAmount(c, n);
}

function MyBets({ state }: { state: PlayerState }) {
  const [data, setData] = useState<MyToteHistory | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/me/bets", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<MyToteHistory>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="mx-auto grid max-w-4xl content-start gap-4" data-testid="my-bets-page">
      <PageHeader
        back={{ href: "/me", label: "Profile" }}
        eyebrow={state.stableName}
        title="My bets"
        meta={
          <>
            Your tote bets and how they went. The tote takes {gc.TOTE_TAKEOUT_PERMILLE / 10}% of every pool to the sink.{" "}
            <Link href="/me/betting" className="link font-bold">
              Betting limits
            </Link>
          </>
        }
      />

      {data && data.summary.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="bets-summary">
          {data.summary.map((s) => (
            <div key={s.currency} className="surface grid gap-1 p-4">
              <p className="label">{CURRENCY_LABEL[s.currency]}</p>
              <p className={`num text-[1.75rem] leading-8 ${s.net > 0 ? "text-positive" : s.net < 0 ? "text-negative" : "text-cream"}`} data-testid={`bets-net-${s.currency}`}>
                {s.net > 0 ? "+" : s.net < 0 ? "−" : ""}
                {gc.formatToteAmount(s.currency, Math.abs(s.net))}
              </p>
              <p className="t-meta">
                Staked {gc.formatToteAmount(s.currency, s.staked)} · returned {gc.formatToteAmount(s.currency, s.returned)} · {s.won} of {s.bets} {s.bets === 1 ? "bet" : "bets"} won
                {s.open > 0 ? ` · ${gc.formatToteAmount(s.currency, s.open)} still running` : ""}
              </p>
            </div>
          ))}
        </div>
      )}

      {data && data.bets.length > 0 ? (
        <ul className="surface rows" data-testid="bets-list">
          {data.bets.map((b) => {
            const s = statusLine(b);
            return (
              <li key={b.id}>
                <Link href={`/race/${b.raceId}`} className="row-link group gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="font-extrabold group-hover:underline">
                        {b.horseName} · {b.pool === "win" ? "Win" : "Place"}
                      </span>
                      <span className="num">{gc.formatToteAmount(b.currency, b.stake)}</span>
                    </span>
                    <span className="t-meta block">
                      {b.raceName} · {b.postTimeMs ? when(b.postTimeMs) : ""}
                    </span>
                    <span className={`block text-sm ${s.tone}`}>{s.text}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : data ? (
        <EmptyState icon="ticket" title="No bets yet" text="Live card races have a Tote panel on the race page. Betting is optional and never needed to play." />
      ) : failed ? (
        <EmptyState icon="cross" title="Couldn't load your bets" text="Check your connection and try again." />
      ) : (
        <div className="min-h-40" aria-busy />
      )}
    </div>
  );
}

export default function MyBetsPage() {
  return <PlayerGate>{(state) => <MyBets state={state} />}</PlayerGate>;
}
