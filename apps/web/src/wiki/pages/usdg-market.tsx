import * as gc from "@thoroughbred/game-core";
import { RULES, usdgPolicy } from "@thoroughbred/db";
import { Callout, Facts, GameLink, H2, Lead, List, P, Steps, Table, WikiLink } from "../kit";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const usd = gc.formatUsdgDollars;

/** The USDG market's rules, every number read live from the policy (game-core defaults + env overrides). */
export default function UsdgMarketPage() {
  const p = usdgPolicy();
  // Practice mode (USDG_MODE=practice): no testnet, no faucet, no network to add.
  const practice = gc.isUsdgPracticeMode(process.env);
  const example = 25 * gc.USDG_UNIT;
  const fee = gc.usdgFee(example, p.feeBps);
  const reserve = 10 * gc.USDG_UNIT;
  const second = gc.minNextBid(p, reserve, reserve);
  const studExample = Math.min(p.studFeeMax, Math.max(p.studFeeMin, 40 * gc.USDG_UNIT));
  const studCut = gc.usdgFee(studExample, p.feeBps);
  return (
    <>
      {practice ? (
        <Lead>
          During the beta, horses <b>registered</b> for the T-USDG market are sold at a fixed price or auctioned for <b>T-USDG</b>, test money with no real value, and trade only for
          T-USDG from then on. Stable Credits never come into it: they can&rsquo;t be bought, sold or cashed out, and race prizes stay in credits.
        </Lead>
      ) : (
        <Lead>
          Some horses can be sold for real dollars. Once a horse is <b>registered</b> for the USDG market, it can be sold at a fixed price or auctioned for <b>USDG</b>, a dollar stablecoin on Robinhood
          Chain, and it trades only for USDG from then on. Stable Credits never come into it: they can&rsquo;t be bought, sold or cashed out, and race prizes stay in credits.
        </Lead>
      )}
      <Callout tone="tip" title="During the beta: T-USDG, test money">
        <p data-testid="wiki-tusdg-explainer" data-practice-raw>
          During the beta, USDG is test money (T-USDG): you sign in with your wallet, nothing is charged and nothing can be withdrawn. Balances may be reset when the beta ends.
        </p>
        <p>
          While the game runs in practice mode, every account gets <b>{gc.formatPracticeUsdg(gc.PRACTICE_USDG_GRANT)}</b> once, the first time its wallet signs in. Everything below works the same,
          with T-USDG instead of USDG: registration, buying, auctions, USDG stud fees, Premium Packs (1 T-USDG per dollar of the price) and the tote&rsquo;s T-USDG pools all use that one
          balance. T-USDG can&rsquo;t be bought, sold, withdrawn or swapped for Stable Credits, and no network, faucet or transaction is needed: bids are still free wallet signatures.
          Horses and trophies are owned in the game only (no NFTs).
        </p>
      </Callout>
      {!practice && (
        <Callout tone="warn" title="Testnet first">
          <p>
            The USDG market opens on Robinhood Chain&rsquo;s <b>testnet</b>, where test USDG has no value (the market tab links the faucets). Real-money trading needs identity and legal checks the
            Club hasn&rsquo;t finished yet.
          </p>
        </Callout>
      )}

      <H2 id="registering">Registering a horse</H2>
      <P>
        Open the horse&rsquo;s page and find <b>Register for the USDG market</b>. A checklist shows what is met and what is missing. A horse can register once it is:
      </P>
      <List
        items={[
          <>in your stable, of racing age, with at least <b>{p.minLiveStarts} Live starts</b> (Story and quick races don&rsquo;t count);</>,
          <>not on the Legacy Farm, not entered in a race and not listed for credits;</>,
          <>not Club-bred: starters, gift foals and free-pack foals stay with the stable that raised them;</>,
          <>not pulled from a Premium Pack itself. Its foals can register.</>,
        ]}
      />
      <P>
        You need a <b>linked wallet</b> (one free signature, one wallet per stable) and you confirm you are 18 or over. Registration costs <b>{usd(p.registrationFee)}</b> once per horse, paid in USDG to
        the Club. The fee makes it pointless to farm free horses for cash.
      </P>

      <H2 id="selling">Selling: fixed price or auction</H2>
      <Facts
        rows={[
          ["Market fee (to the Club)", `${p.feeBps / 100}% of the price`],
          ["Lowest price or reserve", usd(p.minPrice)],
          ["Fixed-price listing", `${p.fixedListingDays.join(", ")} days`],
          ["Auction length", `${p.auctionHours.join(", ")} hours`],
          ["Winner's time to pay", `${Math.round(p.paymentWindowMs / HOUR_MS)} hours`],
          ["Bar for not paying", `${Math.round(p.nonPayerBarMs / DAY_MS)} days`],
          ["Resale lock after buying", `${Math.round(RULES.resaleLockMs / HOUR_MS)} hours`],
        ]}
      />
      <P>
        Dollar prices are yours to set; there is no ceiling beyond a technical limit. A listed horse can&rsquo;t race or breed until it sells, the listing ends or you take it down. Example: a horse sold at{" "}
        <b>{usd(example)}</b> pays the seller <b>{usd(example - fee)}</b> and the Club <b>{usd(fee)}</b>, in the same transaction.
      </P>

      <H2 id="buying">Buying at a fixed price</H2>
      <Steps
        items={[
          <>On <GameLink href="/market#usdg">Sales → USDG</GameLink>, pick a lot. You need a linked wallet and a free stall.</>,
          <>Press Buy. The lot is held for you for {Math.round(p.quoteTtlMs / 60_000)} minutes while you pay; nobody else can buy it meanwhile.</>,
          <>Your wallet approves exactly the price, then pays. The horse moves to your stable as soon as the payment is confirmed.</>,
        ]}
      />
      <Callout tone="rule" title="Your money never sits with the Club">
        <p>
          The market contract pulls the price from your wallet and pays the seller and the Club in one transaction. It holds no balances, so there is nothing to withdraw and nothing that can be
          frozen in between. The horse itself is not a token: it lives in the game, and the game moves it once the chain shows the payment.
        </p>
      </Callout>

      <H2 id="auctions">Auctions</H2>
      <P>
        A bid is a <b>free signature</b> from your linked wallet, not a payment, so nobody&rsquo;s money is locked up while an auction runs. The first bid must meet the reserve; each next bid must beat the
        best by {p.bidIncrementBps / 100}% (at least {usd(p.bidIncrementMin)}). On a {usd(reserve)} reserve, the second bid starts at {usd(second)}.
      </P>
      <Table
        head={["When", "What happens"]}
        rows={[
          ["The auction ends", `The top bidder is offered the horse at their bid and has ${Math.round(p.paymentWindowMs / HOUR_MS)} hours to pay.`],
          ["They pay", "The horse moves to their stable; the seller is paid, minus the market fee."],
          ["They don't pay", `Their offer lapses, they can't bid in USDG auctions for ${Math.round(p.nonPayerBarMs / DAY_MS)} days, and the next bidder is offered the horse at their own bid.`],
          ["Nobody pays, or no bids", "The auction ends unsold and the horse is free again."],
        ]}
      />
      <P>An auction with bids can&rsquo;t be cancelled. A fixed-price listing can be taken down any time, except while a buyer is paying for it.</P>

      <H2 id="stud-fees">USDG stud fees</H2>
      <P>
        Ordinary breeding stays in credits for everyone. The one exception: the owner of a stallion that is <b>registered</b> for the USDG market can stand him at stud for a <b>USDG fee</b> instead
        of a credits fee (never both), from <b>{usd(p.studFeeMin)}</b> to <b>{usd(p.studFeeMax)}</b> per covering. He shows in the stud book with the dollar amount.
      </P>
      <Steps
        items={[
          <>
            In the <GameLink href="/breeding">breeding barn</GameLink>, pick your mare and his name. The preview shows the same possible looks and outlook as any covering, plus <b>Pay {usd(studExample)} USDG to</b> his
            owner&rsquo;s stable.
          </>,
          <>
            Press it. Every breeding rule is checked now (relatives, season and lifetime limits, a mare already in foal, a stall for the foal). His covering slot and your mare are held for you for{" "}
            {Math.round(p.quoteTtlMs / 60_000)} minutes while you pay, and the {gc.BREEDING_BASE_FEE.toLocaleString("en-GB")} credits base fee every covering costs is set aside.
          </>,
          <>Your wallet pays: the fee goes straight to his owner&rsquo;s wallet, minus the market fee to the Club, in one transaction. The covering happens as soon as the payment is confirmed.</>,
        ]}
      />
      <Facts
        rows={[
          ["Who can charge one", "The owner of a registered stallion standing at stud"],
          ["Fee range", `${usd(p.studFeeMin)} to ${usd(p.studFeeMax)}`],
          [`Example: a ${usd(studExample)} fee`, `${usd(studExample - studCut)} to the stallion's owner, ${usd(studCut)} to the Club`],
          ["Base fee (credits, as for any covering)", `${gc.BREEDING_BASE_FEE.toLocaleString("en-GB")} credits, burned`],
          ["Time to pay", `${Math.round(p.quoteTtlMs / 60_000)} minutes; then the booking lapses and the credits come back`],
        ]}
      />
      <P>
        The foal is an ordinary foal of your mare: it races for credits and can register for the USDG market later like any horse. If a paid covering can&rsquo;t happen after all (a rare
        clash, such as the stallion leaving the stud in the meantime), the Club refunds the fee from its treasury; the contract itself never holds or returns money. Linked accounts can&rsquo;t book
        each other&rsquo;s stallions.
      </P>

      <H2 id="fair-play">Fair play</H2>
      <List
        items={[
          <>Accounts the game has linked to each other can&rsquo;t buy from or bid against each other, exactly as on the credits market.</>,
          <>A horse you buy can&rsquo;t be relisted for {Math.round(RULES.resaleLockMs / HOUR_MS)} hours.</>,
          <>Sales far from recent prices for similar horses are flagged for the Club to review. The sale still stands.</>,
          <>Registered horses never go back to the credits market, so dollars and credits can&rsquo;t be traded against each other.</>,
        ]}
      />
      <P>
        Horses that aren&rsquo;t registered keep trading for credits in <WikiLink slug="the-market">the auction house</WikiLink>. Live starts come from the <WikiLink slug="race-types">Live card</WikiLink>.
      </P>
    </>
  );
}
