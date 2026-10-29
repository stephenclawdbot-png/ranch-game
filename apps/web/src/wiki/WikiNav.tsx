"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PixelIcon } from "@/components/icons";
import { WIKI_PAGES, WIKI_SECTIONS, pagesIn, sectionOf, type WikiPageMeta } from "./registry";

/** Pages matching a query (title, summary, keywords, section), best matches first. */
export function searchWiki(q: string): WikiPageMeta[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = WIKI_PAGES.map((p) => {
    const title = p.title.toLowerCase();
    const hay = [p.summary, ...(p.keywords ?? []), sectionOf(p.section).title].join(" ").toLowerCase();
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 3;
      else if (hay.includes(w)) score += 1;
      else return { p, score: 0 };
    }
    return { p, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.p);
}

/** Search box with instant results. */
export function WikiSearch({ autoFocus, className }: { autoFocus?: boolean; className?: string }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => searchWiki(q).slice(0, 8), [q]);
  return (
    <div className={`wiki-search ${className ?? ""}`} role="search">
      <label className="sr-only" htmlFor="wiki-q">
        Search the wiki
      </label>
      <input
        id="wiki-q"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search: foals, injuries, coat…"
        autoComplete="off"
        autoFocus={autoFocus}
        data-testid="wiki-search"
      />
      {q.trim() && (
        <ul className="wiki-search-hits" data-testid="wiki-hits">
          {hits.length ? (
            hits.map((p) => (
              <li key={p.slug}>
                <Link href={`/wiki/${p.slug}`} onClick={() => setQ("")}>
                  <span className="font-extrabold">{p.title}</span>
                  <span className="caption block">{p.summary}</span>
                </Link>
              </li>
            ))
          ) : (
            <li className="caption px-3 py-2">No pages match “{q.trim()}”.</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** The contents sidebar: every section and page; a fold-out on phones. */
export function WikiNav() {
  const pathname = usePathname() ?? "/wiki";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const list = (
    <nav aria-label="Wiki contents" className="wiki-nav-list">
      <Link href="/wiki" className={`wiki-nav-home ${pathname === "/wiki" ? "is-on" : ""}`} aria-current={pathname === "/wiki" ? "page" : undefined}>
        Wiki home
      </Link>
      {WIKI_SECTIONS.map((s) => (
        <div key={s.key} className="wiki-nav-section">
          <p className="label flex items-center gap-1.5">
            <PixelIcon name={s.icon} size={16} />
            {s.title}
          </p>
          <ul>
            {pagesIn(s.key).map((p) => {
              const on = pathname === `/wiki/${p.slug}`;
              return (
                <li key={p.slug}>
                  <Link href={`/wiki/${p.slug}`} className={on ? "is-on" : ""} aria-current={on ? "page" : undefined}>
                    {p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <aside className="wiki-nav">
      <WikiSearch />
      <details className="wiki-nav-fold md:hidden" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="btn btn-sm btn-block">Contents</summary>
        {list}
      </details>
      <div className="max-md:hidden">{list}</div>
    </aside>
  );
}

/** "On this page": the article's section headings, read from the rendered article. */
export function OnThisPage() {
  const pathname = usePathname();
  const [items, setItems] = useState<{ id: string; text: string }[]>([]);
  useEffect(() => {
    const hs = Array.from(document.querySelectorAll<HTMLHeadingElement>(".wiki-article h2[id]"));
    setItems(hs.map((h) => ({ id: h.id, text: (h.textContent ?? "").replace(/^#/, "").trim() })));
  }, [pathname]);
  if (items.length < 2) return null;
  return (
    <nav className="wiki-toc inset" aria-label="On this page">
      <p className="label">On this page</p>
      <ol>
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.id}`} className="link">
              {i.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
