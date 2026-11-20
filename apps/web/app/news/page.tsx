import type { Metadata } from "next";
import Link from "next/link";
import { NewsList } from "@/components/social/NewsList";
import { EmptyState, SceneBand } from "@/components/ui/Page";
import { db } from "@/server/db";
import { dbPage } from "@/server/outage";
import { getSession, hasSessionCookie } from "@/server/session";
import { visitorNews } from "@/server/visitorViews";
import { newsFeed } from "@/server/social";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Racing news" };

/**
 * The racing news: Feature winners, photo-finishes, big first wins, record purses, champions,
 * jockeys' milestones, sales and claims, Hall of Fame entries. Written from facts when they
 * happen; a race's news appears only once its broadcast is over.
 */
export default function NewsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return dbPage("/news", () => renderNews(props));
}

async function renderNews({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab = sp.tab === "mine" ? "mine" : "all";
  const before = Number(Array.isArray(sp.before) ? sp.before[0] : sp.before);
  const session = (await hasSessionCookie()) ? await getSession(await db()) : null;
  const now = new Date();
  const beforeMs = Number.isFinite(before) && before > 0 ? before : null;
  // A visitor's first page of news is the shared copy (no database); "My stable" needs a stable anyway.
  const items = !session && tab === "mine" ? [] : !session && beforeMs === null ? await visitorNews() : await newsFeed(await db(), session, tab, now, beforeMs);
  const older = items.length >= 50 ? items[items.length - 1]!.atMs : null;
  return (
    <div className="grid gap-5">
      <SceneBand scene="press-room" alt="The press room above the course" eyebrow="Kestrel Downs and beyond" title="Racing news" meta="Big wins, photo-finishes, champions, jockeys and sales: written from the results, the moment they're public." />
      <nav className="flex gap-2" aria-label="News filter">
        <Link href="/news" className="fchip" aria-pressed={tab === "all"} data-testid="news-tab-all">
          All
        </Link>
        <Link href="/news?tab=mine" className="fchip" aria-pressed={tab === "mine"} data-testid="news-tab-mine">
          My stable
        </Link>
      </nav>
      {tab === "mine" && !session ? (
        <EmptyState icon="door-key" title="Sign in for your news" text="The My stable tab follows your horses, your jockeys and your rivals." action={<Link href="/play" className="btn">Start a stable</Link>} />
      ) : items.length === 0 ? (
        <EmptyState icon="flag" title="No news yet" text={tab === "mine" ? "When your horses, jockeys or rivals make the news, it shows here." : "The first big results will be here soon."} testId="news-empty" />
      ) : (
        <NewsList items={items} testId="news-feed" />
      )}
      {older && (
        <Link href={`/news?${tab === "mine" ? "tab=mine&" : ""}before=${older}`} className="btn-ghost inline-flex min-h-11 w-fit items-center font-bold">
          Older news ›
        </Link>
      )}
    </div>
  );
}
