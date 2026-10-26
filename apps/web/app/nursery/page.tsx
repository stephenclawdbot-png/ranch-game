import type { Metadata } from "next";
import { JoinNudge } from "@/components/PlayerGate";
import { NurseryBoard } from "@/components/horseLife/NurseryBoard";
import { db } from "@/server/db";
import { nurseryView } from "@/server/horseLife";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nursery" };

export default async function NurseryPage() {
  const database = await db();
  const session = await getSession(database);
  if (!session) return <JoinNudge />;
  return <NurseryBoard view={await nurseryView(database, session, new Date())} />;
}
