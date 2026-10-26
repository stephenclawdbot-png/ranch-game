import { withChainPlayer } from "@/server/chain/http";
import { myAllocations } from "@/server/chain/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your posted allocations with Merkle proofs, vested / claimed / claimable amounts (claim from your wallet). */
export async function GET() {
  return withChainPlayer((ctx, session, now) => myAllocations(ctx, session, now));
}
