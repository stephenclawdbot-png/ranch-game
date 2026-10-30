import * as gc from "@thoroughbred/game-core";
import { PRIZE_SPLIT_PCT } from "@thoroughbred/racing-engine";
import { formatCredits } from "@/lib/format";
import { Callout, Facts, GameLink, H2, H3, Icon, Lead, List, P, Table, WikiLink, count, pct } from "../kit";

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

/** A real entry bank over a few days, run through game-core's grant and spend rules. */
function bankExample() {
  const rows: { day: string; what: string; balance: number }[] = [];
  let bank = gc.NEW_ENTRY_BANK;
  bank = gc.grantFor(bank, 1);
  rows.push({ day: "Day 1", what: `First visit: the day's allowance lands`, balance: bank.balance });
  const spend = gc.ENTRY_DAILY_BASE - 3;
  bank = gc.spendEntries(bank, spend) ?? bank;
  rows.push({ day: "Day 1", what: `${spend} Live races entered`, balance: bank.balance });
  bank = gc.grantFor(bank, 1);
  rows.push({ day: "Day 1", what: "Back again later the same day: nothing more", balance: bank.balance });
  bank = gc.grantFor(bank, 4);
  rows.push({ day: "Day 4", what: "Away for two days, then back: every missed day counts, up to the cap", balance: bank.balance });
  const graded = gc.entryCost({ tier: "g3", kind: "regular" });
  bank = gc.spendEntries(bank, graded) ?? bank;
  rows.push({ day: "Day 4", what: `A Group race (${graded} entries)`, balance: bank.balance });
  return rows;
}

