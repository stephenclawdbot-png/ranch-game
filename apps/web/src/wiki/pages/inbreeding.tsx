import * as gc from "@thoroughbred/game-core";
import { Callout, Facts, Figure, H2, Lead, List, P, ShareBar, Table, WikiLink, pct } from "../kit";

/** The breeding screen's own wording for the hard blocks. */
const BLOCK_TEXT: Record<gc.KinBlock, string> = {
  self: "A horse can't breed with itself.",
  parent_child: "Parent and child can't be paired.",
  full_siblings: "Full siblings can't be paired.",
};

/** COI as the game prints it: one decimal, "None" at 0. */
const coiText = (permille: number) => (permille === 0 ? "None" : `${(permille / 10).toFixed(1)}%`);

/**
 * A tiny hand-made stud book. Founders (generation 0) have no recorded parents; everyone else
 * is bred from them, so gc.coiOf and gc.kinBlock can work out each relationship.
 */
function studBook(): gc.PedigreeIndex {
  const founder = { sireId: null, damId: null, generation: 0 };
  const e = (sireId: string, damId: string, generation: number) => ({ sireId, damId, generation });
  return {
    A: founder,
    B: founder,
    C: founder,
    D: founder,
    E: founder,
    F: founder,
    G: founder,
    // A's foals: two full siblings out of B, one half-sibling out of C
    ab1: e("A", "B", 1),
    ab2: e("A", "B", 1),
    ac: e("A", "C", 1),
    // grandchildren
    ab1d: e("ab1", "D", 2),
    ab2e: e("ab2", "E", 2),
    acE: e("ac", "E", 2),
    // great-grandchildren (second cousins)
    k1: e("ab1d", "F", 3),
    k2: e("ab2e", "G", 3),
  };
}

const PAIRS: [string, string, string][] = [
  ["The same horse", "A", "A"],
  ["Parent and child", "A", "ab1"],
  ["Full siblings", "ab1", "ab2"],
  ["Half-siblings (same sire)", "ab1", "ac"],
  ["Grandparent and grandchild", "A", "ab1d"],
  ["Uncle and niece", "ab2", "ab1d"],
  ["First cousins", "ab1d", "ab2e"],
  ["Half-cousins", "ab1d", "acE"],
  ["Second cousins", "k1", "k2"],
  ["Unrelated", "D", "E"],
];

