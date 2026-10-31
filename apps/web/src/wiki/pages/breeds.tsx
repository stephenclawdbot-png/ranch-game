import * as gc from "@thoroughbred/game-core";
import { Callout, Facts, H2, HorseCard, HorseRow, Lead, List, P, Table, WikiLink, appearanceOfGenome, pct } from "../kit";

type G2Freq = keyof gc.BreedProfile["genes2"];
/** The genes that make a breed recognisable, by allele (MSTN, height and iron legs are in their own columns). */
const SIGNATURE: [G2Freq, string, number][] = [
  ["Ch", "champagne", 10],
  ["Z", "silver", 50],
  ["prl", "pearl", 50],
  ["TO", "tobiano", 50],
  ["LP", "leopard complex", 30],
  ["PATN1", "pattern-1", 100],
  ["SW", "splash", 30],
  ["fe", "feathering", 50],
  ["bh", "big heart", 40],
  ["Ce", "curled ears", 100],
  ["Dh", "dished face", 200],
];
const STAT_SHORT: Record<gc.StatKey, string> = { speed: "Spd", stamina: "Sta", burst: "Bur", durability: "Dur", adaptability: "Ada", temperament: "Tem" };
const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");
const shares = (o: Partial<Record<gc.Breed, number>>): gc.BreedShares => Object.fromEntries(gc.BREEDS.map((b) => [b, o[b] ?? 0])) as gc.BreedShares;
const mix = (s: gc.BreedShares) =>
  gc.BREEDS.filter((b) => s[b] > 0)
    .sort((a, b) => s[b] - s[a])
    .map((b) => `${pct(s[b], s[b] % 10 ? 1 : 0)} ${gc.BREED_LABEL[b]}`)
    .join(" · ");

/** The first seeded purebred of a breed (deterministic). */
function purebred(breed: gc.Breed): gc.Genome {
  for (let i = 0; ; i++) {
    const g = gc.generateFoundationGenome(gc.seedFrom("wiki", "breed", breed, i), { season: 1, breed, rarity: "uncommon" });
    if (g.breed[breed] === 1000 || i > 200) return g;
  }
}

