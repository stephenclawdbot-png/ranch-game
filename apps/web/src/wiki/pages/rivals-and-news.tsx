import * as gc from "@thoroughbred/game-core";
import { NOTABLE_SALE_CREDITS } from "@thoroughbred/db";
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";
import { formatCredits } from "@/lib/format";
import { Callout, Facts, GameLink, H2, Lead, List, P, Table, WikiLink } from "../kit";

const KIND_LABEL: Record<gc.NewsKind, string> = {
  feature_win: "A Feature or Season Final winner",
  first_big_win: "A horse's first win at Listed level or above",
  photo_finish: "A photo-finish (a nose, a short head or a head) in a Listed, Group or Feature race",
  record_purse: "The richest race settled so far",
  season_champion: "The season's champion stable, when a season ends",
  league_champion: "The top of each League table in the season's last week",
  jockey_claim_out: "An apprentice riding out the claim",
  jockey_retirement_announced: "A jockey announcing retirement",
  jockey_retired: "A jockey retiring",
  sale: `A sale on the market of ${formatCredits(NOTABLE_SALE_CREDITS)} credits or more (the price is public)`,
  claim: "A horse claimed out of a claiming race",
  hall_of_fame: "A Hall of Fame entry",
};

export default function RivalsAndNewsPage() {
  const lengthM = HORSE_LENGTH_MM / 1000;
  return (
    <>
      <Lead>
        Racing is more fun with names in it. The stables you keep running into become your rivals, the horse that keeps pipping yours becomes your nemesis, and the racing news tells everyone
        what happened on the track, as soon as it is public.
      </Lead>

      <H2 id="rivals">Rivals</H2>
      <P>
        A close finish is two runners within a length ({lengthM.toFixed(1)} m) of each other at the line. A stable becomes your rival when your horses have finished close to theirs at least{" "}
        {gc.RIVAL_MIN_CLOSE} times in Live races over the last {gc.RIVAL_WINDOW_DAYS} days. Rivals are ranked by close finishes, then by how often you met, then by the most recent meeting; the
        top {gc.RIVALS_SHOWN} show on your Estate and on your stable page.
      </P>
      <List
        items={[
          <>Head-to-head: meetings, who finished ahead (your best runner against theirs), close finishes and the last meeting with its replay.</>,
          <>Horse against horse: the same record for each of your horses against each of theirs.</>,
          <>
            Your nemesis: the other stable&rsquo;s horse that has beaten yours in close finishes most often (at least {gc.NEMESIS_MIN_BEATS} times). On a racecard it carries a Nemesis tag, and
            runners from your rival stables carry a Rival tag.
          </>,
          <>Every stable has a public page; when you are signed in it shows your record against them.</>,
        ]}
      />
      <Callout title="The Club is nobody's rival">Club horses fill the gates but have no owner, so they never count as rivals or as anyone&rsquo;s nemesis.</Callout>
      <P>
        After a race, once the result is on screen, you may see a line such as &ldquo;You beat Thistle Mead&rsquo;s Copper Comet for the first time in 4 meetings&rdquo;. Nothing about a
        race counts until its broadcast is over, so a rival line can never give a result away.
      </P>

      <H2 id="news">The racing news</H2>
      <P>
        The <GameLink href="/news">news</GameLink> is written from facts the moment they happen: at settlement, a sale or the end of a season. An item about a race appears only once that
        race&rsquo;s broadcast has finished. Each kind of item has {gc.NEWS_TEMPLATES.feature_win.length} or more ways of being written, and an item always reads the same.
      </P>
      <Table head={["News item", "Templates"]} rows={gc.NEWS_KINDS.map((k) => [KIND_LABEL[k], String(gc.NEWS_TEMPLATES[k].length)])} />
      <P>
        The <strong>My stable</strong> tab keeps only items involving your horses, your jockeys and your rivals. A horse&rsquo;s improver step is not news: it shows only on its owner&rsquo;s
        career page. See also <WikiLink slug="hall-and-trophies">Hall of Fame &amp; trophies</WikiLink> and <WikiLink slug="jockeys">Jockeys</WikiLink>.
      </P>
      <Facts
        rows={[
          ["Close finish", `within ${lengthM.toFixed(1)} m (a length)`],
          ["Rival", `${gc.RIVAL_MIN_CLOSE}+ close finishes in ${gc.RIVAL_WINDOW_DAYS} days`],
          ["Nemesis", `${gc.NEMESIS_MIN_BEATS}+ close-finish wins over your horses`],
          ["News kinds", String(gc.NEWS_KINDS.length)],
        ]}
      />
    </>
  );
}
