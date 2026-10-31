"use client";

/**
 * Training as a trade-off board (REDESIGN §4.5): every workout laid out side by side with what
 * the NEXT session would do, computed on the server by the same code that runs it
 * (game-core previewTraining): the gain per stat, fatigue now -> after, the chance of a knock,
 * the cost, and the freshness peak hard work sets up. Picking a tile fills the next plan slot;
 * nothing is spent until the session is run.
 */
import type { StatKey, TrainingPreviewView, WorkoutView } from "@/lib/horseLife";
import { STAT_NAMES, dayName } from "@/lib/horseLife";

const TIRED = 300;
const OVERWORK = 600;

const BLOCK_TEXT: Record<string, string> = {
  not_light: "Yearlings do light work only",
  insufficient_credits: "Not enough credits",
  injured: "Resting an injury",
  week_full: "Week done",
  foal: "Too young",
  retired: "Retired",
};

function fatigueWord(f: number): string {
  return f > OVERWORK ? "Overworked" : f > TIRED ? "Tired" : f > 150 ? "Ready" : "Fresh";
}

function pct(permille: number): string {
  const v = permille / 10;
  return `${v >= 1 ? v.toFixed(1).replace(/\.0$/, "") : v.toFixed(1)}%`;
}

/** Fatigue is permille of 1000: show it as a whole percentage (830 -> 83%). */
function fPct(f: number): string {
  return `${Math.round(f / 10)}%`;
}

export function TrainingBoard({
  previews,
  workouts,
  picked,
  session,
  onPick,
}: {
  previews: TrainingPreviewView[];
  workouts: WorkoutView[];
  picked: string | null;
  session: number;
  onPick: (key: string) => void;
}) {
  const byKey = new Map(workouts.map((w) => [w.key, w]));
  const shown = previews.filter((p) => byKey.get(p.key)?.allowed);
  if (!shown.length) return null;
  return (
    <section className="surface grid gap-3 p-4" aria-labelledby="board-h" data-testid="training-board">
      <div>
        <h2 id="board-h" className="t-h2">
          Session {session}: what each workout does
        </h2>
        <p className="text-sm text-cream-dim">Gains, fatigue and risk for the next session, before you spend anything. Pick one, then run it below.</p>
      </div>
      <ul className="tboard">
        {shown.map((p) => {
          const w = byKey.get(p.key)!;
          const gains = (Object.entries(p.gains) as [StatKey, number][]).filter(([, v]) => v > 0);
          const delta = p.fatigueAfter - p.fatigueBefore;
          const blocked = p.block && p.block !== "week_full" ? BLOCK_TEXT[p.block] ?? p.block : null;
          const isPicked = picked === p.key;
          return (
            <li key={p.key} className={`tboard-tile ${isPicked ? "is-picked" : ""}`} data-testid={`board-${p.key}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="tboard-name">{w.label}</h3>
                <span className="tboard-cost">{w.cost ? `${w.cost} cr` : "free"}</span>
              </div>

              <div className="tboard-sec" aria-label="Gain">
                <p className="tboard-label">Gain</p>
                {gains.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {gains.map(([k, v]) => (
                      <li key={k} className="tboard-gain">
                        +{pct(v)} {STAT_NAMES[k]}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm font-bold text-positive">Recovers: fatigue −{Math.abs(delta)}</p>
                )}
                {p.overworked && <p className="mt-1 text-xs font-extrabold text-warn">Tired: half the gains</p>}
              </div>

              <div className="tboard-sec" aria-label="Fatigue">
                <p className="tboard-label">
                  Fatigue <span className="text-cream">{fPct(p.fatigueBefore)} {fatigueWord(p.fatigueBefore)}</span> →{" "}
                  <span className={p.fatigueAfter > TIRED ? "text-warn" : "text-positive"}>{fPct(p.fatigueAfter)} {fatigueWord(p.fatigueAfter)}</span>
                </p>
                <div className="tboard-meter" role="img" aria-label={`Fatigue ${Math.round(p.fatigueBefore / 10)}% to ${Math.round(p.fatigueAfter / 10)}%`}>
                  <span className="tboard-now" style={{ width: `${Math.min(p.fatigueBefore, p.fatigueAfter) / 10}%` }} />
                  <span
                    className={delta >= 0 ? "tboard-add" : "tboard-off"}
                    style={{ left: `${Math.min(p.fatigueBefore, p.fatigueAfter) / 10}%`, width: `${Math.abs(delta) / 10}%` }}
                  />
                  <i style={{ left: `${TIRED / 10}%` }} aria-hidden />
                  <i style={{ left: `${OVERWORK / 10}%` }} aria-hidden className="is-over" />
                </div>
              </div>

              <div className="tboard-sec flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className={`tboard-risk ${p.injuryPermille > 0 ? "is-risk" : ""}`}>{p.injuryPermille > 0 ? `Knock risk ${pct(p.injuryPermille)}` : "No injury risk"}</span>
                {/* The peak line per session (playtest fix 9): hard work sets up a dated window, while
                    light work and rest only keep the pending one (and say so when there isn't one).
                    What used to be one identical "Peak in 3-5 days" on every tile; the hours to
                    race-ready are each session's own wait, from the fatigue it itself adds. */}
                {p.peak?.setsUp ? (
                  <span className="text-xs font-bold text-sky" data-testid={`peak-${p.key}`}>
                    Peak {dayName(p.peak.fromMs)}–{dayName(p.peak.toMs)}
                    {p.readyInH > 0 ? ` · race-ready in ~${p.readyInH}h` : ""}
                  </span>
                ) : p.peak ? (
                  <span className="text-xs font-bold text-cream-dim" data-testid={`peak-${p.key}`}>
                    Keeps the peak {dayName(p.peak.fromMs)}–{dayName(p.peak.toMs)}
                  </span>
                ) : (
                  <span className="text-xs font-bold text-cream-dim" data-testid={`peak-${p.key}`}>
                    No peak pending
                  </span>
                )}
              </div>

              <button
                type="button"
                className={`btn btn-sm mt-auto w-full ${isPicked ? "btn-brass" : "btn-outline"}`}
                aria-pressed={isPicked}
                disabled={!!blocked}
                onClick={() => onPick(p.key)}
                data-testid={`pick-${p.key}`}
              >
                {blocked ?? (isPicked ? "Picked" : "Pick")}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
