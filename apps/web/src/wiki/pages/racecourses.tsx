import * as gc from "@thoroughbred/game-core";
import { CourseMap, SceneryThumb } from "@/components/race/CourseMap";
import { SURFACE_LABEL, formatDistance, furlongs } from "@/lib/format";
import { Callout, Facts, H2, H3, Lead, List, P, Table, WikiLink } from "../kit";

const SHAPE: Record<gc.CourseShape, string> = { oval: "Oval", pear: "Pear", triangle: "Triangle", horseshoe: "Horseshoe" };
const SCENERY: Record<gc.CourseScenery, string> = {
  parkland: "Parkland: old oaks and poplars, a Victorian grandstand with a striped roof",
  chalk_downs: "Chalk downs: rolling downland with a white horse cut into the hill, windswept thorns and gorse",
  coastal: "Coast: the open sea and a lighthouse, sand dunes, beach huts and an Art Deco stand",
  city: "City: a skyline of towers and spires, terraced streets and a steel-and-glass stand",
  meadow: "Meadow: wildflowers, weeping willows, a windmill and a thatched pavilion with marquees",
  moorland: "Moorland: heather moors and granite tors, dry-stone walls and a millstone grandstand",
};

function gradient(c: gc.Course): string {
  const p = c.finishGradientPermille;
  if (p === 0) return "Flat";
  return `${p > 0 ? "Uphill" : "Downhill"} ${Math.abs(p) / 10}% to the line`;
}

function bends(c: gc.Course): string {
  return c.bendTightness >= 700 ? "Tight" : c.bendTightness >= 450 ? "Medium" : c.bendTightness >= 300 ? "Wide" : "Sweeping";
}

/** Keep "2,400 m" on one line in narrow table cells. */
const nb = (s: string) => s.replace(/ /g, "\u00a0");

/** A sample race distance that shows the start marker on the map (a mile, or a lap and a bit on short tracks). */
const SAMPLE_M = 1600;

export default function RacecoursesPage() {
  const courses = gc.COURSES;
  const longest = [...courses].sort((a, b) => b.homeStraightM - a.homeStraightM)[0]!;
  const tightest = [...courses].sort((a, b) => b.bendTightness - a.bendTightness)[0]!;
  const uphill = courses.filter((c) => c.finishGradientPermille > 0);
  return (
    <>
      <Lead>
        There are <b>{courses.length} racecourses</b>, and no two race alike. Each has its own shape, its own way round, its own home straight and its own scenery on the broadcast. Every race
        names its course on the racecard, and the race viewer shows a small overhead <b>course map</b> with the field moving round it.
      </Lead>

      <H2 id="at-a-glance">At a glance</H2>
      <Table
        head={["Course", "Shape", "Way round", "Lap", "Home straight", "Finish", "Surfaces"]}
        rows={courses.map((c) => [
          c.name,
          SHAPE[c.shape],
          `${c.direction === "left" ? "Left" : "Right"}-handed`,
          nb(formatDistance(c.circumferenceM)),
          nb(formatDistance(c.homeStraightM)),
          gradient(c),
          c.surfaces.map((s) => SURFACE_LABEL[s]).join(", "),
        ])}
        caption="Read from the course definitions the game itself uses."
      />
      <P>
        A <b>left-handed</b> course turns left all the way round (anticlockwise seen from above); a <b>right-handed</b> one turns right. The <b>home straight</b> runs from the last bend
        to the winning post: a long one gives late finishers time to come through, a short one with tight bends favours horses that lead early and hold a good position on the rail.
      </P>

      <H2 id="the-courses">The six courses</H2>
      {courses.map((c) => (
        <section key={c.id} className="mb-6" aria-labelledby={`course-${c.id}`}>
          <H3>
            <span id={`course-${c.id}`}>{c.name}</span>
          </H3>
          <P>
            <i>{c.character}</i>
          </P>
          <div className="my-3 grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <SceneryThumb course={c} className="w-full" />
            <figure className="inset m-0 p-2">
              <CourseMap course={c} distanceM={SAMPLE_M} cells={56} className="h-auto w-full" />
              <figcaption className="caption mt-1">
                {SHAPE[c.shape]}, {c.direction}-handed. Green: where a {formatDistance(SAMPLE_M)} race starts.
              </figcaption>
            </figure>
          </div>
          <Facts
            title={`${c.name} by the numbers`}
            rows={[
              ["Way round", `${c.direction === "left" ? "Left" : "Right"}-handed (${c.direction === "left" ? "anticlockwise" : "clockwise"})`],
              ["One lap", `${formatDistance(c.circumferenceM)} (${furlongs(c.circumferenceM)})`],
              ["Home straight", formatDistance(c.homeStraightM)],
              ["Bends", bends(c)],
              ["Finish", gradient(c)],
              ["Surfaces", c.surfaces.map((s) => SURFACE_LABEL[s]).join(", ")],
              ["Scenery", SCENERY[c.scenery]],
            ]}
          />
        </section>
      ))}

      <H2 id="course-map">Reading the course map</H2>
      <P>
        The course map sits in the corner of the race broadcast (tap its title bar to fold it away on a phone) and next to the race name on the racecard. It is drawn from the same course
        definitions as everything else:
      </P>
      <List
        items={[
          <>The outline is the course seen from above, with a small brass arrow showing the way the horses run.</>,
          <>
            The <b>red and white bar</b> is the winning post, at the end of the home straight along the bottom.
          </>,
          <>
            The <b>green bar</b> is where this race starts. A race longer than one lap starts further round and passes the post on the way.
          </>,
          <>
            An <b>amber</b> stretch before the post is an uphill finish (blue would be downhill); during the race a <b>▲ Uphill</b> flag shows while the leaders are on it.
          </>,
          <>
            In the race, each runner is a dot in its silks colour. The leader has a brass frame and your own horse a white one. The dots only ever show what the broadcast has already
            shown, so a live race is never spoiled.
          </>,
        ]}
      />

      <H2 id="what-suits-where">What suits where</H2>
      <P>
        A course tilts a race towards a type of horse; it never decides it. The best horse on the day still usually wins, but it is worth matching your runner to the track when you{" "}
        <WikiLink slug="entering-a-race">enter a race</WikiLink>:
      </P>
      <List
        items={[
          <>
            <b>{longest.name}</b> has the longest straight ({formatDistance(longest.homeStraightM)}): time for closers to come from behind.
          </>,
          <>
            <b>{tightest.name}</b> has the tightest bends: front-runners and low draws are hard to pass.
          </>,
          ...uphill.map((c) => (
            <>
              <b>{c.name}</b> climbs {Math.abs(c.finishGradientPermille) / 10}% over the final stretch: stamina tells at the end. On the broadcast you see the field run uphill to the post.
            </>
          )),
          <>The weather and the going still apply on top of the course: see <WikiLink slug="how-races-are-run">how races are run</WikiLink>.</>,
        ]}
      />
      <Callout tone="tip" title="Where is my race run?">
        The course is part of the race name (&ldquo;{courses[0]!.name} &hellip;&rdquo;) and is shown with its map on the race page, so you can check the shape and the finish before the
        off.
      </Callout>
    </>
  );
}
