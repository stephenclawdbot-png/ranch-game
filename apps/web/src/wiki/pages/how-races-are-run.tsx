import * as gc from "@thoroughbred/game-core";
import {
  BATTLE_AHEAD_MM,
  BATTLE_BASE,
  BATTLE_BEHIND_MM,
  BATTLE_FROM_MM,
  BATTLE_GRIT,
  BATTLE_TEMPER,
  BEND_LANE_LOSS_MM,
  BEND_PASS_CUT,
  DRAMA_FORM_PERMILLE,
  PACK_CARRY,
  PACK_PULL,
  GRADIENT_DRAIN,
  PRIZE_SPLIT_PCT,
  STRAIGHT_EASE_MAX,
  STRAIGHT_EASE_PER_100M,
  STRAIGHT_REF_M,
  TICK_HZ,
  marginLabel,
  simulateRace,
  verifyReplay,
} from "@thoroughbred/racing-engine";
import { HORSE_LENGTH_MM, LIVE_RACE_MODEL, PHOTO_FINISH_MM, formatRaceTime, type RaceInput, type RunningStyle } from "@thoroughbred/shared";
import { STYLE_LABEL, formatDistance, shortHash } from "@/lib/format";
import { Callout, Facts, Figure, H2, Lead, List, P, Steps, Table, WikiLink } from "../kit";
import { WHAT_IF_PER_HOUR } from "@/lib/whatIf";

const STYLES: RunningStyle[] = ["front", "stalker", "closer", "stalker", "front", "closer", "stalker", "closer"];

const EXAMPLE_COURSE = gc.courseById("ashcombe");

/** A real race: eight honest Club runners, a fixed seed, the game's own engine, at Ashcombe. */
function exampleRace() {
  const seed = gc.seedFrom("wiki", "example-race");
  const distanceM = 1600;
  const field = STYLES.map((style, i) => gc.clubRunner(seed, { id: `wiki-runner-${i + 1}`, strength: 480 + ((i * 37) % 60), distanceM, surface: "turf", style }));
  const input: RaceInput = {
    race: { id: "wiki-example", name: "Wiki Example Stakes", distanceM, surface: "turf", weather: "clear", going: "good", raceClass: "novice", postTimeMs: 0, purse: 0 },
    course: gc.courseProfile(EXAMPLE_COURSE),
    model: LIVE_RACE_MODEL,
    entries: field.map((horse, i) => ({ gate: i + 1, tactic: horse.style, horse })),
    seed,
  };
  const replay = simulateRace(input);
  // The same race entered in a different order: still the same result.
  const shuffled = simulateRace({ ...input, entries: [...input.entries].reverse() });
  const byId = new Map(field.map((h, i) => [h.id, { horse: h, gate: i + 1 }]));
  return { input, replay, byId, sameAgain: shuffled.result.resultHash === replay.result.resultHash, verified: verifyReplay(input, replay) };
}

