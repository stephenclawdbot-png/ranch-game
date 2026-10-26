"use client";

import { PlayerGate } from "@/components/PlayerGate";
import { InviteScreen } from "@/components/chain/InviteScreen";

export default function InvitePage() {
  return <PlayerGate>{() => <InviteScreen />}</PlayerGate>;
}
