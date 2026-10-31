"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { RunningStyle } from "@thoroughbred/shared";
import type { CupRow, CupView } from "@/lib/competitionTypes";
import { STYLE_LABEL, STYLE_SHORT, formatClock, formatCredits, ordinal } from "@/lib/format";
import { useClockSkew } from "@/lib/clock";
import { api } from "@/lib/player";
import { Countdown } from "../Countdown";
import { JoinNudge } from "../PlayerGate";
import { Silks } from "../Silks";
import { GradeBadge } from "../StatBars";
import { PixelIcon } from "../icons";
import { ActionBar } from "../ui/ActionBar";
import { ErrorNote } from "../ui/ErrorNote";
import { PositionBadge } from "../ui/PositionBadge";
import { HashValue } from "../ui/HashValue";
import { Saddlecloth } from "../race/Saddlecloth";
import { CupBadge, RaceTime } from "./bits";
import { EmptyState, HowItWorks, SceneBand } from "../ui/Page";

const STYLES: RunningStyle[] = ["front", "stalker", "closer"];

function BoardRow({ r }: { r: CupRow }) {
  return (
    <li className={`flex items-center gap-3 px-3 py-2 ${r.mine ? "surface-2" : ""}`} data-testid="cup-row" data-mine={r.mine || undefined}>
      <span className="num w-9 shrink-0 text-right text-lg text-cream">{r.rank}</span>
      <Silks silks={r.silks} cap={false} className="h-[26px] w-8 shrink-0" />
      <Link href={`/cup/run/${r.entryId}`} className="min-w-0 flex-1 hover:underline">
        <p className="t-title truncate text-cream">
          {r.horseName}
          {r.mine && <span className="you-tag ml-2 align-middle">You</span>}
        </p>
        <p className="t-meta truncate">
          {r.stableName} · {ordinal(r.position)} vs the field
        </p>
      </Link>
      <div className="shrink-0 text-right">
        <RaceTime us={r.timeUs} className="font-extrabold text-cream" />
        {r.rank <= 3 || r.badge === "top10" ? (
          <div className="mt-0.5">
            <CupBadge badge={r.badge} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Picker({ view }: { view: CupView }) {
  const router = useRouter();
  const horses = view.horses ?? [];
  const firstOk = horses.find((h) => !h.block) ?? null;
  const [horseId, setHorseId] = useState<string | null>(firstOk?.id ?? null);
  const horse = horses.find((h) => h.id === horseId) ?? null;
  const [tactic, setTactic] = useState<RunningStyle | null>(firstOk?.style ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (horse) setTactic(horse.style);
  }, [horse]);

  if (!horses.length) return <p className="text-cream-dim">None of your horses is old enough to run yet. Foals can run once they reach racing age.</p>;

  async function run() {
    if (!horseId || !tactic) return;
    setBusy(true);
    setError(null);
    try {
      const { entryId } = await api<{ entryId: string }>("/api/cup/run", { body: { horseId, tactic } });
      router.push(`/cup/run/${entryId}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <fieldset className="grid gap-1.5">
        <legend className="mb-2 font-extrabold">Choose your runner</legend>
        <ul className="surface-2 rows" role="radiogroup" aria-label="Your horses">
          {horses.map((h) => (
            <li key={h.id}>
              <label className={`row-link cursor-pointer gap-3 px-3 py-2 ${h.block ? "opacity-60" : ""} ${horseId === h.id ? "surface-2" : ""}`}>
                <input type="radio" name="cup-horse" className="h-5 w-5 accent-[#d9a441]" value={h.id} checked={horseId === h.id} disabled={!!h.block} onChange={() => setHorseId(h.id)} data-testid="cup-horse" />
                <span className="min-w-0 flex-1">
                  <span className="t-title block truncate text-cream">{h.name}</span>
                  <span className="t-meta block">{h.block ?? `${STYLE_LABEL[h.style]} · fit for today's Cup`}</span>
                </span>
                {!h.block && <GradeBadge grade={h.grade} size="sm" />}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div>
        <p className="mb-1 font-extrabold" id="cup-ride">
          Ride
        </p>
        <div className="segmented" role="group" aria-labelledby="cup-ride">
          {STYLES.map((s) => (
            <button key={s} type="button" aria-pressed={tactic === s} onClick={() => setTactic(s)}>
              {STYLE_SHORT[s]}
              {horse?.style === s ? " ★" : ""}
            </button>
          ))}
        </div>
        <p className="caption mt-1 text-cream-dim">★ natural style. The Cup is free, isn&rsquo;t a career start and never tires your horse.</p>
      </div>
      {horseId ? (
        <ActionBar>
          <button type="button" className="btn btn-brass btn-lg" disabled={!tactic || busy} onClick={run} data-testid="cup-run">
            <PixelIcon name="trophy" size={32} className="-my-2" /> {busy ? "Running…" : "Take your Cup Run"}
          </button>
        </ActionBar>
      ) : (
        <p className="t-meta">None of your horses can run right now. Resting horses are back tomorrow; Story races are always open.</p>
      )}
      {error !== null && <ErrorNote error={error} />}
    </div>
  );
}

export function CupScreen({ view, signedIn }: { view: CupView; signedIn: boolean }) {
  const skew = useClockSkew(view.serverNowMs);
  const { top, near } = view.board;
  const nearOnly = near.filter((r) => !top.some((t) => t.entryId === r.entryId));
  return (
    <div>
      <SceneBand scene="winners-enclosure" alt="The winners' enclosure: a garlanded winner and the cup" eyebrow="Club · one run a day" title="Daily Cup" />

      <section className="frame-hero mt-4 grid gap-4 p-4 sm:p-5" aria-labelledby="today-h">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="tag tag-ready">Today&rsquo;s Cup</p>
            <h2 id="today-h" className="t-hero mt-2">
              {view.conditions.name.replace(/^Daily Cup · /, "")}
            </h2>
            <p className="t-meta">
              <span className="reward !text-base">+{formatCredits(view.participationCredits)}</span> for taking part · {view.entrants} {view.entrants === 1 ? "run" : "runs"} so far
            </p>
            {view.tomorrow && (
              <p className="t-meta mt-1" data-testid="cup-tomorrow">
                Tomorrow: {view.tomorrow.distanceM.toLocaleString("en-GB")} m {view.tomorrow.surface === "synthetic" ? "on the all-weather" : `on ${view.tomorrow.surface}`} · {view.tomorrow.going} ground
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="label">Closes in</p>
            <p className="score text-[2.5rem] leading-none" data-testid="cup-countdown">
              <Countdown targetMs={view.closesAtMs} skewMs={skew} doneLabel="0:00" />
            </p>
          </div>
        </div>
        {view.mine ? (
          <div className="grid gap-3 border-t-2 border-dotted border-line pt-4" data-testid="cup-mine">
            <div className="flex items-center gap-3">
              <PositionBadge position={view.mine.rank} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="t-title">
                  {view.mine.horseName}: <RaceTime us={view.mine.timeUs} />
                </p>
                <p className="t-meta">
                  {ordinal(view.mine.rank)} of {view.entrants} today · {ordinal(view.mine.position)} against the field
                </p>
              </div>
              <CupBadge badge={view.mine.badge} />
            </div>
            <p className="t-meta">Your rank can change as more stables run. The board is final when the Cup closes.</p>
            <ActionBar>
              <Link href={`/cup/run/${view.mine.entryId}`} className="btn btn-brass btn-lg" data-testid="cup-watch-mine">
                <PixelIcon name="stopwatch" size={32} className="-my-2" /> Watch your run
              </Link>
            </ActionBar>
          </div>
        ) : signedIn ? (
          <div className="border-t-2 border-dotted border-line pt-4">
            <Picker view={view} />
          </div>
        ) : null}
      </section>
      {!view.mine && !signedIn && (
        <div className="mt-4">
          <JoinNudge compact />
        </div>
      )}

      <HowItWorks className="mt-3">
        <p>Everyone races the same seeded field in the same conditions. You get one run a day with any horse, ranked by time.</p>
        <p>The Cup is free, never counts as a career start and never tires your horse. Taking part earns {formatCredits(view.participationCredits)} credits.</p>
      </HowItWorks>

      <div className="section grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="board-h" className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="board-h" className="t-h2">
              Today&rsquo;s board
            </h2>
            <p className="eyebrow">Fastest time wins</p>
          </div>
          {top.length ? (
            <>
              <ol className="surface rows" data-testid="cup-board">
                {top.map((r) => (
                  <BoardRow key={r.entryId} r={r} />
                ))}
              </ol>
              {nearOnly.length > 0 && (
                <>
                  <h3 className="label mt-4 mb-1 text-cream-dim">Near you</h3>
                  <ol className="surface rows" data-testid="cup-near">
                    {nearOnly.map((r) => (
                      <BoardRow key={r.entryId} r={r} />
                    ))}
                  </ol>
                </>
              )}
            </>
          ) : (
            <EmptyState icon="trophy" title="No runs yet today" text="Be the first on the board: pick a horse above and take your run." testId="cup-empty" />
          )}
        </section>

        <aside className="grid content-start gap-4">
          <section className="surface p-4" aria-labelledby="field-h">
            <h2 id="field-h" className="t-h2">
              The field
            </h2>
            <p className="t-meta mb-3">The same Club horses for everyone. You start from gate 4.</p>
            <ul className="grid gap-1.5">
              {view.field.map((h) => (
                <li key={h.gate} className="flex items-center gap-2">
                  <Saddlecloth gate={h.gate} className="!h-6 !w-6 !text-sm" />
                  <Silks silks={h.silks} cap={false} className="h-[20px] w-6 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-bold text-cream">{h.name}</span>
                  <span className="caption text-cream-dim">{STYLE_SHORT[h.style]}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="surface p-4" aria-labelledby="seal-h">
            <h2 id="seal-h" className="t-h2 mb-1 flex items-center gap-2">
              <PixelIcon name="shield" size={32} /> Sealed ✓
            </h2>
            <p className="caption text-cream-dim">
              Today&rsquo;s seed was fixed before the first run: fingerprint <HashValue value={view.seedCommitment} />. It&rsquo;s revealed when the Cup closes, so
              anyone can re-run every result.
            </p>
            {view.yesterday && (
              <div className="mt-2 border-t-2 border-line pt-2">
                <p className="font-bold text-cream">Yesterday ({view.yesterday.day})</p>
                {view.yesterday.winner && (
                  <p className="t-meta">
                    Won by {view.yesterday.winner.horseName} ({view.yesterday.winner.stableName}) in <RaceTime us={view.yesterday.winner.timeUs} />
                  </p>
                )}
                {view.yesterday.mine && (
                  <p className="t-meta">
                    You: {ordinal(view.yesterday.mine.rank)} · <RaceTime us={view.yesterday.mine.timeUs} />
                  </p>
                )}
                <p className="caption flex flex-wrap items-center gap-x-1 text-cream-dim">Seed: <HashValue value={view.yesterday.seed} /></p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
