"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Horse, RunningStyle } from "@thoroughbred/shared";
import { pronoun } from "@/lib/aptitude";
import { STYLE_LABEL, SURFACE_LABEL, formatDistance } from "@/lib/format";
import { addPendingRace, horseRecord, recentlyRun, type PlayerState } from "@/lib/player";
import { HorsePortrait } from "../HorsePortrait";
import { PixelIcon } from "../icons";

const TACTICS: RunningStyle[] = ["front", "stalker", "closer"];
/** Where the jockey sits in the pack (index in a 7-cell lane, 6 = leader). */
const TACTIC_POS: Record<RunningStyle, number> = { front: 6, stalker: 4, closer: 0 };
export const PLAN_HINT: Record<RunningStyle, string> = {
  front: "Jump out and lead all the way. Suits quick horses with stamina to hold on.",
  stalker: "Sit just behind the leaders, then pounce in the straight. The balanced ride.",
  closer: "Settle at the back, save energy, one long late run. Needs a strong finishing burst.",
};

/** Tiny pixel race diagram: the pack as cells, your horse in brass, the finish post on the right. */
function PackDiagram({ pos }: { pos: number }) {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => (
        <span key={i} className="h-2.5 w-2.5" style={{ background: i === pos ? "#f2c86a" : "#2c6645" }} />
      ))}
      <span className="ml-1 h-3.5 w-[3px] bg-cream" />
    </span>
  );
}

export async function enterQuickRace(state: PlayerState, horse: Horse, horseIndex: number, tactic: RunningStyle): Promise<string> {
  const res = await fetch("/api/races/quick", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: state.player.playerId, horseIndex, tactic, silks: state.player.silks, stableName: state.player.stableName }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { raceId, postTimeMs } = (await res.json()) as { raceId: string; postTimeMs: number };
  addPendingRace({ raceId, horseIndex, horseName: horse.name, tactic, postTimeMs, enteredAtMs: Date.now() });
  return raceId;
}

export interface QuickPickResult {
  raceId: string;
  postTimeMs: number;
  pick: { horseIndex: number; tactic: RunningStyle; reason: string };
}

/**
 * Quick Pick (Story mode): the server picks the best-suited fresh horse (rotating away from
 * horses run in the last hour), rides it to its natural style and enters the next Story race.
 * `instant` (Story only) creates a race that is already run, so the page opens on the result.
 */
