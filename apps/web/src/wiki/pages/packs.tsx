import * as gc from "@thoroughbred/game-core";
import { formatCredits } from "@/lib/format";
import { Callout, Facts, Figure, GameLink, H2, HorseCard, HorseRow, Lead, List, P, Table, WikiLink, appearanceOfGenome } from "../kit";

/** Same words and colours as the Packs screen. */
const RARITY_LABEL: Record<gc.Rarity, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary" };
const RARITY_COLOR: Record<gc.Rarity, string> = { common: "#a9bda9", uncommon: "#9fe0a8", rare: "#7fc3ee", epic: "#d3a6ff", legendary: "#f2c86a" };

const PULLS = 20;

/** Twenty Paddock pulls in a row through gc.pullPack, from a fixed sealed seed (one that shows the pity rule firing). */
function pullRun() {
  let best: { rarity: gc.Rarity; pity: boolean; genome: gc.Genome }[] = [];
  for (let s = 0; s < 20; s++) {
    let pity = gc.NEW_PITY;
    const run: { rarity: gc.Rarity; pity: boolean; genome: gc.Genome }[] = [];
    for (let i = 0; i < PULLS; i++) {
      const r = gc.pullPack("paddock", pity, { serverSeed: gc.sha256Hex(`wiki-packs-${s}`), accountId: "wiki", season: 1 });
      pity = r.pity;
      run.push({ rarity: r.pull.rarity, pity: r.pull.pityTriggered !== "none", genome: r.pull.genome });
    }
    best = run;
    if (run.some((p) => p.pity)) break;
  }
  return best;
}

