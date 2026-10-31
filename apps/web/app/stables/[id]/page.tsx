import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/competition/LocalTime";
import { StableBadge } from "@/components/StableBadge";
import { NewsList } from "@/components/social/NewsList";
import { scoreLine } from "@/components/social/RivalsPanel";
import { EmptyState, PageHeader, Section } from "@/components/ui/Page";
import { db } from "@/server/db";
import { getSession } from "@/server/session";
import { publicStable } from "@/server/social";

export const dynamic = "force-dynamic";

async function load(id: string) {
  const database = await db();
  const session = await getSession(database);
  return publicStable(database, decodeURIComponent(id), session, new Date());
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const v = await load((await params).id);
  return { title: v?.name ?? "Stable not found" };
}

/** A stable's public page: its racing string, its news and, for a signed-in visitor, "Your record against them". */
export default async function StablePublicPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await load((await params).id);
  if (!v) notFound();
  return (
    <div className="grid gap-5">
      <PageHeader
        scene="barn"
        back={{ href: "/news", label: "Racing news" }}
        eyebrow={v.mine ? "Your stable, as others see it" : "Stable"}
        title={
          <span className="inline-flex items-center gap-3">
            {v.silks && <StableBadge silks={v.silks} photoUrl={v.photoUrl} cap={false} className="h-10 w-12" />}
            {v.name}
          </span>
        }
        meta={
          <>
            Racing since <LocalTime ms={v.createdAtMs} withDate />
          </>
        }
      />

      {v.record && (
        <Section id="record-h" title="Your record against them" testId="record-against">
          <div className="surface grid gap-2 p-4">
            <p className="flex flex-wrap items-center gap-2">
              {v.record.rival && <span className="tag tag-live">Rival</span>}
              <span className="num text-lg font-extrabold">H2H {scoreLine(v.record)}</span>
              <span className="t-meta">
                (you first) in {v.record.meetings} {v.record.meetings === 1 ? "meeting" : "meetings"} · {v.record.close} close {v.record.close === 1 ? "finish" : "finishes"}
              </span>
            </p>
            {v.record.last && (
              <p className="t-meta">
                Last meeting:{" "}
                <Link href={`/race/${v.record.last.raceId}`} className="underline decoration-dotted underline-offset-2">
                  {v.record.last.raceName}
                </Link>{" "}
                (<LocalTime ms={v.record.last.atMs} withDate />), {v.record.last.ahead ? "you finished ahead" : "they finished ahead"} ·{" "}
                <Link href={`/race/${v.record.last.raceId}`} className="underline">
                  Replay
                </Link>
              </p>
            )}
            {v.record.pairs.length > 0 && (
              <ul className="caption grid gap-0.5" aria-label="Horse against horse">
                {v.record.pairs.map((p) => (
                  <li key={`${p.mineId}-${p.theirId}`}>
                    <Link href={`/horse/${p.mineId}`} className="underline-offset-2 hover:underline">
                      {p.mineName}
                    </Link>{" "}
                    v{" "}
                    <Link href={`/horse/${p.theirId}`} className="underline-offset-2 hover:underline">
                      {p.theirName}
                    </Link>
                    : {scoreLine(p)} in {p.meetings}
                    {p.close ? `, ${p.close} close` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      )}

      <Section id="string-h" title="Racing string">
        {v.horses.length ? (
          <ul className="surface rows" data-testid="stable-horses">
            {v.horses.map((h) => (
              <li key={h.id}>
                <Link href={`/horse/${h.id}`} className="row-link gap-3 px-4 py-3">
                  <span className="t-title min-w-0 flex-1 truncate">{h.name}</span>
                  <span className="t-meta whitespace-nowrap">
                    OR {h.rating} · {h.starts} runs, {h.wins}-{h.places}-{h.shows}
                  </span>
                  <span className="chev">›</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No runners yet" text="This stable hasn't had a horse on the course yet." />
        )}
      </Section>

      {v.news.length > 0 && (
        <Section id="stable-news-h" title="In the news">
          <NewsList items={v.news} />
        </Section>
      )}
    </div>
  );
}
