"use client";

import { PlayerGate } from "@/components/PlayerGate";
import { PacksScreen } from "@/components/economy/PacksScreen";

export default function PacksPage() {
  return <PlayerGate>{() => <PacksScreen />}</PlayerGate>;
}