export default function HowRacesAreRunPage() {
  const ex = exampleRace();
  const r = ex.replay.result;
  return (
    <>
      <Lead>
        Every race in Post Time is run by the same race engine: a step-by-step simulation of the horses, their stamina, their kick and the traffic around them. It has no hidden hand. The result
        is decided by the horses and one secret number, the race&rsquo;s seed, which is locked in before the off and published afterwards so anyone can check it.
      </Lead>
      <Figure src="/art/diorama/poster-track-dusk.png" alt="Runners going down to post at dusk" caption="Going down to post. The result was sealed before they left the paddock." focus={0.55} />

      <H2 id="engine">The race engine</H2>
      <P>
        The engine moves every horse forward {TICK_HZ} times a second of race time. Each horse runs from the stats it brought to the race: its speed, stamina and burst, adjusted for its
        condition, the trip, the surface and the going, plus its tactic. Front-runners go for the lead, stalkers sit just behind, closers save energy for one late run. Horses that go too fast
        too early run out of energy, horses stuck behind others have to find a way round, and the ones on the wide outside cover more ground.
      </P>
      <P>
        The engine is <b>deterministic</b>: given the same field and the same seed it produces exactly the same race, down to every frame and every hundredth of a second, on any computer. It uses
        whole-number maths only, so there is no rounding that could differ between machines. The seed supplies the small doses of luck a real race has: who breaks well, who gets a gap.
      </P>

      <H2 id="courses">Every course races differently</H2>
      <P>
        Live races are run on one of {gc.COURSES.length} racecourses, and the engine knows each one&rsquo;s shape: how tight its bends are, how long the run from the last bend to the post is,
        and whether the finish climbs or falls. The course is laid out back from the winning post, so a race&rsquo;s trip decides how many bends it runs. A course tilts a race towards a type of
        horse; it never decides it, and the best horse still usually wins anywhere.
      </P>
      <List
        items={[
          <>
            <b>Bends.</b> A horse racing wide covers extra ground round a bend: on the tightest bend up to {(BEND_LANE_LOSS_MM / 1000).toFixed(1)} metres for every lane out from the rail over a
            half-turn. Passing is harder while turning too (up to {BEND_PASS_CUT / 10}% fewer tries to switch out). Front-runners on the rail and horses drawn low gain on tight courses; a closer
            making its run round the turn loses.
          </>,
          <>
            <b>The home straight.</b> A long straight gives a finishing kick room: a horse kicking down it spends {STRAIGHT_EASE_PER_100M / 10}% less energy for every 100 metres of straight over{" "}
            {STRAIGHT_REF_M} m (at most {STRAIGHT_EASE_MAX / 10}%), and more on a shorter one. Closers, whose run is the longest, like long straights; on a short one it pays to be handy.
          </>,
          <>
            <b>An uphill finish</b> costs energy all the way up the straight ({GRADIENT_DRAIN / 10}% more for each 0.1% of rise, for a horse of average stamina), and the less stamina a horse has the
            more it pays: stayers come into their own. A slight downhill saves energy instead, which suits the speedier, shorter-winded horses.
          </>,
          <>
            <b>Left- or right-handed</b> is only how the course looks: no horse prefers a way round.
          </>,
        ]}
      />
      <Table
        head={["Course", "Bends", "Home straight", "Finish", "Character"]}
        rows={gc.COURSES.map((c) => [
          c.name,
          `${c.bendTightness >= 800 ? "Very tight" : c.bendTightness >= 500 ? "Tight" : c.bendTightness >= 300 ? "Fair" : "Sweeping"} (${c.bendTightness / 10}%)`,
          `${c.homeStraightM} m`,
          c.finishGradientPermille > 0 ? `Uphill ${(c.finishGradientPermille / 10).toFixed(1)}%` : c.finishGradientPermille < 0 ? `Downhill ${(-c.finishGradientPermille / 10).toFixed(1)}%` : "Flat",
          c.character,
        ])}
        caption="Bend tightness runs from 0% (sweeping) to 100% (very tight). The course is set on the racecard."
      />
      <P>
        The course&rsquo;s shape is locked into the field with the runners when entries close, and sealed into the result hash with the seed, so it can&rsquo;t change after the off. Story races, the
        Daily Cup and races run before courses raced differently have no course character.
      </P>

      <H2 id="close-finishes">Close finishes</H2>
      <P>
        Real races are rarely processions, and Post Time&rsquo;s aren&rsquo;t either. Two things in the engine keep evenly matched horses together to the line, so a narrow win, or a narrow
        defeat you can hope to turn round next time, is common. Neither looks at who owns a horse: they apply to every runner alike.
      </P>
      <List
        items={[
          <>
            <b>Racing in a pack.</b> Until a horse starts its finishing run, its pace is pulled {PACK_PULL / 10}% of the way towards the average pace of the field. A slightly slower horse is
            carried along in the slipstream (only {(1000 - PACK_CARRY) / 10}% of the extra effort costs it energy); a faster one is held up by the pace and saves a little for later. The field
            stays together instead of stringing out from the start, and the best horse shows it where it matters: at the finish.
          </>,
          <>
            <b>A battle to the line.</b> From the start of its finishing run (or the last {BATTLE_FROM_MM / 1_000_000 >= 1 ? `${BATTLE_FROM_MM / 1_000_000} km` : `${BATTLE_FROM_MM / 1000} m`}), a
            horse with a rival up to {(BATTLE_AHEAD_MM / HORSE_LENGTH_MM).toFixed(1)} lengths ahead to run down, or one within {(BATTLE_BEHIND_MM / HORSE_LENGTH_MM).toFixed(1)} length behind to
            hold off, finds more: about {(BATTLE_BASE / 1000).toFixed(2)} m/s, plus up to {(BATTLE_TEMPER / 1000).toFixed(2)} m/s more the more composed it is (a genuine horse fights harder),
            plus up to {(BATTLE_GRIT / 1000).toFixed(2)} m/s of fight on the day that nobody knows in advance. That effort doesn&rsquo;t drain its tank. So when two horses come to the last
            furlong together they usually stay together, and which one finds most decides it.
          </>,
        ]}
      />

      <H2 id="form">Form on the day</H2>
      <P>
        No horse runs to exactly the same level every time. Before each race the seed gives every runner its form on the day, a small rise or fall in its cruising pace, so a horse a few
        points below the best in the field still wins its share. Composed horses (high temperament) vary less; rain makes every horse vary a little more; a hired jockey keeps the run closer to
        the horse&rsquo;s true level. In Live races the swing is {DRAMA_FORM_PERMILLE / 10}% of what it was before close finishes came in, because the pack would otherwise turn it into too many
        upsets: a horse 7 points of rating below a rival still beats it about one time in three, and one 15 points below the best in an eight-runner field wins rarely.
      </P>
      <P>
        In a Live <b>handicap</b> the better horses carry more weight: the top-rated runner carries {gc.formatWeight(gc.TOP_WEIGHT_LB)}, and each of the others {gc.OR_PER_LB} lb less for every
        point of rating below it (never under {gc.formatWeight(gc.BOTTOM_WEIGHT_LB)}). Every pound costs a horse one point of rating&rsquo;s worth of ability, so on the ratings the weights put
        the whole field level, and handicaps finish closest of all. The weights are printed on the racecard when entries close.
      </P>

      <H2 id="improvement">Improvement</H2>
      <P>
        Horses improve as they mature (see the maturity type on a horse&rsquo;s career page) and with training. Some go further: about one horse in five is an <b>improver</b> (
        {gc.IMPROVER_PERMILLE.late / 10}% of late developers, {gc.IMPROVER_PERMILLE.normal / 10}% of normal ones, {gc.IMPROVER_PERMILLE.early / 10}% of early types). At a point in its career
        that nobody can see coming, an improver steps up {gc.IMPROVER_STEP_OR[0]}-{gc.IMPROVER_STEP_OR[1]} points of rating&rsquo;s worth of ability over {gc.IMPROVER_RUNS} runs and keeps it,
        filling out its genes sooner (never beyond its potential). The career page shows <b>Improving</b> once it has happened. Who improves is fixed for each horse and is the same whoever
        owns it; races already run are never changed.
      </P>

      <H2 id="sealed">Sealed before the off</H2>
      <Steps
        items={[
          <>
            When a race is put on the card, the game draws its secret <b>seed</b> and publishes only its <b>fingerprint</b> (a sha256 hash). The seed itself stays secret.
          </>,
          <>When entries close, the field is locked: every horse&rsquo;s race-day snapshot and tactic is stored, and the gates are drawn from the seed.</>,
          <>At the off, the engine runs the race from the locked field and the seed. The broadcast shows it as it happens; nobody receives the result before it is shown.</>,
          <>
            After the finish the seed is revealed with the result and its <b>result hash</b>, a fingerprint of the finishing order and times.
          </>,
          <>
            Press <b>Verify</b> on the race page: the game re-runs the race from the field and the seed and checks it gets the same result hash, and your own browser hashes the seed and checks it
            matches the fingerprint published before the off.
          </>,
        ]}
      />
      <Callout tone="rule" title="We choose the field, never the result">
        <p>
          The Club fills empty gates with its own horses, and in Story races the rival stables are set to the chapter&rsquo;s strength. Those horses are honest: plain stat lines, no hidden
          modifiers. Once the field is set, only the engine and the seed decide the race.
        </p>
      </Callout>

      <H2 id="example">A real race, run on this page</H2>
      <P>
        This race was run by the game&rsquo;s own engine while this page was built: eight Club horses over {formatDistance(ex.input.race.distanceM)} on good turf at {EXAMPLE_COURSE.name}. Run it
        again with the same seed and you get the same result every time.
      </P>
      <Table
        head={["Pos.", "Horse", "Gate", "Tactic", "Time", "Beaten by"]}
        rows={r.finishOrder.map((f) => {
          const e = ex.byId.get(f.horseId)!;
          return [f.position, e.horse.name, e.gate, STYLE_LABEL[e.horse.style], formatRaceTime(f.finishTimeUs), f.position === 1 ? "Winner" : f.marginLabel];
        })}
        caption="Beaten by: the distance to the horse one place ahead."
      />
      <Facts
        title="This race's seal"
        rows={[
          ["Fingerprint (published before the off)", <code key="c">{shortHash(ex.replay.seedCommitment, 8)}</code>],
          ["Seed (revealed after the finish)", <code key="s">{shortHash(ex.replay.seed, 8)}</code>],
          ["Result hash", <code key="h">{shortHash(r.resultHash, 8)}</code>],
          ["Re-run and checked", ex.verified ? "Yes: same result, frame for frame" : "No"],
          ["Same race, runners listed in another order", ex.sameAgain ? "Same result" : "Different result"],
          ["Photo finish", r.photoFinish ? "Yes" : "No"],
          ["Engine version", ex.replay.engineVersion],
        ]}
      />

      <H2 id="finish">Margins and the photo finish</H2>
      <P>
        Each horse is timed to the line and placed by its time. The margin to the horse in front is called the racing way: a nose, a short head, a head, a neck, then lengths. A length here is{" "}
        {HORSE_LENGTH_MM / 1000} metres.
      </P>
      <Table
        head={["Gap to the horse ahead", "Called"]}
        rows={[100, 300, 600, 1000, HORSE_LENGTH_MM / 2, HORSE_LENGTH_MM, HORSE_LENGTH_MM * 3, HORSE_LENGTH_MM * 20].map((mm) => [`${(mm / 1000).toFixed(2)} m`, marginLabel(mm) === "dist" ? "a distance" : marginLabel(mm)])}
      />
      <P>
        When the first two are less than {PHOTO_FINISH_MM / 10} centimetres apart, the race is a <b>photo finish</b> and the commentary calls for the photograph. There are no dead heats: the
        engine always puts one horse ahead of the other. Winning one earns the &ldquo;By a Nose&rdquo; plaque in your Trophy Room.
      </P>

      <H2 id="replays">Replays</H2>
      <P>
        Because a race is fully described by its field and its seed, every settled race can be replayed exactly as it was run, from the race page, and shared. The replay is the race itself, not a
        recording of it: re-running it gives the same frames.
      </P>
      <List
        items={[
          <>A Live race&rsquo;s result, seed and full replay are only released once the broadcast has shown the finish, so nobody can see a result early.</>,
          <>
            A purse is split {PRIZE_SPLIT_PCT.map((p) => `${p}%`).join(" / ")} among the first {PRIZE_SPLIT_PCT.length}. See <WikiLink slug="race-types" />.
          </>,
          <>
            The Daily Cup uses the same engine and the same sealing, with one seed for the whole day: <WikiLink slug="daily-cup" />.
          </>,
        ]}
      />
      <Callout tone="tip">
        <p>
          Lost a close one? Watch the replay before blaming the luck. Most races are lost on the tactic: a front-runner taken on for the lead, or a closer left with too much to do. Try a different
          plan, or a trip and ground that suit the horse better (<WikiLink slug="entering-a-race" />), or ask the race itself with a what-if (below).
        </p>
      </Callout>

      <H2 id="what-if">What if? re-runs</H2>
      <P>
        Because a race is its field plus its seed, a race that has been run can be run <b>again with one thing changed</b>, and everything else stays exactly as it was: the same
        runners in the same gates, the same course and going, the same race model and the same sealed seed. Every horse&rsquo;s luck (its form on the day, its break from the
        stalls, its pace and its fight) is drawn from that seed for its own gate, so it is the same luck as on the day. Only your change can move the result.
      </P>
      <Steps
        items={[
          <>
            Open a race your horse ran (the race page once the result is in, or a settled line in your form book) and tap <b>What if?</b>
          </>,
          <>
            Pick <b>one</b> change to your own runner: the tactic, the ride (conservative, normal or all out), the race-day extras that act on the track (soft-ground shoes on soft or
            heavy going, a physio session), or the jockey (another of your jockeys, or a typical Club freelancer of a grade).
          </>,
          <>See where you would have finished, how far behind the winner, the first five both ways and your horse&rsquo;s sectionals both ways. Then watch the what-if in the viewer.</>,
        ]}
      />
      <Facts
        title="The rules"
        rows={[
          ["When", "Only once the race has been run and the result is official (the seed is revealed then): no peeking at a race to come."],
          ["What can change", "One thing about your own runner. The other runners, the gates, the weights carried, the course, the going and the seed never change."],
          ["Engine", "The race re-runs on the engine version it was run with, so an older race stays an older race. A change that race couldn't have had (a jockey before jockeys) isn't offered."],
          ["Cost", `Free. ${WHAT_IF_PER_HOUR} fresh re-runs an hour; one you've already run is free to look at again.`],
          ["Official?", "Never. No credits, no rating, no form line, no record: it's labelled “What if (not official)” everywhere it shows, and the replay has no photo finish or weighed-in."],
        ]}
      />
      <Callout tone="tip">
        <p>
          A what-if answers &ldquo;was it the tactic or the horse?&rdquo; with the same luck, which no amount of re-entering can. If the closer would have won from the same gate on the same
          day, ride it as a closer next time. If nothing you change moves it, the horse needs a different race (<WikiLink slug="ratings-and-form" />).
        </p>
      </Callout>
    </>
  );
}
