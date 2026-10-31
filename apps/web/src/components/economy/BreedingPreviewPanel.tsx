"use client";
/**
 * The breeding preview (owner decision 2026-10-31: "just what maybe it looks like but its still
 * a chance, no geeky genes or numbers"): sample foals as portraits, the outlook in words, the
 * nick in a word, warnings in words, and the fees. No odds, genes or numbers but the fees: the
 * server builds it from public facts only, and the real foal is still a surprise at birth.
 */
import type { PreviewView } from "@/lib/economyTypes";
import { formatCredits } from "@/lib/format";
import { UsdgMoney, UsdgText } from "@/components/chain/UsdgMode";
import { PossibleLooks } from "./PossibleLooks";
import { Credits } from "./kit";

/** Outlook colour by tone (always with the words, never colour alone). */
export const OUTLOOK_TONE: Record<PreviewView["outlook"]["tone"], { color: string; mark: string }> = {
  bright: { color: "#f2c86a", mark: "★" },
  steady: { color: "#9fe0a8", mark: "●" },
  caution: { color: "#ff8a7a", mark: "▼" },
};

export function nickColor(nick: PreviewView["nick"]): string {
  return nick.startsWith("Excellent") ? "#f2c86a" : nick.startsWith("Good") ? "#9fe0a8" : nick.startsWith("Fair") ? "#cdbf9c" : "#ff8a7a";
}

export function BreedingPreviewPanel({ v }: { v: PreviewView }) {
  const tone = OUTLOOK_TONE[v.outlook.tone];
  const warns = v.warnings.filter((w) => w.tone === "warn");
  const notes = v.warnings.filter((w) => w.tone === "note");
  return (
    <div className="grid gap-4" data-testid="breeding-preview">
      <PossibleLooks looks={v.looks} note={v.looksNote} />

      {/* The outlook in words. */}
      <div className="inset grid gap-2 p-3" data-testid="preview-outlook">
        <h4 className="label">Outlook</h4>
        <p className="t-display-m leading-tight" style={{ color: tone.color }} data-outlook={v.outlook.tone}>
          <span aria-hidden>{tone.mark} </span>
          {v.outlook.phrase}
        </p>
        <p className="text-sm text-cream-dim">{v.certainty.phrase}</p>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip font-extrabold" style={{ color: nickColor(v.nick) }} title="How well the lines combine" data-testid="preview-nick">
            {v.nick}
          </span>
          <span className="chip" data-testid="preview-breed">
            {v.breed}
          </span>
        </div>
        {notes.map((w) => (
          <p key={w.key} className="caption" data-note={w.key}>
            {w.text}
          </p>
        ))}
      </div>

      {warns.length > 0 && (
        <ul className="grid gap-2" data-testid="preview-warnings">
          {warns.map((w) => (
            <li key={w.key} className="px-oxblood p-3 text-sm" data-warning={w.key}>
              <span aria-hidden className="font-extrabold">
                ⚠{" "}
              </span>
              {w.text}
            </li>
          ))}
        </ul>
      )}

      {/* Fees. */}
      <div className="inset grid gap-1 p-3 text-sm" data-testid="preview-fees">
        <h4 className="label">Fees</h4>
        <div className="flex justify-between">
          <span>Breeding fee (base)</span>
          <Credits value={v.fees.baseFee} />
        </div>
        {v.usdgStudFee !== null && v.usdgStudFee !== undefined ? (
          <div className="flex justify-between" data-testid="preview-usdg-stud-fee">
            <span>
              <UsdgText>{`Stud fee (USDG, from your wallet to ${v.stallionOwner ?? "his owner"})`}</UsdgText>
            </span>
            <UsdgMoney micro={v.usdgStudFee} />
          </div>
        ) : (
          <div className="flex justify-between">
            <span>{v.ownSire ? "Stud fee (your own stallion)" : "Stud fee"}</span>
            <Credits value={v.fees.studFee} />
          </div>
        )}
        <div className="flex justify-between border-t-2 border-line pt-1 font-extrabold text-cream">
          <span>You pay{v.usdgStudFee ? " in credits" : ""}</span>
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
