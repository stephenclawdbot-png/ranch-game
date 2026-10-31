import * as gc from "@thoroughbred/game-core";
import { Callout, Facts, H2, HorseCard, HorseRow, Lead, List, Meter, P, ShareBar, Table, WikiLink, appearanceOfGenome, pct, sampleGenome } from "../kit";

const STAT_LABEL: Record<gc.StatKey, string> = {
  speed: "Speed",
  stamina: "Stamina",
  burst: "Burst",
  durability: "Durability",
  adaptability: "Adaptability",
  temperament: "Temperament",
};

/** The pattern, body and performance genes: how each is inherited and what it does. */
const V2_GENES: [locus: gc.Genes2Key, name: string, mode: string, effect: string][] = [
  ["champagne", "Champagne (Ch)", "Dominant", "Gold, amber or sable body, pink freckled skin"],
  ["silver", "Silver (Z)", "Dominant, black pigment only", "Black turns chocolate with a flaxen mane; invisible on a chestnut"],
  ["pearl", "Pearl (prl)", "Recessive", "Two copies: pale apricot; one copy shows only next to cream"],
  ["tobiano", "Tobiano (TO)", "Dominant", "White patches across the back, dark head"],
  ["leopard", "Leopard complex (LP)", "Incomplete dominant", "One copy: spots with Pattern-1, else varnish roan; two: few-spot"],
  ["patn1", "Pattern-1 (PATN1)", "Dominant, needs LP", "Turns leopard complex into full leopard spots"],
  ["splash", "Splash white (SW)", "Incomplete dominant", "Big blaze, white legs, blue eyes; two copies: bald face"],
  ["height", "Height (Ht)", "Incomplete dominant", "Taller per copy: more speed and stamina, less burst and durability"],
  ["feather", "Feathering (fe)", "Recessive", "Long hair on the lower legs"],
  ["mstn", "Speed gene (MSTN C)", "Incomplete dominant", "C/C sprinter, C/T miler, T/T stayer"],
  ["bigHeart", "Big heart (bh)", "Recessive", "Two copies: extra stamina potential"],
  ["ironLegs", "Iron legs (IL)", "Dominant", "Lower injury risk"],
  ["curledEars", "Curled ears (Ce)", "Dominant", "Inward-curling ear tips"],
  ["dish", "Dished face (Dh)", "Incomplete dominant", "A slight or a classic Arabian dish"],
];

/** The breeds that carry a gene most often (its non-wild allele frequency, from the breed table). */
function commonIn(locus: gc.Genes2Key): string {
  const freqKey = gc.G2_LOCI.find((l) => l[0] === locus)![1];
  const top = gc.BREEDS.map((b) => [b, gc.BREED_PROFILES[b].genes2[freqKey]] as const)
    .filter(([, f]) => f > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3);
  return top.length ? top.map(([b, f]) => `${gc.BREED_LABEL[b]} ${pct(f)}`).join(", ") : "none";
}

/** Two carriers of pearl and big heart (neither shows them): the rules' exact odds (internal; never shown for a real horse). */
function carrierExample() {
  const base = sampleGenome("carrier-example");
  const carrier: gc.Genome = { ...base, coat: { ...base.coat, cream: ["n", "n"] }, genes2: { ...base.genes2, pearl: ["prl", "n"], bigHeart: ["bh", "n"] } };
  const mk = (id: string, sex: "colt" | "filly") =>
    gc.createHorseState({ id, name: id, sex, ownerId: "wiki", sireId: null, damId: null, generation: 0, genome: carrier, bornAtMs: 0, bornSeason: 1, careSessions: gc.CARE_TO_RACING });
  const p = gc.previewBreeding(mk("wiki-carrier-sire", "colt"), mk("wiki-carrier-dam", "filly"), {}, 1);
  return { pearl: p.traits.find((t) => t.name === "Pearl")?.permille ?? 0 };
}

