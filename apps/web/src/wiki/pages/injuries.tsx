import { Fragment } from "react";
import * as gc from "@thoroughbred/game-core";
import { formatCredits, formatDistance } from "@/lib/format";
import { Callout, Facts, Figure, H2, H3, Lead, List, P, Table, WikiLink, pct } from "../kit";

const SEVERITY_TITLE: Record<gc.InjurySeverity, string> = {
  minor: "Minor injuries",
  moderate: "Moderate injuries",
  career_ending: "Career-ending injuries",
  fatal: "Fatal injuries",
};
const SEVERITY_NOTE: Record<gc.InjurySeverity, string> = {
  minor: "A few days off, then back to racing.",
  moderate: "A longer box rest, then back to racing.",
  career_ending: "The horse can't race again. These heal well enough for a comfortable life: stud, the broodmare band or the Legacy Farm.",
  fatal: "Live races only, never Story races or training. Rare, and written about calmly.",
};
const SEVERITIES: gc.InjurySeverity[] = ["minor", "moderate", "career_ending", "fatal"];

const daysText = (d: readonly [number, number]) => (d[0] === d[1] ? `${d[0]} days` : `${d[0]} to ${d[1]} days`);

/** The likeliest injury of a severity in a context, and its share of that severity (exact, game-core). */
function topOf(ctx: gc.InjuryContext, sev: gc.InjurySeverity): string {
  const all = gc.injuryKindShares(ctx, gc.CAREER_ENDING_SHARE).filter((k) => k.spec.severity === sev);
  const total = all.reduce((a, k) => a + k.share, 0);
  const top = all[0]!;
  return `${top.spec.name} (${pct(Math.round((top.share * 1000) / total))})`;
}

