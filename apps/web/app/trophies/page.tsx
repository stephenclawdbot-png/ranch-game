import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TrophyRoom } from "@/components/competition/TrophyRoom";
import { trophyRoomView } from "@/server/competition";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trophy Room" };

export default async function TrophiesPage() {
  const database = await db();
  const session = await getSession(database);
  if (!session) redirect("/play");
  return <TrophyRoom view={await trophyRoomView(database, session, new Date())} />;
}
