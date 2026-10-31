import * as gc from "@thoroughbred/game-core";
import { Callout, Facts, H2, H3, HorseCard, HorseRow, Lead, List, Num, P, Table, WikiLink, appearanceOfGenome, pct } from "../kit";

const STAT_LABEL: Record<gc.StatKey, string> = {
  speed: "Speed",
  stamina: "Stamina",
  burst: "Burst",
  durability: "Durability",
  adaptability: "Adaptability",
  temperament: "Temperament",
};

/** The lineage names the breeding preview uses. */
const LINE_TAG: Record<"deep" | "rising" | "foundation", string> = { deep: "Established line", rising: "Rising line", foundation: "Foundation stock" };

const mint = (seed: string, rarity: gc.Rarity) => gc.generateFoundationGenome(gc.seedFrom("wiki", "family", seed), { season: 1, rarity });

/** A genome whose every stat allele is `v` (to isolate one rule at a time). */
function flat(v: number): gc.Genome {
  const g = mint("flat", "common");
  const stats = {} as gc.Genome["stats"];
  for (const k of gc.STAT_KEYS) stats[k] = [v, v];
  return { ...g, stats };
}

const asHorse = (id: string, sex: "colt" | "filly", genome: gc.Genome) =>
  gc.createHorseState({ id, name: id, sex, ownerId: "wiki", sireId: null, damId: null, generation: 1, genome, bornAtMs: 0, bornSeason: 1, careSessions: gc.CARE_TO_RACING });

/** A real pairing: two parents and their four parents, run through gc.familyRange. */
function workedExample() {
  // The first seeded family where the level grandparents read as an established line and the
  // weaker ones as a rising line (so the example shows both tags).
  const family = (n: number) => {
    const sire = mint(`sire-${n}`, "legendary");
    const dam = mint(`dam-${n}`, "legendary");
    const level = ["gs", "gd", "ds", "dd"].map((s) => mint(`g-${s}-${n}`, "legendary"));
    const weaker = ["gs", "gd", "ds", "dd"].map((s) => mint(`g-${s}-${n}`, "common"));
    return { sire, dam, level, weaker };
  };
  const tag = (f: ReturnType<typeof family>, fam: gc.Genome[]) => gc.previewBreeding(asHorse("s", "colt", f.sire), asHorse("d", "filly", f.dam), {}, 1, fam).limits.lineage;
  let pick = family(0);
  for (let n = 0; n < 40; n++) {
    const f = family(n);
    if (tag(f, f.level) === "deep" && tag(f, f.weaker) === "rising") {
      pick = f;
      break;
    }
  }
  const { sire, dam, level, weaker } = pick;
  const established = gc.familyRange(sire, dam, level);
  const rising = gc.familyRange(sire, dam, weaker);
  const inbred = gc.familyRange(sire, dam, level, 125);
  const s = asHorse("wiki-sire", "colt", sire);
  const d = asHorse("wiki-dam", "filly", dam);
  return {
    sire,
    dam,
    level,
    weaker,
    established,
    rising,
    inbred,
    pEst: gc.previewBreeding(s, d, {}, 1, level),
    pRise: gc.previewBreeding(s, d, {}, 1, weaker),
    pFound: gc.previewBreeding(s, d, {}, 1, []),
  };
}

