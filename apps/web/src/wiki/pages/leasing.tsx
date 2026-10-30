import * as gc from "@thoroughbred/game-core";
import { RULES } from "@thoroughbred/db";
import { formatCredits } from "@/lib/format";
import { Callout, Facts, GameLink, H2, Lead, List, P, Steps, Table, WikiLink } from "../kit";

/** The Live purse a winner takes from a 1,100-credit handicap, split at each owner share. */
function splitExamples() {
  const purse = gc.PURSE_BY_TIER.hcp_50_75;
  const prize = Math.floor((purse * (RULES.purseSplitBps[0] ?? 0)) / 10_000);
  const shares = [gc.LEASE_OWNER_SHARE_MIN_PCT, gc.LEASE_OWNER_SHARE_DEFAULT_PCT, gc.LEASE_OWNER_SHARE_MAX_PCT];
  return { purse, prize, rows: shares.map((pct) => ({ pct, ...gc.leaseShareSplit(prize, pct) })) };
}

export default function LeasingPage() {
  const ex = splitExamples();
  return (
    <>
      <Lead>
        Leasing is how real racing stables share a good horse: the owner lets another stable race it for a while, and the prize money is split. In Post Time an owner offers a racing horse for{" "}
        {gc.LEASE_TERMS_DAYS.join(", ")} days; another stable takes the lease, races the horse in its own colours and every purse is shared automatically. Rent racers, buy breeders.
      </Lead>

      <H2 id="how-it-works">How a lease works</H2>
      <Steps
        items={[
          <>
            The owner offers one of their racing horses on the lease board (<GameLink href="/market#lease">Sales → Lease</GameLink>, or <b>Offer for lease</b> on the horse page), choosing the term,
            their share of the prizes ({gc.LEASE_OWNER_SHARE_MIN_PCT}–{gc.LEASE_OWNER_SHARE_MAX_PCT}%) and the welfare terms below. Offers stay up for {gc.LEASE_OFFER_DAYS} days.
          </>,
          <>Another stable takes the lease: first come, first served. The horse moves into one of its stalls (the owner&rsquo;s stall is freed) for the whole term.</>,
          <>
            The lessee cares for the horse, trains it and races it in its own silks. League points, trophies and results are the lessee&rsquo;s; the horse&rsquo;s career record keeps counting as
            usual.
          </>,
          <>Every purse the horse wins is split at the moment the race settles: the owner&rsquo;s share to the owner, the rest to the lessee. Both see it in their ledger as a lease share.</>,
          <>When the term ends the horse goes home. Both stables get a note with the races run, what each earned and how the horse came back.</>,
        ]}
      />
      {gc.LEASE_FEE_MAX === 0 ? (
        <Callout tone="rule" title="No money up front">
          <p>A lease costs nothing to take. The prize split is the only money a lease moves, and it is the race&rsquo;s own purse: no credits are created or transferred between players.</p>
        </Callout>
      ) : (
        <Callout tone="rule" title="An upfront fee">
          <p>
            Owners may ask up to {gc.LEASE_FEE_APPRAISAL_PERMILLE / 10}% of the horse&rsquo;s appraisal up front (at most {formatCredits(gc.LEASE_FEE_MAX)} credits); {gc.LEASE_FEE_CUT_PERMILLE / 10}% of
            it is burned.
          </p>
        </Callout>
      )}

      <H2 id="the-split">The prize split</H2>
      <P>
        The owner&rsquo;s share is rounded down to a whole credit and the lessee gets the rest, so the purse is always split exactly. A Live race winner in a {formatCredits(ex.purse)}-credit handicap
        takes {formatCredits(ex.prize)}:
      </P>
      <Table
        head={["Owner's share", "Owner gets", "Lessee gets"]}
        rows={ex.rows.map((r) => [`${r.pct}%`, formatCredits(r.owner), formatCredits(r.lessee)])}
        caption="Story rewards and Daily Cup credits are not purses: they stay with the stable that ran."
      />

      <H2 id="who-does-what">Who may do what</H2>
      <Table
        head={["", "Lessee (during the lease)", "Owner"]}
        rows={[
          ["Care, vet, training", "Yes", "Not while it is away"],
          ["Enter races (Live, Story, Daily Cup), race-day extras", "Yes, within the owner's terms", "Not while it is away"],
          ["Sell or list (credits or USDG), register for USDG", "No", "Once it is home"],
          ["Breed, cover, stand at stud", "No", "Once it is home"],
          ["Retire, Legacy Farm, release to the Club, rename", "No", "Once it is home"],
          ["Insure", "No", "Yes, even while it is away (the payout is the owner's)"],
          ["End the lease early", "Yes: hand it back any time", "No: a lease can't be recalled"],
        ]}
      />
      <P>
        Upkeep is paid by the stable that used the horse that week: during a lease that is the lessee (see <WikiLink slug="credits-and-entries">Credits &amp; entries</WikiLink>).
      </P>

      <H2 id="welfare">Looking after a leased horse</H2>
      <List
        items={[
          <>A leased horse can&rsquo;t be entered while it is tired (the same &ldquo;tired&rdquo; the stable shows). Let it recover first.</>,
          <>No all-out rides, unless the owner ticked &ldquo;allow all-out&rdquo; on the offer.</>,
          <>
            The owner sets how many Live starts a week the horse may make on lease: {gc.LEASE_WEEKLY_STARTS_MIN} to {gc.LEASE_WEEKLY_STARTS_MAX}, {gc.LEASE_WEEKLY_STARTS_DEFAULT} unless they
            choose otherwise.
          </>,
          <>A moderate or worse injury sends the horse home straight after that race; the purse of that race is still split.</>,
          <>If the horse is entered in a race when the lease ends (or is handed back), it goes home once that race has run. Races after the end of the term can&rsquo;t be entered.</>,
          <>A condition report (fitness, fatigue, injury, rating) is taken when the lease starts and when the horse comes home: both stables see whether it came back fresh, tired or injured.</>,
        ]}
      />
      <P>
        Owners rate their lessee 1 to 5 stars once a lease is over. Every lessee has a public record on the lease board: leases taken, races run on lease, injuries on lease, the average fatigue of
        the horses it entered, and its stars. Owners can ask for a minimum rating; a lessee nobody has rated yet counts as {gc.LEASE_UNRATED_STARS} stars.
      </P>

      <H2 id="rules">Who can lease, and the limits</H2>
      <Facts
        rows={[
          ["Terms", `${gc.LEASE_TERMS_DAYS.join(", ")} days`],
          ["Owner's share of purses", `${gc.LEASE_OWNER_SHARE_MIN_PCT}–${gc.LEASE_OWNER_SHARE_MAX_PCT}%`],
          ["To take a lease", `an account ${gc.LESSEE_MIN_ACCOUNT_DAYS}+ days old with ${gc.LESSEE_MIN_LIVE_STARTS}+ Live starts, and a free stall`],
          ["Leases one stable may hold", String(gc.MAX_LEASES_PER_LESSEE)],
          ["Horses one owner may have out on lease", `${gc.LEASES_OUT_SHARE_PERMILLE / 10}% of their racing horses, at least ${gc.MIN_LEASES_OUT_PER_OWNER}, at most ${gc.MAX_LEASES_OUT_PER_OWNER}`],
          ["Open offers per owner", String(gc.MAX_OPEN_LEASE_OFFERS)],
          ["Before a returned horse can be offered again", `${gc.LEASE_RELIST_COOLDOWN_DAYS} days`],
          ["Career starts the horse needs left", `${gc.LEASE_MIN_STARTS_LEFT} of ${gc.CAREER_MAX_STARTS}`],
        ]}
      />
      <P>
        Only racing horses of racing age can be leased: not a horse entered in a race, listed for sale, in foal, injured or standing at stud. Club-bred starters can be leased even though
        they can never be sold: a lease changes no ownership and they always come home. A horse on offer can still race at home until someone takes the lease. Horses registered for the <WikiLink slug="usdg-market">USDG market</WikiLink> can be leased: nothing
        changes hands and nothing is paid in USDG.
      </P>
      <Callout tone="tip" title="Fair play">
        <p>
          Linked accounts can&rsquo;t lease to each other, and two stables leasing horses back and forth are reviewed by the Club. The lease board mixes up horses of similar quality each day and lifts
          offers from owners new to leasing, so the same big stables don&rsquo;t always sit at the top.
        </p>
      </Callout>

      <H2 id="coming-home">When the horse comes home</H2>
      <P>
        The horse always goes home, even to a full stable: like a newborn foal it can sit in the overflow stall, and the owner can&rsquo;t take on more horses until a stall is free. The lease ends
        early if the horse retires (its {gc.CAREER_MAX_STARTS}th start or a career-ending injury) or is lost in a race. See <WikiLink slug="the-market">the auction house</WikiLink> for buying a horse
        outright.
      </P>
    </>
  );
}
