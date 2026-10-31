import * as gc from "@thoroughbred/game-core";
import { Callout, Facts, GameLink, H2, Lead, List, P, Table, WikiLink } from "../kit";

/** A winning pick's points by rank, for a field of `n`. */
const row = (n: number) => [String(n), ...[1, 2, 3, Math.ceil(n / 2), n].map((r) => (r <= n ? String(gc.pickPoints(r, n)) : "–"))];

export default function PicksAndTipstersPage() {
  return (
    <>
      <Lead>
        Before any Live race goes off you can pick the runner you think will win. A good eye earns points on the weekly tipster table. It is just for fun: there is nothing to stake, and
        points can never be exchanged for anything.
      </Lead>

      <H2 id="picking">Making a pick</H2>
      <P>
        Open any Live race on the <GameLink href="/races">race card</GameLink> and use the Pick box beside the field. You pick one runner per race. Picks open as soon as the race is
        published and close at the off, so you can change your mind until the stalls open. You may pick your own runner, a rival&rsquo;s or a Club horse.
      </P>
      <P>
        Entries close only {Math.round(gc.ENTRY_CLOSE_BEFORE_MS / 1000)} seconds before the off, which is too short to study the final field, so you pick from the runners declared so far.
        The Club fills any empty gates when entries close, and those runners can be picked in the last seconds too. If the horse you picked is withdrawn, or the race is called off, your
        pick doesn&rsquo;t count: no points, and it doesn&rsquo;t break your run of winners.
      </P>

      <H2 id="points">Points</H2>
      <P>
        A losing pick scores nothing and costs nothing. A winning pick scores by how unlikely it looked, using one public rule: the runners in the field at the off are ranked by
        official rating (equal ratings share the better rank). Picking the top-rated winner scores {gc.PICK_POINTS_TOP} points; picking the lowest-rated scores {gc.PICK_POINTS_OUTSIDER}; the
        ranks in between are spread evenly (rounded down). The Pick box shows what each runner would score, from the field declared so far.
      </P>
      <Table head={["Runners", "Top-rated", "2nd", "3rd", "Middle", "Lowest-rated"]} rows={[5, 8, 10, 12].map(row)} caption="Points for a winning pick, by rating rank in the field" />
      <P>
        Points are added only once the race&rsquo;s result is public, after the broadcast, so a pick can never give a result away. If two horses dead-heat for first, a pick on either one
        wins.
      </P>

      <H2 id="tipsters">The tipster table</H2>
      <P>
        The <GameLink href="/tipsters">Tipsters</GameLink> page ranks everyone by points for races run this week. The week starts on Monday at 00:00 UTC, when the table resets. Ties go to
        more winners, then to fewer picks. The top {gc.TIPSTER_BADGE_TOP} with points each week get a badge, counted on your tipster line.
      </P>
      <List
        items={[
          <>This week: your points, place and winners from scored picks.</>,
          <>Best week: your highest weekly score, and your points all time.</>,
          <>Winners in a row: your current run of winning picks and your best run. A void pick doesn&rsquo;t end a run, and nothing is lost when one ends.</>,
          <>Best weeks ever: the {gc.TIPSTER_TABLE_SHOWN > 10 ? 10 : gc.TIPSTER_TABLE_SHOWN} highest weekly scores, one per stable.</>,
        ]}
      />
      <Facts
        rows={[
          ["Picks per race", "One per stable, changeable until the off"],
          ["Winning pick", `${gc.PICK_POINTS_TOP} to ${gc.PICK_POINTS_OUTSIDER} points`],
          ["Losing or void pick", "0 points, nothing lost"],
          ["Table resets", "Monday 00:00 UTC"],
          ["Weekly badge", `Top ${gc.TIPSTER_BADGE_TOP} with points`],
        ]}
      />
      <Callout title="Points only, never money">
        Picks cost nothing and pay nothing. Points can never be exchanged for Stable Credits, USDG, money, prizes or anything else, and they don&rsquo;t count towards the League or the Prize
        Pool. Your horses race the same whoever picks them. See also <WikiLink slug="rivals-and-news">Rivals &amp; news</WikiLink>.
      </Callout>
    </>
  );
}
