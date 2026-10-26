"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { RunningStyle } from "@thoroughbred/shared";
import { pronoun } from "@/lib/aptitude";
import { STYLE_LABEL, SURFACE_LABEL, formatDistance } from "@/lib/format";
import { api, type PlayerState } from "@/lib/player";
import type { RacePlan, RideIntensity, RiskView, StableHorse } from "@/lib/types";
import { HorsePortrait } from "../HorsePortrait";
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
              className={`surface-2 flex w-52 shrink-0 snap-start items-center gap-2 p-1.5 text-left disabled:opacity-50 md:w-auto ${selected ? "is-selected" : "hover:brightness-110"}`}
              data-testid="pick-horse"
            >
              <HorsePortrait appearance={h.appearance} scale="thumb" />
              <span className="min-w-0">
                <span className="block truncate font-extrabold">{h.name}</span>
                <span className="block truncate text-sm text-cream-dim">
                  {formatDistance(h.preferredDistanceM)} · {SURFACE_LABEL[h.preferredSurface]} · {s.starts}/{s.maxStarts} starts
                </span>
                <span className={`block truncate text-xs font-semibold ${reason ? "text-negative" : cond.tone}`}>{reason ?? cond.text}</span>
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
            {current.factors.length > 0 && <span className="text-cream-dim">· {current.factors.slice(0, 3).join(" · ")}</span>}
          </p>
        )}
      </fieldset>
    </>
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
