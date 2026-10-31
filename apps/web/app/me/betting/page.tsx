"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import * as gc from "@thoroughbred/game-core";
import type { ToteSettingsView } from "@thoroughbred/db";
import { PlayerGate } from "@/components/PlayerGate";
import { PageHeader } from "@/components/ui/Page";
import { CURRENCY_LABEL, parseStake } from "@/components/tote/TotePanel";
import type { PlayerState } from "@/lib/player";

type Currency = gc.ToteCurrency;

const EXCLUSIONS: { v: gc.ToteSelfExclusion; label: string }[] = [
  { v: "24h", label: "24 hours" },
  { v: "7d", label: "7 days" },
  { v: "30d", label: "30 days" },
  { v: "permanent", label: "Permanently" },
];

const fmt = (c: Currency, n: number | null) => (n === null ? "No limit of your own" : gc.formatToteAmount(c, n));
const asText = (c: Currency, n: number | null) => (n === null ? "" : c === "CR" ? String(n) : (n / gc.TOTE_USDG_UNIT).toFixed(2).replace(/\.00$/, ""));
const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function send(body: unknown): Promise<ToteSettingsView> {
  const res = await fetch("/api/me/betting", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as (ToteSettingsView & { message?: string }) | null;
  if (!res.ok || !json) throw new Error(json?.message ?? "Couldn't save that. Try again.");
  return json;
}

function LimitsForm({ currency, view, onSaved }: { currency: Currency; view: ToteSettingsView; onSaved: (v: ToteSettingsView) => void }) {
  const own = view.limits[currency];
  const [perRace, setPerRace] = useState(asText(currency, own.perRace));
  const [perDay, setPerDay] = useState(asText(currency, own.perDay));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pending = view.pending?.[currency];
  const parse = (t: string) => (t.trim() === "" ? null : parseStake(currency, t));
  const r = parse(perRace);
  const d = parse(perDay);
  const bad = (perRace.trim() !== "" && r === null) || (perDay.trim() !== "" && d === null);
  return (
    <div className="surface grid gap-3 p-4" data-testid={`limits-${currency}`}>
      <h3 className="t-title">{CURRENCY_LABEL[currency]}</h3>
      <ul className="grid gap-1 text-sm text-cream-dim">
        <li>
          Game limits: {gc.formatToteAmount(currency, view.game.min[currency])} smallest bet · {gc.formatToteAmount(currency, view.game.perRace[currency])}
          {currency === "CR" ? ` or ${view.game.balancePermille / 10}% of your balance, whichever is lower,` : ""} per race · {gc.formatToteAmount(currency, view.game.perDay[currency])} a day
        </li>
        <li>
          Your limits now: {fmt(currency, own.perRace)} per race · {fmt(currency, own.perDay)} a day
        </li>
        {pending && view.pendingAtMs && (
          <li data-testid={`limits-pending-${currency}`}>
            From {when(view.pendingAtMs)}: {fmt(currency, pending.perRace)} per race · {fmt(currency, pending.perDay)} a day
          </li>
        )}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-bold">
          Most per race
          <input className="field" inputMode={currency === "CR" ? "numeric" : "decimal"} value={perRace} placeholder="No limit of your own" onChange={(e) => setPerRace(e.target.value)} data-testid={`limit-race-${currency}`} />
        </label>
        <label className="grid gap-1 text-sm font-bold">
          Most per day
          <input className="field" inputMode={currency === "CR" ? "numeric" : "decimal"} value={perDay} placeholder="No limit of your own" onChange={(e) => setPerDay(e.target.value)} data-testid={`limit-day-${currency}`} />
        </label>
      </div>
      <p className="caption">Lower limits apply at once. Raising or removing one takes 24 hours.</p>
      <button
        type="button"
        className="btn w-fit"
        disabled={busy || bad}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const v = await send({ action: "limits", currency, perRace: r, perDay: d });
            onSaved(v);
            setMsg({ ok: true, text: v.pending?.[currency] ? "Saved. The higher limit starts in 24 hours." : "Saved." });
          } catch (e) {
            setMsg({ ok: false, text: (e as Error).message });
          } finally {
            setBusy(false);
          }
        }}
        data-testid={`limits-save-${currency}`}
      >
        Save limits
      </button>
      {msg && <p className={`text-sm font-bold ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
    </div>
  );
}

function Betting({ state }: { state: PlayerState }) {
  const [view, setView] = useState<ToteSettingsView | null>(null);
  const [failed, setFailed] = useState(false);
  const [choice, setChoice] = useState<gc.ToteSelfExclusion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adultTick, setAdultTick] = useState(false);

  useEffect(() => {
    fetch("/api/me/betting", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ToteSettingsView>) : Promise.reject(new Error(String(r.status)))))
      .then(setView)
      .catch(() => setFailed(true));
  }, []);

  async function act(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      setView(await send(body));
      setChoice(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-3xl content-start gap-4" data-testid="betting-limits-page">
      <PageHeader
        back={{ href: "/me", label: "Profile" }}
        eyebrow={state.stableName}
        title="Betting limits"
        meta="The tote is optional: you never need to bet to play, and it never pays out anything but game currency. Set limits that suit you, or take a break."
      />
      {!view ? (
        failed ? <p className="surface p-4">Couldn&rsquo;t load your settings. Try again in a moment.</p> : <div className="min-h-40" aria-busy />
      ) : (
        <>
          <section className="surface grid gap-2 p-4" aria-labelledby="age-h">
            <h2 id="age-h" className="t-h2">
              Age
            </h2>
            {view.adultConfirmed ? (
              <p className="text-sm text-cream-dim" data-testid="age-confirmed">
                ✓ You confirmed you are 18 or over.
              </p>
            ) : (
              <>
                <p className="text-sm text-cream-dim">Betting is for players aged 18 or over.</p>
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input type="checkbox" checked={adultTick} onChange={(e) => setAdultTick(e.target.checked)} /> I confirm I am 18 or over
                </label>
                <button type="button" className="btn w-fit" disabled={!adultTick || busy} onClick={() => act({ action: "confirm_adult" })}>
                  Confirm
                </button>
              </>
            )}
          </section>

          <section className="grid gap-3" aria-labelledby="limits-h">
            <h2 id="limits-h" className="t-h2">
              Your limits
            </h2>
            {view.currencies.map((c) => (
              <LimitsForm key={c} currency={c} view={view} onSaved={setView} />
            ))}
          </section>

          <section className="surface grid gap-3 p-4" aria-labelledby="break-h" data-testid="self-exclusion">
            <h2 id="break-h" className="t-h2">
              Take a break
            </h2>
            {view.excludedPermanent ? (
              <p className="font-bold" data-testid="excluded">
                You have closed betting on this account for good.
              </p>
            ) : view.excludedUntilMs ? (
              <p className="font-bold" data-testid="excluded">
                Betting is closed for you until {when(view.excludedUntilMs)}.
              </p>
            ) : (
              <p className="text-sm text-cream-dim">Stop yourself betting for a while. Racing, breeding and everything else carry on as normal.</p>
            )}
            {!view.excludedPermanent && (
              <>
                <div className="flex flex-wrap gap-2">
                  {EXCLUSIONS.map((x) => (
                    <button key={x.v} type="button" className="btn btn-sm" aria-pressed={choice === x.v} onClick={() => setChoice(x.v)} data-testid={`exclude-${x.v}`}>
                      {x.label}
                    </button>
                  ))}
                </div>
                {choice && (
                  <div className="inset grid gap-2 p-3 text-sm" data-testid="exclude-confirm">
                    <p className="font-bold">
                      {choice === "permanent"
                        ? "Close betting on this account for good? This can't be undone."
                        : `Close betting for ${EXCLUSIONS.find((x) => x.v === choice)!.label}? It can't be shortened or lifted early.`}
                    </p>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-oxblood btn-sm" disabled={busy} onClick={() => act({ action: "exclude", choice })}>
                        Yes, close betting
                      </button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setChoice(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            {error && <p className="text-sm font-bold text-negative">{error}</p>}
          </section>

          <p className="t-meta">
            How the tote works, with every number: <Link href="/wiki/tote" className="link font-bold">The tote</Link> · Your history: <Link href="/me/bets" className="link font-bold">My bets</Link>
          </p>
        </>
      )}
    </div>
  );
}

export default function BettingLimitsPage() {
  return <PlayerGate>{(state) => <Betting state={state} />}</PlayerGate>;
}
