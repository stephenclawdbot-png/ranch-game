import * as gc from "@thoroughbred/game-core";
import { formatCredits, formatDistance, oneInText } from "@/lib/format";
import { Callout, Facts, Figure, H2, H3, Lead, List, P, ShareBar, Table, WikiLink, pct } from "../kit";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Midday, a month after the horse arrived, so earlier runs can fall on the same day. */
const NOW = 30 * DAY + 12 * HOUR;
const INTENSITY_LABEL: Record<gc.RideIntensity, string> = { conservative: "Conservative (Easy) ride", normal: "Normal ride", all_out: "All-out ride" };
const RISK_LABEL = { low: "Low", moderate: "Moderate", elevated: "Elevated", high: "High" } as const;
const SEVERITY_LABEL: Record<gc.InjurySeverity, string> = { minor: "Minor", moderate: "Moderate", career_ending: "Career-ending", fatal: "Fatal" };

function sample() {
  const [h] = gc.createStarterStable({ ownerId: "wiki", seed: "wiki-injury", nowMs: 0, season: 1 });
  return h!;
}

type Ctx = Parameters<typeof gc.injuryRisk>[1];

/** Live injury-risk table: the same function the entry sheet uses, on one real horse. */
function riskTable(h: gc.HorseState) {
  const best = gc.preferredDistanceM(h.genome);
  const base: Ctx = { nowMs: NOW, going: "good", distanceM: best, intensity: "normal", stage: gc.stageOf(h) };
  const intensities = (["conservative", "normal", "all_out"] as const).map((intensity) => ({ intensity, r: gc.injuryRisk(h, { ...base, intensity }) }));
  const ranToday: gc.HorseState = { ...h, recentRuns: [1, 2].map((n) => ({ atMs: NOW - n * HOUR, position: 5, fieldSize: 10, raceId: `today-${n}` })) };
  const fragile: gc.HorseState = { ...h, genome: { ...h.genome, fragile: [1, 0] } };
  const scenarios: { what: string; r: gc.InjuryRisk }[] = [
    { what: `Normal ride, good going, ${formatDistance(best)}`, r: gc.injuryRisk(h, base) },
    { what: "Firm going", r: gc.injuryRisk(h, { ...base, going: "firm" }) },
    { what: "Heavy going", r: gc.injuryRisk(h, { ...base, going: "heavy" }) },
    { what: "Still tired (80% fatigue)", r: gc.injuryRisk(gc.withFatigue(h, 800, NOW, true), base) },
    { what: "Already ran twice today", r: gc.injuryRisk(ranToday, base) },
    { what: `A long trip (${formatDistance(2800)})`, r: gc.injuryRisk(h, { ...base, distanceM: 2800 }) },
    { what: "As a veteran", r: gc.injuryRisk(h, { ...base, stage: "veteran" }) },
    { what: "With fragile legs", r: gc.injuryRisk(fragile, base) },
    { what: "With iron legs", r: gc.injuryRisk({ ...h, genome: { ...h.genome, genes2: { ...h.genome.genes2, ironLegs: ["IL", "n"] } } }, base) },
    { what: "Tired, heavy going and all-out", r: gc.injuryRisk(gc.withFatigue(h, 800, NOW, true), { ...base, going: "heavy", intensity: "all_out" }) },
  ];
  return { intensities, scenarios, base };
}

/** What an injury turns out to be: 4,000 certain injuries rolled by the game's own rollInjury. */
function severities(careerEndingShare: number, fatal: boolean) {
  const n = 4000;
  const count: Record<gc.InjurySeverity, number> = { minor: 0, moderate: 0, career_ending: 0, fatal: 0 };
  for (let i = 0; i < n; i++) {
    const inj = gc.rollInjury({ permille: 1000, careerEndingShare }, `wiki-sev-${i}`, 0, 0, "wiki", { fatal });
    if (inj) count[inj.severity]++;
  }
  return count;
}

/** Days to heal one injury: left alone, with daily care, and with daily care plus the vet. */
function healing(vetLevel: number, hours: number) {
  const inj: gc.Injury = { severity: "moderate", atMs: 0, unitsRequired: hours, bonusUnits: 0, vetLevel, source: "wiki" };
  const days = (perDay: number) => {
    for (let d = 0; d <= 60; d++) {
      const i = { ...inj, bonusUnits: perDay * d };
      if (gc.isHealed(i, d * DAY)) return d;
    }
    return 60;
  };
  return { alone: days(0), care: days(gc.CARE_HEAL_BONUS_H), vet: days(gc.CARE_HEAL_BONUS_H + gc.VET_HEAL_BONUS_H) };
}

