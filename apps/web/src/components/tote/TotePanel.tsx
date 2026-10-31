"use client";

/**
 * The tote on a race page: pool betting for spectators (game-core tote.ts, db services/tote.ts).
 * Runners with live odds and pool share bars (Win / Place), the bet slip, your bets and, once the
 * result is public, the tote audit with the dividends. Plain and responsible: the take and the
 * limits link are always on show; no promotions, nothing that nudges.
 *
 * The board is the same for every viewer (CDN-cached for a couple of seconds) and polled every
 * TOTE_ODDS_POLL_MS before the off. After the off the pools are frozen (no bets in running).
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as gc from "@thoroughbred/game-core";
import type { MyToteBet, MyToteRace, ToteAuditRow, ToteBoard } from "@thoroughbred/db";
import { refreshPlayer } from "@/lib/player";
import { Saddlecloth } from "../race/Saddlecloth";
import { PixelIcon } from "../icons";
import { RealToteSlip } from "./RealToteSlip";

type Currency = gc.ToteCurrency;
type Pool = gc.TotePoolKind;
type BoardRes = { available: false } | { available: true; board: ToteBoard };
type MeRes = { signedIn: false } | { signedIn: true; me: MyToteRace | null };

const TAKE_PCT = gc.TOTE_TAKEOUT_PERMILLE / 10;
const QUICK: Record<Currency, number[]> = { CR: [10, 50, 100, 250], TUSDG: [gc.TOTE_USDG_UNIT / 2, gc.TOTE_USDG_UNIT, 2 * gc.TOTE_USDG_UNIT, 5 * gc.TOTE_USDG_UNIT] };
export const CURRENCY_LABEL: Record<Currency, string> = { CR: "Credits", TUSDG: "T-USDG" };

/** Amount without the unit word, for tight rows: "1,250" / "2.50". */
export function amountShort(currency: Currency, units: number): string {
  return gc.formatToteAmount(currency, units).replace(/ (credits|T-USDG)$/, "");
}

/** Stake text -> base units (credits: whole numbers; T-USDG: up to 2 decimals). Null when not a number. */
export function parseStake(currency: Currency, text: string): number | null {
  const t = text.trim();
  if (currency === "CR") return /^\d{1,9}$/.test(t) ? Number(t) : null;
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * gc.TOTE_USDG_UNIT + Number((m[2] ?? "0").padEnd(2, "0")) * 10_000;
}

function stakeText(currency: Currency, units: number): string {
  return currency === "CR" ? String(units) : (units / gc.TOTE_USDG_UNIT).toFixed(2).replace(/\.00$/, "");
}

