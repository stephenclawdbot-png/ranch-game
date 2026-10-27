"use client";

import { PlayerGate } from "@/components/PlayerGate";
import { PacksScreen } from "@/components/economy/PacksScreen";

export default function PacksPage() {
  return (
    <PlayerGate band={{ scene: "paddock", alt: "The paddock", eyebrow: "Market · foals with published odds", title: "Packs" }}>
      {() => <PacksScreen />}
    </PlayerGate>
  );
}
