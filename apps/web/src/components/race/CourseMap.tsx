import { CourseMap as PixelCourseMap, SCENERY, describeCourse } from "@thoroughbred/race-viewer";
import { courseByName, type Course } from "@thoroughbred/game-core";
import { formatDistance } from "@/lib/format";

/**
 * The racecourse's overhead map (pixel art, drawn from game-core's course geometry): the
 * outline in its running direction, the winning post, the start for `distanceM` and the
 * finish gradient. Static: no runners (the race HUD draws those from the broadcast frames).
 * Renders on the server or the client.
 */
export function CourseMap({ course, distanceM, className, cells }: { course: Course; distanceM?: number; className?: string; cells?: number }) {
  return <PixelCourseMap course={course} distanceM={distanceM} cells={cells} className={className} />;
}

/** "Right-handed · 2,400 m round · 500 m straight · uphill finish" */
export function courseFacts(course: Course): string {
  const parts = [`${course.direction === "left" ? "Left" : "Right"}-handed`, `${formatDistance(course.circumferenceM)} round`, `${formatDistance(course.homeStraightM)} straight`];
  if (course.finishGradientPermille > 0) parts.push("uphill finish");
  else if (course.finishGradientPermille < 0) parts.push("downhill finish");
  return parts.join(" · ");
}

/**
 * Racecard header strip: the small course map (start marked for this race), the course
 * name and its one-line character. Nothing for an unknown track.
 */
export function CourseStrip({ track, distanceM }: { track: string | null | undefined; distanceM: number }) {
  const course = courseByName(track);
  if (!course) return null;
  return (
    <section className="surface flex items-center gap-3 p-2 pr-3" aria-label={`Racecourse: ${course.name}`} data-testid="course-strip">
      <CourseMap course={course} distanceM={distanceM} cells={48} className="h-auto w-[5.5rem] shrink-0 sm:w-28" />
      <div className="min-w-0">
        <p className="eyebrow !text-[0.625rem]">Racecourse</p>
        <p className="t-serif text-[1.0625rem] leading-6 text-cream">{course.name}</p>
        <p className="text-sm leading-5 text-cream-dim">{course.character}</p>
        <p className="t-meta mt-0.5" title={describeCourse(course, distanceM)}>
          {courseFacts(course)} · starts {formatDistance(distanceM)} out
        </p>
      </div>
    </section>
  );
}

/**
 * A small picture of a course's scenery from the broadcast's own art: its far panorama, a
 * piece of its midground and its grandstand, over a golden-hour sky (pixel-crisp).
 */
export function SceneryThumb({ course, className }: { course: Course; className?: string }) {
  const r = SCENERY[course.scenery];
  const far = `/art/${r.far ?? "race/far-hills.png"}`;
  const mid = r.mid === "trees" ? "/art/race/bb-tree-oak.png" : `/art/${r.mid.items[0]!.src}`;
  const stand = `/art/${r.stand}`;
  const grass = `linear-gradient(${r.railFill[0]}, ${r.railFill[1]})`;
  return (
    <div
      className={`relative overflow-hidden border-2 border-ink ${className ?? ""}`}
      style={{ aspectRatio: "16 / 7", background: "linear-gradient(#6f97c4, #f3d29a 70%, #ffd79a)" }}
      role="img"
      aria-label={`${course.name} scenery`}
      data-testid="scenery-thumb"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={far} alt="" className="pixelated absolute bottom-[14%] left-0 h-auto w-[200%] max-w-none" draggable={false} loading="lazy" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mid} alt="" className="pixelated absolute bottom-[12%] left-[2%] h-auto w-[34%] max-w-none" draggable={false} loading="lazy" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={stand} alt="" className="pixelated absolute bottom-[12%] right-[2%] h-auto w-[52%] max-w-none" draggable={false} loading="lazy" />
      <div className="absolute inset-x-0 bottom-0 h-[14%]" style={{ background: grass, boxShadow: "inset 0 2px 0 #f4f4ef" }} />
    </div>
  );
}
