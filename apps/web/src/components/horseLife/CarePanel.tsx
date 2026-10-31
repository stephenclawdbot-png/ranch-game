"use client";

import { useState } from "react";
import type { HorseLifeView } from "@/lib/horseLife";
import { INTENSITY_LABEL, RISK_LABEL, dayName, hoursText } from "@/lib/horseLife";
import { formatCredits, oneInText } from "@/lib/format";
import { PixelIcon } from "../icons";
import { ActionBar } from "../ui/ActionBar";
import { ErrorNote } from "../ui/ErrorNote";
import { CellBar, GrowthTrack, useAction } from "./common";

interface CareResponse {
  counted: boolean;
  graduated: boolean;
  stageAfter: string;
  quality: number;
  careSessions: number;
}

/** Care & condition: today's care session, growth, freshness, injuries, risk and insurance. */
export function CarePanel({ view }: { view: HorseLifeView }) {
  const { care, condition: cond, career } = view;
  const first = view.name;
  const recommended = care.feeds.find((f) => f.recommended)?.key ?? care.feeds[0]!.key;
  const [feed, setFeed] = useState(recommended);
  const [groom, setGroom] = useState(true);
  const [turnout, setTurnout] = useState(true);
  const [result, setResult] = useState<CareResponse | null>(null);
  const action = useAction();
  const base = `/api/horses/${view.id}`;

  async function doCare() {
    const r = await action.run<CareResponse>("care", `${base}/care`, { body: { feed, groom, turnout } });
    if (r) setResult(r);
  }

  const peak = cond.peak;
  const peakText =
    peak.phase === "none"
      ? "No hard work lately, so no freshness peak is building. Hard work sets one up 3 to 5 days later."
      : peak.phase === "building"
        ? `Freshness peak building: best from ${dayName(peak.fromMs!)} to ${dayName(peak.toMs!)}.`
        : peak.phase === "peak"
          ? `At the freshness peak until ${dayName(peak.toMs!)}: a good time to race.`
          : "The freshness peak is fading.";

  return (
    <div className="grid gap-5">
      <section className="surface grid gap-3 p-4" aria-labelledby="care-h" data-testid="care-panel">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="care-h" className="t-h2">
              Today&rsquo;s care
            </h2>
            <p className="text-sm text-cream-dim">One counted session a day. Missing a day only pauses growth; it never harms {first}.</p>
          </div>
          {care.caredToday && (
            <span className="chip text-positive" data-testid="cared-today">
              ✓ Done today
            </span>
          )}
        </div>

        {care.growth && <GrowthTrack growth={care.growth} />}

        {result?.counted && (
          <p className="surface-2 p-2 text-sm font-bold text-cream" role="status" data-testid="care-result">
            {result.graduated
              ? `${first} is ready to race! Welcome them to the yard in the Nursery.`
              : `Session ${result.careSessions} counted. ${result.quality >= 1000 ? "Just the right feed." : "A different feed would have suited better."}`}
          </p>
        )}

        {!care.caredToday && care.canCare && (
          <>
            <fieldset className="grid gap-2">
              <legend className="label mb-1">Feed</legend>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {care.feeds.map((f) => (
                  <label key={f.key} className={`flex min-h-11 cursor-pointer items-center gap-2 px-2 py-1.5 ${feed === f.key ? "bg-surface-2 shadow-[inset_0_0_0_2px_#d9a441]" : "bg-inset"}`}>
                    <input type="radio" name="feed" value={f.key} checked={feed === f.key} onChange={() => setFeed(f.key)} className="accent-[#d9a441]" />
                    <span className="min-w-0 text-sm leading-tight">
                      <span className="block font-extrabold text-cream">
                        {f.label} {f.recommended && <span className="text-xs text-positive">✓ suits {first}</span>}
                      </span>
                      <span className="block text-cream-dim">{f.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Also">
              <button type="button" className="chip min-h-11 px-3" aria-pressed={groom} onClick={() => setGroom((g) => !g)}>
                {groom ? "✓" : "○"} Groom
              </button>
              <button type="button" className="chip min-h-11 px-3" aria-pressed={turnout} onClick={() => setTurnout((t) => !t)}>
                {turnout ? "✓" : "○"} Turnout
              </button>
            </div>
          </>
        )}
        <p className="t-meta">
          Bond {Math.round(care.bond / 10)}% · care quality {Math.round(care.careQuality / 10)}%
        </p>
        {action.error != null && action.busy === null && <ErrorNote error={action.error} />}
        {care.canCare && (
          <ActionBar>
            <button type="button" className="btn btn-brass btn-lg" onClick={doCare} disabled={care.caredToday || action.busy !== null} data-testid="care-now">
              <PixelIcon name="horseshoe" size={32} className="-my-2" />
              {care.caredToday ? "Cared for today · back tomorrow" : action.busy === "care" ? "Caring…" : `Care for ${first}`}
            </button>
          </ActionBar>
        )}
      </section>

      <section className="surface grid gap-3 p-4" aria-labelledby="cond-h" data-testid="condition-panel">
        <h2 id="cond-h" className="t-h2">
          Condition
        </h2>
        <div className="grid gap-1">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-bold text-cream-dim">Freshness</span>
            <span className="num text-sm">{Math.round(cond.freshness / 10)}%</span>
          </div>
          <CellBar value={cond.freshness} max={1000} cells={20} label={`Freshness ${Math.round(cond.freshness / 10)}%`} tone={cond.freshness < 450 ? "negative" : "positive"} />
          <p className="text-sm text-cream-dim" data-testid="peak">
            {peakText}
            {peak.bonus > 0 && ` (+${(peak.bonus / 10).toFixed(1)}% now)`}
          </p>
        </div>
        <ul className="flex flex-wrap gap-1.5 text-sm">
          <li className={`chip ${cond.fatigue > 300 ? "text-negative" : "text-cream"}`}>Fatigue {Math.round(cond.fatigue / 10)}%{cond.fatigue > 300 ? " · tired" : ""}</li>
          <li className="chip text-cream">Fitness {Math.round(cond.fitness / 10)}%</li>
          <li className="chip text-cream">Morale {cond.morale > 0 ? `+${cond.morale}` : cond.morale}</li>
        </ul>
        <p className="caption">Fatigue recovers on its own in real time, even while you&rsquo;re away.</p>
      </section>

      <section className="surface grid gap-3 p-4" aria-labelledby="inj-h" data-testid="injury-panel">
        <h2 id="inj-h" className="t-h2">
          Injuries
        </h2>
        {cond.injury?.severity === "fatal" ? (
          <p className="font-extrabold text-negative" data-testid="injury-status">
            Fatal injury. In memoriam: the horse rests on the Legacy Farm, and its record and foals carry the line on.
          </p>
        ) : cond.injury ? (
          <div className="grid gap-2" data-testid="injury-card">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="t-title text-negative" data-testid="injury-name">
                {cond.injury.label}
              </p>
              {cond.injury.label !== cond.injury.severityLabel && <span className="chip !py-0 text-xs text-cream">{cond.injury.severityLabel}</span>}
              {cond.injury.area && <span className="chip !py-0 text-xs text-cream-dim">{cond.injury.area}</span>}
            </div>
            {cond.injury.description && <p className="text-sm text-cream">{cond.injury.description}</p>}
            <p className="font-extrabold text-negative" data-testid="injury-status">
              {cond.injury.careerEnding ? "Settled" : "Back"} in {hoursText(cond.injury.hoursLeft)} ({dayName(cond.injury.untilMs)})
            </p>
            {cond.injury.careerEnding && (
              <p className="text-sm font-bold text-cream" data-testid="injury-career-ending">
                {first} can&rsquo;t race again. {view.horse.sex === "filly" || view.horse.sex === "mare" ? "She can join your broodmares" : "He can stand at stud"} once healed, or retire to the Legacy Farm.
              </p>
            )}
            <p className="text-sm text-cream-dim">
              What helps: rest (healing carries on in real time, even while you&rsquo;re away), a care session (12 h off, once a day) and vet treatment (24 h off, once a day). A better vet facility heals faster.
            </p>
            <button
              type="button"
              className="btn btn-sm w-fit"
              onClick={() => action.run("vet", `${base}/vet`)}
              disabled={cond.injury.treatedToday || action.busy !== null || view.credits < cond.injury.vetCost}
              data-testid="vet-treat"
            >
              {cond.injury.treatedToday ? "Treated today ✓" : `Vet treatment · ${formatCredits(cond.injury.vetCost)} cr`}
            </button>
          </div>
        ) : (
          <p className="text-cream-dim">
            {first} is sound. {career.careerStatus === "racing" ? "Injury risk for the next start:" : ""}
          </p>
        )}
        {career.careerStatus === "racing" && career.racingAge && (
          <table className="w-full text-sm" data-testid="risk-table">
            <caption className="sr-only">Injury risk for the next start, at its best trip on good going</caption>
            <tbody className="rows">
              {cond.risks.map((r) => (
                <tr key={r.intensity}>
                  <th scope="row" className="py-1.5 text-left font-bold text-cream-dim">
                    {INTENSITY_LABEL[r.intensity]}
                  </th>
                  <td className={`py-1.5 text-right font-extrabold ${r.label === "low" ? "text-cream" : "text-negative"}`}>
                    {RISK_LABEL[r.label]} · {(r.permille / 10).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cond.risks[1] && cond.risks[1].factors.length > 0 && career.racingAge && <p className="caption">{cond.risks[1].factors.join(" · ")}</p>}
        {cond.risks[1]?.likely && cond.risks[1].likely.length > 0 && career.careerStatus === "racing" && career.racingAge && (
          <p className="caption" data-testid="likely-injuries">
            Most likely if injured: {cond.risks[1].likely.join(", ").toLowerCase()}.
          </p>
        )}

        <div className="grid gap-2 border-t-2 border-line pt-3" data-testid="insurance">
          <h3 className="t-title">Insurance</h3>
          {cond.insurance.insured ? (
            <p className="text-sm text-positive">✓ Insured against a career-ending injury (pays {formatCredits(cond.insurance.payout)} credits).</p>
          ) : cond.insurance.available ? (
            <>
              <p className="text-sm text-cream-dim" data-testid="insurance-risk">
                Risk: {oneInText(cond.insurance.careerEndingPerRace)} races ends a career for a horse in this condition.
              </p>
              <p className="text-sm text-cream-dim">
                One premium of {formatCredits(cond.insurance.premium)} credits. Pays {formatCredits(cond.insurance.payout)} if an injury ever ends {first}&rsquo;s
                racing career.
              </p>
              <button
                type="button"
                className="btn btn-sm w-fit"
                onClick={() => action.run("insure", `${base}/insurance`)}
                disabled={action.busy !== null || view.credits < cond.insurance.premium}
                data-testid="insure"
              >
                Insure · {formatCredits(cond.insurance.premium)} cr
              </button>
            </>
          ) : (
            <p className="text-sm text-cream-dim">Only horses still racing can be insured.</p>
          )}
        </div>
      </section>
    </div>
  );
}
