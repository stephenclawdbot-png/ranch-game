import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HorseLog } from "@/components/formBook/HorseLog";
import { HorseLifeHeader } from "@/components/horseLife/HorseLifeHeader";
import { db } from "@/server/db";
import { horseLog } from "@/server/formBook";
import { horseLifeView } from "@/server/horseLife";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Log" };

export default async function HorseLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = await db();
  const session = await getSession(database);
  const now = new Date();
  const view = session ? await horseLifeView(database, session, id, now) : null;
  // Only the owner has these tabs; everyone else sees the public horse page.
  if (!view || !session) redirect(`/horse/${encodeURIComponent(id)}`);
  const log = await horseLog(database, session, id, null, now);
  return (
    <div className="grid gap-5">
      <HorseLifeHeader view={view} active="log" />
      <section aria-labelledby="log-h" className="grid gap-2">
        <h2 id="log-h" className="t-h2">
          {view.name}&rsquo;s log
        </h2>
        <p className="t-meta max-w-prose">
          Everything that happened to {view.name}, newest first: each training session with what it gained, care days, every race with its replay and rating change,
          injuries and the vet, reveals, breeding and changes of hands.
        </p>
        <HorseLog horseId={view.id} initial={log} />
      </section>
    </div>
  );
}
