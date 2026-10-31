"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { RunningStyle } from "@thoroughbred/shared";
import { pronoun } from "@/lib/aptitude";
import { STYLE_LABEL, SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { api, type PlayerState } from "@/lib/player";
import type { RaceDayOffer, RacePlan, RideIntensity, RiskView, StableHorse } from "@/lib/types";
import type { JockeyKey, RaceDayChoice, RaceExtraKey } from "@thoroughbred/game-core";
import type { RiderOption } from "@/lib/types";
import { HorsePortrait } from "../HorsePortrait";
import { GradeBadge } from "../StatBars";
import { PixelIcon } from "../icons";
import { ErrorNote } from "../ui/ErrorNote";

const TACTICS: RunningStyle[] = ["front", "stalker", "closer"];
/** Where the jockey sits in the pack (index in a 7-cell lane, 6 = leader). */
const TACTIC_POS: Record<RunningStyle, number> = {
  front: 6,
  stalker: 4,
  closer: 0,
};
export const PLAN_HINT: Record<RunningStyle, string> = {
  front: "Jump out and lead all the way. Suits quick horses with stamina to hold on.",
  stalker: "Sit just behind the leaders, then pounce in the straight. The balanced ride.",
  closer: "Settle at the back, save energy, one long late run. Needs a strong finishing burst.",
};
export const INTENSITIES: { v: RideIntensity; label: string; hint: string }[] = [
  { v: "conservative", label: "Easy", hint: "Look after the horse: a little less kick, lower injury risk." },
  { v: "normal", label: "Normal", hint: "A proper race ride." },
  { v: "all_out", label: "All-out", hint: "More kick at the end, but a higher injury risk." },
];
/** game-core INTENSITY_RISK (permille multipliers) for the Story sheet's estimate. */
const INTENSITY_MULT: Record<RideIntensity, number> = { conservative: 0.7, normal: 1, all_out: 1.5 };

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

/** The risk factor lines the sheet has room for: race-day extras first (they are the player's choice), then the rest. */
function riskLines(factors: readonly string[]): string[] {
  const chosen = (f: string) => f === "Vet-checked" || f.includes("(shod");
  return [...factors.filter(chosen), ...factors.filter((f) => !chosen(f))].slice(0, 3);
}

export function riskText(r: RiskView | null | undefined): string {
  if (!r) return "";
  return `${(r.permille / 10).toLocaleString("en-GB", { maximumFractionDigits: 1 })}% (${r.label})`;
}

/** Story-sheet estimate: the horse's normal-ride risk scaled by the ride intensity. */
export function storyRisk(h: StableHorse, intensity: RideIntensity): RiskView {
  const permille = Math.min(80, Math.max(1, Math.round(h.risk.permille * INTENSITY_MULT[intensity])));
  const label = permille < 5 ? "low" : permille < 12 ? "moderate" : permille < 25 ? "elevated" : "high";
  return { ...h.risk, permille, label };
}

export function conditionLabel(h: StableHorse): { text: string; tone: string } {
  if (h.block) return { text: h.block, tone: "text-negative" };
  if (h.condition === "tired") return { text: "Tired", tone: "text-negative" };
  if (h.ranToday > 0) return { text: `Ran ${h.ranToday}x today`, tone: "text-sage" };
  return { text: h.condition === "fresh" ? "Fresh" : "Ready", tone: "text-positive" };
}

/** Story race (solo, settled on the server when you enter; free). Returns the race id. */
export async function enterStoryRace(horseId: string, plan: RacePlan, opts: { instant?: boolean } = {}): Promise<{ raceId: string; postTimeMs: number }> {
  return api<{ raceId: string; postTimeMs: number }>("/api/races/quick", { body: { horseId, plan, ...(opts.instant ? { instant: true } : {}) } });
}

export interface QuickPickResult {
  raceId: string;
  postTimeMs: number;
  horseId: string;
  pick: { horseId: string; horseName: string; tactic: RunningStyle; reason: string };
}

/**
 * Quick Pick (Story mode): the server picks the best-suited fresh horse, rides it to its
 * natural style and runs the next Story race (settled on the server at once). `instant`
 * back-dates it, so the page opens on the result.
 */
export async function quickPickRace(opts: { instant?: boolean } = {}): Promise<QuickPickResult> {
  return api<QuickPickResult>("/api/races/quick", { body: { pick: "auto", ...(opts.instant ? { instant: true } : {}) } });
}

/** Horse picker shared by the Story and Live entry sheets. */
export function HorsePicker({
  horses,
  selectedId,
  onSelect,
  reasons,
}: {
  horses: StableHorse[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Per-race eligibility (Live): a reason disables the horse. */
  reasons?: Record<string, string | null>;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="t-title mb-2">Runner</legend>
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 pt-1 md:grid md:grid-cols-3 md:overflow-visible">
        {horses.map((s) => {
          const h = s.horse;
          const selected = s.id === selectedId;
          const reason = reasons ? reasons[s.id] : s.block;
          const cond = conditionLabel(s);
          return (
            <button
              key={s.id}
              type="button"
              disabled={!!reason}
              aria-pressed={selected}
              onClick={() => onSelect(s.id)}
              className={`surface-2 flex w-64 shrink-0 snap-start items-center gap-2 p-1.5 text-left disabled:opacity-50 md:w-auto ${selected ? "is-selected" : "hover:brightness-110"}`}
              data-testid="pick-horse"
            >
              <HorsePortrait appearance={h.appearance} scale="thumb" />
              <span className="min-w-0">
                {/* Names and details wrap (never clipped at phone width). */}
                <span className="block break-words font-extrabold leading-tight">{h.name}</span>
                <span className="block break-words text-sm leading-snug text-cream-dim">
                  {formatDistance(h.preferredDistanceM)} · {SURFACE_LABEL[h.preferredSurface]} · {s.starts}/{s.maxStarts} starts
                </span>
                <span className={`block break-words text-xs font-semibold leading-snug ${reason ? "text-negative" : cond.tone}`}>{reason ?? cond.text}</span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Riding plan: tactic (natural preselected) and intensity, with the injury risk shown before entry. */
export function PlanPicker({
  horse,
  plan,
  onChange,
  risk,
}: {
  horse: StableHorse | undefined;
  plan: RacePlan;
  onChange: (p: RacePlan) => void;
  risk: (i: RideIntensity) => RiskView | null;
}) {
  const h = horse?.horse;
  const current = risk(plan.intensity);
  return (
    <>
      <fieldset className="min-w-0">
        <legend className="t-title mb-1">Riding plan</legend>
        <p className="mb-2 text-sm text-cream-dim">
          {h ? (
            <>
              {h.name} is a natural <strong className="text-cream">{STYLE_LABEL[h.style].toLowerCase()}</strong>, and riding to {pronoun(h.sex).his} natural
              style is usually best.
            </>
          ) : (
            " "
          )}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {TACTICS.map((t) => {
            const selected = plan.tactic === t;
            const natural = h?.style === t;
            return (
              <label
                key={t}
                className={`surface-2 flex min-h-11 cursor-pointer flex-col gap-1.5 p-2.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-brass-bright ${
                  selected ? "is-selected" : "hover:brightness-110"
                }`}
              >
                <input type="radio" name="tactic" value={t} checked={selected} onChange={() => onChange({ ...plan, tactic: t })} className="sr-only" />
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
      <fieldset className="min-w-0">
        <legend className="t-title mb-1">Ride</legend>
        <div className="segmented flex-wrap" role="group" aria-label="Ride intensity">
          {INTENSITIES.map((i) => (
            <button key={i.v} type="button" aria-pressed={plan.intensity === i.v} onClick={() => onChange({ ...plan, intensity: i.v })}>
              {i.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-cream-dim">{INTENSITIES.find((i) => i.v === plan.intensity)!.hint}</p>
        {current && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm" data-testid="injury-risk">
            <PixelIcon name="shield" size={16} />
            <span className={current.label === "low" ? "text-cream" : "font-bold text-negative"}>Injury risk {riskText(current)}</span>
            {current.factors.length > 0 && <span className="text-cream-dim">· {riskLines(current.factors).join(" · ")}</span>}
          </p>
        )}
      </fieldset>
    </>
  );
}

/** Credits a race-day choice costs in this race (the offer carries the server's prices). */
export function raceDayCost(offer: RaceDayOffer | null | undefined, choice: RaceDayChoice): number {
  if (!offer) return 0;
  const extras = offer.extras.filter((x) => choice.extras.includes(x.key)).reduce((a, x) => a + x.price, 0);
  const rider = choice.jockeyId ? [...(offer.riders?.own ?? []), ...(offer.riders?.freelancers ?? [])].find((r) => r.id === choice.jockeyId) : undefined;
  return extras + (rider ? rider.fee : (offer.jockeys.find((j) => j.key === choice.jockey)?.price ?? 0));
}

/**
 * The entry sheet's jockey picker (Live races): your own jockeys ride free, Club freelancers for a
 * fee by grade and the purse. The default is your best jockey who is free at the off.
 */
export function JockeyPicker({ riders, choice, onChange }: { riders: NonNullable<RaceDayOffer["riders"]>; choice: RaceDayChoice; onChange: (c: RaceDayChoice) => void }) {
  const pick = (id: string | undefined) => onChange({ ...choice, jockey: "apprentice", ...(id ? { jockeyId: id } : { jockeyId: undefined }) });
  const row = (r: RiderOption) => {
    const on = choice.jockeyId === r.id;
    return (
      <label
        key={r.id}
        className={`surface-2 flex min-h-11 items-center gap-2 p-2.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-brass-bright ${r.busy ? "opacity-60" : "cursor-pointer"} ${on ? "is-selected" : r.busy ? "" : "hover:brightness-110"}`}
        data-testid={`rider-${r.own ? "own" : "freelance"}`}
      >
        <input type="radio" name="jockey" checked={on} disabled={!!r.busy} onChange={() => pick(r.id)} className="h-4 w-4 shrink-0 accent-[#f2c86a]" />
        <GradeBadge grade={r.grade} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-extrabold">{r.cardName}</span>
          <span className="block text-xs text-cream-dim">
            {r.stage === "apprentice" ? "Apprentice" : r.stage === "veteran" ? "Veteran" : "Prime"}
            {r.busy ? ` · ${r.busy}` : ""}
          </span>
        </span>
        <span className="num shrink-0 text-sm text-cream">{r.own ? "free" : `${formatCredits(r.fee)} cr`}</span>
      </label>
    );
  };
  return (
    <div className="mt-3" data-testid="jockey-picker">
      <p className="mb-1 text-sm font-bold text-cream">Jockey</p>
      {riders.own.length > 0 && (
        <>
          <p className="caption mb-1">Your jockeys</p>
          <div className="grid gap-2 sm:grid-cols-2">{riders.own.map(row)}</div>
        </>
      )}
      {riders.freelancers.length > 0 && (
        <>
          <p className="caption mb-1 mt-2">Club freelancers</p>
          <div className="grid gap-2 sm:grid-cols-2">{riders.freelancers.map(row)}</div>
        </>
      )}
      {!choice.jockeyId && <p className="mt-2 text-sm text-cream-dim">No jockey picked: one of yours if free at the off, else a Club rider, at no charge.</p>}
      <p className="mt-2 text-sm text-cream-dim">
        Better jockeys break faster, waste less energy and fight harder at the finish: worth about 2-3 rating points between the best and the worst. Apprentices claim weight in handicaps.{" "}
        <a href="/jockeys" className="underline">
          All jockeys
        </a>
      </p>
    </div>
  );
}

/**
 * The entry sheet's Extras step (Live races): optional race-day extras and a jockey, each with
 * its price and what it does in plain words. Charged with the entry, refunded on a scratch
 * before entries close or if the race is abandoned. Nothing here makes a horse better than
 * its genes: extras only take away part of a cost or narrow the day-form swing.
 */
export function ExtrasPicker({ offer, choice, onChange }: { offer: RaceDayOffer; choice: RaceDayChoice; onChange: (c: RaceDayChoice) => void }) {
  if (!offer.jockeys.length && !offer.extras.length && !offer.riders) return null;
  const toggle = (k: RaceExtraKey) => onChange({ ...choice, extras: choice.extras.includes(k) ? choice.extras.filter((x) => x !== k) : [...choice.extras, k] });
  const jockey = offer.jockeys.find((j) => j.key === choice.jockey);
  const total = raceDayCost(offer, choice);
  return (
    <fieldset className="min-w-0" data-testid="extras-step">
      <legend className="t-title mb-1">Extras</legend>
      <p className="mb-2 text-sm text-cream-dim">
        Optional, paid in credits with the entry and refunded if you scratch before entries close. Small, published effects: none makes a horse faster than its genes allow.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {offer.extras.map((x) => {
          const on = choice.extras.includes(x.key);
          return (
            <label
              key={x.key}
              className={`surface-2 flex min-h-11 cursor-pointer items-start gap-2 p-2.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-brass-bright ${on ? "is-selected" : "hover:brightness-110"}`}
              data-testid={`extra-${x.key}`}
            >
              <input type="checkbox" checked={on} onChange={() => toggle(x.key)} className="mt-1 h-4 w-4 shrink-0 accent-[#f2c86a]" />
              <span className="min-w-0">
                <span className="flex items-center justify-between gap-2 font-extrabold">
                  {x.label}
                  <span className="num shrink-0 text-sm text-cream">{formatCredits(x.price)} cr</span>
                </span>
                <span className="block text-sm leading-snug text-cream-dim">{x.effect}</span>
              </span>
            </label>
          );
        })}
      </div>
      {offer.riders && <JockeyPicker riders={offer.riders} choice={choice} onChange={onChange} />}
      {offer.jockeys.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-sm font-bold text-cream">Jockey</p>
          <div className="segmented flex-wrap" role="group" aria-label="Jockey">
            {offer.jockeys.map((j) => (
              <button key={j.key} type="button" aria-pressed={choice.jockey === j.key} onClick={() => onChange({ ...choice, jockey: j.key as JockeyKey })} data-testid={`jockey-${j.key}`}>
                {j.label}
                {j.price > 0 ? ` · ${formatCredits(j.price)} cr` : " · free"}
              </button>
            ))}
          </div>
          {jockey && <p className="mt-2 text-sm text-cream-dim">{jockey.effect}</p>}
        </div>
      )}
      {total > 0 && (
        <p className="mt-2 text-sm font-bold text-cream" data-testid="extras-total">
          Extras: {formatCredits(total)} credits
        </p>
      )}
    </fieldset>
  );
}

/**
 * Story entry: choose a runner (optional) and a riding plan, then go to the gates. The plan
 * defaults to the horse's natural style, so a new player can enter with one tap.
 */
export function EntryForm({
  state,
  initialHorseId,
  showPicker = true,
  inline = false,
  autoFocusSubmit = false,
}: {
  state: PlayerState;
  initialHorseId?: string | null;
  showPicker?: boolean;
  /** Inline on a page, where Quick Pick is the primary action: the submit is a secondary button. */
  inline?: boolean;
  autoFocusSubmit?: boolean;
}) {
  const router = useRouter();
  const racing = state.horses.filter((h) => h.careerStatus === "racing");
  const [horseId, setHorseId] = useState<string | null>(initialHorseId ?? racing.find((h) => !h.block)?.id ?? null);
  const horse = racing.find((h) => h.id === horseId);
  const [plan, setPlan] = useState<RacePlan>({ tactic: horse?.horse.style ?? "stalker", intensity: "normal" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (initialHorseId) setHorseId(initialHorseId);
  }, [initialHorseId]);
  useEffect(() => {
    const h = racing.find((x) => x.id === horseId);
    if (h) setPlan((p) => ({ ...p, tactic: h.horse.style }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horseId]);

  async function go() {
    if (!horse) return;
    setBusy(true);
    setError(null);
    try {
      const { raceId } = await enterStoryRace(horse.id, plan);
      router.push(`/race/${raceId}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const blocked = horse?.block ?? null;
  const submit = (
    <button
      type="button"
      className={inline ? "btn btn-lg" : "btn btn-brass btn-lg"}
      disabled={!horse || !!blocked || busy}
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
      {showPicker && <HorsePicker horses={racing} selectedId={horseId} onSelect={setHorseId} />}
      <PlanPicker horse={horse} plan={plan} onChange={setPlan} risk={(i) => (horse ? storyRisk(horse, i) : null)} />
      <p className="flex items-start gap-2 text-sm text-cream-dim">
        <PixelIcon name="shield" size={16} className="mt-0.5" />
        <span>
          Story race against the Club&rsquo;s horses, usually near {horse ? `${pronoun(horse.horse.sex).his} best trip` : "your horse's best trip"}. Free: no
          stable entries and no career start used. The result is sealed and settled the moment you enter; the gates open 10 seconds later.
        </span>
      </p>
      {error !== null && <ErrorNote error={error} />}
      {inline ? <div>{submit}</div> : <div className="grid [&>.btn]:w-full">{submit}</div>}
    </div>
  );
}
