import * as gc from "@thoroughbred/game-core";
import { RULES } from "@thoroughbred/db";
import { Callout, Facts, GameLink, H2, Lead, List, P, WikiLink } from "../kit";

export default function PlanningPage() {
  const horizonH = RULES.cardHorizonMs / 3_600_000;
  const reminderH = gc.PLAN_CLOSE_REMINDER_MS / 3_600_000;
  const aheadDays = gc.PLAN_CALENDAR_AHEAD_MS / 86_400_000;
  const exampleRest = gc.restHoursAfter(420);
  return (
    <>
      <Lead>
        A campaign is a plan: aim a horse at a race in advance and the game checks the plan against the rules, reminds you when entries open, and tidies up after the race.
      </Lead>

      <H2 id="targets">Targets</H2>
      <P>
        On a horse&rsquo;s page, or on <GameLink href="/week">This week</GameLink>, pin a race as a target. You can aim at any Live race on the published card (the next {horizonH} hours) or at a
        calendar race up to {aheadDays} days ahead: the Feature Qualifiers, the Weekend Feature and the Season Finals. A calendar race can be pinned before it is on the card. Each horse can
        have up to {gc.MAX_TARGETS_PER_HORSE} targets at a time.
      </P>
      <P>
        A target leaves the plan by itself, with a note, when the horse runs in the race, is scratched from it, can no longer run in it (out of the rating band at its best, too many wins
        for a maiden, retired, sold) or when entries close without an entry.
      </P>

      <H2 id="checks">The checks</H2>
      <List
        items={[
          <>Eligibility now: the rating band and conditions, starts left, an injury that runs past the off, and for the Weekend Feature whether the horse has qualified yet.</>,
          <>
            Freshness: the peak comes {gc.FRESHNESS_PEAK_FROM_H} to {gc.FRESHNESS_PEAK_TO_H} hours after the last hard work (see <WikiLink slug="care-and-condition">Care &amp; condition</WikiLink>
            ). A race is hard work too, so each target counts from the one before it.
          </>,
          <>
            Clashes: one Live race per horse per day, and no target inside the hours a race leaves the horse tired (fatigue recovers {gc.FATIGUE_RECOVERY_PER_HOUR} points an hour, so a race
            that adds 420 needs {exampleRest} hours).
          </>,
          <>The entry window: entries open when the race is published on the card ({horizonH} hours ahead) and close just before the off.</>,
        ]}
      />

      <H2 id="reminders">Reminders and entering</H2>
      <P>
        If the horse isn&rsquo;t entered yet, your inbox gets one reminder when entries open and one {reminderH} hours before they close. While entries are open, &ldquo;Enter now&rdquo; on the
        target opens the usual entry sheet for that race.
      </P>
      <Callout title="A plan is not an entry">Pinning a target costs nothing and enters nothing: you still enter the race yourself, with its entry cost.</Callout>
      <Facts
        rows={[
          ["Targets per horse", String(gc.MAX_TARGETS_PER_HORSE)],
          ["Calendar races ahead", `${aheadDays} days`],
          ["Freshness peak", `${gc.FRESHNESS_PEAK_FROM_H}-${gc.FRESHNESS_PEAK_TO_H} h after hard work`],
          ["Closing reminder", `${reminderH} h before entries close`],
        ]}
      />
    </>
  );
}