export default function InjuriesAndInsurancePage() {
  const h = sample();
  const rt = riskTable(h);
  const live = severities(gc.CAREER_ENDING_SHARE, true);
  const normal = rt.intensities[1]!.r;
  const fatalPerStart = (normal.permille * normal.careerEndingShare * gc.FATAL_SHARE_OF_CAREER_ENDING) / 1_000_000;
  const careerEndingPerStart = (normal.permille * normal.careerEndingShare) / 1000;
  const moderateHours = Math.round(((gc.INJURY_DAYS.moderate[0] + gc.INJURY_DAYS.moderate[1]) / 2) * 24);
  const vetLevels = gc.FACILITY_COSTS.vet.length;
  const heal = Array.from({ length: vetLevels + 1 }, (_, lv) => ({ lv, ...healing(lv, moderateHours) }));
  const appraisal = gc.appraise(h);
  return (
    <>
      <Lead>
        Racing carries a small risk of injury, and the game shows you that risk before every start. Most injuries are minor and heal in a few days. A few end a racing career, and in Live
        races a very few are fatal. Care, the vet and a sensible ride all help, and insurance softens the worst outcome.
      </Lead>
      <Figure src="/art/diorama/poster-barn.png" alt="A quiet barn with horses resting in their stalls" caption="Injured horses rest in their stalls; healing carries on while you are away." focus={0.5} />

      <H2 id="risk">The risk of each start</H2>
      <P>
        Every start begins from a base chance of <b>{pct(gc.BASE_INJURY_PERMILLE, 1)}</b>, then each factor below multiplies it, up to a ceiling of {pct(gc.MAX_INJURY_PERMILLE)}. The
        entry sheet shows the result for the ride you choose, and the horse&rsquo;s Care tab shows it for each kind of ride. For a real starter, at its best trip on good going:
      </P>
      <Table
        head={["Ride", "Injury risk", "If injured, career-ending"]}
        rows={rt.intensities.map(({ intensity, r }) => [INTENSITY_LABEL[intensity], `${RISK_LABEL[r.label]} · ${pct(r.permille, 1)}`, pct(r.careerEndingShare, 1)])}
      />
      <H3>What raises it</H3>
      <Table
        head={["Same horse, normal ride unless shown", "Injury risk", "Factors the game lists"]}
        rows={rt.scenarios.map((s) => [s.what, `${RISK_LABEL[s.r.label]} · ${pct(s.r.permille, 1)}`, s.r.factors.map((f) => `${f.text} (×${(f.multiplier / 1000).toFixed(2)})`).join(" · ")])}
        caption="Worked out by the game's own risk rules when this page is built."
      />
      <List
        items={[
          <>
            <b>Durability</b> always counts: the soundest horses carry well under the base risk, the most fragile well over it.
          </>,
          <>
            <b>Going:</b> {(Object.keys(gc.GOING_RISK) as (keyof typeof gc.GOING_RISK)[]).map((g) => `${g} ×${(gc.GOING_RISK[g] / 1000).toFixed(1)}`).join(", ")}.
          </>,
          <>
            <b>The ride:</b> {(Object.keys(gc.INTENSITY_RISK) as gc.RideIntensity[]).map((i) => `${INTENSITY_LABEL[i].toLowerCase()} ×${(gc.INTENSITY_RISK[i] / 1000).toFixed(1)}`).join(", ")}.
            An all-out ride and a very tired horse also make an injury more likely to be career-ending.
          </>,
          <>
            <b>Fragile legs</b> (inherited) ×{(gc.FRAGILE_RISK / 1000).toFixed(1)}. See <WikiLink slug="fragile-legs" />.
          </>,
          <>
            <b>Iron legs</b> (inherited, dominant) ×{(gc.IRON_LEGS_RISK / 1000).toFixed(1)}: the one gene that lowers the risk. A bigger horse also carries a little less durability. See{" "}
            <WikiLink slug="breeds" />.
          </>,
        ]}
      />

      <H2 id="severity">The four severities</H2>
      <Table
        head={["Severity", "Time to heal", "What it means"]}
        rows={(Object.keys(gc.INJURY_DAYS) as gc.InjurySeverity[]).map((s) => {
          const [lo, hi] = gc.INJURY_DAYS[s];
          return [
            SEVERITY_LABEL[s],
            s === "fatal" ? "–" : lo === hi ? `${lo} days` : `${lo} to ${hi} days`,
            s === "minor"
              ? "A few days off, then back to racing."
              : s === "moderate"
                ? "A longer rest, then back to racing."
                : s === "career_ending"
                  ? "No more racing. Once healed the horse can still go to stud or become a broodmare."
                  : "The horse dies. Live races only.",
          ];
        })}
      />
      <P>When an injury does happen, this is how it turns out at the base career-ending chance, from 4,000 injuries rolled by the game&rsquo;s own code:</P>
      <ShareBar
        label="What 4,000 injuries in Live races turned out to be"
        parts={[
          { label: "Minor", value: live.minor, color: "#9fe0a8" },
          { label: "Moderate", value: live.moderate, color: "#8fa592" },
          { label: "Career-ending", value: live.career_ending, color: "#d9a441" },
          { label: "Fatal", value: live.fatal, color: "#ff8a7a" },
        ]}
      />
      <Callout tone="rule" title="Fatal injuries">
        <p>
          Only Live races can be fatal: {pct(gc.FATAL_SHARE_OF_CAREER_ENDING)} of career-ending injuries there. Story races and training never are, and a training knock is always minor.
          For the starter above on a normal ride, the chance of a career-ending injury is {oneInText(careerEndingPerStart)} starts, and of a fatal one{" "}
          {oneInText(fatalPerStart)}.
        </p>
        <p>
          A horse lost this way rests on the Legacy Farm, in memoriam. Its record stays, and its foals carry the line on. If it was insured, the insurance pays. See{" "}
          <WikiLink slug="legacy-farm" />.
        </p>
      </Callout>

      <H2 id="healing">Healing, care and the vet</H2>
      <P>Injuries heal in real time, even while you are away. You can speed it up:</P>
      <List
        items={[
          <>
            <b>Care</b>: each daily care session takes <b>{gc.CARE_HEAL_BONUS_H} hours</b> off. Feed Recovery; see <WikiLink slug="care-and-condition" />.
          </>,
          <>
            <b>Vet treatment</b>: <b>{formatCredits(gc.VET_TREATMENT_COST)}</b> credits takes <b>{gc.VET_HEAL_BONUS_H} hours</b> off, once per injury per day.
          </>,
          <>
            <b>The Vet facility</b> makes every hour of healing count for more, level by level (up to {vetLevels}). See <WikiLink slug="facilities" />.
          </>,
        ]}
      />
      <Table
        head={["Vet facility", "Left alone", "Daily care", "Daily care and vet treatment"]}
        rows={heal.map((r) => [r.lv === 0 ? "None" : `Level ${r.lv}`, `${r.alone} days`, `${r.care} days`, `${r.vet} days`])}
        caption={`Days to heal a ${moderateHours / 24}-day moderate injury, worked out by the game's own healing rules.`}
      />
      <P>An injured horse can&rsquo;t race and can only rest in training until it is healed.</P>

      <H2 id="insurance">Insurance</H2>
      <P>
        You can insure any horse that is still racing, from its Care tab. You pay one premium, <b>{pct(gc.INSURANCE_PREMIUM_PERMILLE)}</b> of the horse&rsquo;s appraised value, and if an
        injury ever ends its racing career (career-ending or fatal) you receive <b>{pct(gc.INSURANCE_PAYOUT_PERMILLE)}</b> of its appraisal. The appraisal is the market&rsquo;s view of
        the horse: what is known of its potential, its record and its breedings left. See <WikiLink slug="the-market" />.
      </P>
      <Facts
        title="Insuring the starter above"
        rows={[
          ["Appraisal", `${formatCredits(appraisal)} credits`],
          ["Premium, paid once", `${formatCredits(gc.insurancePremium(h))} credits`],
          ["Pays if its career ends through injury", `${formatCredits(gc.insurancePayout(h))} credits`],
          ["Career-ending risk per start (normal ride)", oneInText(careerEndingPerStart)],
        ]}
      />
      <Callout tone="gamble">
        <p>
          For most horses insurance is a small, sure cost against a rare loss. It is worth most on a valuable horse you plan to race hard, often, or as a veteran, when the risk climbs.
        </p>
      </Callout>
      <Callout tone="tip">
        <p>
          Before an important start, check the risk line on the entry sheet. Resting a tired horse a day, avoiding heavy ground or riding normally instead of all-out each cut the risk.
        </p>
      </Callout>
    </>
  );
}
