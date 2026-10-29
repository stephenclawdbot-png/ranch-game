import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RoadToSaturday } from "@/components/competition/RoadToSaturday";
import { db } from "@/server/db";
import { getSession } from "@/server/session";
import { weekView } from "@/server/week";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "This week" };

export default async function WeekPage() {
  const database = await db();
  const session = await getSession(database);
  if (!session) redirect("/play");
  return <RoadToSaturday view={await weekView(database, session, new Date())} />;
}