export default function CreditsAndEntriesPage() {
  const costs = Object.values(gc.WORKOUTS)
    .map((w) => w.cost)
    .filter((c) => c > 0);
  const chapters = gc.STORY_CHAPTER_DEFS;
  const tiers = gc.ENTRY_TIER_COST.map((cost, i) => ({ tier: i + 1, cost, allowance: gc.dailyAllowance(i + 1), cap: gc.bankCap(i + 1) }));
  const bank = bankExample();
  return (
    <>
      <Lead>
        Your stable runs on two things. <b>Stable Credits</b> pay for everything you choose to do: training, the vet, breeding, packs and new facilities. <b>Stable entries</b> are your daily
        budget for Live races. Credits are earned and spent inside the game only; they are never cashed out.
      </Lead>

      <H2 id="credits">Stable Credits</H2>
      <P>
        You start with <b>{formatCredits(gc.STARTER_GRANT)}</b> credits. Your balance is the <Icon name="coin" size={16} /> number in the top bar. A cost you can&rsquo;t afford is simply
        refused, so you can never go into debt, and there are no running costs: no stall rent, no feed bills, nothing that ticks while you are away.
      </P>
      <Callout tone="rule" title="Credits stay in the game">
        <p>
          Stable Credits have no cash value. They can&rsquo;t be withdrawn, sold or exchanged for money, and races pay prizes in credits only. They exist to run your stable.
        </p>
      </Callout>

      <H2 id="earning">How you earn credits</H2>
      <Table
        head={["Source", "What it pays"]}
        rows={[
          ["Live races", `A share of the purse for the first ${PRIZE_SPLIT_PCT.length} home: ${PRIZE_SPLIT_PCT.map((p, i) => `${ordinal(i + 1)} ${p}%`).join(", ")}`],
          ["Story races", `A first win of each Story race pays the chapter's reward; any other finish pays ${gc.STORY_REPLAY_REWARD}`],
          ["Today's goals", `${gc.DAILY_GOAL_CREDITS} each for running a race, caring for a horse and running the Daily Cup (${gc.DAILY_GOAL_CREDITS * gc.DAILY_GOALS_PER_DAY} a day)`],
          ["Daily Cup", `${gc.CUP_PARTICIPATION_CREDITS} for your run each day`],
          ["Selling a horse", `The price, less a ${pct(gc.MARKET_FEE_PERMILLE)} market fee`],
          ["Your stallion at stud", `The stud fee you set (at most his appraisal), less a ${pct(gc.STUD_FEE_BURN_PERMILLE)} cut`],
          ["Insurance", `${pct(gc.INSURANCE_PAYOUT_PERMILLE)} of the horse's appraisal if an injury ends its racing career`],
          ["Releasing a horse to the Club", `${gc.RELEASE_TO_CLUB_CREDITS} credits`],
        ]}
      />
      <H3>Story rewards by chapter</H3>
      <P>Story rewards are capped per chapter, so they get you started but can&rsquo;t be farmed forever.</P>
      <Table
        head={["Chapter", "First win of a race", "Most the chapter can ever pay"]}
        rows={chapters.map((c) => [c.title, formatCredits(gc.STORY_FIRST_WIN_REWARD[c.id]), formatCredits(gc.STORY_CHAPTER_CAP[c.id])])}
      />

      <H2 id="spending">How you spend credits</H2>
      <Table
        head={["Spend", "Cost", "More"]}
        rows={[
          ["A training session", `${Math.min(...costs)} to ${Math.max(...costs)} (rest is free)`, <WikiLink key="t" slug="training" />],
          ["Vet treatment for an injured horse", formatCredits(gc.VET_TREATMENT_COST), <WikiLink key="i" slug="injuries-and-insurance" />],
          ["Insurance (one premium per horse)", `${pct(gc.INSURANCE_PREMIUM_PERMILLE)} of the appraisal`, <WikiLink key="i2" slug="injuries-and-insurance" />],
          ["Pedigree Scan (narrows a horse's potential ranges for good)", formatCredits(gc.PEDIGREE_SCAN_COST), <WikiLink key="g" slug="genetics-and-inheritance" />],
          ["Covering a mare", `${formatCredits(gc.BREEDING_BASE_FEE)}, plus the stud fee for another stable's stallion`, <WikiLink key="b" slug="breeding-basics" />],
          ["Paddock Pack", `${formatCredits(gc.PADDOCK_PACK_PRICE)} (up to ${gc.PADDOCK_CREDIT_BUYS_PER_WEEK} a week)`, <WikiLink key="p" slug="packs" />],
          ["Entry refill", `${formatCredits(gc.ENTRY_REFILL_COST)} for +${gc.ENTRY_REFILL_AMOUNT} entries`, <a key="r" href="#refill" className="link">The daily refill</a>],
          ["A new stall", `${formatCredits(gc.stallCost(gc.BASE_STALLS + 1))} rising to ${formatCredits(gc.stallCost(gc.MAX_STALLS))}`, <WikiLink key="f" slug="facilities" />],
          ["Trainer", gc.FACILITY_COSTS.trainer.map(formatCredits).join(" / "), <WikiLink key="f2" slug="facilities" />],
          ["Vet", gc.FACILITY_COSTS.vet.map(formatCredits).join(" / "), <WikiLink key="f3" slug="facilities" />],
          ["Entry office", gc.ENTRY_TIER_COST.map(formatCredits).join(" / "), <a key="o" href="#entry-office" className="link">The entry office</a>],
          ["A horse at auction", "The seller's price", <WikiLink key="m" slug="the-market" />],
          [
            "Weekly upkeep",
            `${formatCredits(gc.UPKEEP_RACING_PER_WEEK)} per racing horse and ${formatCredits(gc.UPKEEP_STUD_PER_WEEK)} per horse at stud, only for horses you used that week`,
            <a key="u" href="#upkeep" className="link">Upkeep</a>,
          ],
        ]}
      />
      <H3>Upkeep</H3>
      <P>
        <span id="upkeep" />
        After each week ends, your stable pays upkeep for the horses you actually used: any horse that raced (Live or Story), had a paid training session, or covered or was covered.
        Horses you leave alone that week cost nothing, so a week away is free. Upkeep never takes your balance below zero: what you can&rsquo;t pay is waived. The{" "}
        <GameLink href="/week">This week</GameLink> page shows it building up, and a note in your inbox shows the breakdown. The first week charged is the week starting{" "}
        {new Date(`${gc.UPKEEP_FIRST_WEEK}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.
      </P>
      <P>
        Every free Paddock Pack is earned by playing: one for every {gc.FREE_PADDOCK_EVERY_PLAY_DAYS} days you play. See <WikiLink slug="packs" />.
      </P>

      <H2 id="entries">Stable entries</H2>
      <P>
        Every Live race on the <GameLink href="/races">Race card</GameLink> costs stable entries. Your bank is the <Icon name="flag" size={16} /> number in the top bar.
      </P>
      <List
        items={[
          <>
            <b>+{gc.ENTRY_DAILY_BASE} entries</b> land at your local midnight. They are added the first time you play each day.
          </>,
          <>
            Unused entries roll over into your bank, up to <b>{gc.ENTRY_BANK_BASE}</b>. Days you miss still count when you come back, up to that cap.
          </>,
          <>
            A Live race costs <b>{gc.entryCost({ tier: "hcp_0_55", kind: "regular" })}</b> entry; a Feature, Group race or the Season Final costs{" "}
            <b>{gc.entryCost({ tier: "g1", kind: "regular" })}</b>. Story races and the Daily Cup are free.
          </>,
          <>
            Each horse can run <b>{count(gc.MAX_LIVE_STARTS_PER_DAY, "Live race")} a day</b>, so the more horses you have racing, the more of your entries you can use.
          </>,
          <>If a race is abandoned you get the entries back. If you scratch a horse yourself, the entries are spent.</>,
        ]}
      />
      <Table head={["When", "What happened", "Bank after"]} caption="A real bank, run through the game's own entry rules." rows={bank.map((r) => [r.day, r.what, r.balance])} />

      <H3>
        <span id="refill">The daily refill</span>
      </H3>
      <P>
        When your bank is below <b>{gc.ENTRY_REFILL_BELOW}</b>, you can buy <b>+{gc.ENTRY_REFILL_AMOUNT}</b> entries for <b>{formatCredits(gc.ENTRY_REFILL_COST)}</b> credits, once per
        local day.
      </P>
      <H3>
        <span id="entry-office">The entry office</span>
      </H3>
      <P>
        The entry office in <GameLink href="/facilities">Facilities</GameLink> raises both numbers, one tier at a time, to at most {gc.ENTRY_DAILY_MAX} a day and a bank of{" "}
        {gc.ENTRY_BANK_MAX}.
      </P>
      <Table
        head={["Tier", "Cost", "Entries a day", "Bank holds"]}
        rows={[["Start", "–", gc.dailyAllowance(0), gc.bankCap(0)], ...tiers.map((t) => [`Tier ${t.tier}`, formatCredits(t.cost), t.allowance, t.cap])]}
      />
      <Facts
        rows={[
          ["Entries each local day", gc.ENTRY_DAILY_BASE],
          ["Bank cap", gc.ENTRY_BANK_BASE],
          ["Most entries a day (entry office)", gc.ENTRY_DAILY_MAX],
          ["Biggest bank (entry office)", gc.ENTRY_BANK_MAX],
          ["Refill", `+${gc.ENTRY_REFILL_AMOUNT} for ${formatCredits(gc.ENTRY_REFILL_COST)}, below ${gc.ENTRY_REFILL_BELOW}`],
          ["Live races per horse per day", gc.MAX_LIVE_STARTS_PER_DAY],
          ["Races per horse per day, Live and Story", gc.MAX_STARTS_PER_DAY],
        ]}
      />
      <Callout tone="tip">
        <p>
          Entries are for Live races only. When the bank is low, Story races and the Daily Cup still cost nothing, and they count towards today&rsquo;s goals.
        </p>
      </Callout>
    </>
  );
}
