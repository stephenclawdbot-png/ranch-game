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

/** A real example pairing: two foundation horses, their exact preview and 400 simulated foals. */
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
  return { sireG, damG, sireOv, damOv, lo, hi, preview, below, above, between: foals.length - below - above, n: foals.length, buckets, best: Math.max(...foals), worst: Math.min(...foals) };
}

export default function GeneticsAndInheritancePage() {
  const ex = examplePairing();
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
        What the breeding screen would show for this pairing before you pay. It uses the true genes, so its odds are exact; it leaves mutations out (they are listed separately), and 400
        foals are only a sample, so the two can differ by a few points.
      </P>
      <Facts
        title="Breeding preview"
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
        <p className="caption">Expected foal potential per stat (the preview also shows each stat&rsquo;s full range).</p>
      </div>

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
            <b>Coat and markings</b>: real horse colour genetics, see <WikiLink slug="coats-and-markings" />.
          </>,
          <>
            <b>Quirks</b> such as mudlark (loves soft ground) or gate-shy, some dominant, some hidden until a scan.
          </>,
          <>
            <b>Fragile legs</b>, the risk that comes with breeding from injured horses: <WikiLink slug="fragile-legs" />.
          </>,
        ]}
      />
      <Callout tone="tip">
        <p>
          Read the preview before every covering. Its odds are exact, and the <WikiLink slug="family-limits" /> tell you the worst and best this pairing can ever produce.
        </p>
      </Callout>
    </>
  );
}