export default function PacksPage() {
  const run = pullRun();
  const paddockPity = gc.PACK_PITY.paddock[0]!;
  const firstUncommon = run.find((p) => p.rarity !== "common") ?? run[0]!;
  const firstCommon = run.find((p) => p.rarity === "common") ?? run[0]!;
  const ceiling = gc.packCeiling(1);
  return (
    <>
      <Lead>
        A pack is a young horse. You open it for Stable Credits (or free, every few days you play), and out comes a foal with genes no one has seen before. The odds are published, a pity counter
        guarantees a better foal if luck runs dry, and every pull is sealed so you can check it was fair.
      </Lead>
      <Figure src="/art/ui/pack-paddock.png" alt="A Paddock Pack" caption="The Paddock Pack, on the Packs screen under Sales." height={160} contain />

      <H2 id="paddock-pack">The Paddock Pack</H2>
      <List
        items={[
          <>
            <b>Bought:</b> {formatCredits(gc.PADDOCK_PACK_PRICE)} credits, up to {gc.PADDOCK_CREDIT_BUYS_PER_WEEK} a week. The weekly count resets on Monday (UTC).
          </>,
          <>
            <b>Free:</b> one every {gc.FREE_PADDOCK_EVERY_PLAY_DAYS}rd day you play. The days don&rsquo;t need to be in a row, and unopened free packs wait for you.
          </>,
          <>
            <b>Inside:</b> one foal, Common or Uncommon.
          </>,
        ]}
      />
      <Table head={["Rarity", "Chance"]} rows={gc.oddsTable("paddock").map((o) => [<span key={o.rarity} style={{ color: RARITY_COLOR[o.rarity] }}>{RARITY_LABEL[o.rarity]}</span>, o.percent])} />
      <P>
        Packs never contain credits, and credits are never cashed out. A free-pack foal is <b>Club-bred</b>: it stays with your stable and can&rsquo;t be sold. A foal from a pack you bought is yours to
        keep, race or sell at <WikiLink slug="the-market">the auction house</WikiLink>.
      </P>

      <H2 id="pity">The pity counter</H2>
      <P>
        Pity is a guarantee. The Paddock Pack promises <b>{RARITY_LABEL[paddockPity.min]} or better within {paddockPity.within} pulls</b>: if the last {paddockPity.within - 1} were all Common, the next
        one is {RARITY_LABEL[paddockPity.min]} whatever the roll says. Any {RARITY_LABEL[paddockPity.min]}, rolled or guaranteed, sets the counter back to zero. The pack card shows where you stand:
        how many pulls since the last one and how soon the guarantee kicks in.
      </P>
      <P>Here are {PULLS} Paddock pulls in a row, rolled by the game&rsquo;s own pack code from one sealed seed. The ringed pull is one the pity counter decided:</P>
      <ol className="flex flex-wrap gap-1.5" aria-label={`${PULLS} pulls in a row`}>
        {run.map((p, i) => (
          <li
            key={i}
            className="inset grid min-w-[3.25rem] place-items-center px-1.5 py-1 text-center text-xs font-extrabold"
            style={{ color: RARITY_COLOR[p.rarity], outline: p.pity ? `3px solid ${RARITY_COLOR[p.rarity]}` : undefined }}
            title={`Pull ${i + 1}: ${RARITY_LABEL[p.rarity]}${p.pity ? " (pity)" : ""}`}
          >
            <span className="score text-cream-dim">{i + 1}</span>
            {RARITY_LABEL[p.rarity]}
            {p.pity && <span className="caption">pity</span>}
          </li>
        ))}
      </ol>
      <Callout tone="rule" title="Pity never changes the odds">
        <p>
          Each roll uses the published odds. Pity only steps in after a run of bad luck, and the pull&rsquo;s record says when it did (&ldquo;pity ({RARITY_LABEL[paddockPity.min]} guarantee)&rdquo; in
          your pull history).
        </p>
      </Callout>

      <H2 id="the-foal">What you get</H2>
      <P>
        Every pack is a <b>foal</b>. It needs {gc.CARE_TO_RACING} days of care before it can race (see <WikiLink slug="growing-up" />), and like every foundation horse it has no recorded parents:
        fresh blood for your breeding, with no inbreeding at all. Its rarity comes from its genes, from its average potential:
      </P>
      <HorseRow>
        <HorseCard appearance={appearanceOfGenome(firstCommon.genome)} name={RARITY_LABEL[firstCommon.rarity]} line={`Average potential ${gc.meanPotential(firstCommon.genome)}`} size="sm" />
        <HorseCard appearance={appearanceOfGenome(firstUncommon.genome)} name={RARITY_LABEL[firstUncommon.rarity]} line={`Average potential ${gc.meanPotential(firstUncommon.genome)}`} size="sm" />
      </HorseRow>
      <Table
        head={["Rarity", "Average potential"]}
        rows={gc.RARITY_ORDER.map((r) => {
          const [lo, hi] = gc.RARITY_MINT_BANDS[r];
          return [<span key={r} style={{ color: RARITY_COLOR[r] }}>{RARITY_LABEL[r]}</span>, r === "legendary" ? `${lo} and up` : `${lo} to ${hi - 1}`];
        })}
      />
      <P>
        No pack foal has a stat above the season ceiling: <b>{ceiling}</b> in the first season, rising by {gc.CEILING_STEP_PER_SEASON} a season (up to {gc.CEILING_MAX_STEPS} times) so later players aren&rsquo;t left behind. Bred
        horses have no such cap: the best horses in the game are bred, not pulled. See <WikiLink slug="genetics-and-inheritance" />.
      </P>
      <Facts
        rows={[
          ["Paddock Pack price", `${formatCredits(gc.PADDOCK_PACK_PRICE)} credits`],
          ["Bought Paddock Packs per week", gc.PADDOCK_CREDIT_BUYS_PER_WEEK],
          ["Free Paddock Pack", `every ${gc.FREE_PADDOCK_EVERY_PLAY_DAYS} play days`],
          ["Pity", `${RARITY_LABEL[paddockPity.min]}+ within ${paddockPity.within}`],
          ["Highest stat on a pack foal (season 1)", ceiling],
          ["Foals from packs per season, all stables", formatCredits(gc.SEASON_FOAL_CROP_CAP)],
        ]}
      />

      <H2 id="limits">Stalls and the foal crop</H2>
      <List
        items={[
          <>
            Opening a pack needs a <b>free stall</b>. If your stalls are full, free one or build another (see <WikiLink slug="facilities" />).
          </>,
          <>
            Every season has one <b>foal crop</b> shared by all stables: {formatCredits(gc.SEASON_FOAL_CROP_CAP)} pack foals. The Packs screen shows how many are left. When it is gone, packs reopen
            with the next season&rsquo;s crop. Bred foals don&rsquo;t count.
          </>,
        ]}
      />

      <H2 id="fair">Sealed pulls you can check</H2>
      <P>
        Before you open a pack, the screen shows the <b>seal</b> of your next pull: a fingerprint of a secret seed that is fixed in advance. After the pull the seed is revealed. Press{" "}
        <b>Verify</b> on any pull in your history and the game recomputes the roll, the pity step and the foal&rsquo;s genes from that seed, so you can see nothing was changed after the fact.
      </P>
      <P>
        The screen also shows a <b>Premium Pack</b> with its own odds (up to {RARITY_LABEL.legendary}) and a second pity level. It is a preview for now: there is nothing to buy.
      </P>
      <Callout tone="tip">
        <p>
          Play a little on most days and the free Paddock Packs add up. A pack foal is also the cheapest outcross there is: no shared ancestors with anything in your stable. See{" "}
          <WikiLink slug="inbreeding" /> and <GameLink href="/packs">open the Packs screen</GameLink>.
        </p>
      </Callout>
    </>
  );
}