export async function quickPickRace(state: PlayerState, horses: Horse[] | null, opts: { instant?: boolean } = {}): Promise<QuickPickResult> {
  const res = await fetch("/api/races/quick", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      playerId: state.player.playerId,
      pick: "auto",
      exclude: recentlyRun(state, Date.now()),
      ...(opts.instant ? { instant: true } : {}),
      silks: state.player.silks,
      stableName: state.player.stableName,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const out = (await res.json()) as QuickPickResult;
  const name = horses?.[out.pick.horseIndex]?.name ?? out.pick.reason.split(":")[0] ?? "Your horse";
  addPendingRace({ raceId: out.raceId, horseIndex: out.pick.horseIndex, horseName: name, tactic: out.pick.tactic, postTimeMs: out.postTimeMs, enteredAtMs: Date.now() });
  return out;
}

/**
 * Quick-race entry: choose a runner (optional) and a riding plan, then go to the gates.
 * The plan defaults to the horse's natural style, so a new player can enter with one tap.
 */
export function EntryForm({
  state,
  horses,
  initialIndex = 0,
  showPicker = true,
  inline = false,
  autoFocusSubmit = false,
}: {
  state: PlayerState;
  horses: Horse[] | null;
  initialIndex?: number;
  showPicker?: boolean;
  /** Inline on a page, where Quick Pick is the primary action: the submit is a secondary button. */
  inline?: boolean;
  autoFocusSubmit?: boolean;
}) {
  const router = useRouter();
  const [horseIndex, setHorseIndex] = useState(initialIndex);
  const [tactic, setTactic] = useState<RunningStyle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHorseIndex(initialIndex);
    setTactic(null);
  }, [initialIndex]);

  const horse = horses?.[horseIndex];
  const chosen = tactic ?? horse?.style ?? "stalker";

  async function go() {
    if (!horse) return;
    setBusy(true);
    setError(null);
    try {
      const raceId = await enterQuickRace(state, horse, horseIndex, chosen);
      router.push(`/race/${raceId}`);
    } catch (e) {
      setError(`Couldn't enter the race (${(e as Error).message}). Please try again.`);
      setBusy(false);
    }
  }

  const submit = (
    <button
      type="button"
      className={inline ? "btn btn-lg" : "btn btn-brass btn-lg"}
      disabled={!horse || busy}
      onClick={go}
      data-testid="enter-race"
      autoFocus={autoFocusSubmit}
    >
      <PixelIcon name="flag" size={32} className="-my-2" />
      <span className="truncate">{busy ? "Entering…" : "Go to the gates"}</span>
    </button>
  );

  return (
    <div className="grid gap-5" data-testid="quick-race">
      {showPicker && (
        <fieldset className="min-w-0">
          <legend className="t-title mb-2">Runner</legend>
          <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 pt-1 md:grid md:grid-cols-3 md:overflow-visible">
            {(horses ?? Array.from({ length: 6 }, () => null)).map((h, i) => {
              const selected = i === horseIndex;
              const rec = horseRecord(state, i);
              return (
                <button
                  key={h?.id ?? i}
                  type="button"
                  disabled={!h}
                  aria-pressed={selected}
                  onClick={() => {
                    setHorseIndex(i);
                    setTactic(null);
                  }}
                  className={`surface-2 flex w-48 shrink-0 snap-start items-center gap-2 p-1.5 text-left md:w-auto ${selected ? "is-selected" : "hover:brightness-110"}`}
                  data-testid="pick-horse"
                >
                  {h ? <HorsePortrait appearance={h.appearance} scale="thumb" /> : <span className="h-12 w-12 bg-inset" />}
                  <span className="min-w-0">
                    <span className="block truncate font-extrabold">{h?.name ?? "…"}</span>
                    <span className="block truncate text-sm text-cream-dim">
                      {h ? `${formatDistance(h.preferredDistanceM)} · ${SURFACE_LABEL[h.preferredSurface]}` : " "}
                    </span>
                    <span className="block text-xs font-semibold text-sage">
                      {rec.starts === 0 ? "Unraced" : `${rec.starts} runs · ${rec.wins} wins`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <fieldset className="min-w-0">
        <legend className="t-title mb-1">Riding plan</legend>
        <p className="mb-2 text-sm text-cream-dim">
          {horse ? (
            <>
              {horse.name} is a natural <strong className="text-cream">{STYLE_LABEL[horse.style].toLowerCase()}</strong>, and riding to {pronoun(horse.sex).his} natural style is
              usually best.
            </>
          ) : (
            " "
          )}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {TACTICS.map((t) => {
            const selected = chosen === t;
            const natural = horse?.style === t;
            return (
              <label
                key={t}
                className={`surface-2 flex min-h-11 cursor-pointer flex-col gap-1.5 p-2.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-brass-bright ${
                  selected ? "is-selected" : "hover:brightness-110"
                }`}
              >
                <input type="radio" name="tactic" value={t} checked={selected} onChange={() => setTactic(t)} className="sr-only" />
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-extrabold">
                    <span className={`h-3 w-3 ${selected ? "bg-brass-bright" : "bg-inset"}`} style={{ boxShadow: "0 0 0 2px #0b0f0c" }} aria-hidden />
                    {STYLE_LABEL[t]}
                  </span>
                  {natural && <span className="chip !py-0 text-xs text-cream">Natural</span>}
                </span>
                <PackDiagram pos={TACTIC_POS[t]} />
                <span className="text-sm leading-snug text-cream-dim">{PLAN_HINT[t]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <p className="flex items-start gap-2 text-sm text-cream-dim">
        <PixelIcon name="shield" size={16} className="mt-0.5" />
        <span>
          Quick race against the club&rsquo;s horses, usually near {horse ? `${pronoun(horse.sex).his} best trip` : "your horse's best trip"}. Free to
          enter. The result is sealed the moment you enter, and the gates open 10 seconds later.
        </span>
      </p>

      {error && (
        <p className="text-sm font-bold text-negative" role="alert">
          {error}
        </p>
      )}
      {inline ? <div>{submit}</div> : <div className="grid [&>.btn]:w-full">{submit}</div>}
    </div>
  );
}
