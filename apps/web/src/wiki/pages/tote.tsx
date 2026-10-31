import * as gc from "@thoroughbred/game-core";
import { Callout, Facts, GameLink, H2, Lead, List, P, Table, WikiLink, pct } from "../kit";

const cr = (n: number) => gc.formatToteAmount("CR", n);
const usdg = (n: number) => gc.formatToteAmount("TUSDG", n);

/** A worked WIN pool, settled by the game's own code. */
function example() {
  const finish = Array.from({ length: 8 }, (_, i) => ({ horseId: `h${i + 1}`, position: i + 1 }));
  const bets = [
    { id: "a", horseId: "h1", stake: 100 },
    { id: "b", horseId: "h1", stake: 300 },
    { id: "c", horseId: "h2", stake: 600 },
    { id: "d", horseId: "h3", stake: 1_000 },
  ];
  return gc.settleTotePool("win", bets, finish);
}

/** Two runners dead-heat for first: each takes half the net pool. */
function deadHeat() {
  const finish = [
    { horseId: "h1", position: 1 },
    { horseId: "h2", position: 1 },
    ...Array.from({ length: 6 }, (_, i) => ({ horseId: `h${i + 3}`, position: i + 3 })),
  ];
  return gc.settleTotePool("win", [
    { id: "a", horseId: "h1", stake: 100 },
    { id: "b", horseId: "h2", stake: 300 },
    { id: "c", horseId: "h3", stake: 600 },
  ], finish);
}