export default function BreedsPage() {
  const rows = gc.BREEDS.map((b) => {
    const p = gc.BREED_PROFILES[b];
    const sum = gc.STAT_KEYS.reduce((a, k) => a + p.statMean[k], 0);
    const trip = (Object.entries(p.distance) as [gc.DistanceAllele, number][]).sort((x, y) => y[1] - x[1])[0]![0];
    const size = gc.breedSizePermille(shares({ [b]: 1000 }));
    const sig = SIGNATURE.filter(([k, , min]) => p.genes2[k] >= min).map(([, name]) => name);
    return { b, p, sum, trip, size, sig };
  });
  const sums = rows.map((r) => r.sum);
  const examples = gc.BREEDS.map((b) => ({ b, g: purebred(b) }));

  // Breed % through three generations, with the game's own averaging and labels.
  const tb = shares({ thoroughbred: 1000 });
  const ar = shares({ arabian: 1000 });
  const f1 = gc.blendBreeds(tb, ar);
  const f2 = gc.blendBreeds(f1, tb);
  const f3 = gc.blendBreeds(f2, tb);
  const wb = gc.blendBreeds(shares({ warmblood: 1000 }), shares({ friesian: 1000 }));

  // Size: a pure Standardbred (size 1.00) with 0, 1 and 2 Ht copies, and the breed extremes.
  const sizeSteps = [-12, -9, -6, -3, 0, 3, 6, 9, 12];
  const tallest = [...rows].sort((a, b) => b.size - a.size)[0]!;
  const smallest = [...rows].sort((a, b) => a.size - b.size)[0]!;

  return (
    <>
      <Lead>
        Every horse is a mix of twelve breeds, written as breed percentages that add up to 100. A foal&rsquo;s breed is the exact average of its parents&rsquo;. Breeds shape a horse: its stat
        profile, its best trip, its size and the genes it tends to carry. No breed is better overall; each is good at something else.
      </Lead>

      <H2 id="the-breeds">The twelve breeds</H2>
      <P>
        Each breed has a typical stat profile (the mean of its stat genes), a favourite trip, a liking for turf or dirt, a size and its own signature genes. The numbers below come straight from the
        game&rsquo;s breed table.
      </P>
      <Table
        caption="Breed profiles: stat means, the most common distance gene, turf share, size against an average Thoroughbred, signature genes"
        head={["Breed", ...gc.STAT_KEYS.map((k) => STAT_SHORT[k]), "Total", "Trip", "Turf", "Size", "Signature genes"]}
        rows={rows.map((r) => [
          gc.BREED_LABEL[r.b],
          ...gc.STAT_KEYS.map((k) => r.p.statMean[k]),
          r.sum,
          r.trip,
          pct(r.p.turf),
          `${signed(r.size / 10)}%`,
          r.sig.length ? r.sig.join(", ") : "none",
        ])}
      />
      <HorseRow>
        {examples.map(({ b, g }) => (
          <HorseCard key={b} appearance={appearanceOfGenome(g)} name={gc.BREED_LABEL[b]} line={gc.breedLabel(g.breed)} size="sm" />
        ))}
      </HorseRow>
      <Callout tone="rule" title="No breed is better overall">
        <p>
          Every breed&rsquo;s stat means add up to between {Math.min(...sums).toLocaleString("en-GB")} and {Math.max(...sums).toLocaleString("en-GB")}. A horse&rsquo;s overall potential comes from its
          own genes and rarity, never its breed: the breed only decides where the points sit. A Quarter Horse puts them into speed and burst for short trips, an Arabian into stamina for long ones.
        </p>
      </Callout>
      <P>
        The portraits show the coat and markings. They don&rsquo;t draw breed shapes, size or the new patterns yet; the horse page lists those by name (see <WikiLink slug="coats-and-markings" />).
      </P>

      <H2 id="breed-percent">Breed %: foals are the average</H2>
      <P>
        A foal&rsquo;s breed is the exact average of its parents&rsquo;, to a tenth of a percent. A horse is <b>purebred</b> when one breed is {pct(gc.PUREBRED_PERMILLE, 1)} or more (the breed
        registries&rsquo; seven-eighths rule). Some two-breed crosses have their own names: both breeds need {pct(gc.NAMED_CROSS_MIN_PERMILLE)} or more and together {pct(gc.PUREBRED_PERMILLE, 1)}.
        Any other mix is a crossbred, named by its two biggest breeds.
      </P>
      <Table
        caption="Three generations of breeding back to Thoroughbreds (worked out by the game)"
        head={["Pairing", "Foal's breed", "Label"]}
        rows={[
          ["Thoroughbred × Arabian", mix(f1), gc.breedLabel(f1)],
          ["That foal × Thoroughbred", mix(f2), gc.breedLabel(f2)],
          ["That foal × Thoroughbred", mix(f3), gc.breedLabel(f3)],
          ["Warmblood × Friesian", mix(wb), gc.breedLabel(wb)],
        ]}
      />
      <List
        items={gc.NAMED_CROSSES.map(([a, b, name]) => (
          <span key={name}>
            <b>{name}</b>: {gc.BREED_LABEL[a]} and {gc.BREED_LABEL[b]}.
          </span>
        ))}
      />

      <H2 id="size">Size: shape, not strength</H2>
      <P>
        Size is measured against an average Thoroughbred. It is the breed&rsquo;s size plus a polygenic height gene (up to ±{gc.SIZE_POLYGENIC_PERMILLE / 10}%) plus{" "}
        <b>{signed(gc.SIZE_PER_HT_PERMILLE / 10)}% for each copy of the Height gene (Ht)</b>, which is incompletely dominant: one copy makes a horse taller, two copies taller still. Size runs from{" "}
        {signed(gc.SIZE_MIN_PERMILLE / 10)}% to {signed(gc.SIZE_MAX_PERMILLE / 10)}%. The {gc.BREED_LABEL[tallest.b]} is the biggest breed ({signed(tallest.size / 10)}%), the{" "}
        {gc.BREED_LABEL[smallest.b]} the smallest ({signed(smallest.size / 10)}%).
      </P>
      <P>
        A taller horse gains top speed and stamina and loses burst and durability; a smaller one the reverse. The points only move between stats, so the total never changes. Per whole 1% of size:
        speed {signed(gc.SIZE_STAT_PER_PCT.speed)}, stamina {signed(gc.SIZE_STAT_PER_PCT.stamina)}, burst {signed(gc.SIZE_STAT_PER_PCT.burst)}, durability {signed(gc.SIZE_STAT_PER_PCT.durability)}.
      </P>
      <Table
        caption="What size does to the stats (the game's own calculation)"
        head={["Size", "Speed", "Stamina", "Burst", "Durability", "Total"]}
        rows={sizeSteps.map((s) => {
          const d = gc.sizeStatDelta(s * 10);
          return [`${signed(s)}%`, signed(d.speed), signed(d.stamina), signed(d.burst), signed(d.durability), signed(gc.STAT_KEYS.reduce((a, k) => a + d[k], 0))];
        })}
      />
      <Callout tone="tip" title="Size shows in foals">
        <p>
          A horse from a pack, a starter stable or the Club is made to its breed&rsquo;s shape, so its stats already include its size. Size starts to matter when you breed: two Ht/n parents throw a
          foal with two copies a quarter of the time, and that foal is taller, faster and less durable than either parent. How big the foal turns out is a surprise until it is born; its horse page then shows its size.
        </p>
      </Callout>

      <H2 id="speed-gene">The speed gene (MSTN)</H2>
      <P>
        MSTN has two versions, C (sprint) and T (stay), and neither dominates. <b>C/C</b> horses are sprinters: their best trip is {gc.MSTN_TRIP_M} m shorter than their distance genes say, with burst{" "}
        {signed(gc.MSTN_STAT_SHIFT)} and stamina {signed(-gc.MSTN_STAT_SHIFT)}. <b>T/T</b> horses are stayers: {gc.MSTN_TRIP_M} m longer, stamina {signed(gc.MSTN_STAT_SHIFT)} and burst{" "}
        {signed(-gc.MSTN_STAT_SHIFT)}. <b>C/T</b> horses are milers with no shift. Like size, it moves points and never adds any.
      </P>
      <Table
        caption="Share of C (sprint) copies by breed"
        head={["Breed", "C copies", "Sprinter (C/C)", "Stayer (T/T)"]}
        rows={rows.map((r) => {
          const c = r.p.genes2.C;
          return [gc.BREED_LABEL[r.b], pct(c), pct(Math.round((c * c) / 1000)), pct(Math.round(((1000 - c) * (1000 - c)) / 1000))];
        })}
      />

      <H2 id="big-heart-iron-legs">Big heart and iron legs</H2>
      <List
        items={[
          <>
            <b>Big heart</b> is recessive and rare: only a horse with two copies (bh/bh) has it, and then it gets <b>{signed(gc.BIG_HEART_STAMINA)} stamina</b> potential. It is the one new gene that adds
            strength. Two carriers have a 25% chance of a big-heart foal. It stays unknown on the horse page until the horse races or has a Pedigree Scan.
          </>,
          <>
            <b>Iron legs</b> is dominant: one copy multiplies the injury risk of every start by <b>{(gc.IRON_LEGS_RISK / 1000).toFixed(2)}</b> (see <WikiLink slug="injuries-and-insurance" />). It is
            the sound-legged opposite of <WikiLink slug="fragile-legs" />; a horse can carry both, and then both apply.
          </>,
          <>
            <b>Feathering</b> (long hair on the lower legs) is recessive, <b>curled ears</b> dominant and the <b>dished face</b> incompletely dominant. These are looks only.
          </>,
        ]}
      />
      <Facts
        rows={[
          ["Breeds", gc.BREEDS.length],
          ["Purebred from", pct(gc.PUREBRED_PERMILLE, 1)],
          ["Height per Ht copy", `${signed(gc.SIZE_PER_HT_PERMILLE / 10)}%`],
          ["Size range", `${signed(gc.SIZE_MIN_PERMILLE / 10)}% to ${signed(gc.SIZE_MAX_PERMILLE / 10)}%`],
          ["MSTN trip shift", `${gc.MSTN_TRIP_M} m`],
          ["Big heart", `${signed(gc.BIG_HEART_STAMINA)} stamina`],
          ["Iron legs injury risk", `×${(gc.IRON_LEGS_RISK / 1000).toFixed(2)}`],
        ]}
      />

      <H2 id="older-horses">Horses from before the twelve breeds</H2>
      <P>
        Horses born before the twelve breeds arrived keep exactly the genes, looks and stats they had. They count as 0% of the eight new breeds, carry none of the new genes and are C/T milers, and
        their size never moves their stats. Their foals are ordinary new horses: they get their parents&rsquo; average breed and their own size. Breeding commitments made before the change foal
        the same horse they were always going to, plus the new genes. See <WikiLink slug="genetics-and-inheritance" /> for how every gene is passed on.
      </P>
    </>
  );
}
