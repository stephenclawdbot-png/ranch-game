"use client";

import { PlayerGate } from "@/components/PlayerGate";
import { BreedingBarn } from "@/components/economy/BreedingBarn";

export default function BreedingPage() {
  return <PlayerGate>{() => <BreedingBarn />}</PlayerGate>;
}
