"use client";

import { PlayerGate } from "@/components/PlayerGate";
import { BringRival } from "@/components/social/BringRival";

export default function BringRivalPage() {
  return <PlayerGate>{() => <BringRival />}</PlayerGate>;
}
