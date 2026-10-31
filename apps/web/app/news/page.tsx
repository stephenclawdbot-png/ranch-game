import type { Metadata } from "next";
import Link from "next/link";
import { NewsList } from "@/components/social/NewsList";
import { EmptyState, PageHeader } from "@/components/ui/Page";
import { db } from "@/server/db";
import { getSession } from "@/server/session";
import { newsFeed } from "@/server/social";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Racing news" };

/**
 * The racing news: Feature winners, photo-finishes, big first wins, record purses, champions,
 * jockeys' milestones, sales and claims, Hall of Fame entries. Written from facts when they
 * happen; a race's news appears only once its broadcast is over.
 */
export default async function NewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab = sp.tab === "mine" ? "mine" : "all";
  const before = Number(Array.isArray(sp.before) ? sp.before[0] : sp.before);
  const database = await db();
  const session = await getSession(database);
  const now = new Date();
  const items = await newsFeed(database, session, tab, now, Number.isFinite(before) && before > 0 ? before : null);
  const older = items.length >= 50 ? items[items.length - 1]!.atMs : null;
  return (
    <div className="grid gap-5">
      <PageHeader scene="grandstand" eyebrow="Kestrel Downs and beyond" title="Racing news" meta="Big wins, photo-finishes, champions, jockeys and sales: written from the results, the moment they're public." />
      <nav className="flex gap-2" aria-label="News filter">
        <Link href="/news" className="fchip" aria-pressed={tab === "all"} data-testid="news-tab-all">
          All
        </Link>
        <Link href="/news?tab=mine" className="fchip" aria-pressed={tab === "mine"} data-testid="news-tab-mine">
          My stable
        </Link>
      </nav>
      {tab === "mine" && !session ? (
        <EmptyState title="Sign in for your news" text="The My stable tab follows your horses, your jockeys and your rivals." action={<Link href="/play" className="btn">Start a stable</Link>} />
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
