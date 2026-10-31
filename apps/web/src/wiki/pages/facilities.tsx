import * as gc from "@thoroughbred/game-core";
import { STABLE_HAND_COST } from "@thoroughbred/db";
import { formatCredits } from "@/lib/format";
import { Callout, Facts, Figure, GameLink, H2, Lead, List, P, Table, WikiLink } from "../kit";

const HOUR_MS = 3_600_000;

/** Days until an injury needing `days` of rest is healed at each vet level (game-core healing). */
function daysToHeal(days: number, vetLevel: number): number {
  const injury: gc.Injury = { severity: "moderate", atMs: 0, unitsRequired: days * 24, bonusUnits: 0, vetLevel, source: "wiki" };
  let h = 0;
  while (!gc.isHealed(injury, h * HOUR_MS) && h < days * 24) h++;
  return Math.round((h / 24) * 10) / 10;
}

/** Healing speed at a vet level, as a % over normal (from gc.healingHours over 100 hours). */
function healBoost(vetLevel: number): number {
  const injury: gc.Injury = { severity: "minor", atMs: 0, unitsRequired: 1000, bonusUnits: 0, vetLevel, source: "wiki" };
  return gc.healingHours(injury, 100 * HOUR_MS) - 100;
}

export default function FacilitiesPage() {
  // Stall prices, three to a row.
  const stalls = Array.from({ length: gc.MAX_STALLS - gc.BASE_STALLS }, (_, i) => gc.BASE_STALLS + 1 + i);
  const stallRows: (string | number)[][] = [];
  for (let i = 0; i < stalls.length; i += 3) stallRows.push(stalls.slice(i, i + 3).flatMap((n) => [`Stall ${n}`, formatCredits(gc.stallCost(n))]));
  const allStalls = stalls.reduce((a, n) => a + gc.stallCost(n), 0);
  const trainerTotal = gc.FACILITY_COSTS.trainer.reduce<number>((a, b) => a + b, 0);
  const vetTotal = gc.FACILITY_COSTS.vet.reduce<number>((a, b) => a + b, 0);
  const injuryDays = gc.INJURY_DAYS.moderate[1];
  const trainerLevels = [0, ...gc.FACILITY_COSTS.trainer.map((_, i) => i + 1)];
  const vetLevels = [0, ...gc.FACILITY_COSTS.vet.map((_, i) => i + 1)];
  const tiers = Array.from({ length: gc.ENTRY_FACILITY_TIERS + 1 }, (_, t) => t);
  return (
    <>
      <Lead>
        Facilities are one-off upgrades to your stable, paid in credits: more stalls, a trainer, a vet, a bigger entry office and a stable hand. Facilities have no running costs (horses have a small weekly <WikiLink slug="credits-and-entries">upkeep</WikiLink> only in weeks you use them). Once bought, an
        upgrade is yours for good.
      </Lead>
      <Figure src="/art/diorama/poster-yard.png" alt="The stable yard" caption="Upgrades are bought on the Facilities screen under Stable, one level at a time." focus={0.55} />
      <Facts
        rows={[
          ["Stalls you start with", gc.BASE_STALLS],
          ["Most stalls", gc.MAX_STALLS],
          ["Every stall up to the maximum", `${formatCredits(allStalls)} credits`],
          ["Trainer, both levels", `${formatCredits(trainerTotal)} credits`],
          ["Vet, all levels", `${formatCredits(vetTotal)} credits`],
          ["Stable hand", `${formatCredits(STABLE_HAND_COST)} credits`],
        ]}
      />

      <H2 id="stalls">Stalls</H2>
      <P>
        Every horse in your stable takes a stall: racing horses, youngsters growing up, horses at stud and broodmares. Horses on the <WikiLink slug="legacy-farm">Legacy Farm</WikiLink> and horses released to the Club
        don&rsquo;t. You start with <b>{gc.BASE_STALLS}</b> and can build up to <b>{gc.MAX_STALLS}</b>, one at a time, each a little dearer than the last.
      </P>
      <Table head={["Stall", "Cost", "Stall", "Cost", "Stall", "Cost"]} rows={stallRows} />
      <P>
        A full stable never loses a foal: a newborn waits in the nursery overflow and moves into the first stall that frees up. Buying a horse or opening a pack
        needs a free stall, though. To free one, retire a horse to the Legacy Farm, sell it at <WikiLink slug="the-market">the auction house</WikiLink>, or release it to the Club.
      </P>

      <H2 id="trainer">Trainer</H2>
      <P>
        Without a trainer every horse gets <b>{gc.slotsFor(0)}</b> training sessions a week. The first trainer level adds a fourth session, and each level makes every workout more effective. See{" "}
        <WikiLink slug="training" />.
      </P>
      <Table
        head={["Level", "Cost", "Sessions a week", "Gains from each workout"]}
        rows={trainerLevels.map((lv) => [
          lv === 0 ? "None" : `Level ${lv}`,
          lv === 0 ? "–" : formatCredits(gc.FACILITY_COSTS.trainer[lv - 1]!),
          gc.slotsFor(lv),
          lv === 0 ? "Normal" : `+${(gc.TRAINER_EFFICIENCY_PER_LEVEL * lv) / 10}%`,
        ])}
      />

      <H2 id="vet">Vet</H2>
      <P>
        A vet makes injuries heal faster. Healing always carries on while you&rsquo;re away. Vet treatments and care during recovery
        help on top; see <WikiLink slug="injuries-and-insurance" />.
      </P>
      <Table
        head={["Level", "Cost", "Healing speed", `A ${injuryDays}-day injury heals in`]}
        rows={vetLevels.map((lv) => [
          lv === 0 ? "None" : `Level ${lv}`,
          lv === 0 ? "–" : formatCredits(gc.FACILITY_COSTS.vet[lv - 1]!),
          lv === 0 ? "Normal" : `${healBoost(lv)}% faster`,
          `${daysToHeal(injuryDays, lv)} days`,
        ])}
      />

      <H2 id="entry-office">Entry office</H2>
      <P>
        Each tier adds a Live race entry a day and two to your bank, for the days you play more. See <WikiLink slug="credits-and-entries" />.
      </P>
      <Table
        head={["Tier", "Cost", "Entries a day", "Bank holds up to"]}
        rows={tiers.map((t) => [t === 0 ? "Starting" : `Tier ${t}`, t === 0 ? "–" : formatCredits(gc.ENTRY_TIER_COST[t - 1]!), gc.dailyAllowance(t), gc.bankCap(t)])}
      />

      <H2 id="stable-hand">Stable hand</H2>
      <P>
        A stable hand ({formatCredits(STABLE_HAND_COST)} credits) adds <b>Care for all</b> to the nursery: every horse cared for in one tap, each with the right feed. Each horse still counts once a
        day, so it saves taps, not days. See <WikiLink slug="care-and-condition" />.
      </P>

      <H2 id="what-first">What to buy first</H2>
      <List
        items={[
          <>
            <b>Stalls</b> when you are breeding or buying: every foal and every pack needs one, and the first few are the cheapest.
          </>,
          <>
            <b>Trainer level 1</b> for a stable that races a lot: the fourth weekly session is the biggest single jump.
          </>,
          <>
            <b>Vet</b> once you race often: injured horses are back sooner, which matters most for a horse in its prime.
          </>,
        ]}
      />
      <Callout tone="tip">
        <p>
          Facilities never cost anything to keep, so an upgrade bought early pays back for the life of your stable. Check the{" "}
          <GameLink href="/facilities">Facilities</GameLink> screen: it shows what each next level does and costs.
        </p>
      </Callout>
    </>
  );
}