export default function InjuriesPage() {
  const contexts: { what: string; ctx: gc.InjuryContext }[] = [
    { what: `Good going, ${formatDistance(1600)}, normal ride`, ctx: { going: "good", distanceM: 1600, intensity: "normal" } },
    { what: `Firm going, ${formatDistance(1200)} sprint`, ctx: { going: "firm", distanceM: 1200, intensity: "normal" } },
    { what: `Heavy going, tired, ${formatDistance(2800)}`, ctx: { going: "heavy", distanceM: 2800, intensity: "normal", tired: true } },
    { what: "All-out ride, fragile legs", ctx: { going: "good", distanceM: 1600, intensity: "all_out", fragile: true } },
    { what: "A veteran on firm going", ctx: { going: "firm", distanceM: 1600, intensity: "normal", veteran: true } },
  ];
  const ce = gc.CAREER_ENDING_SHARE;
  return (
    <>
      <Lead>
        Racehorses get hurt the way real racehorses do: sore shins on firm ground, a strained tendon at the end of a long, tiring race, a bruised foot from a stone. Every injury in the game has a
        name, a place on the horse and a typical recovery time. Most are minor. A few end a racing career, and in Live races a very few are fatal.
      </Lead>
      <Figure src="/art/scenes/vet-room.png" alt="The vet checking a horse's foreleg in the vet room" caption="Injured horses rest in their stalls; healing carries on while you are away." focus={0.55} />

      <H2 id="catalogue">Every injury, by severity</H2>
      <P>
        The game first decides whether a horse is hurt and how badly, exactly as described in <WikiLink slug="injuries-and-insurance" />. Then it names the injury: one of the injuries of that
        severity that heal in that time, picked with the context of the race in mind. The name never changes the chance of being hurt or how long it takes to heal.
      </P>
      {SEVERITIES.map((sev) => {
        const kinds = gc.INJURY_KINDS.filter((k) => k.severity === sev);
        return (
          <Fragment key={sev}>
            <H3>{SEVERITY_TITLE[sev]}</H3>
            <P>{SEVERITY_NOTE[sev]}</P>
            <Table
              head={["Injury", "Likelier with"]}
              rows={kinds.map((k) => [
                <span key={k.key} className="block min-w-[11rem]">
                  <b>{k.name}</b>
                  <span className="block text-sm font-bold text-sage">
                    {gc.INJURY_AREA_LABEL[k.area]}
                    {sev === "fatal" ? "" : ` · ${daysText(k.days)}`}
                  </span>
                  <span className="block font-normal text-cream-dim">{k.description}</span>
                </span>,
                gc.injuryLikelierText(k),
              ])}
            />
          </Fragment>
        );
      })}

      <H2 id="context">What makes one injury likelier than another</H2>
      <P>The race itself shapes which injury it is, if one happens:</P>
      <List
        items={[
          <>
            <b>Firm going</b>: sore shins, bruised feet, splints and fractures.
          </>,
          <>
            <b>Soft or heavy going</b>: tendon and suspensory strains, foot abscesses and lost shoes.
          </>,
          <>
            <b>Long trips</b> (over {formatDistance(gc.INJURY_LONG_OVER_M)}) <b>and tiredness</b>: tying-up, tendon trouble and bleeding from the lungs.
          </>,
          <>
            <b>Sprints</b> ({formatDistance(gc.INJURY_SPRINT_MAX_M)} or less): sore shins and splints.
          </>,
          <>
            <b>An all-out ride</b>: tendons and fractures. <b>Fragile legs</b>: fractures and tendons. <b>Veteran legs</b>: chronic joint damage.
          </>,
          <>
            <b>Deep ground when tired</b>: tying-up and back strain.
          </>,
        ]}
      />
      <Table
        head={["Context", "Likeliest minor", "Likeliest moderate", "Likeliest career-ending"]}
        rows={contexts.map((c) => [c.what, topOf(c.ctx, "minor"), topOf(c.ctx, "moderate"), topOf(c.ctx, "career_ending")])}
        caption="If an injury of that severity happens, the injury it most likely is, and how often, worked out by the game's own naming rules."
      />
      <Callout tone="tip">
        <p>
          Under the risk line, the entry sheet names the injuries most likely for the race and ride you pick, and the likeliest serious one: &ldquo;Most likely if injured today: sore
          shins, knocked joint; if serious, hairline fracture&rdquo;. Most injuries are minor, so the first names usually are too.
        </p>
      </Callout>

      <H2 id="risk">How the risk works</H2>
      <P>
        Every rated start begins from <b>{pct(gc.BASE_INJURY_PERMILLE, 1)}</b>. These factors multiply it, up to a ceiling of <b>{pct(gc.MAX_INJURY_PERMILLE)}</b>:
      </P>
      <List
        items={[
          <>
            <b>Durability</b>: from ×1.6 for the most fragile type to ×0.6 for the soundest.
          </>,
          <>
            <b>Fatigue</b>: above {Math.round(gc.TIRED_THRESHOLD / 10)}% fatigue, up to ×3 when exhausted.
          </>,
          <>
            <b>Frequency</b>: +0.4 for each run already today, +0.1 for each run over 6 in a week.
          </>,
          <>
            <b>Going</b>: {(Object.keys(gc.GOING_RISK) as (keyof typeof gc.GOING_RISK)[]).map((g) => `${g} ×${(gc.GOING_RISK[g] / 1000).toFixed(1)}`).join(", ")} (shoes for the going halve the extra).
          </>,
          <>
            <b>The ride</b>: {(Object.keys(gc.INTENSITY_RISK) as gc.RideIntensity[]).map((i) => `${i.replace("_", "-")} ×${(gc.INTENSITY_RISK[i] / 1000).toFixed(1)}`).join(", ")}.
          </>,
          <>
            <b>Distance</b>: ×1.1 over {formatDistance(2400)}. <b>Veteran legs</b>: ×1.2. <b>Fragile legs</b>: ×{(gc.FRAGILE_RISK / 1000).toFixed(1)}. <b>Iron legs</b>: ×
            {(gc.IRON_LEGS_RISK / 1000).toFixed(1)}. <b>Pre-race vet check</b>: ×{(gc.VET_CHECK_RISK_PERMILLE / 1000).toFixed(2)}.
          </>,
        ]}
      />
      <P>
        If an injury happens, it is career-ending {pct(ce)} of the time at baseline; more if the horse was very tired (over 70% fatigue, +{pct(30)}) or ridden all-out (+{pct(20)}). Of the rest,{" "}
        {pct(300)} are moderate and {pct(700)} minor. Training only ever causes minor knocks, and only when a tired horse is worked hard.
      </P>

      <H2 id="career-ending">Career-ending and fatal injuries</H2>
      <List
        items={[
          <>
            A <b>career-ending</b> injury retires the horse from racing at once. It still heals (14 to 21 days), and after that a mare can join your broodmares and a stallion can stand at
            stud, or the horse can retire to the Legacy Farm. If it was insured, the insurance pays.
          </>,
          <>
            A <b>fatal</b> injury happens only in Live races: {pct(gc.FATAL_SHARE_OF_CAREER_ENDING)} of career-ending injuries there. Story races, trials and training are never fatal. The
            horse rests on the Legacy Farm in memoriam, its record stays in your books and the Hall, and any foals carry the line on. See <WikiLink slug="legacy-farm" />.
          </>,
        ]}
      />

      <H2 id="inherited">Fragile legs run in families</H2>
      <P>
        A horse whose racing ended in an injury can pass <b>fragile legs</b> to its foals: {pct(gc.FRAGILE_FROM_INJURY_PERMILLE)} of the time for each such parent, and a fragile parent
        passes its own gene as well. Fragile legs cost {Math.abs(gc.FRAGILE_DURABILITY_PENALTY)} durability potential and multiply the injury risk by {(gc.FRAGILE_RISK / 1000).toFixed(1)},
        and make fractures and tendon injuries the likelier kinds. See <WikiLink slug="fragile-legs" />.
      </P>

      <H2 id="healing">Healing: rest, care and the vet</H2>
      <P>Healing runs in real time, even while you are away. You can speed it up:</P>
      <Facts
        title="What helps"
        rows={[
          ["Rest", "Every real hour heals an hour"],
          ["A care session (once a day)", `${gc.CARE_HEAL_BONUS_H} hours off`],
          ["Vet treatment (once a day)", `${gc.VET_HEAL_BONUS_H} hours off, ${formatCredits(gc.VET_TREATMENT_COST)} credits`],
          ["The Vet facility", "Each level makes an hour of healing count 25% more"],
        ]}
      />
      <P>
        The horse page shows the injury by name, where it is, what it is and how long until it heals. Days and costs for each vet level are worked out in <WikiLink slug="injuries-and-insurance" />.
      </P>

      <H2 id="in-foal">Mares in foal don&rsquo;t race</H2>
      <P>
        A mare carrying a foal can&rsquo;t be entered in a race. The other way round, a mare entered in a race that hasn&rsquo;t run yet can&rsquo;t be covered: scratch her while entries are
        open, or cover her after the race. The horse page and the entry sheet show &ldquo;In foal · can race again after foaling (in N h)&rdquo;; a pregnancy lasts{" "}
        {Math.round(gc.PREGNANCY_MS / 3_600_000)} hours. See <WikiLink slug="stud-and-broodmares" />.
      </P>
    </>
  );
}
