import type { Metadata } from "next";
import { HallScreen } from "@/components/competition/HallScreen";
import { hallView } from "@/server/competition";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hall of Fame" };

export default async function HallPage() {
  const database = await db();
  const session = await getSession(database);
  const view = await hallView(database, session, new Date());
  return <HallScreen view={view} />;
}
