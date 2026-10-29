import * as gc from "@thoroughbred/game-core";
import { RISK_LABEL } from "@/lib/horseLife";
import { Callout, Facts, Figure, H2, Lead, List, P, Table, WikiLink, pct } from "../kit";

const withFragile = (g: gc.Genome, fragile: [0 | 1, 0 | 1]): gc.Genome => ({ ...g, fragile });

/** A racing horse in its prime, for the entry-sheet injury risk. */
function prime(genome: gc.Genome) {
  const h = gc.createHorseState({ id: "wiki-runner", name: "Runner", sex: "colt", ownerId: "wiki", sireId: null, damId: null, generation: 1, genome, bornAtMs: 0, bornSeason: 1, careSessions: gc.CARE_TO_RACING });
  return { ...h, career: { ...h.career, starts: 10 }, record: { ...h.record, starts: 10 } };
}

const RISK = { nowMs: 0, going: "good", distanceM: 1600, intensity: "normal", stage: "prime" } as const;

export default function FragileLegsPage() {
  const base = gc.generateFoundationGenome(gc.seedFrom("wiki", "fragile-example"), { season: 1, rarity: "epic" });
  const sound = withFragile(base, [0, 0]);
  const fragile = withFragile(base, [1, 0]);
  const riskSound = gc.injuryRisk(prime(sound), RISK);
  const riskFragile = gc.injuryRisk(prime(fragile), RISK);

  const S = sound;
  const scenarios: [string, gc.Genome, gc.Genome, { sire?: boolean; dam?: boolean }][] = [
    ["Two sound parents, both retired from racing normally", S, S, {}],
    ["One parent's racing ended in an injury", S, S, { sire: true }],
    ["Both parents' racing ended in an injury", S, S, { sire: true, dam: true }],
    ["One parent has fragile legs (one copy)", fragile, S, {}],
    ["One parent has fragile legs (two copies)", withFragile(base, [1, 1]), S, {}],
    ["Both parents have fragile legs (one copy each)", fragile, fragile, {}],
    ["One fragile parent, the other's racing ended in an injury", fragile, S, { dam: true }],
  ];
  const carrierPasses = gc.fragileChance(fragile, S);

  return (
    <>
      <Lead>
        Fragile legs is a weakness a horse can inherit. It costs durability, raises the risk of injury in every race, and it can be passed on. It enters a family when a horse whose racing ended in
        an injury goes on to breed.
      </Lead>
      <Figure src="/art/diorama/poster-barn.png" alt="The barn aisle" caption="Fragile legs don't show in the coat: you find them in the horse's Genetics panel." focus={0.55} />

      <H2 id="what-it-does">What fragile legs do</H2>
      <List
        items={[
          <>
            <b>Lower durability.</b> The horse&rsquo;s durability potential is <b>{gc.FRAGILE_DURABILITY_PENALTY}</b> lower than its genes would otherwise give. Training can&rsquo;t win it back.
          </>,
          <>
            <b>More injuries.</b> On top of that, the injury risk in every race is multiplied by <b>{(gc.FRAGILE_RISK / 1000).toFixed(1)}</b>. The entry sheet lists it as &ldquo;Fragile legs
            (inherited)&rdquo;.
          </>,
          <>
            <b>It passes on.</b> A fragile horse can hand it to its foals, so it can run through a family for generations.
          </>,
        ]}
      />
      <P>The same horse with and without the gene, as the game works it out for a normal ride over a mile on good going:</P>
      <Table
        head={["", "Sound", "Fragile legs"]}
        rows={[
          ["Durability potential", gc.potentialOf(sound, "durability"), gc.potentialOf(fragile, "durability")],
          ["Overall potential", gc.overallPotential(sound), gc.overallPotential(fragile)],
          ["Injury risk per start", pct(riskSound.permille, 1), pct(riskFragile.permille, 1)],
          ["Risk label on the entry sheet", RISK_LABEL[riskSound.label], RISK_LABEL[riskFragile.label]],
        ]}
      />
      <Facts
        rows={[
          ["Durability potential lost", gc.FRAGILE_DURABILITY_PENALTY],
          ["Injury risk multiplier", `×${(gc.FRAGILE_RISK / 1000).toFixed(1)}`],
          ["Copies needed to show it", "1 (dominant)"],
          ["Chance an injured parent passes it on", pct(gc.FRAGILE_FROM_INJURY_PERMILLE)],
          ["Chance a one-copy carrier passes it on", pct(carrierPasses)],
        ]}
      />

      <H2 id="inheritance">How it is inherited</H2>
      <P>
        Fragile legs is <b>dominant</b>: one copy is enough to show. A foal gets one copy of the gene from each parent, and it can come two ways:
      </P>
      <List
        items={[
          <>
            <b>From a fragile parent.</b> A parent with the gene passes one of its two copies at random: with one copy that is half its foals, with two copies every foal.
          </>,
          <>
            <b>From an injury.</b> A parent whose racing career ended in an injury passes fragile legs {pct(gc.FRAGILE_FROM_INJURY_PERMILLE)} of the time, even though the parent itself isn&rsquo;t
            fragile. A career ended by choice or by reaching the maximum starts doesn&rsquo;t count.
          </>,
        ]}
      />
      <P>The breeding preview combines both. Here are the chances for some common pairings, straight from the game&rsquo;s own calculation:</P>
      <Table
        head={["Pairing", "Chance the foal has fragile legs"]}
        rows={scenarios.map(([label, sire, dam, injured]) => [label, pct(gc.fragileChance(sire, dam, injured))])}
      />
      <Callout tone="rule" title="A sound horse carries nothing">
        <p>
          Because one copy always shows, a horse without fragile legs has no hidden copy to pass on. Breed a fragile horse to a sound one, keep the sound foals, and the line is clean again from that
          generation on.
        </p>
      </Callout>

      <H2 id="where-to-see-it">Where you see it</H2>
      <List
        items={[
          <>
            <b>The horse page.</b> In the Genetics panel, a fragile horse has a <b>Soundness</b> line reading &ldquo;Fragile legs (inherited)&rdquo;. Like the coat it is public stud-book
            information, so you can check any stallion at stud before you book him. See <WikiLink slug="coats-and-markings">reading the Genetics panel</WikiLink>.
          </>,
          <>
            <b>The breeding preview.</b> If there is any chance, the preview shows &ldquo;Fragile legs&rdquo; with the percentage, and says whether it comes from a parent&rsquo;s injury or from a
            parent that carries the gene.
          </>,
          <>
            <b>The entry sheet.</b> &ldquo;Fragile legs (inherited)&rdquo; appears among the injury risk factors. See <WikiLink slug="injuries-and-insurance" />.
          </>,
        ]}
      />

      <H2 id="the-gamble">Breeding from an injured champion</H2>
      <P>
        A career-ending injury doesn&rsquo;t end a horse&rsquo;s breeding life: it retires from racing and can still breed (see <WikiLink slug="stud-and-broodmares" />). Its genes are exactly as good
        as before. The only thing that has changed is the fragile-legs risk for its foals.
      </P>
      <Callout tone="gamble">
        <p>
          A brilliant horse whose racing ended in an injury is still a brilliant horse to breed from. Each foal has a {pct(gc.FRAGILE_FROM_INJURY_PERMILLE)} chance of fragile legs from that side, and
          a fragile foal gives up {gc.FRAGILE_DURABILITY_PENALTY} durability potential, about {gc.overallPotential(sound) - gc.overallPotential(fragile)} points of overall potential, and races with more
          risk. If the genes are good enough, that can be a price worth paying. Breed to a sound partner, read the preview, and decide.
        </p>
      </Callout>
      <Callout tone="tip">
        <p>
          A fragile foal can still be a great breeding prospect: with one copy, it passes fragile legs to only half its foals by a sound partner. Consider insuring fragile runners, and see <WikiLink slug="genetics-and-inheritance" />{" "}
          for the rest of what a foal inherits.
        </p>
      </Callout>
    </>
  );
}