export default function TotePage() {
  const ex = example();
  const dh = deadHeat();
  const paid = (s: gc.ToteSettlement, id: string) => s.payouts.find((p) => p.betId === id)?.amount ?? 0;
  return (
    <>
      <Lead>
        Every Live card race has a tote: pool betting for anyone watching. You back a runner to win or to place, your stake goes into a pool with everyone else&rsquo;s, the house takes{" "}
        {pct(gc.TOTE_TAKEOUT_PERMILLE)} off the top, and the winners share the rest. Nobody sets the odds: they come from the pool alone, and they move as bets arrive until the off. Betting is
        optional, never needed to play, and only ever pays out game currency.
      </Lead>

      <Facts
        rows={[
          ["House take", `${pct(gc.TOTE_TAKEOUT_PERMILLE)} of every pool (to the sink)`],
          ["Pools", "Win, and Place in fields of 5 or more"],
          ["Place pays", `the first ${gc.totePlaces(gc.TOTE_PLACE_THREE_FROM)} from ${gc.TOTE_PLACE_THREE_FROM} runners, the first ${gc.totePlaces(gc.TOTE_PLACE_MIN_FIELD)} from ${gc.TOTE_PLACE_MIN_FIELD} to ${gc.TOTE_PLACE_THREE_FROM - 1}`],
          ["Smallest bet", `${cr(gc.TOTE_MIN_STAKE.CR)} · ${usdg(gc.TOTE_MIN_STAKE.TUSDG)}`],
          ["Most per race", `${cr(gc.TOTE_MAX_STAKE_PER_RACE.CR)} or ${pct(gc.TOTE_MAX_STAKE_BALANCE_PERMILLE)} of your balance, whichever is lower · ${usdg(gc.TOTE_MAX_STAKE_PER_RACE.TUSDG)}`],
          ["Most per day", `${cr(gc.TOTE_MAX_STAKE_PER_DAY.CR)} · ${usdg(gc.TOTE_MAX_STAKE_PER_DAY.TUSDG)}`],
          ["Betting closes", "at the off (post time); never during a race"],
        ]}
      />

      <H2 id="pools">Pools and odds</H2>
      <P>
        Each race has a <b>Win</b> pool (your runner must win) and, when at least {gc.TOTE_PLACE_MIN_FIELD} run, a <b>Place</b> pool (your runner must finish in the first{" "}
        {gc.totePlaces(gc.TOTE_PLACE_THREE_FROM)} with {gc.TOTE_PLACE_THREE_FROM} or more runners, the first {gc.totePlaces(gc.TOTE_PLACE_MIN_FIELD)} with {gc.TOTE_PLACE_MIN_FIELD} to{" "}
        {gc.TOTE_PLACE_THREE_FROM - 1}). Credits and T-USDG have separate pools that never mix.
      </P>
      <P>
        The odds on the panel are the pool&rsquo;s own maths: <b>odds = pool × (1 − {pct(gc.TOTE_TAKEOUT_PERMILLE)}) ÷ the stakes on that runner</b>, as decimal odds (what 1 returns, stake
        included). For Place it is divided again by the number of paying places (or by the number of runners backed, when fewer are): exact when the other placed runners are backed, higher when one of them isn&rsquo;t. The share bar shows how much of the pool is on
        each runner. The odds change with every bet until the off, so the return shown on your bet slip is labelled as an estimate; the final odds freeze at the off and show under the broadcast
        while the race runs.
      </P>
      <Callout tone="rule" title="Pure pool betting">
        <p>
          The game never bets, never sets a price and never takes the other side of your bet. The Club doesn&rsquo;t bet either. Whatever happens, everything in a pool is either paid to the
          winners or kept as the take: the house can&rsquo;t win or lose on a result.
        </p>
      </Callout>

      <H2 id="settlement">How winnings are worked out</H2>
      <List
        items={[
          <>The take is {pct(gc.TOTE_TAKEOUT_PERMILLE)} of the pool, rounded down. What is left is the net pool.</>,
          <>Win: the net pool goes to the winner&rsquo;s backers, each in proportion to their stake.</>,
          <>Place: the net pool is split into equal parts, one per paying place; each part goes to the backers of the runner in that place. If nobody backed one of the placed runners, its part goes to the other placed runners&rsquo; backers.</>,
          <>Every payout is rounded down to the unit; the few units left over go to the house with the take, so payouts + take + rounding = the pool, exactly.</>,
          <>Bets are settled only once the result is public, when the broadcast is over: a payout can never give away a result before you have seen the race.</>,
        ]}
      />
      <Table
        caption={`A worked Win pool of ${cr(ex.total)} (computed by the game's own settlement code)`}
        head={["Bet", "Stake", "Runner finished", "Paid back"]}
        rows={[
          ["A", cr(100), "1st", cr(paid(ex, "a"))],
          ["B", cr(300), "1st", cr(paid(ex, "b"))],
          ["C", cr(600), "2nd", cr(0)],
          ["D", cr(1_000), "3rd", cr(0)],
          ["House take", "", "", `${cr(ex.takeout)} + ${cr(ex.remainder)} rounding`],
        ]}
      />
      <P>
        Here the dividend is {gc.formatToteOdds(ex.dividends[0]?.perUnitMilli ?? null)} per credit: ({cr(ex.total)} − {cr(ex.takeout)}) ÷ {cr(400)} on the winner.
      </P>

      <H2 id="dead-heats">Dead heats</H2>
      <P>
        When runners dead-heat they share the places they cover. Two dead-heating for first in the Win pool each take half of the net pool for their backers; two dead-heating for the last
        paying place in the Place pool share that place&rsquo;s part. In a pool of {cr(dh.total)} where the two dead-heaters carry {cr(100)} and {cr(300)}, each side gets {cr(paid(dh, "a"))}: the{" "}
        {cr(100)} backer is paid {cr(paid(dh, "a"))} and the {cr(300)} backers {cr(paid(dh, "b"))} between them. Races in this game are timed finely, so dead heats are very rare; the rule is
        there for completeness.
      </P>

      <H2 id="refunds">Refunds</H2>
      <List
        items={[
          <>A runner taken out before the off (scratched, or scratched at the lock): every stake on it is refunded in full, and it leaves the pool.</>,
          <>An abandoned or called-off race: every stake is refunded in full, with no take.</>,
          <>Nobody backed the winner (or any placed runner): the net pool goes back to everyone who bet in that pool, in proportion to their stakes. Nothing carries over to another race.</>,
          <>Too few runners for a place pool when the race runs: every place stake is refunded in full.</>,
          <>A bet that turns out to break the fairness rules below is voided and refunded in full.</>,
        ]}
      />

      <H2 id="fairness">Fairness rules</H2>
      <List
        items={[
          <>You can&rsquo;t bet on a race in which your stable has a runner, or a stable you lease a horse to or from, or an account linked to yours (the same detection as the <WikiLink slug="the-market">auction house</WikiLink>).</>,
          <>If such a horse is entered after you bet, your bets on that race are voided and refunded.</>,
          <>Bets are accepted only before the off, checked against the server&rsquo;s clock under a lock on the race, so nothing can be bet once the race has started. Each race&rsquo;s result is sealed before it runs (see <WikiLink slug="how-races-are-run">how races are run</WikiLink>).</>,
          <>After settlement every race shows a tote audit: each pool&rsquo;s total, the take, the number of winning tickets, the dividend per 1 unit with its formula, and the check that payouts + take + rounding = the pool.</>,
          <>Unusual patterns, such as a horse ridden conservatively while linked accounts bet against it, are flagged for review.</>,
        ]}
      />

      <H2 id="currencies">Credits and T-USDG</H2>
      <P>
        Credits bets use your Stable Credits; credits never leave the game. The take on credits pools is a sink: those credits leave circulation, like an entry fee. T-USDG pools appear only while
        the game runs in practice mode with test dollars, have their own (lower) limits, and never touch real money.
      </P>

      <H2 id="limits">Limits, breaks and 18+</H2>
      <P>
        Betting is for players aged 18 or over: the first time, the panel asks you to confirm it. On <GameLink href="/me/betting">Betting limits</GameLink> you can set your own lower limits per
        race and per day (lowering one is immediate, raising or removing one takes 24 hours) and take a break from betting for 24 hours, 7 days, 30 days or for good. A break can&rsquo;t be
        shortened or lifted early. Racing, breeding and everything else carry on as normal. <GameLink href="/me/bets">My bets</GameLink> lists every bet with your running profit or loss.
      </P>
      <Callout tone="warn" title="Keep it fun">
        <p>Most bets lose: the take means that, on average, the tote returns less than goes in. Bet small, set a limit, and take a break if it stops being fun.</p>
      </Callout>
    </>
  );
}
