import type { Metadata } from "next";
import { JoinNudge } from "@/components/PlayerGate";
import { NurseryBoard } from "@/components/horseLife/NurseryBoard";
import { db } from "@/server/db";
import { nurseryView } from "@/server/horseLife";
import { getSession } from "@/server/session";
import { outagePage } from "@/server/outage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nursery" };

async function NurseryPage() {
  const database = await db();
  const session = await getSession(database);
  if (!session) return <JoinNudge />;
  return <NurseryBoard view={await nurseryView(database, session, new Date())} />;
}

// The database unreachable or over quota: the outage page (HTTP 503), not an error page.
export default outagePage("/nursery", NurseryPage);
