import * as gc from "@thoroughbred/game-core";
import { formatCredits } from "@/lib/format";
import { Callout, Facts, GameLink, H2, Lead, List, P, Table, WikiLink } from "../kit";

const all = (v: number): gc.JockeySkills => ({ gate: v, pace: v, finish: v, handling: v });
const pct = (permille: number) => `${Math.round(permille / 10)}%`;
const PURSES = [1_000, 2_000, 2_500, 6_000, 20_000];

/** Example riders across the grades: what each brings to a ride (engine kit). */
const EXAMPLES: { label: string; v: number }[] = [
  { label: "E (a raw apprentice)", v: 150 },
  { label: "C", v: 500 },
  { label: "A", v: 850 },
];

export default function JockeysPage() {
  const w = gc.JOCKEY_CAREER_WEEKS;
  return (
    <>
      <Lead>
        Jockeys are riders with careers of their own. Every stable starts with an apprentice; stables can hold up to {gc.JOCKEYS_PER_STABLE_MAX}, and Club freelancers ride for anyone
        for a fee. A jockey&rsquo;s skills grow with rides, and over a few seasons the young rider from your yard might become a champion for someone else, then retire.
      </Lead>
      <Facts
        rows={[
          ["Jockeys a stable can hold", gc.JOCKEYS_PER_STABLE_MAX],
          ["Pool size", `about ${gc.JOCKEY_POOL_PER_ACTIVE_STABLE} per active stable (raced or visited in ${gc.JOCKEY_ACTIVE_STABLE_DAYS} days)`],
          ["Career", `${w.apprentice} weeks apprentice, ${w.prime} weeks prime, ${w.veteranMin}-${w.veteranMax} weeks veteran`],
          ["Retirement notice", `${gc.JOCKEY_RETIREMENT_NOTICE_WEEKS} weeks`],
          ["Apprentice claims", gc.APPRENTICE_CLAIMS.map((c) => `${c.lb} lb until ${c.untilWins} winners`).join(", ")],
          ["Idle stables", `after ${gc.JOCKEY_IDLE_RELEASE_DAYS} days away their jockeys rejoin the Club pool`],
        ]}
      />

      <H2 id="skills">Four skills</H2>
      <P>
        Each skill runs from 0 to 1000 and shows as a grade from A to E, like a horse&rsquo;s stats. Behind each sits a hidden potential: the most that skill can grow to. A young jockey&rsquo;s page
        shows a range (&ldquo;C to A&rdquo;) that narrows as they ride; after {gc.JOCKEY_SCOUT_RIDES} rides you know exactly.
      </P>
      <Table head={["Skill", "What it does in a race"]} rows={gc.JOCKEY_SKILLS.map((k) => [gc.JOCKEY_SKILL_LABELS[k].label, gc.JOCKEY_SKILL_LABELS[k].effect])} />
      <P>
        The skills are sealed into the field with the runner when entries close, so old races replay exactly whatever the jockey does later. A jockey never turns a bad horse into a good one:
        between the best and the worst rider is worth about two to three rating points in total.
      </P>
      <Table
        head={["Rider (all skills)", "Slow-start chance", "Energy drain", "Late-battle response", "Day-form swing", "Keen horse's early waste"]}
        rows={EXAMPLES.map(({ label, v }) => {
          const k = gc.jockeyKit(all(v));
          return [label, pct(k.slowStartPermille), pct(k.drainPermille), pct(k.battlePermille), pct(k.formAmpPermille), pct(k.keenPermille)];
        })}
        caption="Each figure is the share of the horse's own value that still applies: a better rider breaks cleaner, wastes less, fights harder and keeps the horse's run closer to its true level (both ways)."
      />
      <Table
        head={["Grade", "Overall skill (mean of the four)"]}
        rows={gc.JOCKEY_GRADE_FLOORS.map(([g, floor], i) => [g, i === 0 ? `${floor}+` : `${floor}-${gc.JOCKEY_GRADE_FLOORS[i - 1]![1] - 1}`])}
      />

      <H2 id="growth">Growing and ageing</H2>
      <P>
        Every ride teaches: {gc.JOCKEY_XP_BASE} experience, plus up to {gc.JOCKEY_XP_FIELD_MAX} more for a strong field and up to {gc.JOCKEY_XP_PURSE_MAX} more for a rich race. Each skill
        then moves towards its potential, quickly at first and more slowly near the ceiling. Veterans slowly lose their gate, finishing drive and handling; pace judgement holds.
      </P>
      <List
        items={[
          `Apprentice: the first ${w.apprentice} weeks (about a season).`,
          `Prime: the next ${w.prime} weeks (about three seasons).`,
          `Veteran: ${w.veteranMin} to ${w.veteranMax} weeks of slow decline, then retirement, announced ${gc.JOCKEY_RETIREMENT_NOTICE_WEEKS} weeks ahead.`,
        ]}
      />

      <H2 id="claims">Apprentice allowances</H2>
      <P>
        In handicaps (where horses carry weights, 1 lb = 1 rating point), a jockey who hasn&rsquo;t ridden many winners claims an allowance off the horse&rsquo;s weight. The racecard shows it after the
        name: &ldquo;T. Ashby (5)&rdquo;.
      </P>
      <Table head={["Career winners", "Allowance"]} rows={gc.APPRENTICE_CLAIMS.map((c, i) => [`${i === 0 ? 0 : gc.APPRENTICE_CLAIMS[i - 1]!.untilWins}-${c.untilWins - 1}`, `${c.lb} lb`]).concat([[`${gc.APPRENTICE_CLAIMS.at(-1)!.untilWins}+`, "none"]])} />

      <H2 id="booking">Booking a ride</H2>
      <P>
        The <WikiLink slug="entering-a-race">entry sheet</WikiLink> picks the jockey for a Live race: your best jockey who is free at the off, unless you choose another of yours (free) or a Club
        freelancer (a fee by grade and purse, burned). A jockey rides one horse per race and can&rsquo;t take two rides less than {gc.JOCKEY_CLASH_MS / 60_000} minutes apart. Club runners get a
        freelancer drawn from the race seed.
      </P>
      <Table
        head={["Purse", ...gc.JOCKEY_GRADES.map((g) => `${g} freelancer`)]}
        rows={PURSES.map((p) => [formatCredits(p), ...gc.JOCKEY_GRADES.map((g) => formatCredits(gc.freelanceFee(g, p)))])}
        caption="Freelance fees in credits. Refunded if you scratch before entries close or the race is abandoned."
      />

      <H2 id="signing">Signing and releasing</H2>
      <P>
        A stable with fewer than {gc.JOCKEYS_PER_STABLE_MAX} jockeys can sign an unsigned freelancer for a one-off fee, and release one back to the Club pool at any time. Linked accounts can&rsquo;t sign
        a jockey the other just released.
      </P>
      <Table head={["Grade", "Signing fee"]} rows={gc.JOCKEY_GRADES.map((g) => [g, `${formatCredits(gc.signingFee(g))} credits`])} />

      <H2 id="supply">Supply</H2>
      <P>
        Each week new apprentices join so the whole pool holds about {gc.JOCKEY_POOL_PER_ACTIVE_STABLE} jockeys per active stable; retirements take the oldest out. The same ratio holds at 50 players
        or 5,000, so jockeys never pile up. Personality (money-minded, ambitious, loyal, workhorse) shows on each jockey&rsquo;s page now and will matter when contracts arrive.
      </P>
      <Callout title="Where to look">
        <p>
          <GameLink href="/jockeys">Racing → Jockeys</GameLink> lists every active jockey with the season&rsquo;s leading riders; your own are on the Stable page.
        </p>
      </Callout>
    </>
  );
}