/** A real example pairing: two foundation horses, the rules' exact odds, the player's outlook in words and 400 simulated foals. */
function examplePairing() {
  // the first seeded horses good enough to be worth breeding from (deterministic)
  const good = (prefix: string) => {
    for (let i = 0; ; i++) {
      const g = sampleGenome(`${prefix}-${i}`, 9);
      if (gc.overallPotential(g) >= 580 || i > 500) return g;
    }
  };
  const sireG = good("example-sire");
  const damG = good("example-dam");
  const mk = (id: string, sex: "colt" | "filly", genome: gc.Genome) =>
    gc.createHorseState({ id, name: id, sex, ownerId: "wiki", sireId: null, damId: null, generation: 0, genome, bornAtMs: 0, bornSeason: 1, careSessions: gc.CARE_TO_RACING });
  const sire = mk("wiki-sire", "colt", sireG);
  const dam = mk("wiki-dam", "filly", damG);
  const preview = gc.previewBreeding(sire, dam, {}, 4);
  // What the breeding screen shows instead: the outlook in words, from public facts only.
  const outlook = gc.pairingOutlook(gc.publicParentOf(sire), gc.publicParentOf(dam), { coi: 0 });
  const sireOv = gc.overallPotential(sireG);
  const damOv = gc.overallPotential(damG);
  const lo = Math.min(sireOv, damOv);
  const hi = Math.max(sireOv, damOv);
  const foals = Array.from({ length: 400 }, (_, i) => gc.overallPotential(gc.inherit(sireG, damG, gc.seedFrom("wiki-foal", i), { coi: 0 })));
  const below = foals.filter((v) => v < lo).length;
  const above = foals.filter((v) => v > hi).length;
  // histogram in 10-point buckets
  const min = Math.floor(Math.min(...foals, lo) / 10) * 10;
  const max = Math.ceil(Math.max(...foals, hi) / 10) * 10;
  const buckets: { from: number; n: number }[] = [];
  for (let b = min; b < max; b += 10) buckets.push({ from: b, n: foals.filter((v) => v >= b && v < b + 10).length });
  return { sireG, damG, sireOv, damOv, lo, hi, preview, outlook, below, above, between: foals.length - below - above, n: foals.length, buckets, best: Math.max(...foals), worst: Math.min(...foals) };
}

/** The example pairing's nick, worked through with the rules' own weights. */
function nickWorked(preview: gc.BreedingPreview) {
  const beats = preview.overall.beatsBothParents / 1000;
  const trip = Math.max(...Object.values(preview.distance).map((v) => v ?? 0)) / 1000;
  const surface = Math.max(...Object.values(preview.surface).map((v) => v ?? 0)) / 1000;
  const w = gc.NICK_WEIGHTS;
  const parts = { base: w.base, beats: w.beatsBoth * beats, trip: w.tripCertainty * trip, surface: w.surfaceCertainty * surface, coi: preview.coi / w.coiDivisor };
  return { beats, trip, surface, parts, result: gc.nickRating(beats, trip, surface, preview.coi) };
}

const one = (x: number) => (Math.round(x * 10) / 10).toString();

