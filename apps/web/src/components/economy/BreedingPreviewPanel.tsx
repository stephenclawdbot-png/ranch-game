"use client";
/**
 * The breeding preview: the exact odds of a pairing, before the player commits (game-design
 * §7). Overall first (range, ranking, nick), then the depth: stat ranges, coat colours,
 * aptitudes, inbreeding and mutation, fees.
 */
import type { PreviewView } from "@/lib/economyTypes";
import { formatCredits } from "@/lib/format";
import { GRADE_COLOR, GRADE_TEXT } from "@/components/StatBars";
import { Credits } from "./kit";

const STATS = [
  ["speed", "Speed"],
  ["stamina", "Stamina"],
  ["burst", "Burst"],
  ["durability", "Durability"],
  ["adaptability", "Adaptability"],
  ["temperament", "Temperament"],
] as const;
const GRADES = ["S", "A", "B", "C", "D", "E"] as const;
const LO = 300;
const HI = 950;

/** game-core gradeOf: E < 500 <= D < 600 <= C < 700 <= B < 800 <= A < 900 <= S. */
export function gradeOf(v: number): (typeof GRADES)[number] {
  return v >= 900 ? "S" : v >= 800 ? "A" : v >= 700 ? "B" : v >= 600 ? "C" : v >= 500 ? "D" : "E";
}
const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - LO) / (HI - LO)) * 100))}%`;
const pct = (permille: number) => `${(permille / 10).toFixed(permille < 100 && permille % 10 ? 1 : 0)}%`;

function OddsBars({ title, items }: { title: string; items: { label: string; permille: number }[] }) {
  const shown = items.filter((i) => i.permille > 0).sort((a, b) => b.permille - a.permille);
  return (
    <div>
      <h4 className="label mb-1">{title}</h4>
      <ul className="grid gap-1">
        {shown.map((i) => (
          <li key={i.label} className="grid grid-cols-[minmax(0,7.5rem)_1fr_3.25rem] items-center gap-2 text-sm">
            <span className="truncate font-bold text-cream">{i.label}</span>
            <span className="h-3 bg-[#050b08] p-[2px]" aria-hidden>
              <span className="block h-full bg-cream-dim" style={{ width: `${Math.max(2, i.permille / 10)}%` }} />
            </span>
            <span className="num text-right text-cream">{pct(i.permille)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LABEL: Record<string, string> = {
  sprint: "Sprint",
  mile: "Mile",
  middle: "Middle",
  staying: "Staying",
  turf: "Turf",
  dirt: "Dirt",
  synthetic: "Synthetic",
  front: "Front-runner",
  stalker: "Stalker",
  closer: "Closer",
  early: "Early peaker",
  normal: "Normal",
  late: "Late peaker",
};
/** What the line means for the foal's limits (game-core familyRange). */
const LINEAGE: Record<"deep" | "rising" | "foundation", { tag: string; text: string }> = {
  deep: {
    tag: "Established line",
    text: "Parents and grandparents are of a level, so a foal can land up to 40 above its best parent's genes. Mutations lean back toward the family's level.",
  },
  rising: {
    tag: "Rising line",
    text: "These parents are well above their own parents: a one-generation jump. The foal gets less headroom above them, and mutations lean back toward the family.",
  },
  foundation: {
    tag: "Foundation stock",
    text: "No grandparents on record: the limits come from the parents alone. Breeding on from this foal builds a line.",
  },
};
const entries = (o: Partial<Record<string, number>>) => Object.entries(o).map(([k, v]) => ({ label: LABEL[k] ?? k, permille: v ?? 0 }));

export function BreedingPreviewPanel({ v }: { v: PreviewView }) {
  const p = v.preview;
  const o = p.overall;
  const nickColor = p.nick.label === "Excellent" ? "#f2c86a" : p.nick.label === "Good" ? "#9fe0a8" : p.nick.label === "Fair" ? "#cdbf9c" : "#ff8a7a";
  return (
    <div className="grid gap-4" data-testid="breeding-preview">
      {/* Headline: the predicted overall and the nick. */}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="inset grid gap-2 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="label">Predicted overall potential</h4>
            {v.topPercent ? (
              <span className="chip" data-testid="preview-percentile">
                Likely top {v.topPercent.p50}% · best case top {v.topPercent.p90}%
              </span>
            ) : (
              <span className="caption">Ranking appears once 10+ horses are in the game</span>
            )}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="score text-[2.5rem] text-cream" data-testid="preview-p50">
              {o.p50}
            </span>
            <span className="t-meta">
              likely · range <span className="num text-cream">{o.p10}</span>–<span className="num text-cream">{o.p90}</span> (80% of foals)
            </span>
          </div>
          {/* Range bar: p10..p90 band, p50 tick, both parents marked. */}
          <div className="relative h-6 bg-[#050b08]" role="img" aria-label={`Range ${o.p10} to ${o.p90}, most likely ${o.p50}. Sire ${v.parents.sire}, dam ${v.parents.dam}.`}>
            <span className="absolute inset-y-1 bg-[#3f8558]" style={{ left: pos(o.p10), width: `calc(${pos(o.p90)} - ${pos(o.p10)})` }} />
            <span className="absolute inset-y-0 w-[3px] bg-brass-bright" style={{ left: pos(o.p50) }} />
            <span className="absolute -bottom-0 h-2 w-2 bg-sky" style={{ left: pos(v.parents.sire) }} title={`Sire ${v.parents.sire}`} />
            <span className="absolute -bottom-0 h-2 w-2 bg-claret" style={{ left: pos(v.parents.dam) }} title={`Dam ${v.parents.dam}`} />
          </div>
          <p className="caption">
            <span className="text-sky">■</span> Sire {v.parents.sire} · <span className="text-claret">■</span> Dam {v.parents.dam} · Beats both parents: <span className="num text-cream">{pct(o.beatsBothParents)}</span>
          </p>
          <div className="flex flex-wrap gap-1.5" aria-label="Chance per grade">
            {GRADES.filter((g) => (o.grades[g] ?? 0) > 0).map((g) => (
              <span key={g} className="chip">
                <span className="font-extrabold" style={{ color: GRADE_TEXT[g] }}>
                  {g}
                </span>
                {pct(o.grades[g] ?? 0)}
              </span>
            ))}
          </div>
        </div>
        <div className="inset grid min-w-[9rem] content-center justify-items-center gap-1 p-3 text-center">
          <h4 className="label">Nick rating</h4>
          <span className="score text-[2.5rem]" style={{ color: nickColor }} data-testid="preview-nick">
            {p.nick.score}
          </span>
          <span className="font-extrabold" style={{ color: nickColor }}>
            {p.nick.label}
          </span>
          <span className="caption">How well the lines combine</span>
        </div>
      </div>

      {/* Family limits: the lowest and highest this foal can possibly be, set by the line. */}
      <div className="inset grid gap-2 p-3" data-testid="preview-limits">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="label">Family limits</h4>
          <span className="chip">{LINEAGE[p.limits.lineage].tag}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <span className="t-meta">
            Lowest possible{" "}
            <span className="num text-cream" data-testid="limit-floor">
              {p.limits.overall.floor}
            </span>{" "}
            <span className="font-extrabold" style={{ color: GRADE_TEXT[gradeOf(p.limits.overall.floor)] }}>
              {gradeOf(p.limits.overall.floor)}
            </span>
          </span>
          <span className="t-meta">
            Highest possible{" "}
            <span className="num text-cream" data-testid="limit-ceiling">
              {p.limits.overall.ceiling}
            </span>{" "}
            <span className="font-extrabold" style={{ color: GRADE_TEXT[gradeOf(p.limits.overall.ceiling)] }}>
              {gradeOf(p.limits.overall.ceiling)}
            </span>
          </span>
        </div>
        <div className="relative h-5 bg-[#050b08]" role="img" aria-label={`Possible ${p.limits.overall.floor} to ${p.limits.overall.ceiling}; 80% of foals ${o.p10} to ${o.p90}.`}>
          <span className="absolute inset-y-1 bg-[#23402f]" style={{ left: pos(p.limits.overall.floor), width: `calc(${pos(p.limits.overall.ceiling)} - ${pos(p.limits.overall.floor)})` }} />
          <span className="absolute inset-y-1 bg-[#3f8558]" style={{ left: pos(o.p10), width: `calc(${pos(o.p90)} - ${pos(o.p10)})` }} />
        </div>
        <p className="caption">{LINEAGE[p.limits.lineage].text}</p>
      </div>

      {/* Inbreeding. */}
      <div className={`flex flex-wrap items-center gap-2 p-3 ${p.coiWarning ? "px-oxblood" : "inset"}`} data-testid="preview-coi">
        <span className="font-extrabold">{p.coiWarning ? "⚠ Inbreeding warning" : "✓ Inbreeding"}</span>
        <span className="text-sm">
          COI <span className="num">{(p.coi / 10).toFixed(1)}%</span>
          {p.coiWarning ? " — close relatives: lower durability and temperament, more negative mutations." : p.coi > 0 ? " — distant shared ancestors." : " — no shared ancestors."}
        </span>
        <span className="caption w-full">
          Mutations: {(p.mutation.ratePermille / 10).toFixed(1)}% per allele, up to ±{p.mutation.maxStep}; {(p.mutation.negPermille / 10).toFixed(0)}% of them negative.
        </span>
      </div>

      {/* Stat ranges. */}
      <div>
        <h4 className="label mb-1">Stat potential ranges</h4>
        <ul className="grid gap-1.5">
          {STATS.map(([k, label]) => {
            const s = p.stats[k];
            const g = gradeOf(s.expected);
            return (
              <li key={k} className="grid grid-cols-[6.5rem_1fr_5.5rem] items-center gap-2 text-sm">
                <span className="font-bold text-cream">{label}</span>
                <span className="relative h-4 bg-[#050b08]" role="img" aria-label={`${label}: ${s.min} to ${s.max}, expected ${s.expected}; possible ${p.limits.stats[k].floor} to ${p.limits.stats[k].ceiling}`}>
                  <span className="absolute inset-y-[5px] bg-[#1c3427]" style={{ left: pos(p.limits.stats[k].floor), width: `calc(${pos(p.limits.stats[k].ceiling)} - ${pos(p.limits.stats[k].floor)})` }} />
                  <span className="absolute inset-y-1 bg-[#2c6645]" style={{ left: pos(s.min), width: `max(3px, calc(${pos(s.max)} - ${pos(s.min)}))` }} />
                  <span className="absolute inset-y-0 w-[3px]" style={{ left: pos(s.expected), background: GRADE_COLOR[g] }} />
                </span>
                <span className="num text-right text-cream">
                  {s.min}–{s.max}{" "}
                  <span className="font-extrabold" style={{ color: GRADE_TEXT[gradeOf(s.max)] }}>
                    {gradeOf(s.min) === gradeOf(s.max) ? gradeOf(s.min) : `${gradeOf(s.min)}–${gradeOf(s.max)}`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <OddsBars title="Coat colour" items={p.coats.map((c) => ({ label: c.name, permille: c.permille }))} />
        <OddsBars title="Best trip" items={entries(p.distance)} />
        <OddsBars title="Surface" items={entries(p.surface)} />
        <OddsBars title="Running style" items={entries(p.style)} />
        <OddsBars title="Maturity" items={entries(p.maturity)} />
      </div>

      {/* Fees. */}
      <div className="inset grid gap-1 p-3 text-sm" data-testid="preview-fees">
        <h4 className="label">Fees</h4>
        <div className="flex justify-between">
          <span>Breeding fee (base)</span>
          <Credits value={v.fees.baseFee} />
        </div>
        <div className="flex justify-between">
          <span>{v.ownSire ? "Stud fee (your own stallion)" : "Stud fee"}</span>
          <Credits value={v.fees.studFee} />
        </div>
        <div className="flex justify-between border-t-2 border-line pt-1 font-extrabold text-cream">
          <span>You pay</span>
          <Credits value={v.fees.totalPaidByMareOwner} />
        </div>
        <p className="caption">
          {formatCredits(v.fees.burned)} burned (the base fee + 10% of the stud fee)
          {v.fees.toStallionOwner > 0 ? ` · ${formatCredits(v.fees.toStallionOwner)} to the stallion's owner` : ""}. Credits are never cashed out.
        </p>
      </div>
    </div>
  );
}
