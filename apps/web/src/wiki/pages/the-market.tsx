import * as gc from "@thoroughbred/game-core";
import { RULES } from "@thoroughbred/db";
import { formatCredits } from "@/lib/format";
import { Callout, Facts, Figure, GameLink, H2, HorseCard, HorseRow, Lead, List, P, Steps, Table, WikiLink, appearanceOfGenome, pct, sampleGenome } from "../kit";

const DAY_MS = 86_400_000;

/** One horse at several points in its life, appraised by the game's own gc.appraise. */
function lifeOfALot() {
  const genome = sampleGenome("sales-ring-lot-3");
  const h = gc.createHorseState({ id: "wiki-lot", name: "Lot", sex: "colt", ownerId: "wiki", sireId: null, damId: null, generation: 1, genome, bornAtMs: 0, bornSeason: 1, careSessions: 0 });
  const racing = (starts: number, wins: number, earnings: number, peakOr: number) => ({
    ...h,
    care: { ...h.care, sessions: gc.CARE_TO_RACING },
    career: { ...h.career, starts },
    record: { ...h.record, starts, wins, earnings },
    rating: { ...h.rating, peakOr },
  });
  const proven = racing(gc.PRIME_MAX_STARTS - 6, 4, 9_000, gc.INITIAL_OR + 30);
  const stages: [string, gc.HorseState][] = [
    ["Foal, just arrived", h],
    ["Yearling", { ...h, care: { ...h.care, sessions: gc.CARE_TO_YEARLING } }],
    ["Juvenile, unraced", racing(0, 0, 0, gc.INITIAL_OR)],
    [`Prime, ${proven.record.starts} starts, ${proven.record.wins} wins`, proven],
    [`Veteran, ${gc.PRIME_MAX_STARTS + 4} starts`, { ...proven, career: { ...proven.career, starts: gc.PRIME_MAX_STARTS + 4 }, record: { ...proven.record, starts: gc.PRIME_MAX_STARTS + 4 } }],
    ["Retired to stud, 2 breedings used", { ...proven, career: { ...proven.career, racingRetired: { reason: "choice", atStarts: proven.record.starts } }, breeding: { used: 2, bySeason: [] } }],
  ];
  return { genome, stages, proven };
}

