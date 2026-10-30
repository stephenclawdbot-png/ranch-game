import * as gc from "@thoroughbred/game-core";
import { CoatSchema, FaceMarkingSchema, LegMarkingSchema, type Coat, type HorseAppearance, type Silks } from "@thoroughbred/shared";
import { Callout, Facts, H2, H3, HorseCard, HorseRow, Lead, List, P, ShareBar, Table, WikiLink, appearanceOfGenome, sampleGenome, sampleOfCoat } from "../kit";

const SILKS: Silks = { pattern: "hoops", primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#1f4e9c" };
const RACING = { racingAge: true, starts: 5, retired: false };

/** The name each of the ten painted coats goes by in the game (the plain example of it). */
const COAT_LABEL: Record<Coat, string> = {
  bay: "Bay",
  dark_bay: "Seal Brown",
  chestnut: "Chestnut",
  liver_chestnut: "Liver Chestnut",
  black: "Black",
  grey: "Grey",
  dapple_grey: "Dapple Grey",
  palomino: "Palomino",
  buckskin: "Buckskin",
  roan: "Bay Roan",
};

type CoatSample = { genome: gc.Genome; appearance: HorseAppearance; name: string };

/** A seeded horse with this coat, preferring the plain version of it (a Black that isn't Smoky Black). */
function coatSample(coat: Coat): CoatSample | null {
  if (coat === "grey") {
    // Greys only go fully white late in a career, so take a dapple grey and age it.
    const d = sampleOfCoat("dapple_grey");
    if (!d) return null;
    const progress = { racingAge: true, starts: gc.GREY_WHITE_AT_STARTS, retired: false };
    return { genome: d.genome, appearance: gc.appearanceOf(d.genome, progress, SILKS), name: gc.resolveCoat(d.genome, progress).coatName };
  }
  for (let i = 0; i < 400; i++) {
    const genome = sampleGenome(`coats-${coat}-${i}`);
    const appearance = appearanceOfGenome(genome);
    const name = gc.resolveCoat(genome, RACING).coatName;
    if (appearance.coat === coat && name === COAT_LABEL[coat]) return { genome, appearance, name };
  }
  const any = sampleOfCoat(coat);
  return any ? { ...any, name: gc.resolveCoat(any.genome, RACING).coatName } : null;
}

/** Coat genes with every locus at its plain (wild) setting, then the given changes. */
const genes = (over: Partial<gc.CoatGenes>): gc.CoatGenes => ({
  extension: ["E", "E"],
  agouti: ["A", "A"],
  cream: ["n", "n"],
  grey: ["n", "n"],
  roan: ["n", "n"],
  dun: ["n", "n"],
  liver: ["L", "L"],
  sabino: ["n", "n"],
  ...over,
});

/** Extension and agouti in standard notation (stronger copy first), as the Genetics panel prints them. */
const short = (g: gc.Genome, a: HorseAppearance) =>
  gc
    .geneticsSummary(g, a, [])
    .coat.loci.filter((l) => l.locus === "Extension" || l.locus === "Agouti")
    .map((l) => l.alleles)
    .join(" ");

/** A real horse given exactly these coat genes (everything else from its own seeded genome). */
function withGenes(seed: string, over: Partial<gc.CoatGenes>): gc.Genome {
  const g = sampleGenome(seed);
  return { ...g, coat: genes(over) };
}

const asHorse = (id: string, sex: "colt" | "filly", genome: gc.Genome) =>
  gc.createHorseState({ id, name: id, sex, ownerId: "wiki", sireId: null, damId: null, generation: 0, genome, bornAtMs: 0, bornSeason: 1, careSessions: gc.CARE_TO_RACING });

const coatOdds = (sire: gc.Genome, dam: gc.Genome) => gc.previewBreeding(asHorse("wiki-sire", "colt", sire), asHorse("wiki-dam", "filly", dam), {}, 1).coats;

/** The genetics-v2 colour and pattern genes: one copy, two copies. */
const PATTERN_GENES: [locus: gc.Genes2Key, name: string, one: string, two: string][] = [
  ["champagne", "Champagne (Ch)", "Gold, amber or sable body, pink freckled skin, amber eyes", "The same"],
  ["silver", "Silver (Z)", "Black pigment turns chocolate, flaxen mane; hidden on a chestnut", "The same"],
  ["pearl", "Pearl (prl)", "Hidden, unless the horse also has cream: pale, green or blue eyes", "Pale apricot"],
  ["tobiano", "Tobiano (TO)", "White patches crossing the back, white legs, dark head", "Tobiano with small ink spots"],
  ["leopard", "Leopard complex (LP)", "Leopard spots with Pattern-1, varnish roan without", "Few-spot: nearly white"],
  ["patn1", "Pattern-1 (PATN1)", "Turns the leopard complex into full spots; hidden without it", "The same"],
  ["splash", "Splash white (SW)", "Big blaze, white legs, blue eyes", "Bald face, white belly"],
];

/** One portrait per v2 colour/pattern gene: [caption, v2 genes, coat genes, line]. */
const PATTERN_SAMPLES: [string, Partial<gc.Genes2>, Partial<gc.CoatGenes>, string][] = [
  ["Gold champagne", { champagne: ["Ch", "n"] }, { extension: ["e", "e"] }, "Chestnut + Ch"],
  ["Classic champagne", { champagne: ["Ch", "n"] }, { agouti: ["a", "a"] }, "Black + Ch"],
  ["Silver black", { silver: ["Z", "n"] }, { agouti: ["a", "a"] }, "Black + Z"],
  ["Pearl", { pearl: ["prl", "prl"] }, { extension: ["e", "e"] }, "Chestnut + prl/prl"],
  ["Tobiano", { tobiano: ["TO", "n"] }, {}, "Bay + TO"],
  ["Leopard", { leopard: ["LP", "n"], patn1: ["PATN1", "n"] }, { extension: ["e", "e"] }, "Chestnut + LP + PATN1"],
  ["Few-spot", { leopard: ["LP", "LP"] }, {}, "Bay + LP/LP"],
  ["Splash white", { splash: ["SW", "n"] }, { extension: ["e", "e"] }, "Chestnut + SW"],
];

/** The three breeds with the most copies of a gene. */
function topCarriers(locus: gc.Genes2Key): string {
  const key = gc.G2_LOCI.find((l) => l[0] === locus)![1];
  return gc.BREEDS.map((b) => [b, gc.BREED_PROFILES[b].genes2[key]] as const)
    .filter(([, f]) => f > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([b, f]) => `${gc.BREED_LABEL[b]} ${Math.round(f / 10)}%`)
    .join(", ");
}

/** A seeded horse with plain v2 genes, then the given ones. */
function withG2(seed: string, over: Partial<gc.Genes2>, coat: Partial<gc.CoatGenes> = {}): gc.Genome {
  const g = sampleGenome(seed);
  return { ...g, coat: genes(coat), genes2: { ...gc.WILD_GENES2, ...over } };
}

/** The preview's odds for a trait in a pairing. */
const traitOdds = (sire: gc.Genome, dam: gc.Genome, name: string) =>
  gc.previewBreeding(asHorse("wiki-sire", "colt", sire), asHorse("wiki-dam", "filly", dam), {}, 1).traits.find((t) => t.name === name)?.permille ?? 0;

const ODDS_COLOURS =["#c47a3f", "#8a3b1e", "#2a2422", "#d9b98f", "#8fa592", "#e9dccb"];

const RARE: [string, Partial<gc.CoatGenes>, string][] = [
  ["Palomino", { extension: ["e", "e"], cream: ["Cr", "n"] }, "Chestnut + one cream"],
  ["Smoky Black", { agouti: ["a", "a"], cream: ["Cr", "n"] }, "Black + one cream (hard to tell from black)"],
  ["Cremello", { extension: ["e", "e"], cream: ["Cr", "Cr"] }, "Chestnut + two cream"],
  ["Perlino", { cream: ["Cr", "Cr"] }, "Bay + two cream"],
  ["Red Dun", { extension: ["e", "e"], dun: ["D", "n"] }, "Chestnut + dun"],
  ["Bay Dun", { dun: ["D", "n"] }, "Bay + dun"],
  ["Grullo", { agouti: ["a", "a"], dun: ["D", "n"] }, "Black + dun"],
  ["Strawberry Roan", { extension: ["e", "e"], roan: ["Rn", "n"] }, "Chestnut + roan"],
  ["Blue Roan", { agouti: ["a", "a"], roan: ["Rn", "n"] }, "Black + roan"],
  ["Sabino", { extension: ["e", "e"], sabino: ["Sb1", "Sb1"] }, "Chestnut with two sabino copies"],
];

export default function CoatsAndMarkingsPage() {
  const coats = CoatSchema.options.map((c) => ({ coat: c, s: coatSample(c) })).filter((x): x is { coat: Coat; s: CoatSample } => x.s !== null);

  // Base colour: extension x agouti (x liver on red).
  const baseRows: Partial<gc.CoatGenes>[] = [
    { extension: ["E", "E"], agouti: ["A", "A"] },
    { extension: ["E", "e"], agouti: ["A", "a"] },
    { extension: ["E", "E"], agouti: ["At", "a"] },
    { extension: ["E", "e"], agouti: ["a", "a"] },
    { extension: ["e", "e"], agouti: ["A", "A"] },
    { extension: ["e", "e"], agouti: ["a", "a"], liver: ["l", "l"] },
  ];

  // Dilutions and patterns on each base.
  const bases: [string, Partial<gc.CoatGenes>][] = [
    ["Chestnut", { extension: ["e", "e"] }],
    ["Bay", {}],
    ["Seal Brown", { agouti: ["At", "At"] }],
    ["Black", { agouti: ["a", "a"] }],
  ];
  const dilutionRows = bases.map(([name, b]) => [
    name,
    gc.adultCoatName(genes({ ...b, cream: ["Cr", "n"] })),
    gc.adultCoatName(genes({ ...b, cream: ["Cr", "Cr"] })),
    gc.adultCoatName(genes({ ...b, dun: ["D", "n"] })),
    gc.adultCoatName(genes({ ...b, roan: ["Rn", "n"] })),
  ]);

  // Grey through a career: one horse, three moments.
  const greyHorse = sampleOfCoat("dapple_grey");
  const greyStages = greyHorse
    ? (
        [
          ["As a foal", { racingAge: false, starts: 0, retired: false }],
          ["Racing", RACING],
          [`After ${gc.GREY_WHITE_AT_STARTS} starts`, { racingAge: true, starts: gc.GREY_WHITE_AT_STARTS, retired: false }],
        ] as const
      ).map(([label, progress]) => ({ label, appearance: gc.appearanceOf(greyHorse.genome, progress, SILKS), name: gc.resolveCoat(greyHorse.genome, progress).coatName }))
    : [];
  const greyBornAs = greyHorse ? gc.geneticsSummary(greyHorse.genome, greyHorse.appearance, []).coat.bornAs : null;

  // Face markings, plain to bald: the first seeded horse showing each.
  const faces: { face: string; appearance: HorseAppearance; legs: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 400 && seen.size < 6; i++) {
    const g = sampleGenome(`face-${i}`);
    const a = appearanceOfGenome(g);
    if (seen.has(a.face)) continue;
    seen.add(a.face);
    const s = gc.geneticsSummary(g, a, []);
    faces.push({ face: s.white.face, appearance: a, legs: s.white.legs });
  }
  const FACE_ORDER = ["Plain face", "Star", "Snip", "Stripe", "Blaze", "Bald face"];
  faces.sort((a, b) => FACE_ORDER.indexOf(a.face) - FACE_ORDER.indexOf(b.face));

  // Hidden copies: two bays that each carry red and black.
  const baySire = withGenes("hidden-sire", { extension: ["E", "e"], agouti: ["A", "a"] });
  const bayDam = withGenes("hidden-dam", { extension: ["E", "e"], agouti: ["A", "a"] });
  const hiddenOdds = coatOdds(baySire, bayDam);
  const panel = gc.geneticsSummary(baySire, appearanceOfGenome(baySire), []);

  // Genetics-v2 pattern odds, straight from the preview.
  const patternOdds: [string, string, number][] = [
    ["Tobiano (TO/n) × plain", "Tobiano", traitOdds(withG2("to-s", { tobiano: ["TO", "n"] }), withG2("to-d", {}), "Tobiano")],
    ["Two pearl carriers (prl/n, no cream)", "Pearl", traitOdds(withG2("prl-s", { pearl: ["prl", "n"] }), withG2("prl-d", { pearl: ["prl", "n"] }), "Pearl")],
    ["Two silver carriers, both chestnut", "Silver", traitOdds(withG2("z-s", { silver: ["Z", "n"] }, { extension: ["e", "e"] }), withG2("z-d", { silver: ["Z", "n"] }, { extension: ["e", "e"] }), "Silver")],
    [
      "Two LP/n PATN1/n Appaloosas",
      "Leopard spots",
      traitOdds(withG2("lp-s", { leopard: ["LP", "n"], patn1: ["PATN1", "n"] }), withG2("lp-d", { leopard: ["LP", "n"], patn1: ["PATN1", "n"] }), "Leopard spots"),
    ],
  ];

  // Palomino recipe: cremello x chestnut.
  const palOdds = coatOdds(withGenes("pal-sire", { extension: ["e", "e"], cream: ["Cr", "Cr"] }), withGenes("pal-dam", { extension: ["e", "e"] }));

  return (
    <>
      <Lead>
        A horse&rsquo;s coat comes from real horse colour genetics: a base colour, dilutions that lighten it, patterns like roan and grey, and white markings on the face and legs. Every gene comes in
        two copies, one from each parent, and a horse can carry a copy it doesn&rsquo;t show and pass it to its foals.
      </Lead>

      <H2 id="the-coats">The coats</H2>
      <P>
        These are the main coats, each on a real horse the game generated. The cards are the same portraits you see in your stable. Rarer colours (cremello, grullo and the rest) are further down.
      </P>
      <HorseRow>
        {coats.map(({ coat, s }) => (
          <HorseCard key={coat} appearance={s.appearance} name={s.name} line={short(s.genome, s.appearance)} size="sm" />
        ))}
      </HorseRow>
      <Facts
        rows={[
          ["Coat genes on every horse", Object.keys(genes({})).length],
          ["Copies of each gene", "2 (one from the sire, one from the dam)"],
          ["Starts until a grey is fully white", gc.GREY_WHITE_AT_STARTS],
          ["Face markings", `${FaceMarkingSchema.options.length - 1} plus a plain face`],
          ["Leg markings", `${LegMarkingSchema.options.length - 1} per leg, or none`],
        ]}
      />

      <H2 id="base-colour">Base colour: black, bay or chestnut</H2>
      <P>
        Two genes set the base. <b>Extension</b> decides whether the horse makes black pigment at all: <b>E</b> (black) beats <b>e</b> (red), so only an <b>e/e</b> horse is chestnut. On a horse with
        black pigment, <b>Agouti</b> decides where the black goes: <b>A</b> keeps it to the mane, tail and legs (bay), <b>At</b> lets it spread over most of the body (seal brown), and two copies of{" "}
        <b>a</b> leave the horse solid black. A third gene, <b>Liver</b>, darkens a chestnut to liver chestnut, but only with two copies.
      </P>
      <Table
        caption="Worked out by the game's own coat rules"
        head={["Extension", "Agouti", "Liver", "Coat"]}
        rows={baseRows.map((r) => {
          const c = genes(r);
          return [c.extension.join("/"), c.agouti.join("/"), c.liver.join("/"), gc.adultCoatName(c)];
        })}
      />
      <Callout tone="rule" title="Agouti hides on a chestnut">
        <p>A chestnut can&rsquo;t show agouti at all, so a chestnut mare may quietly carry bay or black. Bred to a black stallion, she can throw a bay.</p>
      </Callout>

      <H2 id="dilutions">Dilutions and patterns</H2>
      <List
        items={[
          <>
            <b>Cream</b> lightens the coat. One copy turns chestnut to palomino and bay to buckskin; on black it barely shows (smoky black). Two copies give the pale cream coats: cremello, perlino
            and smoky cream.
          </>,
          <>
            <b>Dun</b> lightens the body and adds primitive markings: a dark stripe down the back and barring on the legs. Bay becomes bay dun, chestnut red dun, black grullo.
          </>,
          <>
            <b>Roan</b> mixes white hairs through the body while the head and legs stay dark: strawberry, bay and blue roan.
          </>,
          <>
            <b>Grey</b> is a pattern that comes with time; it has its own section below.
          </>,
        ]}
      />
      <Table caption="One base, one extra gene (the game's own names)" head={["Base", "One cream", "Two cream", "Dun", "Roan"]} rows={dilutionRows} />
      <H3>Rarer colours</H3>
      <P>Real horses from the game, each given exactly the genes in its caption.</P>
      <HorseRow>
        {RARE.map(([name, over, line]) => {
          const g = withGenes(`rare-${name}`, over);
          return <HorseCard key={name} appearance={appearanceOfGenome(g)} name={name === "Sabino" ? `${gc.adultCoatName(g.coat)}, sabino` : gc.adultCoatName(g.coat)} line={line} size="sm" />;
        })}
      </HorseRow>
      <P>Genes stack: a buckskin that is also dun is a dunskin; a palomino roan is a palomino with the roan gene. The game names the combination, and the preview shows its odds.</P>

      <H2 id="grey">Grey: born coloured, white by the end</H2>
      <P>
        Grey (<b>G</b>) needs only one copy. A grey foal is born in its base colour and starts greying out. From racing age the coat is dapple grey, and by <b>{gc.GREY_WHITE_AT_STARTS} starts</b>, or
        when it retires from racing, it is fully grey. It goes by career, not by the calendar. A grey also hides the dun stripe once the grey shows.
      </P>
      {greyStages.length > 0 && (
        <HorseRow>
          {greyStages.map((s) => (
            <HorseCard key={s.label} appearance={s.appearance} name={s.name} line={s.label} size="sm" />
          ))}
        </HorseRow>
      )}
      <P>
        The horse page names the colour a grey was born as{greyBornAs ? <> (this one: &ldquo;Grey, born {greyBornAs.toLowerCase()}, greying with career&rdquo;)</> : null}. Under the grey it still carries
        those base genes and passes them on.
      </P>

      <H2 id="markings">White markings</H2>
      <P>
        Face and leg white comes from many small genes adding up, plus the <b>Sabino</b> gene. Each horse has a white tendency: the higher it is, the more white. On the face that runs from a plain face
        through a star, snip, stripe and blaze to a bald face; on the legs from a coronet to a sock to a stocking. Hind legs carry a little more white than front legs.
      </P>
      <HorseRow>
        {faces.map((f) => (
          <HorseCard key={f.face} appearance={f.appearance} name={f.face} line={f.legs} size="sm" />
        ))}
      </HorseRow>
      <P>
        One copy of Sabino-1 adds white face and leg markings; two copies give a loud white pattern with patches on the body. Markings are inherited like everything else, with a small chance each time
        that the white tendency drifts a little.
      </P>

      <H2 id="hidden-copies">Hidden copies and coat odds</H2>
      <P>
        Because black beats red and bay beats black, a horse can carry a gene it doesn&rsquo;t show. Two bays that each carry red (<b>E/e</b>) and black (<b>A/a</b>) look identical to any other bay, but
        their foals can come out in three colours. The <WikiLink slug="breeding-basics">breeding preview</WikiLink> works out the exact odds from the true genes:
      </P>
      <HorseRow>
        <HorseCard appearance={appearanceOfGenome(baySire)} name="Bay sire" line="E/e A/a" size="sm" />
        <HorseCard appearance={appearanceOfGenome(bayDam)} name="Bay dam" line="E/e A/a" size="sm" />
      </HorseRow>
      <ShareBar label="Coat odds, bay E/e A/a × bay E/e A/a" total={1000} parts={hiddenOdds.map((c, i) => ({ label: c.name, value: c.permille, color: ODDS_COLOURS[i % ODDS_COLOURS.length]! }))} />
      <Callout tone="tip" title="Breeding for colour">
        <p>
          Want palominos? A cremello bred to a chestnut gives{" "}
          {palOdds.map((c, i) => (
            <span key={c.name}>
              {i > 0 ? ", " : ""}
              {c.name} {Math.round(c.permille / 10)}%
            </span>
          ))}
          : every foal gets one cream copy from the cremello and red from both. The preview shows greys as &ldquo;Grey&rdquo;, since that is what they end up as.
        </p>
      </Callout>

      <H2 id="new-colours">Champagne, silver, pearl and the white patterns</H2>
      <P>
        Seven more genes change the colour or add white patterns. They follow the same two-copy rules, and some hide: silver can&rsquo;t show on a chestnut, pearl needs two copies (or one next to
        cream), and Pattern-1 does nothing without the leopard complex.
      </P>
      <Table
        caption="Colour and pattern genes: share of copies in the breeds that carry them most (from the game's breed table)"
        head={["Gene", "One copy", "Two copies", "Most common in"]}
        rows={PATTERN_GENES.map(([locus, name, one, two]) => [name, one, two, topCarriers(locus)])}
      />
      <P>Odds the breeding preview gives for some pairings, worked out by the game:</P>
      <Table
        head={["Pairing", "Foals that show it"]}
        rows={patternOdds.map(([label, name, permille]) => [label, `${Math.round(permille / 10)}% ${name.toLowerCase()}`])}
      />
      <P>Each of these horses carries exactly the gene in its caption; the portraits draw it from the genes.</P>
      <HorseRow>
        {PATTERN_SAMPLES.map(([label, over, coat, line]) => (
          <HorseCard key={label} appearance={appearanceOfGenome(withG2(`v2-${label}`, over, coat))} name={label} line={line} size="sm" />
        ))}
      </HorseRow>
      <Callout tone="rule" title="Where they show">
        <p>
          The 3/4 portraits draw all seven: champagne, silver and pearl colour the coat, mane, skin and eyes, and tobiano, the leopard complex and splash white paint their white on the
          head and neck (a grey still goes white over them). On the race sprites and the yard horses the three colour genes show, but the white patterns are not drawn yet; the horse page names
          them under <b>Markings</b>.
        </p>
      </Callout>

      <H2 id="genetics-panel">Reading the Genetics panel</H2>
      <P>
        Every horse page has a <b>Genetics</b> panel: the stud-book view of the horse. Coat genes are public, so you can read them on anyone&rsquo;s horse, including stallions at stud. Each line is one
        gene: its two copies in standard notation (the stronger one first) and what they do. A line marked <b>(hidden copy)</b> carries something the coat doesn&rsquo;t show but the horse can pass on.
        Here is the panel for the bay sire above:
      </P>
      <Table
        caption={`${panel.coat.name}: coat loci`}
        head={["Gene", "Copies", "What it means"]}
        rows={panel.coat.loci.map((l) => [
          l.locus,
          <code key="a">{l.alleles}</code>,
          <>
            {l.meaning}
            {l.carried ? <b> (hidden copy)</b> : null}
          </>,
        ])}
      />
      <List
        items={[
          <>
            <b>Face</b> and <b>Legs</b> name the markings (near and off are the horse&rsquo;s left and right; fore and hind are front and back).
          </>,
          <>
            <b>Sabino</b> shows the copies of Sabino-1; <b>White tendency</b> (low, medium or high) is how much white its genes carry, which is also what it tends to pass on.
          </>,
          <>
            <b>Build</b>, the <b>breed mix</b>, <b>Inbreeding</b> (see <WikiLink slug="inbreeding" />), any quirks revealed in races and, if the horse has it, <b>Fragile legs (inherited)</b> (see{" "}
            <WikiLink slug="fragile-legs" />).
          </>,
          <>
            <b>Body, pattern and performance genes</b>: one line for each of the {gc.GENES2_KEYS.length} genes above and on <WikiLink slug="breeds" />, with hidden copies marked; <b>Size</b> with what it
            does to the stats; <b>Markings</b> naming the colour and pattern genes the horse shows (and any the portrait doesn&rsquo;t draw yet). Big heart reads &ldquo;?/?&rdquo; until the horse has raced or had a Pedigree Scan.
          </>,
          <>Stat genes are not shown here: those stay hidden behind ranges. See <WikiLink slug="genetics-and-inheritance" />.</>,
        ]}
      />
    </>
  );
}