export default function FamilyLimitsPage() {
  const ex = workedExample();
  const P0 = 600;
  // Headroom by how far the parents jumped above their own parents (parents flat at 600).
  const headroom = [0, 50, 100, 150, 200].map((spike) => {
    const r = gc.familyRange(flat(P0), flat(P0), [flat(P0 - spike), flat(P0 - spike), flat(P0 - spike), flat(P0 - spike)]).speed;
    return [spike === 0 ? "Level with them" : `${spike} higher`, r.ceiling, `+${r.ceiling - P0}`];
  });
  // Floor by family strength (parents flat at 600), with and without inbreeding.
  const floors = [400, 600, 700, 800].map((gp) => {
    const fam = [flat(gp), flat(gp), flat(gp), flat(gp)];
    const r = gc.familyRange(flat(P0), flat(P0), fam).speed;
    const ri = gc.familyRange(flat(P0), flat(P0), fam, 125).speed;
    return [gp, r.centre, r.floor, ri.floor];
  });
  const cards: [gc.Genome, string, string][] = [
    [ex.level[0]!, "Sire's sire", "Grandparent"],
    [ex.level[1]!, "Sire's dam", "Grandparent"],
    [ex.sire, "Sire", `Potential ${gc.overallPotential(ex.sire)}`],
    [ex.dam, "Dam", `Potential ${gc.overallPotential(ex.dam)}`],
    [ex.level[2]!, "Dam's sire", "Grandparent"],
    [ex.level[3]!, "Dam's dam", "Grandparent"],
  ];
  return (
    <>
      <Lead>
        Every pairing has family limits: the lowest and highest a foal of that pairing can ever be, stat by stat. They come from the two parents and their four parents. A foal can still beat both
        parents or fall below them, but never past what its family allows.
      </Lead>
      <HorseRow>
        {cards.map(([g, name, line]) => (
          <HorseCard key={name} appearance={appearanceOfGenome(g)} name={name} line={line} size="sm" />
        ))}
      </HorseRow>

      <H2 id="what-they-are">What the limits are</H2>
      <P>
        Each stat is a pair of genes (alleles), one from each parent; see <WikiLink slug="genetics-and-inheritance" />. A foal takes one allele from the sire and one from the dam, and that is always
        allowed. What the limits catch is <b>mutation</b>: the rare random nudge an allele can get as it is passed on. A mutation can never push an allele below the family&rsquo;s floor or above its
        ceiling.
      </P>
      <List
        items={[
          <>
            <b>Ceiling:</b> the best allele either parent carries, plus some headroom. That headroom is how a line climbs, a little every generation.
          </>,
          <>
            <b>Floor:</b> a little below the weakest allele either parent carries. A strong family holds it up.
          </>,
          <>
            <b>Centre:</b> where the family sits. The parents count for two thirds, the grandparents for one third. Mutations lean back towards it.
          </>,
        ]}
      />
      <Facts
        rows={[
          ["Headroom above the best parent allele", `up to +${gc.FAMILY_HEADROOM}`],
          ["Headroom for a one-generation jump, at least", `+${gc.FAMILY_HEADROOM_MIN}`],
          ["Floor below the weakest parent allele, at most", `${gc.FAMILY_FLOOR_DROP} points`],
          ["A strong family protects the floor down to", `its centre − ${gc.FAMILY_FLOOR_SPREAD}`],
          ["Inbreeding lowers the floor by", "1 point per 1% of inbreeding (COI)"],
          ["Mutation lean per 100 above the centre", `+${pct(gc.FAMILY_PULL_PER_100)} more likely to hurt`],
        ]}
      />

      <H2 id="ceiling">The ceiling: how a line climbs</H2>
      <P>
        A foal&rsquo;s allele can reach the best parent allele plus <Num>{gc.FAMILY_HEADROOM}</Num>. That is the whole room a generation has to grow. If the parents have only just jumped well above
        their own parents, the line hasn&rsquo;t proved itself yet and the headroom shrinks: every 5 points of jump costs a point of headroom, down to <Num>{gc.FAMILY_HEADROOM_MIN}</Num>.
      </P>
      <Table
        caption={`Parents whose alleles are all ${P0}, with grandparents at different levels (worked out by the game's own familyRange)`}
        head={["Parents compared with grandparents", "Highest allele a foal can carry", "Headroom"]}
        rows={headroom}
      />
      <Callout tone="tip" title="Build a line, don't spike it">
        <p>
          Two great horses from ordinary families give a <b>Rising line</b>: less headroom and mutations that pull back down. Keep breeding within a strong family for a generation or two and it becomes an{" "}
          <b>Established line</b> with the full +{gc.FAMILY_HEADROOM}. Steady lines go further than lucky ones.
        </p>
      </Callout>

      <H2 id="floor">The floor: what a good family protects</H2>
      <P>
        The floor sits at most <Num>{gc.FAMILY_FLOOR_DROP}</Num> below the weakest parent allele. If the family&rsquo;s centre is high, the floor can&rsquo;t drop more than{" "}
        <Num>{gc.FAMILY_FLOOR_SPREAD}</Num> below that centre, so a strong family keeps it close to the weakest parent allele. The floor never rises above that allele, so a foal can always inherit any
        gene its parents carry.
      </P>
      <P>
        Inbreeding cuts through that protection: the floor drops a further point for every 1% of inbreeding (COI), whatever the family. See <WikiLink slug="inbreeding" />.
      </P>
      <Table
        caption={`Parents whose alleles are all ${P0}: the lowest allele a foal can carry`}
        head={["Grandparents' alleles", "Family centre", "Floor", "Floor at 12.5% COI"]}
        rows={floors}
      />

      <H2 id="lean">Mutations lean towards the family</H2>
      <P>
        At no inbreeding, a mutation is as likely to help as to hurt. Inside a family, an allele already above the centre is more likely to be nudged down, and one below the centre more likely to be
        nudged up: <Num>{pct(gc.FAMILY_PULL_PER_100)}</Num> more (or less) chance to hurt for every 100 points away from the centre. That keeps a line together. Inbreeding adds its own push towards
        harmful mutations on top.
      </P>

      <H2 id="lineage">Established, rising or foundation</H2>
      <P>The breeding preview names the kind of line a pairing comes from, in words (it judges a &ldquo;rising&rdquo; line from what is public about the parents and grandparents):</P>
      <Table
        head={["Tag", "What it means"]}
        rows={[
          [LINE_TAG.deep, `Parents and grandparents are of a level. The foal can land up to ${gc.FAMILY_HEADROOM} above its best parent's genes; mutations lean back towards the family's level.`],
          [LINE_TAG.rising, "The parents are well above their own parents: a one-generation jump. Less headroom above them, and mutations lean back towards the family."],
          [LINE_TAG.foundation, "No grandparents on record: both parents are foundation horses, such as starters or pack foals. The limits come from the parents alone; breeding on from the foal builds a line."],
        ]}
      />

      <H2 id="example">A worked example</H2>
      <P>
        The six horses at the top of this page are real genomes made by the game. Below is what <b>familyRange</b> says for a foal of the sire and dam, worked out when this page is built. Numbers are
        alleles (0 to 1000), not potentials.
      </P>
      <Table
        caption={`${LINE_TAG[ex.pEst.limits.lineage]}: grandparents of the same level as the parents`}
        head={["Stat", "Sire's alleles", "Dam's alleles", "Centre", "Floor", "Ceiling"]}
        rows={gc.STAT_KEYS.map((k) => [STAT_LABEL[k], ex.sire.stats[k].join(" / "), ex.dam.stats[k].join(" / "), ex.established[k].centre, ex.established[k].floor, ex.established[k].ceiling])}
      />
      <H3>Same parents, weaker grandparents</H3>
      <P>
        Swap the four grandparents for ordinary horses and the parents become a one-generation jump. The ceilings come down (less headroom), the floors hold, and the line counts as{" "}
        <b>{LINE_TAG[ex.pRise.limits.lineage]}</b>. Add inbreeding at half-sibling level instead and the floors drop.
      </P>
      <Table
        head={["Stat", "Ceiling (level family)", "Ceiling (weaker family)", "Floor (level family)", "Floor (weaker family)", "Floor (level family, 12.5% COI)"]}
        rows={gc.STAT_KEYS.map((k) => [STAT_LABEL[k], ex.established[k].ceiling, ex.rising[k].ceiling, ex.established[k].floor, ex.rising[k].floor, ex.inbred[k].floor])}
      />
      <Facts
        title="What the rules give for this example"
        rows={[
          [`${LINE_TAG[ex.pEst.limits.lineage]}: lowest to highest possible`, `${ex.pEst.limits.overall.floor} (${gc.gradeOf(ex.pEst.limits.overall.floor)}) to ${ex.pEst.limits.overall.ceiling} (${gc.gradeOf(ex.pEst.limits.overall.ceiling)})`],
          [`${LINE_TAG[ex.pRise.limits.lineage]}: lowest to highest possible`, `${ex.pRise.limits.overall.floor} (${gc.gradeOf(ex.pRise.limits.overall.floor)}) to ${ex.pRise.limits.overall.ceiling} (${gc.gradeOf(ex.pRise.limits.overall.ceiling)})`],
          [`${LINE_TAG[ex.pFound.limits.lineage]} (no grandparents): lowest to highest possible`, `${ex.pFound.limits.overall.floor} to ${ex.pFound.limits.overall.ceiling}`],
          ["Middle 80% of foals (any family)", `${ex.pEst.overall.p10} to ${ex.pEst.overall.p90}`],
        ]}
      />

      <H2 id="in-the-preview">Reading the preview</H2>
      <P>
        On the <WikiLink slug="breeding-basics">breeding screen</WikiLink>, the preview names the line (established, rising or foundation) in a sentence under the outlook. It shows no limits or
        ranges as numbers: the numbers on this page are the rules at work on example horses. The preview is worked out only from what is public about the two horses, so it can&rsquo;t give away
        their hidden genes, and the real foal is a surprise.
      </P>
      <Callout tone="rule" title="Limits are the extremes, not the odds">
        <p>
          The lowest and highest possible are what the dice could do at their most extreme; most foals land well inside them. The limits tell you what can never happen, not what to expect.
        </p>
      </Callout>
    </>
  );
}
