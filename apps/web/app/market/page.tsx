"use client";

import { PlayerGate } from "@/components/PlayerGate";
import { MarketScreen } from "@/components/economy/MarketScreen";
import { FeatureGate, useLocked } from "@/components/onboarding/FeatureGate";
import { SceneBand } from "@/components/ui/Page";

/** While the Market is still locked for a new stable: the Sales Ring scene over the locked note. */
function LockedBand() {
  const locked = useLocked("market");
  return locked ? <SceneBand scene="sales-ring" alt="The Sales Ring, quiet until your market opens" eyebrow="Sales" title="Market" testId="market-band" /> : null;
}

export default function MarketPage() {
  return (
    <PlayerGate>
      {() => (
        <div className="grid gap-6">
          <LockedBand />
          <FeatureGate feature="market">
            <MarketScreen />
          </FeatureGate>
        </div>
      )}
    </PlayerGate>
  );
}