export default function TheMarketPage() {
  const lot = lifeOfALot();
  const price = gc.appraise(lot.proven);
  const fee = gc.marketFee(price);
  const p = gc.DEFAULT_SELLER_POLICY;
  return (
    <>
      <Lead>
        The auction house is where stables buy and sell horses, for Stable Credits only. Every horse for sale is a lot in the Sales Ring, with an asking price its seller chose inside a band set by
        the Club&rsquo;s appraisal.
      </Lead>
      <Figure src="/art/diorama/poster-sales-ring.png" alt="The Sales Ring" caption="The Sales Ring: the lot that closes soonest is led round in its own coat." focus={0.5} />

      <H2 id="buying">Buying a horse</H2>
      <P>
        Open <GameLink href="/market">Horses for sale</GameLink> under Sales. The lot board in the ring shows the next lot: its lot number, its pedigree (&ldquo;by &hellip; out of &hellip;&rdquo;, or
        foundation stock) and the asking price. Below it, the catalogue lists every lot with its stage, starts, rating and seller.
      </P>
      <Steps
        items={[
          <>Pick a lot and check its horse page: revealed ability ranges, form, pedigree and the Genetics panel are all public.</>,
          <>Make sure you have a free stall. A bought horse moves straight into your stable.</>,
          <>Buy at the asking price. The sale happens in one go: you pay, the seller is paid and the horse is yours.</>,
        ]}
      />
      <P>
        A horse you buy can&rsquo;t go back on the market for <b>{Math.round(gc.RESALE_LOCK_MS / 3_600_000)} hours</b> after the sale. The lock only stops it being listed again.
      </P>

      <H2 id="appraisal">The appraisal</H2>
      <P>
        The Club appraises every horse, and that number sets the price band, the insurance premium and the insurance payout. It uses only what the market can see:
      </P>
      <List
        items={[
          <>
            <b>Revealed ability</b>: the middle of each stat&rsquo;s revealed range. Better horses are worth a lot more, and the value climbs faster the higher they go.
          </>,
          <>
            <b>Stage</b>: foals and yearlings are valued below racing horses, veterans and stud horses less again.
          </>,
          <>
            <b>Breedings left</b> out of the lifetime {gc.BREEDINGS_LIFETIME}, <b>wins</b>, <b>earnings</b> and the horse&rsquo;s <b>best rating</b>.
          </>,
        ]}
      />
      <Callout tone="rule" title="What it never uses">
        <p>
          The appraisal never looks at the hidden genes: not the true potentials, not the alleles a horse carries but doesn&rsquo;t show. Two horses with the same revealed ranges and record are
          appraised the same, whatever their genes say. That is where a good eye for pedigree pays.
        </p>
      </Callout>
      <P>One horse the game generated, appraised by the game&rsquo;s own rules at different points in its life:</P>
      <HorseRow>
        <HorseCard appearance={appearanceOfGenome(lot.genome)} name="The example lot" line={`${gc.geneticsLine(lot.genome)}`} size="sm" />
      </HorseRow>
      <Table
        head={["Stage", "Appraisal", "Lowest asking price", "Highest asking price"]}
        rows={lot.stages.map(([label, s]) => [label, formatCredits(gc.appraise(s)), formatCredits(gc.listingFloor(s)), formatCredits(gc.listingCeiling(s))])}
      />
      <P>
        The ranges narrow as a horse grows up and races, so the appraisal of a young horse can move either way as its ability is revealed. A <b>Pedigree Scan</b> narrows them too.
      </P>

      <H2 id="selling">Selling a horse</H2>
      <P>
        On the <b>Sell</b> tab, choose a horse, set a price and how long the listing runs (up to {Math.round(RULES.maxListingMs / DAY_MS)} days). You can cancel any time. While a horse is listed it
        can&rsquo;t race or breed.
      </P>
      <Facts
        rows={[
          ["Lowest asking price", `${pct(gc.LISTING_FLOOR_PERMILLE)} of the appraisal`],
          ["Highest asking price", `${gc.LISTING_CEILING_PERMILLE / 1000}x the appraisal`],
          ["Market fee (burned)", pct(gc.MARKET_FEE_PERMILLE)],
          ["Resale lock after a purchase", `${Math.round(gc.RESALE_LOCK_MS / 3_600_000)} hours`],
          ["Longest listing", `${Math.round(RULES.maxListingMs / DAY_MS)} days`],
          ["Release to the Club pays", `${formatCredits(RULES.releasePayout)} credits`],
        ]}
      />
      <P>
        Example: the prime horse above, listed at its appraisal of <b>{formatCredits(price)}</b>, sells and the seller receives <b>{formatCredits(price - fee)}</b>. The other{" "}
        <b>{formatCredits(fee)}</b> is the market fee, and it leaves the game.
      </P>
      <H2 id="requirements">Who can sell</H2>
      <P>Selling needs an established stable. It keeps the market fair and stops throwaway accounts from moving horses around. The Sell tab shows a checklist:</P>
      <List
        items={[
          <>
            Your account is at least <b>{p.minAgeDays} days</b> old.
          </>,
          <>
            You have run at least <b>{p.minRaces} races</b>.
          </>,
          <>Where the checklist asks for it, a verified email address.</>,
        ]}
      />
      <P>Some horses can&rsquo;t be listed at all. The Sell tab says why next to each one:</P>
      <Table
        head={["Reason", "What it means"]}
        rows={[
          ["Club-bred", "Your starters and free-pack foals stay with the stable that raised them. They can never be sold."],
          ["Foal of a Club-bred parent", "Tradeable once it has run 5 starts."],
          ["Entered in a race", "Wait until the race is run."],
          ["In foal", "She can be sold after foaling."],
          ["On the Legacy Farm", "Retired for good; never sold."],
          ["Bought on the market", `Can be listed again once the ${Math.round(gc.RESALE_LOCK_MS / 3_600_000)}-hour resale lock ends.`],
          ["Price outside the band", `Below ${pct(gc.LISTING_FLOOR_PERMILLE)} or above ${gc.LISTING_CEILING_PERMILLE / 1000}x the appraisal.`],
        ]}
      />
      <P>Two accounts the game has linked to each other can&rsquo;t trade, and you can&rsquo;t buy your own horse.</P>

      <H2 id="release">Release to the Club</H2>
      <P>
        Need a stall and the horse won&rsquo;t sell, or it is Club-bred? From the horse&rsquo;s career panel you can <b>release it to the Club</b>. It joins the Club&rsquo;s string, frees the stall
        straight away and you get <b>{formatCredits(RULES.releasePayout)} credits</b>. Every horse can be released, Club-bred ones too, except one that is entered in a race, listed, or in foal. It
        is for good. For a horse you want to keep but not race, see the <WikiLink slug="legacy-farm">Legacy Farm</WikiLink>.
      </P>
      <Callout tone="tip">
        <p>
          Price near the appraisal to sell fast, or nearer the top of the band for a horse whose hidden genes you rate (a strong pedigree, a coat that carries something rare). Buyers can read the
          Genetics panel and pedigree too. See <WikiLink slug="genetics-and-inheritance" /> and <WikiLink slug="coats-and-markings" />.
        </p>
      </Callout>
      <P>
        More stalls come from <WikiLink slug="facilities" />; foals with published odds come from <WikiLink slug="packs" />.
      </P>
    </>
  );
}
