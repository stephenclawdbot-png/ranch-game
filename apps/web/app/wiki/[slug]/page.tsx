import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PixelIcon } from "@/components/icons";
import { WIKI_CONTENT } from "@/wiki/content";
import { WIKI_PAGES, neighbours, pageMeta, sectionOf } from "@/wiki/registry";
import { OnThisPage } from "@/wiki/WikiNav";

export const dynamicParams = false;

export function generateStaticParams() {
  return WIKI_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const m = pageMeta((await params).slug);
  return m ? { title: m.title, description: m.summary } : {};
}

export default async function WikiArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const meta = pageMeta(slug);
  const Body = WIKI_CONTENT[slug];
  if (!meta || !Body) notFound();
  const section = sectionOf(meta.section);
  const { prev, next } = neighbours(slug);
  return (
    <article className="wiki-article surface" data-testid="wiki-article">
      <header className="wiki-head">
        <p className="label flex items-center gap-1.5">
          <Link href="/wiki" className="link">
            Wiki
          </Link>
          <span aria-hidden>›</span>
          <PixelIcon name={section.icon} size={16} />
          {section.title}
        </p>
        <h1 className="t-page">{meta.title}</h1>
        <p className="text-cream-dim">{meta.summary}</p>
      </header>
      <OnThisPage />
      <div className="wiki-body">
        <Body />
      </div>
      <footer className="wiki-pager">
        {prev ? (
          <Link href={`/wiki/${prev.slug}`} className="wiki-pager-link">
            <span className="label">‹ Previous</span>
            <span className="font-extrabold">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`/wiki/${next.slug}`} className="wiki-pager-link text-right">
            <span className="label">Next ›</span>
            <span className="font-extrabold">{next.title}</span>
          </Link>
        )}
      </footer>
    </article>
  );
}
