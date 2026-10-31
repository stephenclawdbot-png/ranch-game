import type { Metadata } from "next";
import Link from "next/link";
import { PixelIcon } from "@/components/icons";
import { WIKI_PAGES, WIKI_SECTIONS, pagesIn } from "@/wiki/registry";
import { WikiSearch } from "@/wiki/WikiNav";
import { practiceWikiText } from "@/wiki/practiceText";

export const metadata: Metadata = { title: { absolute: "Wiki · Post Time" } };

/** Wiki home: the hero, search, and every section with its pages. */
export default function WikiHome() {
  return (
    <div className="grid gap-5" data-testid="wiki-home">
      <section className="wiki-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/diorama/poster-pasture.png" alt="" className="pixelated" aria-hidden draggable={false} />
        <div className="wiki-hero-text">
          <p className="label">The Post Time Wiki</p>
          <h1 className="t-hero">Everything about your stable</h1>
          <p>Raising, racing and breeding, explained. Every number here is read from the game&rsquo;s own rules, so it is always up to date.</p>
          <WikiSearch className="mt-3 max-w-[28rem]" />
        </div>
      </section>
      <div className="wiki-sections">
        {WIKI_SECTIONS.map((s) => (
          <section key={s.key} className="wiki-section-card surface" aria-labelledby={`sec-${s.key}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.poster} alt="" className="pixelated" aria-hidden draggable={false} loading="lazy" />
            <div className="p-4">
              <h2 id={`sec-${s.key}`} className="t-h2 flex items-center gap-2">
                <PixelIcon name={s.icon} size={32} />
                {s.title}
              </h2>
              <p className="caption mt-1">{s.blurb}</p>
              <ul className="mt-3 grid gap-1.5">
                {pagesIn(s.key).map((p) => (
                  <li key={p.slug}>
                    <Link href={`/wiki/${p.slug}`} className="link font-bold">
                      {practiceWikiText(p.title)}
                    </Link>
                    <span className="caption"> · {practiceWikiText(p.summary)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
      <p className="caption text-center">{WIKI_PAGES.length} pages · new to the game? Start with <Link href="/wiki/quick-start" className="link">Quick start</Link>.</p>
    </div>
  );
}
