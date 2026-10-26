import type { Metadata } from "next";
import { PoolScreen } from "@/components/chain/PoolScreen";

export const metadata: Metadata = { title: "Prize Pool" };

/** The on-chain weekly Prize Pool (closed beta). Public: signed-out visitors see the pool and the rules. */
export default function PoolPage() {
  return <PoolScreen />;
}
