import type { Metadata } from "next";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CupScreen } from "@/components/competition/CupScreen";
import { cupView } from "@/server/competition";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Daily Cup" };

export default async function CupPage() {
  const database = await db();
  const session = await getSession(database);
  const now = new Date();
  const view = await cupView(database, session, now);
  return (
    <>
      {/* A new Cup opens at UTC midnight: refresh then. */}
      <AutoRefresh atMs={view.closesAtMs} serverNowMs={now.getTime()} />
      <CupScreen view={view} signedIn={!!session} />
    </>
  );
}
