import type { Metadata } from "next";
import { SceneBackdrop } from "@/components/ui/Page";
import { WikiNav } from "@/wiki/WikiNav";

export const metadata: Metadata = {
  title: { default: "Wiki", template: "%s · Post Time Wiki" },
  description: "The Post Time wiki: how to raise, race and breed horses, with every rule and number from the game.",
};

/** The wiki: contents and search beside the article (public, no stable needed). */
export default function WikiLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SceneBackdrop scene="club-library" />
      <div className="wiki-shell">
        <WikiNav />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
