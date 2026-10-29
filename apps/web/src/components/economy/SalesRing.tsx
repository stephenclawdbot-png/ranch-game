"use client";

/**
 * The market as an auction house (REDESIGN §4.7): the Sales Ring, with the lot that closes
 * soonest led round in its own coat and a lot board (lot number, pedigree, asking price).
 * Prices stay the sellers' fixed asks (the economy is unchanged); the catalogue below carries
 * every lot.
 */
import { useMemo, type ReactNode } from "react";
import type { ListingView } from "@/lib/economyTypes";
import { formatCredits } from "@/lib/format";
import { Diorama } from "../diorama/Diorama";
import { salesRingScene } from "../diorama/scenes";

export function pedigreeLine(l: Pick<ListingView, "sireName" | "damName">): string {
  if (l.sireName && l.damName) return `by ${l.sireName} out of ${l.damName}`;
  if (l.sireName) return `by ${l.sireName}`;
  if (l.damName) return `out of ${l.damName}`;
  return "Foundation stock";
}

export function SalesRing({ lot, eyebrow, onSeeLot }: { lot: ListingView | null; eyebrow: ReactNode; onSeeLot: (l: ListingView) => void }) {
  const look = lot ? { coat: lot.horse.appearance.coat, appearance: lot.horse.appearance } : null;
  const key = lot ? `${lot.listingId}` : "";
  const def = useMemo(() => salesRingScene(look), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="ring bleed" aria-label="The Sales Ring" data-testid="sales-ring">
      <div className="ring-stage">
        <Diorama scene="sales-ring" sceneDef={def} aspect={null} priority label={lot ? `${lot.horse.name} being led round the Sales Ring` : "The Sales Ring"} style={{ position: "absolute", inset: 0 }} />
        <div className="ring-greet">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="ring-title">Sales Ring</h1>
        </div>
        {lot && (
          <div className="ring-board print" data-testid="lot-board">
            <p className="ring-board-eyebrow">
              Lot {lot.lot} · in the ring
            </p>
            <p className="ring-board-name">{lot.horse.name}</p>
            <p className="ring-board-ped">{pedigreeLine(lot)}</p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <span>
                <span className="ring-board-label">Asking</span>
                <span className="ring-board-price">{formatCredits(lot.price)}</span>
              </span>
              <button type="button" className="btn btn-sm btn-brass" onClick={() => onSeeLot(lot)}>
                See lot {lot.lot}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
