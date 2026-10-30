import * as gc from "@thoroughbred/game-core";
import { formatCredits } from "@/lib/format";
import { Callout, Facts, GameLink, H2, Lead, List, P, Steps, Table, WikiLink, pct } from "../kit";

/** A worked claim at a few appraisals: the price band and what the owner receives at the appraisal. */
function examples() {
  return [2_000, 4_000, 8_000].map((appraisal) => {
    const band = gc.claimPriceBounds(appraisal);
    const { toOwner, fee } = gc.claimSettlement(appraisal);
    return { appraisal, ...band, toOwner, fee };
  });
}

const MEETING_TIME = gc.MEETING_START_TIMES_UTC[gc.CLAIMING_MEETING_OF_DAY];

export default function ClaimingRacesPage() {
  const rows = examples();
  return (
    <>
      <Lead>
        In a claiming race every runner is for sale. Its owner sets a claim price when entering, and any other stable can claim the horse at that price before the field locks. After the race the
        horse moves to its new stable, whatever the result. The race is the market: a way to sell a horse you don&rsquo;t need and to buy one that has just shown you what it can do.
      </Lead>

      <H2 id="when">When they run</H2>
      <P>
        There is {gc.CLAIMING_RACES_PER_DAY === 1 ? "one claiming race" : `${gc.CLAIMING_RACES_PER_DAY} claiming races`} a day, in the {MEETING_TIME} UTC meeting. It takes the place of one of
        that meeting&rsquo;s three handicaps, and the band changes every day: 0-55, then 50-75, then 70-95. It runs to that handicap&rsquo;s conditions and purse and is called the
        &ldquo;&lt;Course&gt; Claiming Stakes (band)&rdquo;. A calendar race always keeps its place: if one holds that day&rsquo;s band, the claiming race moves to the next band, and on the
        Season Finals&rsquo; day there is none. The race list marks it <b>Claiming</b>.
      </P>

      <H2 id="entering">Entering a horse</H2>
      <Steps
        items={[
          <>
            Open the race from the <GameLink href="/races">race card</GameLink> and enter as usual. The entry sheet asks for a claim price: between {pct(gc.CLAIM_PRICE_MIN_PERMILLE)} and{" "}
            {pct(gc.CLAIM_PRICE_MAX_PERMILLE)} of the horse&rsquo;s appraisal, the same band as a <WikiLink slug="the-market">market listing</WikiLink>.
          </>,
          <>
            Only a horse you could sell for credits today can run: not Club-bred, a starter or a gift horse; past its starts requirement; not on lease or offered for lease; not registered for the
            USDG market or listed; not in foal; and not inside a resale lock. You also need to meet the market&rsquo;s seller requirements.
          </>,
          <>Everything else about the entry is the same: stable entries, any entry fee, race-day extras and the plan.</>,
        ]}
      />
      <Callout tone="rule" title="Injured horses still move">
        <p>
          As in real claiming, a claimed horse goes to its new stable even if it is injured in the race. Only a fatal injury voids the claim, and then the claimant is refunded in full.
        </p>
      </Callout>

      <H2 id="claiming">Claiming a horse</H2>
      <List
        items={[
          <>The racecard shows each runner&rsquo;s claim price and how many claims it has (never who). Press <b>Claim</b> next to a runner while entries are open.</>,
          <>You need a free stall (a claim holds one until it is decided) and the credits: the price is held in escrow from the moment you claim.</>,
          <>You can&rsquo;t claim your own horse or a horse of an account linked to yours (the same rule as the market). One claim per stable in each claiming race.</>,
          <>If several stables claim the same horse, a draw at the lock decides, made from the race&rsquo;s sealed seed so it can be checked afterwards. Losing claims are refunded at once.</>,
          <>If the horse is scratched or the race is abandoned, every claim is refunded.</>,
        ]}
      />

      <H2 id="after">After the race</H2>
      <P>
        At settlement the horse moves to the winning claimant. The old owner keeps any purse the horse won in this race and receives the claim price less the market&rsquo;s{" "}
        {pct(gc.MARKET_FEE_PERMILLE)} fee, which is burned. Both stables get a note in the inbox. The new owner can&rsquo;t sell the horse for {gc.RESALE_LOCK_MS / 3_600_000} hours (the
        resale lock), and the horse can&rsquo;t run in another claiming race for {gc.CLAIM_REENTRY_LOCK_DAYS} days.
      </P>
      <Table
        head={["Appraisal", "Lowest price", "Highest price", "Claimed at the appraisal: owner gets", "Burned"]}
        rows={rows.map((r) => [formatCredits(r.appraisal), formatCredits(r.min), formatCredits(r.max), formatCredits(r.toOwner), formatCredits(r.fee)])}
        caption="Credits only move between the claimant, the old owner and the burn: a claim never creates credits."
      />
      <Facts
        rows={[
          ["Claiming races a day", String(gc.CLAIMING_RACES_PER_DAY)],
          ["Meeting", `${MEETING_TIME} UTC`],
          ["Claim price", `${pct(gc.CLAIM_PRICE_MIN_PERMILLE)}–${pct(gc.CLAIM_PRICE_MAX_PERMILLE)} of appraisal`],
          ["Fee (burned)", pct(gc.MARKET_FEE_PERMILLE)],
          ["Resale lock", `${gc.RESALE_LOCK_MS / 3_600_000} h`],
          ["Claiming re-entry lock", `${gc.CLAIM_REENTRY_LOCK_DAYS} days`],
        ]}
      />
    </>
  );
}
