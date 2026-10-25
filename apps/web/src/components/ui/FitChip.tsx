import { FIT_SYMBOL, type Fit, type FitLevel } from "@/lib/aptitude";

const TONE: Record<FitLevel, string> = { good: "text-positive", ok: "text-warn", poor: "text-negative" };
const WORD: Record<FitLevel, string> = { good: "suits", ok: "so-so", poor: "against" };

/** ✓ / ~ / ✗ plus a word: fit is never shown by colour alone. */
export function FitChip({ fit, showDetail = false }: { fit: Fit; showDetail?: boolean }) {
  return (
    <span className="chip !gap-1.5" title={`${fit.label}: ${fit.detail}`}>
      <span className={`font-extrabold ${TONE[fit.level]}`} aria-hidden>
        {FIT_SYMBOL[fit.level]}
      </span>
      <span className="text-cream">{fit.label}</span>
      {showDetail ? <span className="font-semibold text-cream-dim">{fit.detail}</span> : <span className="sr-only">{WORD[fit.level]}</span>}
    </span>
  );
}

export function FitList({ fits, showDetail = false }: { fits: Fit[]; showDetail?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Fit check">
      {fits.map((f) => (
        <li key={f.id}>
          <FitChip fit={f} showDetail={showDetail} />
        </li>
      ))}
    </ul>
  );
}
