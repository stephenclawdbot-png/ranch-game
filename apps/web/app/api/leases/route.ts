import { leaseView } from "@/server/leasing";
import { withPlayer } from "@/server/economyHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sales > Lease: the lease board, your offers, your leases (either side), your horses to offer, your lessee record. */
export async function GET() {
  return withPlayer((db, session, now) => leaseView(db, session, now));
}
