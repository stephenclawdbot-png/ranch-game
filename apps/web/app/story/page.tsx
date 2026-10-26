import type { Metadata } from "next";
import { StoryScreen } from "@/components/competition/StoryScreen";
import { db } from "@/server/db";
import { getSession } from "@/server/session";
import { storyView } from "@/server/story";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Story" };

export default async function StoryPage() {
  const database = await db();
  const session = await getSession(database);
  const view = await storyView(database, session, new Date());
  return <StoryScreen view={view} signedIn={!!session} />;
}