/** Polls the public board (and your side when signed in): every few seconds before the off, slower until settled, then stops. */
export function useTote(raceId: string, enabled = true) {
  const [board, setBoard] = useState<ToteBoard | null | undefined>(undefined);
  const [me, setMe] = useState<MeRes | null>(null);
  const status = useRef<ToteBoard["status"] | null>(null);
  const load = useCallback(async () => {
    try {
      const [b, m] = await Promise.all([
        fetch(`/api/races/${encodeURIComponent(raceId)}/tote`).then((r) => (r.ok ? (r.json() as Promise<BoardRes>) : null)),
        fetch(`/api/races/${encodeURIComponent(raceId)}/tote/me`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<MeRes>) : null)),
      ]);
      if (b) {
        setBoard(b.available ? b.board : null);
        status.current = b.available ? b.board.status : "settled";
      }
      if (m) setMe(m);
    } catch {
      /* keep the last board; the next poll retries */
    }
  }, [raceId]);
  useEffect(() => {
    if (!enabled) return;
    let t: ReturnType<typeof setTimeout>;
    let live = true;
    const tick = async () => {
      await load();
      if (!live) return;
      const s = status.current;
      if (s === "settled" || s === "abandoned") return;
      t = setTimeout(tick, s === "open" || s === null ? gc.TOTE_ODDS_POLL_MS : 10_000);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [enabled, load]);
  return { board, me, setMe, reload: load };
}

function OddsRow({
  runner,
  odds,
  currency,
  selected,
  onSelect,
  betting,
}: {
  runner: ToteBoard["runners"][number];
  odds: gc.ToteRunnerOdds | undefined;
  currency: Currency;
  selected: boolean;
  onSelect: () => void;
  betting: boolean;
}) {
  const share = odds?.sharePermille ?? 0;
  const body = (
    <>
      {runner.gate ? <Saddlecloth gate={runner.gate} /> : <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-sm text-cream-dim">–</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-extrabold">{runner.name}</span>
        <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,.08)]" aria-hidden>
          <span className="block h-full bg-brass" style={{ width: `${Math.max(share > 0 ? 2 : 0, share / 10)}%` }} />
        </span>
        <span className="t-meta block truncate">
          {(share / 10).toFixed(1)}% · {amountShort(currency, odds?.stake ?? 0)} · {runner.isHouse ? "The Club" : (runner.stableName ?? "")}
        </span>
      </span>
      <span className="w-14 shrink-0 text-right">
        <span className="num block text-[1.125rem] leading-6 text-cream" data-testid="tote-odds">
          {gc.formatToteOdds(odds?.oddsMilli ?? null)}
        </span>
        <span className="caption block">odds</span>
      </span>
    </>
  );
  if (!betting) return <li className="flex items-center gap-3 px-3 py-2">{body}</li>;
  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className={`flex w-full items-center gap-3 px-3 py-2 text-left ${selected ? "bg-[rgba(217,164,65,.14)] shadow-[inset_3px_0_0_var(--color-brass)]" : "hover:bg-[rgba(255,255,255,.04)]"}`}
        data-testid="tote-runner"
      >
        {body}
      </button>
    </li>
  );
}

function betStatusText(b: MyToteBet, closed: boolean, reveal: boolean): string {
  const amt = (n: number) => gc.formatToteAmount(b.currency, n);
  // While the finish is still being called on the page, a settled bet waits too (no spoiler).
  if (!reveal && (b.status === "won" || b.status === "lost" || b.status === "returned")) return "Waiting for the result";
  switch (b.status) {
    case "open":
      if (closed) return b.potentialReturn !== null ? `Waiting for the result · returns ${amt(b.potentialReturn)} if it ${b.pool === "win" ? "wins" : "places"} (final odds)` : "Waiting for the result";
      return b.potentialReturn !== null ? `Returns about ${amt(b.potentialReturn)} if it ${b.pool === "win" ? "wins" : "places"}, at the current pool (changes until the off)` : "Waiting for the off";
    case "won":
      return `Won: ${amt(b.payout)} back`;
    case "lost":
      return "Lost";
    case "returned":
      return `Returned ${amt(b.payout)}: nobody backed a paying runner`;
    case "void":
      return `Refunded ${amt(b.payout)}${b.voidReason ? ` (${b.voidReason.replace(/^void: /, "")})` : ""}`;
  }
}

