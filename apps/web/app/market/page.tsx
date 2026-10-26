"use client";

import { PlayerGate } from "@/components/PlayerGate";
import { MarketScreen } from "@/components/economy/MarketScreen";

export default function MarketPage() {
  return <PlayerGate>{() => <MarketScreen />}</PlayerGate>;
}
