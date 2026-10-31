"use client";

import { useEffect, useState } from "react";
import type { HomeSocialView } from "@/lib/socialTypes";
import { Section } from "../ui/Page";
import { NewsList } from "./NewsList";
import { RivalsPanel } from "./RivalsPanel";

/**
 * Home's Rivals panel and racing news (or just the rivals, on the stable page). One request;
 * both come from races whose result is already public.
 */
export function HomeSocial({ show = "both" }: { show?: "both" | "rivals" }) {
  const [view, setView] = useState<HomeSocialView | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/social/home", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<HomeSocialView>) : null))
      .then((v) => live && setView(v))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!view) return null;
  return (
    <>
      <Section id={`rivals-${show}-h`} title="Rivals" href="/news?tab=mine" linkLabel="Your news" testId="home-rivals">
        <RivalsPanel rivals={view.rivals} nemesis={view.nemesis} compact={show === "rivals"} />
      </Section>
      {show === "both" && view.news.length > 0 && (
        <Section id="racing-news-h" title="Racing news" href="/news" linkLabel="All news" testId="home-news">
          <NewsList items={view.news} />
        </Section>
      )}
    </>
  );
}