export function YourBets({ bets, closed, reveal = true }: { bets: MyToteBet[]; closed: boolean; reveal?: boolean }) {
  if (!bets.length) return null;
  return (
    <div className="grid gap-1.5" data-testid="tote-your-bets">
      <p className="label">Your bets</p>
      <ul className="inset grid divide-y divide-[rgba(255,255,255,.06)]">
        {bets.map((b) => (
          <li key={b.id} className="grid gap-0.5 px-3 py-2 text-sm">
            <span className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="font-extrabold">
                {b.horseName} · {b.pool === "win" ? "Win" : "Place"}
              </span>
              <span className="num">{gc.formatToteAmount(b.currency, b.stake)}</span>
            </span>
            <span className={`text-cream-dim ${b.status === "won" && reveal ? "!text-positive font-bold" : ""}`}>{betStatusText(b, closed, reveal)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The per-race tote audit, after settlement: pool totals, the take, winning tickets, the dividend per 1 unit with its formula, and the check. */
export function ToteAudit({ audit }: { audit: ToteAuditRow[] }) {
  if (!audit.length) return null;
  return (
    <div className="grid gap-2" data-testid="tote-audit">
      <p className="label">Tote audit</p>
      {audit.map((a) => {
        const amt = (n: number) => gc.formatToteAmount(a.currency, n);
        const unit = a.currency === "CR" ? "1 credit" : "1 T-USDG";
        return (
          <div key={`${a.pool}${a.currency}`} className="inset grid gap-1 px-3 py-2 text-sm">
            <p className="font-extrabold">
              {a.pool === "win" ? "Win" : `Place (first ${a.places || "–"})`} pool · {CURRENCY_LABEL[a.currency]}
            </p>
            {a.outcome === "abandoned" ? (
              <p className="text-cream-dim">The race didn&rsquo;t run: every stake ({amt(a.refunded)}) was refunded in full. No take.</p>
            ) : a.outcome === "void" ? (
              <p className="text-cream-dim" data-testid="tote-audit-void">
                {a.voidReason === "thin_pool"
                  ? `Small pool: fewer than ${gc.TOTE_MIN_POOL_BETTORS} players backing ${gc.TOTE_MIN_POOL_RUNNERS} runners, so every stake (${amt(a.refunded)}) was refunded in full. No take.`
                  : `Too few runners for a place pool: every stake (${amt(a.refunded)}) was refunded in full. No take.`}
              </p>
            ) : (
              <>
                <p className="text-cream-dim">
                  Pool {amt(a.total)} · house take <span data-testid="tote-audit-take">{amt(a.takeout)}</span>
                  {a.takeoutReduced ? ` (cut from ${a.takeoutPermille / 10}% so every winner got the stake back)` : ` (${a.takeoutPermille / 10}%)`} · {a.tickets}{" "}
                  {a.tickets === 1 ? "ticket" : "tickets"} from {a.bettors}{" "}
                  {a.bettors === 1 ? "player" : "players"}
                  {a.refunded > 0 ? ` · ${amt(a.refunded)} refunded (non-runners)` : ""}
                </p>
                {a.outcome === "no_winner" ? (
                  <p className="text-cream-dim">Nobody backed a paying runner, so the pool after the take went back to every staker in proportion to their stake.</p>
                ) : (
                  <ul className="grid gap-0.5">
                    {a.dividends.map((d) => (
                      <li key={d.horseId} className="flex flex-wrap justify-between gap-x-2">
                        <span>
                          {d.position}
                          {ordinalSuffix(d.position)} {d.name}
                        </span>
                        <span className="num">
                          {gc.formatToteOdds(d.perUnitMilli)} per {unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="caption">
                  Dividend = 1 + (pool − take − winning stakes) ÷ {a.pool === "win" ? "1" : "paying places"} ÷ stakes on the runner (dead heats share their places): every winner gets the stake back
                  first, never less. Paid {amt(a.paid)} to {a.winningTickets} winning{" "}
                  {a.winningTickets === 1 ? "ticket" : "tickets"}; rounding {amt(a.remainder)} to the house.
                </p>
                <p className={`text-sm font-bold ${a.balanced ? "text-positive" : "text-negative"}`} data-testid="tote-audit-check">
                  {a.balanced ? "✓" : "✕"} {amt(a.paid)} paid + {amt(a.takeout)} take + {amt(a.remainder)} rounding = {amt(a.total)} pool
                </p>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  return ["th", "st", "nd", "rd"][(v - 20) % 10] ?? ["th", "st", "nd", "rd"][v] ?? "th";
}

/**
 * The Tote panel for a Live card race. Renders nothing for races without a tote. `reveal`: the
 * page is showing the result (false while the finale is still being called in the stage), so
 * the audit and settled bets wait for it.
 */
export function TotePanel({ raceId, reveal = true }: { raceId: string; reveal?: boolean }) {
  const { board, me, setMe, reload } = useTote(raceId);
  const [pool, setPool] = useState<Pool>("win");
  const [currency, setCurrency] = useState<Currency>("CR");
  const [horseId, setHorseId] = useState<string | null>(null);
  const [stake, setStake] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  const [adultTick, setAdultTick] = useState(false);

  const view = board?.pools.find((p) => p.currency === currency) ?? board?.pools[0];
  const poolView = view ? (pool === "place" ? view.place : view.win) : null;
  const stakesMap = useMemo(() => new Map((poolView?.runners ?? []).map((r) => [r.horseId, r.stake])), [poolView]);

  if (board === undefined) return <section className="surface min-h-24 p-3" aria-busy aria-label="Tote" />;
  if (board === null || !view) return null;

  const open = board.status === "open";
  const closed = board.status === "closed";
  const mine = me?.signedIn ? me.me : null;
  const canBet = open && !!mine && mine.canBet.ok;
  const allowance = mine?.allowance.find((a) => a.currency === currency);
  const units = parseStake(currency, stake);
  const preview = horseId && units && units > 0 && board.fieldSize ? gc.toteReturnIfPlaced(pool, stakesMap, horseId, units, board.fieldSize) : null;
  const selected = board.runners.find((r) => r.horseId === horseId) ?? null;
  const problem = units === null ? null : allowance ? gc.toteStakeProblem({ currency, stake: units, balance: allowance.balance, stakedOnRace: 0, stakedToday: 0, own: { perRace: allowance.race, perDay: allowance.day } }) : null;

  async function submit() {
    if (!horseId || !units) return;
    setBusy(true);
    setError(null);
    setPlaced(null);
    try {
      const res = await fetch(`/api/races/${encodeURIComponent(raceId)}/tote/bet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ horseId, pool, currency, stake: units, clientKey: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }),
      });
      const body = (await res.json().catch(() => null)) as { me?: MyToteRace; message?: string } | null;
      if (!res.ok || !body?.me) throw new Error(body?.message ?? `Couldn't place the bet (HTTP ${res.status}).`);
      setMe({ signedIn: true, me: body.me });
      setPlaced(`${gc.formatToteAmount(currency, units)} on ${selected?.name ?? "your pick"} to ${pool === "win" ? "win" : "place"}.`);
      setStake("");
      void reload();
      void refreshPlayer().catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmAdult() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/betting", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm_adult" }) });
      if (!res.ok) throw new Error("Couldn't save that. Try again.");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const statusChip = open ? (
    <span className="chip">Open · closes at the off</span>
  ) : closed ? (
    <span className="chip">Closed at the off</span>
  ) : board.status === "settled" && reveal ? (
    <span className="chip">✓ Settled</span>
  ) : board.status === "settled" ? (
    <span className="chip">Closed at the off</span>
  ) : (
    <span className="chip">Refunded</span>
  );

  return (
    <section className="surface grid h-fit gap-3 p-3" aria-labelledby="tote-h" data-testid="tote-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="tote-h" className="flex items-center gap-2 font-extrabold">
          <PixelIcon name="ticket" size={32} className="-my-1" /> Tote
        </h2>
        {statusChip}
      </div>
      <p className="text-sm text-cream-dim" data-testid="tote-take">
        Pool betting: takes up to {TAKE_PCT}% to the sink; winners share the rest and never get back less than their stake. The odds come from the pool alone and move as bets arrive,
        until the off.{" "}
        <Link href="/me/betting" className="link font-bold">
          Betting limits
        </Link>{" "}
        ·{" "}
        <Link href="/wiki/tote" className="link font-bold">
          How it works
        </Link>
      </p>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="segmented" role="tablist" aria-label="Pool">
          <button type="button" role="tab" aria-selected={pool === "win"} onClick={() => setPool("win")} data-testid="tote-tab-win">
            Win
          </button>
          <button type="button" role="tab" aria-selected={pool === "place"} disabled={!view.place} onClick={() => setPool("place")} data-testid="tote-tab-place">
            {view.place ? `Place (first ${board.places})` : "Place (5+ runners)"}
          </button>
        </div>
        {board.currencies.length > 1 && (
          <div className="segmented" role="group" aria-label="Currency">
            {board.currencies.map((c) => (
              <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)} data-testid={`tote-currency-${c}`}>
                {CURRENCY_LABEL[c]}
              </button>
            ))}
          </div>
        )}
      </div>

      {poolView && (
        <>
          <p className="t-meta" data-testid="tote-pool-total">
            {pool === "win" ? "Win" : "Place"} pool {gc.formatToteAmount(currency, poolView.total)}
            {poolView.total > 0 ? ` · ${gc.formatToteAmount(currency, poolView.net)} to share after the take` : " · no bets yet"}
            {!board.fieldLocked && board.runners.length > 0 ? " · Club runners join when entries close" : ""}
          </p>
          {open && poolView.thin && (
            <p className="caption" data-testid="tote-small-pool">
              Small pool: refunded if fewer than {gc.TOTE_MIN_POOL_BETTORS} players bet (on at least {gc.TOTE_MIN_POOL_RUNNERS} runners).
            </p>
          )}
          {board.runners.length === 0 ? (
            <p className="text-sm text-cream-dim">No runners yet: the field fills as stables enter.</p>
          ) : (
            <ul className="inset grid divide-y divide-[rgba(255,255,255,.06)]" role={canBet ? "radiogroup" : undefined} aria-label={canBet ? "Pick a runner" : undefined} data-testid="tote-runners">
              {board.runners.map((r) => (
                <OddsRow
                  key={r.horseId}
                  runner={r}
                  odds={poolView.runners.find((x) => x.horseId === r.horseId)}
                  currency={currency}
                  selected={horseId === r.horseId}
                  betting={canBet}
                  onSelect={() => setHorseId(r.horseId)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {open && me && !me.signedIn && <p className="text-sm text-cream-dim">Found a stable to bet on this race.</p>}
      {open && mine && !mine.canBet.ok && mine.canBet.reason === "age" && (
        <div className="inset grid gap-2 p-3 text-sm" data-testid="tote-age">
          <p className="font-bold">Betting is for players aged 18 or over.</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={adultTick} onChange={(e) => setAdultTick(e.target.checked)} data-testid="tote-age-tick" /> I confirm I am 18 or over
          </label>
          <button type="button" className="btn btn-sm w-fit" disabled={!adultTick || busy} onClick={confirmAdult} data-testid="tote-age-confirm">
            Confirm
          </button>
        </div>
      )}
      {open && mine && !mine.canBet.ok && mine.canBet.reason !== "age" && (
        <p className="text-sm font-bold text-cream-dim" data-testid="tote-cant-bet">
          {mine.canBet.message}
        </p>
      )}

      {canBet && (
        <div className="inset grid gap-2 p-3" data-testid="tote-slip">
          <p className="label">Bet slip</p>
          {selected ? (
            <p className="text-sm">
              <b>{selected.name}</b> to {pool === "win" ? "win" : `finish in the first ${board.places}`}
            </p>
          ) : (
            <p className="text-sm text-cream-dim">Pick a runner above.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="tote-stake">
              Stake
            </label>
            <input
              id="tote-stake"
              className="field w-28"
              inputMode={currency === "CR" ? "numeric" : "decimal"}
              placeholder={`min ${stakeText(currency, gc.TOTE_MIN_STAKE[currency])}`}
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              data-testid="tote-stake"
            />
            <span className="text-sm text-cream-dim">{currency === "CR" ? "credits" : "T-USDG"}</span>
            {QUICK[currency].map((q) => (
              <button key={q} type="button" className="chip" onClick={() => setStake(stakeText(currency, q))} data-testid="tote-chip">
                {stakeText(currency, q)}
              </button>
            ))}
          </div>
          {allowance && (
            <p className="caption">
              Min {gc.formatToteAmount(currency, allowance.min)} · up to {gc.formatToteAmount(currency, Math.min(allowance.race, allowance.day))} more on this race today · balance{" "}
              {gc.formatToteAmount(currency, allowance.balance)}
            </p>
          )}
          {preview !== null && selected && (
            <p className="text-sm" data-testid="tote-preview">
              Returns about <b className="num">{gc.formatToteAmount(currency, preview)}</b> if {selected.name} {pool === "win" ? "wins" : "places"}, at the current pool. It
              changes as bets arrive, until the off.
            </p>
          )}
          <p className="caption" data-testid="tote-slip-take">
            Up to {TAKE_PCT}% of every pool goes to the house take (a sink); winners share the rest and always get at least their stake back. Bets are final.
          </p>
          {units !== null && problem === "below_min" && <p className="text-sm font-bold text-negative">The smallest bet is {gc.formatToteAmount(currency, gc.TOTE_MIN_STAKE[currency])}.</p>}
          {units !== null && (problem === "race_limit" || problem === "day_limit") && <p className="text-sm font-bold text-negative">That&rsquo;s over your limit for this race or today.</p>}
          <button type="button" className="btn btn-brass w-full sm:w-fit" disabled={!selected || !units || !!problem || busy} onClick={submit} data-testid="tote-place">
            {busy ? "Placing…" : units && selected ? `Bet ${gc.formatToteAmount(currency, units)}` : "Place bet"}
          </button>
          {placed && (
            <p className="text-sm font-bold text-positive" role="status">
              Bet placed: {placed}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="text-sm font-bold text-negative" role="alert">
          {error}
        </p>
      )}

      {mine && <YourBets bets={mine.bets} closed={!open} reveal={reveal} />}
      {board.status === "settled" && reveal && <ToteAudit audit={board.audit} />}
      {board.status === "abandoned" && <ToteAudit audit={board.audit} />}
      {/* Dormant real-money pool: renders nothing unless REAL_TOTE_ENABLED is on for this race. */}
      <RealToteSlip raceId={raceId} runners={board.runners} />
    </section>
  );
}

/** Under the broadcast while the race runs: the final odds (Win pool, credits) frozen at the off. No bet buttons. */
export function FinalOddsStrip({ raceId }: { raceId: string }) {
  const [board, setBoard] = useState<ToteBoard | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/races/${encodeURIComponent(raceId)}/tote`)
      .then((r) => (r.ok ? (r.json() as Promise<BoardRes>) : null))
      .then((b) => {
        if (live && b?.available) setBoard(b.board);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [raceId]);
  const win = board?.pools[0]?.win;
  if (!board || !win || win.total === 0) return null;
  const rows = board.runners
    .map((r) => ({ r, o: win.runners.find((x) => x.horseId === r.horseId) }))
    .filter((x) => x.o?.oddsMilli != null)
    .sort((a, b) => (a.r.gate ?? 99) - (b.r.gate ?? 99));
  return (
    <div className="flex items-center gap-2 overflow-x-auto px-[var(--gutter)] py-1.5 md:px-0" aria-label="Final odds" data-testid="final-odds">
      <span className="label shrink-0">Final odds</span>
      {rows.map(({ r, o }) => (
        <span key={r.horseId} className="chip shrink-0 gap-1.5">
          {r.gate ? <Saddlecloth gate={r.gate} className="!h-5 !w-5 !text-xs" /> : null}
          <span className="max-w-[7rem] truncate">{r.name}</span>
          <b className="num">{gc.formatToteOdds(o!.oddsMilli)}</b>
        </span>
      ))}
    </div>
  );
}
