import type { Metadata } from "next";
import { StoryScreen } from "@/components/competition/StoryScreen";
import { db } from "@/server/db";
import { getSession } from "@/server/session";
import { storyView } from "@/server/story";
import { outagePage } from "@/server/outage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Story" };

async function StoryPage() {
  const database = await db();
  const session = await getSession(database);
  const view = await storyView(database, session, new Date());
  return <StoryScreen view={view} signedIn={!!session} />;
}

// The database unreachable or over quota: the outage page (HTTP 503), not an error page.
export default outagePage("/story", StoryPage);