export default function InbreedingPage() {
  const ped = studBook();
  const rows = PAIRS.map(([label, a, b]) => {
    const coi = gc.coiOf(a, b, ped);
    const block = gc.kinBlock(a, b, ped);
    const m = gc.mutationParams(coi);
    return {
      label,
      coi,
      block,
      cells: [
        label,
        block === "self" ? "–" : coiText(coi),
        block ? <b key="b">Blocked</b> : coi >= gc.COI_WARN ? "Inbreeding warning" : coi > 0 ? "Allowed" : "No shared ancestors",
        block ? "–" : gc.expressStat(600, 0, "durability", coi),
        block ? "–" : pct(m.ratePermille, 1),
        block ? "–" : pct(m.negPermille),
      ],
    };
  });
  const half = rows.find((r) => r.label.startsWith("Half-siblings"))!.coi;
  const cousins = rows.find((r) => r.label === "First cousins")!.coi;
  const m0 = gc.mutationParams(0);
  const mHalf = gc.mutationParams(half);
  return (
    <>
      <Lead>
        Breeding two relatives doubles up on the same genes. The game measures that with a coefficient of inbreeding (COI), blocks the closest pairings outright, and makes inbred foals pay for it:
        weaker legs and nerves, and more mutations that go the wrong way.
      </Lead>
      <Figure src="/art/diorama/poster-pasture.png" alt="Mares and foals out at grass" caption="Every horse's sire and dam are kept in the stud book, so the game always knows who is related." focus={0.6} />

      <H2 id="coi">What COI means</H2>
      <P>
        COI is the chance that a foal gets two copies of the same ancestor&rsquo;s gene, one through its sire and one through its dam. Two unrelated parents give a COI of zero. The more ancestors the
        parents share, and the closer those ancestors are, the higher it goes. The game reads the stud book back <b>{gc.COI_MAX_DEPTH} generations</b>; horses with no recorded parents count as
        unrelated founders.
      </P>
      <P>
        The foal keeps its COI for life. You see it as <b>Inbreeding</b> in the horse&rsquo;s Genetics panel and under its pedigree tree, and the breeding preview warns in words before you pay:
        &ldquo;Closely related&rdquo; over the warning line, &ldquo;Distantly related&rdquo; below it.
      </P>
      <Facts
        rows={[
          ["Stud book generations read", gc.COI_MAX_DEPTH],
          ["Preview says “closely related” from COI", coiText(gc.COI_WARN)],
          ["Durability and temperament lost", `${pct(gc.INBREEDING_DEPRESSION_PERMILLE)} of the COI (e.g. ${coiText(half)} COI costs ${pct((half * gc.INBREEDING_DEPRESSION_PERMILLE) / 1000, 0)})`],
          ["Extra mutation chance per 10% COI", pct(gc.MUTATION_COI_RATE_PER_100)],
          ["Extra share of harmful mutations per 10% COI", pct(gc.MUTATION_NEG_PER_100_COI)],
        ]}
      />

      <H2 id="blocked">Pairings that are never allowed</H2>
      <P>Three pairings are blocked outright. The breeding screen won&rsquo;t let you cover them and tells you why:</P>
      <List items={(Object.keys(BLOCK_TEXT) as gc.KinBlock[]).map((k) => BLOCK_TEXT[k])} />
      <P>
        Everything else is allowed, however close. Half-siblings, grandparent and grandchild, uncle and niece: you can breed them, and the preview warns you in words.
      </P>

      <H2 id="table">How related is too related?</H2>
      <P>
        A small stud book run through the game&rsquo;s own COI and block checks. The durability column is a stat whose genes would give <b>600</b> with no inbreeding; the last two columns are the
        mutation odds the rules give.
      </P>
      <Table
        head={["Pairing", "Foal's COI", "Breeding screen", "Durability (600 at no COI)", "Mutation chance", "Mutations that hurt"]}
        rows={rows.map((r) => r.cells)}
      />
      <Callout tone="warn" title="The warning line">
        <p>
          From a COI of {coiText(gc.COI_WARN)} the preview shows a red warning: &ldquo;Closely related: higher risk of weakness (less durability and temperament, more bad mutations).&rdquo; First
          cousins ({coiText(cousins)}) are already over it; half-siblings ({coiText(half)}) are well over.
        </p>
      </Callout>

      <H2 id="cost">What inbreeding costs</H2>
      <List
        items={[
          <>
            <b>Inbreeding depression.</b> Durability and temperament potential drop by {pct(gc.INBREEDING_DEPRESSION_PERMILLE)} of the COI. A half-sibling foal loses about{" "}
            {pct((half * gc.INBREEDING_DEPRESSION_PERMILLE) / 1000, 0)} of both. Lower durability means more injuries; lower temperament means a horse that wastes energy pulling early.
          </>,
          <>
            <b>More mutations.</b> Each stat gene&rsquo;s chance to mutate rises from {pct(m0.ratePermille, 1)} by {gc.MUTATION_COI_RATE_PER_100 / 10} points for every 10% of COI.
          </>,
          <>
            <b>Worse mutations.</b> At no COI half of mutations hurt. Each 10% of COI adds {gc.MUTATION_NEG_PER_100_COI / 10} points to that share.
          </>,
          <>
            <b>A lower floor.</b> The <WikiLink slug="family-limits">family limits</WikiLink> drop by a point for every 1% of COI, so an inbred foal can fall further.
          </>,
        ]}
      />
      <ShareBar
        label="Mutations, unrelated parents"
        parts={[
          { label: "Help", value: 1000 - m0.negPermille, color: "#9fe0a8" },
          { label: "Hurt", value: m0.negPermille, color: "#ff8a7a" },
        ]}
      />
      <ShareBar
        label={`Mutations, half-sibling parents (COI ${coiText(half)})`}
        parts={[
          { label: "Help", value: 1000 - mHalf.negPermille, color: "#9fe0a8" },
          { label: "Hurt", value: mHalf.negPermille, color: "#ff8a7a" },
        ]}
      />

      <H2 id="line-breeding">Line breeding without paying for it</H2>
      <P>
        Breeding within a family has a real upside: it builds an established line with more room above the parents (see <WikiLink slug="family-limits" />). The trick is to keep the family close
        but the parents not too close. Distant shared ancestors cost very little: second cousins come in at {coiText(rows.find((r) => r.label === "Second cousins")!.coi)}.
      </P>
      <Callout tone="tip">
        <p>
          Check the <WikiLink slug="breeding-basics">breeding preview</WikiLink> for the &ldquo;Closely related&rdquo; warning before every covering. If it is there, look for an outcross: a stallion from another family, another
          stable&rsquo;s stud, or a Club stud brings fresh blood and sets the COI back to zero.
        </p>
      </Callout>
      <P>
        See also <WikiLink slug="genetics-and-inheritance" /> for how mutations work, and <WikiLink slug="injuries-and-insurance" /> for why durability matters.
      </P>
    </>
  );
}
