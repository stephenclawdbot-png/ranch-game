import * as gc from "@thoroughbred/game-core";
import { Callout, Facts, Figure, GameLink, H2, HorseCard, HorseRow, Lead, List, P, Table, WikiLink, appearanceOfGenome, pct, sampleGenome } from "../kit";

/** A real pairing's fragile-legs chance, as the breeding preview shows it, with and without injured parents. */
function fragileExample() {
  const sire = sampleGenome("stud-sire-2");
  const dam = sampleGenome("stud-dam-5");
  return {
    sire,
    dam,
    rows: [
      ["Neither parent injured", gc.fragileChance(sire, dam, {})],
      ["The sire retired injured", gc.fragileChance(sire, dam, { sire: true })],
      ["Both retired injured", gc.fragileChance(sire, dam, { sire: true, dam: true })],
    ] as [string, number][],
  };
}

export default function StudAndBroodmaresPage() {
  const ex = fragileExample();
  return (
    <>
      <Lead>
        When a racehorse stops racing, its second career begins. A stallion goes <b>to stud</b>, a mare becomes a <b>broodmare</b>: no more races, but it stays in your stable and can breed
        until its lifetime breedings are used up. It is how a good racehorse keeps paying you back.
      </Lead>
      <Figure src="/art/diorama/poster-pasture.png" alt="Broodmares and foals in the pasture" caption="Broodmares and their foals out on the Ranch." focus={0.6} />

      <H2 id="ending-racing">Ending a racing career</H2>
      <P>
        On a horse&rsquo;s Career tab, under Decisions, the button depends on the horse. Whichever it is, it ends the racing career now, and it is final: the horse never races again.
      </P>
      <Table
        head={["Horse", "Button", "Afterwards"]}
        rows={[
          ["Colt or stallion", "Send to stud", `At stud: breeds up to ${gc.BREEDINGS_LIFETIME} times in its life, ${gc.STALLION_PER_SEASON} coverings a season at most.`],
          ["Filly or mare", "Make a broodmare", `A broodmare: breeds up to ${gc.BREEDINGS_LIFETIME} times in her life, ${gc.MARE_PER_SEASON} covering a season.`],
          ["Gelding", "End racing", "Geldings don't breed. It stays in your stable until you retire it for good."],
        ]}
      />
      <List
        items={[
          <>You can do it at any point of the career, but not while the horse is entered in a race.</>,
          <>
            A horse that runs all {gc.CAREER_MAX_STARTS} starts goes to stud or becomes a broodmare on its own. See <WikiLink slug="racing-career" />.
          </>,
          <>The horse keeps its stall, its record, its rating and its name.</>,
        ]}
      />

      <H2 id="breeding">Breeding after racing</H2>
      <HorseRow>
        <HorseCard appearance={appearanceOfGenome(ex.sire)} name="At stud" line="A stallion's second career" size="sm" />
        <HorseCard appearance={appearanceOfGenome(ex.dam)} name="Broodmare" line="A mare's second career" size="sm" />
      </HorseRow>
      <P>
        A racing horse has to reach {gc.BREED_FROM_STARTS} starts before it can breed. A horse at stud or a broodmare can breed straight away, whatever its starts. Every horse has{" "}
        {gc.BREEDINGS_LIFETIME} breedings in its life, counting any it used while still racing; the Career tab shows how many are left.
      </P>
      <List
        items={[
          <>
            Cover your broodmares from <GameLink href="/breeding">Breeding</GameLink>, with your own stallion (no stud fee), another stable&rsquo;s or a Club stud.
          </>,
          <>A stallion of yours can also stand at public stud for other stables at a fee you set. Each visiting mare uses one of his breedings.</>,
          <>
            Once a horse has used all {gc.BREEDINGS_LIFETIME} breedings it retires for good to the <WikiLink slug="legacy-farm">Legacy Farm</WikiLink> on its own, freeing its stall: a
            stallion straight after his last covering, a mare once her last foal is born. You get a note in your inbox.
          </>,
        ]}
      />
      <Facts
        rows={[
          ["Breedings in a lifetime", gc.BREEDINGS_LIFETIME],
          ["Stallion: coverings per season", gc.STALLION_PER_SEASON],
          ["Mare: coverings per season", gc.MARE_PER_SEASON],
          ["Racing horses may breed from", `${gc.BREED_FROM_STARTS} starts`],
          ["At stud or broodmare: may breed from", "straight away"],
          ["A season lasts", `${gc.SEASON_DAYS} days`],
        ]}
      />
      <Callout tone="tip">
        <p>
          You don&rsquo;t have to wait for {gc.CAREER_MAX_STARTS} starts. A horse with a strong record and good genes is often worth more at stud than in its veteran years.
        </p>
      </Callout>

      <H2 id="injury">After a career-ending injury</H2>
      <P>
        A career-ending injury retires a horse from racing on the spot: a stallion goes to stud, a mare becomes a broodmare, just as if you had chosen it. It can still breed, and if it
        was insured the insurance pays out (<WikiLink slug="injuries-and-insurance" />).
      </P>
      <P>
        There is a catch. A parent whose career ended in an injury passes <WikiLink slug="fragile-legs" /> to each foal {pct(gc.FRAGILE_FROM_INJURY_PERMILLE)} of the time, on top of any fragile
        gene it already carries. The breeding preview shows the chance before you pay. For these two real horses:
      </P>
      <Table head={["Pairing", "Chance the foal has fragile legs"]} rows={ex.rows.map(([k, v]) => [k, pct(v)])} />
      <Callout tone="gamble">
        <p>
          Breeding from an injured champion is a gamble on the bloodline against the legs. Fragile legs raise a horse&rsquo;s injury risk for its whole career, so weigh the preview&rsquo;s odds
          before you cover.
        </p>
      </Callout>
      <P>
        The basics of pairing, fees and foaling are on <WikiLink slug="breeding-basics" />.
      </P>
    </>
  );
}
