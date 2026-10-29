import * as gc from "@thoroughbred/game-core";
import { RULES } from "@thoroughbred/db";
import { formatCredits } from "@/lib/format";
import { Callout, Facts, Figure, H2, Lead, List, P, Steps, Table, WikiLink, pct, sampleGenome } from "../kit";

/** How rare a fatal injury is for one real, rested horse on a normal ride in a Live race. */
function fatalOdds() {
  const genome = sampleGenome("legacy-odds");
  const born = gc.createHorseState({ id: "wiki-legacy", name: "Example", sex: "filly", ownerId: "wiki", sireId: null, damId: null, generation: 0, genome, bornAtMs: 0, bornSeason: 1, careSessions: gc.CARE_TO_RACING });
  const state: gc.HorseState = { ...born, career: { ...born.career, starts: gc.JUVENILE_MAX_STARTS + 4 } };
  const risk = gc.injuryRisk(state, { nowMs: 0, going: "good", distanceM: 1600, intensity: "normal", stage: gc.stageOf(state) });
  // permille × permille × permille → chance per start in 1e-9 units
  const perBillion = risk.permille * risk.careerEndingShare * gc.FATAL_SHARE_OF_CAREER_ENDING;
  return { risk, oneIn: perBillion > 0 ? Math.round(1e9 / perBillion) : null };
}

export default function LegacyFarmPage() {
  const odds = fatalOdds();
  return (
    <>
      <Lead>
        The Legacy Farm is where horses go when their working life is over. A horse retired here never races or breeds again, takes no stall and costs nothing, ever. It is never deleted: its
        record, its foals and its place in the Hall of Fame stay with your stable for good.
      </Lead>
      <Figure src="/art/diorama/pasture-far.png" alt="Rolling farmland with a fenced paddock and a farmhouse" caption="The Legacy Farm: open country, no stalls, no bills." height={160} focus={0.5} />

      <H2 id="retire-for-good">Retire for good</H2>
      <P>
        Any horse can be sent to the Legacy Farm from the Decisions section of its Career tab, with the <b>Retire for good</b> button: a racehorse, a stallion at stud, a broodmare or a gelding.
      </P>
      <Table
        head={["", "At stud or broodmare", "On the Legacy Farm"]}
        rows={[
          ["Races", "No", "No"],
          ["Breeds", `Yes, until its ${gc.BREEDINGS_LIFETIME} lifetime breedings are used`, "No"],
          ["Uses a stall", "Yes", "No"],
          ["Upkeep", "None", "None"],
          ["Can be undone", "No (it never races again)", "No"],
        ]}
      />
      <List
        items={[
          <>It frees the horse&rsquo;s stall straight away, so a foal waiting in the nursery can move in.</>,
          <>It can&rsquo;t happen while the horse is entered in a race or listed for sale, or while a mare is in foal: wait until she has foaled.</>,
          <>The horse keeps its page, its race record and its family tree, and its foals still name it as sire or dam.</>,
          <>Horses are never deleted from the game.</>,
        ]}
      />
      <Callout tone="warn">
        <p>Retiring for good is permanent. A horse on the Legacy Farm can never race or breed again, even if it had breedings left. Use up the breedings you want first.</p>
      </Callout>

      <H2 id="release">Or release to the Club</H2>
      <P>
        The other way to free a stall is <b>Release to the Club</b>: the horse leaves your stable for the Club&rsquo;s string and you receive {formatCredits(RULES.releasePayout)} credits. Unlike
        the Legacy Farm, the horse is no longer yours. Horses you can&rsquo;t sell, such as Club-bred ones, can always be released.
      </P>
      <Facts
        rows={[
          ["Stall used on the Legacy Farm", "none"],
          ["Upkeep on the Legacy Farm", "none, ever"],
          ["Credits for releasing a horse to the Club", formatCredits(RULES.releasePayout)],
          ["Lifetime breedings before a stud horse has nothing left", gc.BREEDINGS_LIFETIME],
        ]}
      />

      <H2 id="in-memoriam">In memoriam</H2>
      <P>
        Very rarely, a career-ending injury in a Live race is fatal: {pct(gc.FATAL_SHARE_OF_CAREER_ENDING)} of career-ending injuries, and only in Live races. Story races, the Daily Cup and
        training never kill a horse.
        {odds.oneIn !== null && (
          <>
            {" "}
            For one real horse in its prime ({odds.risk.factors[0]!.text.toLowerCase()}), rested and ridden normally over a mile on good ground, that is about one Live start in {odds.oneIn.toLocaleString("en-GB")}.
          </>
        )}
      </P>
      <Steps
        items={[
          <>Your inbox says so plainly: the horse was fatally injured, in which race.</>,
          <>The horse moves to the Legacy Farm at once. It frees its stall and can never race or breed again.</>,
          <>Its Career tab reads &ldquo;In memoriam&rdquo;, and your Trophy Room marks it the same way among your stars.</>,
          <>If it was insured, the insurance pays out as for any career-ending injury.</>,
          <>Its record, its Hall of Fame entries and any foals it left carry the line on.</>,
        ]}
      />
      <Callout tone="tip">
        <p>
          The risk is shown on the entry sheet before every race. An Easy ride, a rested horse and good ground all bring it down; an all-out ride on a tired veteran pushes it up. See{" "}
          <WikiLink slug="entering-a-race" /> and <WikiLink slug="injuries-and-insurance" />.
        </p>
      </Callout>

      <H2 id="legends">Legends never leave the Hall</H2>
      <P>
        A horse inducted into the Hall of Fame keeps its place there forever, wherever it is now: racing, at stud, on the Legacy Farm or in memoriam. See <WikiLink slug="hall-and-trophies" />.
        Before a horse gets here, it has usually had a second career: <WikiLink slug="stud-and-broodmares" />.
      </P>
    </>
  );
}