export default function GeneticsAndInheritancePage() {
  const ex = examplePairing();
  const carriers = carrierExample();
  const nick = nickWorked(ex.preview);
  const quirks = gc.quirkCatalogue();
  const peak = Math.max(...ex.buckets.map((b) => b.n));
  return (
    <>
      <Lead>
        Every horse carries a hidden genome. A foal gets one copy of each gene from its sire and one from its dam, picked at random, with an occasional mutation. That is why a foal can beat both
        parents, land between them, or fall below both. It isn&rsquo;t always a blessing, but it is always a chance.
      </Lead>

      <H2 id="potential">Potential: the ceiling, not the horse</H2>
      <P>
        Genes set a horse&rsquo;s <b>potential</b> for each of six stats, on a scale of 0 to 1000. Training and racing bring the horse up towards that ceiling; they can never take it past it. Overall
        potential is the average of the six, and it earns a grade:
      </P>
      <Table
        head={["Grade", "Potential from", "What it means"]}
        rows={gc.GRADE_FLOORS.map(([g, floor]) => [
          g,
          floor,
          g === "S" ? "Once-in-a-generation" : g === "A" ? "Elite, usually several bred generations in" : g === "B" ? "A strong, well-bred line" : g === "C" ? "Where the first horses top out" : g === "D" ? "Ordinary" : "Weak",
        ])}
      />
      <List
        items={(Object.keys(STAT_LABEL) as gc.StatKey[]).map((k) => (
          <span key={k}>
            <b>{STAT_LABEL[k]}</b>
            {k === "speed"
              ? ": top speed in the race."
              : k === "stamina"
                ? ": how long it holds that speed; matters more the longer the trip."
                : k === "burst"
                  ? ": the kick in the final furlong."
                  : k === "durability"
                    ? ": resistance to injury and fatigue."
                    : k === "adaptability"
                      ? ": copes with a surface or trip it doesn't prefer."
                      : ": consistency from race to race; a hot-headed horse pulls hard early and wastes energy."}
          </span>
        ))}
      />

      <H2 id="two-copies">Two copies of every gene</H2>
      <P>
        Each stat is a pair of numbers (alleles), one from each parent. The horse shows a blend that leans towards the better copy: the weaker copy plus <b>{pct(gc.DOMINANCE_PERMILLE)}</b> of the
        gap. A second gene pair, <b>class</b> (vigour), adds or takes away up to {gc.VIGOUR_MAX} on every stat at once. That gene is why some foals are simply a cut above.
      </P>
      <Callout tone="rule" title="Why foals vary">
        <p>
          The foal takes one copy at random from each parent, for every stat and for class. A brilliant parent can hand down its weak copy. Two average parents can each hand down their best one.
        </p>
      </Callout>

      <H2 id="mutation">Mutations</H2>
      <P>
        Each stat allele has a <b>{pct(gc.MUTATION_PERMILLE)}</b> chance to mutate by up to {gc.MUTATION_MAX} points when it is passed on. At no inbreeding, half of mutations help and half hurt.
        Inbreeding raises both the mutation rate and the share that hurt (see <WikiLink slug="inbreeding" />). Mutations also lean towards the family&rsquo;s centre, and they can never carry a foal
        outside its <WikiLink slug="family-limits">family limits</WikiLink>.
      </P>
      <Facts
        rows={[
          ["Higher copy's weight in the blend", pct(gc.DOMINANCE_PERMILLE)],
          ["Class (vigour) range", `${gc.VIGOUR_MIN} to +${gc.VIGOUR_MAX} on every stat`],
          ["Mutation chance per stat allele", pct(gc.MUTATION_PERMILLE)],
          ["Largest mutation step", `${gc.MUTATION_MAX} points`],
          ["Extra mutation chance per 10% inbreeding", pct(gc.MUTATION_COI_RATE_PER_100)],
          ["Share of mutations that hurt (no inbreeding)", pct(gc.MUTATION_NEG_BASE)],
        ]}
      />

      <H2 id="example">A real example</H2>
      <P>
        Two horses generated by the game, paired, then bred 400 times by the same code that breeds your foals. The numbers below are worked out when this page is built, so they change if the rules
        do.
      </P>
      <HorseRow>
        <HorseCard appearance={appearanceOfGenome(ex.sireG)} name="Example sire" line={`Potential ${ex.sireOv} · grade ${gc.gradeOf(ex.sireOv)}`} />
        <HorseCard appearance={appearanceOfGenome(ex.damG)} name="Example dam" line={`Potential ${ex.damOv} · grade ${gc.gradeOf(ex.damOv)}`} />
      </HorseRow>
      <ShareBar
        label="400 foals of the example pairing"
        parts={[
          { label: "Below both parents", value: ex.below, color: "#ff8a7a" },
          { label: "Between them", value: ex.between, color: "#8fa592" },
          { label: "Better than both", value: ex.above, color: "#9fe0a8" },
        ]}
      />
      <div className="inset grid gap-1.5 p-3" role="img" aria-label={`Foal potentials from ${ex.worst} to ${ex.best}; parents ${ex.lo} and ${ex.hi}.`}>
        <p className="label">Foal potential, 400 foals (parents marked)</p>
        <div className="flex h-28 items-end gap-[3px]">
          {ex.buckets.map((b) => {
            const parent = (ex.lo >= b.from && ex.lo < b.from + 10) || (ex.hi >= b.from && ex.hi < b.from + 10);
            return (
              <span
                key={b.from}
                title={`${b.from}-${b.from + 9}: ${b.n} foals`}
                className="flex-1"
                style={{ height: `${Math.max(2, (b.n / peak) * 100)}%`, background: parent ? "var(--color-brass)" : b.from + 9 < ex.lo ? "#ff8a7a" : b.from > ex.hi ? "#9fe0a8" : "#8fa592" }}
              />
            );
          })}
        </div>
        <div className="caption flex justify-between">
          <span>{ex.buckets[0]!.from}</span>
          <span>
            Worst foal {ex.worst} · best foal {ex.best}
          </span>
          <span>{ex.buckets[ex.buckets.length - 1]!.from + 10}</span>
        </div>
      </div>
      <P>
        The rules&rsquo; exact odds for this example pairing, worked out from the two example horses&rsquo; true genes (mutations left out; 400 foals are only a sample, so the two can differ
        by a few points). The breeding screen never shows numbers like these for a real pairing: they would give the horses&rsquo; hidden genes away. It shows a few possible looks and an outlook
        in words, worked out only from what is public about the two horses. For this pair (the dam as your mare) it would read: <b>&ldquo;{ex.outlook.outlook.phrase}.&rdquo;</b>{" "}
        <b>{ex.outlook.nick}</b>.
      </P>
      <Facts
        title="The rules' exact odds (example horses only)"
        rows={[
          ["Middle 80% of foals", `${ex.preview.overall.p10} to ${ex.preview.overall.p90}`],
          ["Beats both parents", pct(ex.preview.overall.beatsBothParents)],
          ["Below both parents", pct(ex.preview.overall.belowBothParents)],
          ["Family limits", `${ex.preview.limits.overall.floor} to ${ex.preview.limits.overall.ceiling}`],
          ["Nick rating", `${ex.preview.nick.score} (${ex.preview.nick.label})`],
        ]}
      />
      <div className="grid gap-2">
        {(Object.keys(STAT_LABEL) as gc.StatKey[]).map((k) => (
          <Meter key={k} label={STAT_LABEL[k]} value={ex.preview.stats[k].expected} max={1000} suffix="" />
        ))}
        <p className="caption">Expected foal potential per stat, from the rules (not shown on the breeding screen).</p>
      </div>

      <H2 id="nick-rating">The nick rating, worked out</H2>
      <P>
        The <b>nick</b> sums up how well two lines combine: how often a foal beats both parents (upside), how settled the foal&rsquo;s best trip and surface are (a coherent type), and how
        inbred it is. The breeding preview shows only its label, as a word (&ldquo;Good nick&rdquo;), and feeds it public facts only: the outlook&rsquo;s chance to beat both parents, whether the
        parents&rsquo; published best trips agree and whether their surfaces agree (a full share when they match, half when they don&rsquo;t), and the kinship. The formula, with the weights the game
        uses:
      </P>
      <Callout tone="rule" title="Nick formula">
        <p>
          nick = {gc.NICK_WEIGHTS.base} + {gc.NICK_WEIGHTS.beatsBoth} &times; <i>beats both parents</i> + {gc.NICK_WEIGHTS.tripCertainty} &times; <i>most likely trip</i> +{" "}
          {gc.NICK_WEIGHTS.surfaceCertainty} &times; <i>most likely surface</i> &minus; <i>inbreeding (per mille)</i> &divide; {gc.NICK_WEIGHTS.coiDivisor}, kept between 0 and 100.
        </p>
        <p>
          Each share is a fraction from 0 to 1. Inbreeding is the coefficient in tenths of a percent (full siblings are 250), see <WikiLink slug="inbreeding" />. Below, the formula is worked
          through with the example pair&rsquo;s exact odds, to show how it behaves.
        </p>
      </Callout>
      <Table
        caption="Nick labels"
        head={["Label", "Nick from"]}
        rows={[...gc.NICK_LABELS.map((l) => [l.label, l.min]), ["Poor", 0]]}
      />
      <Facts
        title="The example pairing's nick"
        rows={[
          ["Base", String(nick.parts.base)],
          [`Beats both parents (${pct(Math.round(nick.beats * 1000))})`, `+${one(nick.parts.beats)}`],
          [`Most likely trip (${pct(Math.round(nick.trip * 1000))})`, `+${one(nick.parts.trip)}`],
          [`Most likely surface (${pct(Math.round(nick.surface * 1000))})`, `+${one(nick.parts.surface)}`],
          [`Inbreeding (${ex.preview.coi} per mille)`, `−${one(nick.parts.coi)}`],
          ["Nick", `${nick.result.score} (${nick.result.label})`],
        ]}
      />
      <P>
        A nick is a summary, not a verdict: two pairings with the same nick can differ a lot in their best and worst foals. Read it with the outlook and the possible looks.
      </P>

      <H2 id="dominant-recessive">Dominant, recessive and hidden copies</H2>
      <P>
        Besides the stats and the coat, every horse carries {V2_GENES.length} more genes for patterns, body and performance. Each comes in two copies like the rest, and how the copies combine
        depends on the gene. A <b>dominant</b> gene shows with one copy. A <b>recessive</b> gene shows only with two, so a horse can carry one copy without showing it and pass it on. With an{" "}
        <b>incompletely dominant</b> gene, one copy shows a little and two copies show fully.
      </P>
      <Table
        caption="The pattern, body and performance genes (most common in: share of copies in each breed)"
        head={["Gene", "Inheritance", "What it does", "Most common in"]}
        rows={V2_GENES.map(([locus, name, mode, effect]) => [name, mode, effect, commonIn(locus)])}
      />
      <Callout tone="rule" title="Hidden copies surface in foals">
        <p>
          Two horses that each carry one copy of pearl look plain, yet {pct(carriers.pearl)} of their foals are pearl. The horse page marks a colour or pattern copy the horse carries but
          doesn&rsquo;t show as a <b>hidden copy</b>, and the breeding preview&rsquo;s possible looks can turn one up.
        </p>
      </Callout>
      <P>
        Size, the speed gene and big heart change the stat potentials, and the family limits include them. The twelve breeds and what they carry are on <WikiLink slug="breeds" />; the new colours
        and patterns are on <WikiLink slug="coats-and-markings" />.
      </P>

      <H2 id="other-genes">What else is inherited</H2>
      <List
        items={[
          <>
            <b>Distance:</b> sprint, mile, middle or staying genes set the trip a horse is happiest at.
          </>,
          <>
            <b>Surface:</b> turf or dirt; a horse with one of each copes better on both.
          </>,
          <>
            <b>Running style</b> (front-runner, stalker, closer) and <b>maturity</b> (early, normal or late peak).
          </>,
          <>
            <b>Breed</b>: the foal&rsquo;s breed percentages are the exact average of its parents&rsquo;, see <WikiLink slug="breeds" />.
          </>,
          <>
            <b>Size and the speed gene</b>: they move points between stats and shift the best trip, never the total.
          </>,
          <>
            <b>Coat and markings</b>: real horse colour genetics, see <WikiLink slug="coats-and-markings" />.
          </>,
          <>
            <b>Quirks</b> such as mudlark (loves soft ground) or gate-shy, some dominant, some recessive; they only show themselves in races (see <a href="#quirks">Quirks</a> below).
          </>,
          <>
            <b>Fragile legs</b>, the risk that comes with breeding from injured horses: <WikiLink slug="fragile-legs" />.
          </>,
        ]}
      />
      <H2 id="quirks">Quirks: the catalogue</H2>
      <P>
        A quirk is a small inherited habit that only matters in some races. It never shows on the horse page until it is <b>discovered</b>: in a race where the quirk shows itself, there is a{" "}
        <b>{gc.QUIRK_REVEAL_PCT}%</b> chance it is noticed afterwards. From then on it is known for good, listed under Quirks on the horse page, and you get a note in your Stable news saying what
        it means. A Pedigree Scan narrows the potential ranges but does not reveal quirks: only racing does.
      </P>
      <Table
        caption="Every quirk, from the game rules (one copy of an allele per parent, as for every gene)"
        head={["Quirk", "Shows itself", "Effect in those races", "Inheritance", "Share of first-generation alleles", "What to do"]}
        rows={quirks.map((q) => [q.label, q.when, q.effect, q.inheritance, pct(gc.QUIRK_FREQ[q.key]), q.advice])}
      />
      <P>
        The effects add to the horse&rsquo;s stats for that race only (stats run from 0 to 1000; see <WikiLink slug="stats-and-aptitudes" />). A horse can carry a recessive quirk without
        ever showing it, so two clean parents can still throw a mudlark.
      </P>

      <Callout tone="tip">
        <p>
          Read the preview before every covering: the possible looks, the outlook and the warnings. It&rsquo;s still a chance, and the real foal is a surprise at birth. The{" "}
          <WikiLink slug="family-limits" /> explain why no foal can land far beyond its family.
        </p>
      </Callout>
    </>
  );
}
