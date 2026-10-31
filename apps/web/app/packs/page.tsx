"use client";

import { PlayerGate } from "@/components/PlayerGate";
import { PacksScreen } from "@/components/economy/PacksScreen";

export default function PacksPage() {
  return (
    <PlayerGate band={{ scene: "stud-dawn", alt: "Mares and foals at the stud at dawn", eyebrow: "Market · foals with published odds", title: "Packs" }}>
      {() => <PacksScreen />}
    </PlayerGate>
  );
}
