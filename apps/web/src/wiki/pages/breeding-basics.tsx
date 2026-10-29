import * as gc from "@thoroughbred/game-core";
import { formatCredits } from "@/lib/format";
import { Callout, Facts, Figure, GameLink, H2, Lead, List, P, Steps, Table, WikiLink } from "../kit";

const HOURS = (ms: number) => Math.round(ms / 3_600_000);

export default function BreedingBasicsPage() {
  const ownStud = gc.breedingFees(0, true);
  const example = gc.breedingFees(2_000, false);
  return (
    <>
      <Lead>
        Breeding is how a stable gets better than the horses it started with. You pair a stallion with a mare, the foal arrives a day later, and its genes are a fresh roll of both parents. Good
        lines compound over generations; bad luck is part of it too.
      </Lead>
      <Figure src="/art/diorama/poster-pasture.png" alt="Mares and foals turned out in the paddock" caption="Your mares and youngstock live out on the Ranch between races." focus={0.62} />

      <H2 id="who-can-breed">Who can breed</H2>
      <List
        items={[
          <>
            Horses must have reached <b>racing age</b> (all {gc.CARE_TO_RACING} care sessions as a youngster done).
          </>,
          <>
            A racing horse can breed once it has run <b>{gc.BREED_FROM_STARTS} starts</b>. Any horse sent to stud (stallion) or made a broodmare (mare) can breed straight away. See{" "}
            <WikiLink slug="stud-and-broodmares" />.
          </>,
          <>
            Geldings never breed. Horses retired for good to the <WikiLink slug="legacy-farm" /> never breed again.
          </>,
          <>
            Every horse has <b>{gc.BREEDINGS_LIFETIME} breedings</b> in its lifetime. When they are used up, a horse at stud retires for good.
          </>,
          <>
            Close relatives can&rsquo;t be paired (parent and child, full siblings), and related pairings carry an inbreeding cost: <WikiLink slug="inbreeding" />.
          </>,
        ]}
      />
      <Facts
        rows={[
          ["Mare: coverings per season", gc.MARE_PER_SEASON],
          ["Stallion: coverings per season", gc.STALLION_PER_SEASON],
          ["Breedings per lifetime", gc.BREEDINGS_LIFETIME],
          ["Racing starts before a racing horse can breed", gc.BREED_FROM_STARTS],
          ["Pregnancy", `${HOURS(gc.PREGNANCY_MS)} hours`],
          ["A season lasts", `${gc.SEASON_DAYS} days`],
        ]}
      />

      <H2 id="how-to">How to breed a foal</H2>
      <Steps
        items={[
          <>
            Open <GameLink href="/breeding">Breeding</GameLink> under Stable and pick a mare.
          </>,
          <>
            Choose a stallion: one of your own (no stud fee), another stable&rsquo;s stallion at stud, or a Club stud.
          </>,
          <>
            Read the <b>preview</b>: the foal&rsquo;s likely potential, its chance to beat or fall below both parents, coat odds, the family limits, inbreeding and the fragile-legs chance. See{" "}
            <WikiLink slug="genetics-and-inheritance" />.
          </>,
          <>Pay the fees and cover the mare. The foal&rsquo;s genes are sealed at this moment and can be verified later.</>,
          <>
            {HOURS(gc.PREGNANCY_MS)} hours later the foal is due. Name it and it moves into a free stall, or the nursery if your stalls are full.
          </>,
          <>
            Raise it with daily care until racing age: <WikiLink slug="growing-up" />.
          </>,
        ]}
      />

      <H2 id="fees">Fees</H2>
      <P>
        Every covering costs a platform fee of <b>{formatCredits(gc.BREEDING_BASE_FEE)}</b> credits, which leaves the game. Using another stable&rsquo;s stallion adds its stud fee; that owner
        receives the fee less a {gc.STUD_FEE_BURN_PERMILLE / 10}% cut.
      </P>
      <Table
        head={["Covering", "You pay", "Stallion owner gets", "Leaves the game"]}
        rows={[
          ["Your own stallion", formatCredits(ownStud.totalPaidByMareOwner), "–", formatCredits(ownStud.burned)],
          [`Another stable's stallion, fee ${formatCredits(example.studFee)}`, formatCredits(example.totalPaidByMareOwner), formatCredits(example.toStallionOwner), formatCredits(example.burned)],
        ]}
      />

      <H2 id="stand-at-stud">Standing a stallion at stud</H2>
      <P>
        A stallion of yours can stand at stud for other stables at a fee you choose (or free). Each visiting mare uses one of his coverings for the season and one of his lifetime breedings, and
        you earn the fee. Stallions with a strong race record and good genes get the bookings.
      </P>

      <H2 id="foals">Where foals go</H2>
      <P>
        Foals need a stall. If every stall is taken they wait in the <GameLink href="/nursery">nursery</GameLink> and move in as soon as one frees up. More stalls come from{" "}
        <WikiLink slug="facilities" />.
      </P>
      <Callout tone="gamble">
        <p>
          Breeding is never a sure thing. In the game&rsquo;s own tests, about half of good × good foals came out below both parents, and almost as many beat both. The preview gives the exact odds
          for your pairing before you pay.
        </p>
      </Callout>
    </>
  );
}
