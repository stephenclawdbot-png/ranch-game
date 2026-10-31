"use client";

import { PlayerGate } from "@/components/PlayerGate";
import { MarketScreen } from "@/components/economy/MarketScreen";
import { FeatureGate } from "@/components/onboarding/FeatureGate";

export default function MarketPage() {
  return (
    <PlayerGate>
      {() => (
        <FeatureGate feature="market">
          <MarketScreen />
        </FeatureGate>
      )}
    </PlayerGate>
  );
}
