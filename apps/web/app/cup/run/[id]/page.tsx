import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CupRunScreen } from "@/components/competition/CupRunScreen";
import { cupRunView } from "@/server/competition";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cup Run" };

export default async function CupRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = await db();
  const session = await getSession(database);
  const run = await cupRunView(database, decodeURIComponent(id), session, new Date());
  if (!run) notFound();
  return <CupRunScreen run={run} />;
}
