import type { ReactNode } from "react";
import { PLATE_AFTER_SLOTS, RULES } from "@thoroughbred/db";
import { GLOSSARY } from "@/lib/glossary";
import { Callout, Figure, H2, Lead, P, Table, WikiLink } from "../kit";

type Entry = [term: string, meaning: ReactNode, slug: string];

const TERMS: Entry[] = [
  ...GLOSSARY,
  ["Saturday Plate", `A Listed race ${PLATE_AFTER_SLOTS * (RULES.slotMs / 60_000)} minutes after the Weekend Feature, over the same trip, for horses that ran in that week's Qualifiers and didn't qualify.`, "race-types"],
];

const GROUPS: { id: string; title: string; from: string; to: string }[] = [
  { id: "a-e", title: "A to E", from: "A", to: "E" },
  { id: "f-l", title: "F to L", from: "F", to: "L" },
  { id: "m-p", title: "M to P", from: "M", to: "P" },
  { id: "q-z", title: "Q to Z", from: "Q", to: "Z" },
];

export default function GlossaryPage() {
  const sorted = [...TERMS].sort((a, b) => a[0].localeCompare(b[0], "en-GB"));
  return (
    <>
      <Lead>
        Racing and breeding come with their own words. Here are the ones Post Time uses, in plain English, each with the page that explains it properly.
      </Lead>
      <Figure src="/art/scenes/club-library.png" alt="The Club library: stud books and pedigree charts" caption="From foal to Legacy Farm: the words you will meet on the way." focus={0.55} />
      {GROUPS.map((g) => (
        <section key={g.id}>
          <H2 id={g.id}>{g.title}</H2>
          <Table
            head={["Term", "Meaning", "More"]}
            rows={sorted
              .filter(([term]) => {
                const c = term[0]!.toUpperCase();
                return c >= g.from && c <= g.to;
              })
              .map(([term, meaning, slug]) => [term, meaning, <WikiLink key={slug} slug={slug} />])}
          />
        </section>
      ))}
      <Callout tone="tip">
        <p>
          New to all this? Start with the <WikiLink slug="quick-start">Quick start</WikiLink> guide, then come back here whenever a word on a screen is unfamiliar.
        </p>
      </Callout>
      <P>
        Missing a word? Most screens explain themselves under &ldquo;How it works&rdquo;, and every number in this wiki comes straight from the game&rsquo;s rules.
      </P>
    </>
  );
}
