"use client";

import { use } from "react";
import { PlayerGate } from "@/components/PlayerGate";
import { PullVerify } from "@/components/economy/PullVerify";

export default function PullVerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PlayerGate>{() => <PullVerify id={id} />}</PlayerGate>;
}
