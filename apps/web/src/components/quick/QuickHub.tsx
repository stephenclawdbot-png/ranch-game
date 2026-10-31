"use client";

/**
 * The Quick races hub (/quick): the daily challenge, match races and ghost races, one tab each,
 * then your latest quick races. Phone first: one column, big choices, one primary button.
 * Every race runs on the server and opens on its own page (/quick/:id) in the race viewer.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { RunningStyle, Surface } from "@thoroughbred/shared";
import { formatDistance, GOING_LABEL, ordinal, STYLE_LABEL, SURFACE_LABEL, WEATHER_LABEL } from "@/lib/format";
import { raceTimeText } from "@/lib/formBook";
import { GRADE_WORD, QUICK_MODE_LABEL, type DailyRequest, type DailyView, type GhostSourceView, type Intensity, type JockeyGrade, type MatchOpponent, type QuickHorse, type QuickHubView } from "@/lib/quickRaces";
import { useClockSkew } from "@/lib/clock";
import { Countdown } from "../Countdown";
import { HorsePortrait } from "../HorsePortrait";
import { JoinNudge } from "../PlayerGate";
import { SilksIcon } from "../Silks";
import { HashValue } from "../ui/HashValue";
import { EmptyState, HowItWorks } from "../ui/Page";

export type QuickTab = "daily" | "match" | "ghost";
const TABS: QuickTab[] = ["daily", "match", "ghost"];
const STYLES: RunningStyle[] = ["front", "stalker", "closer"];
const INTENSITIES: { v: Intensity; label: string; sub: string }[] = [
  { v: "conservative", label: "Steady", sub: "Saves stamina" },
  { v: "normal", label: "Normal", sub: "As it comes" },
  { v: "all_out", label: "All out", sub: "More burst, hotter" },
];
const GRADES: JockeyGrade[] = ["A", "B", "C", "D", "E"];

async function post(url: string, body: unknown): Promise<{ id: string }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok || !data.id) throw new Error(data.message ?? "That didn't run. Try again.");
  return { id: data.id };
}

/** A big tap target in a grid of choices (radio semantics). */
function Choice({ on, onClick, label, sub, testId, disabled }: { on: boolean; onClick: () => void; label: ReactNode; sub?: ReactNode; testId?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={`whatif-choice ${on ? "is-on" : "inset"} grid min-h-11 content-center px-2.5 py-1.5 text-left disabled:opacity-40`}
    >
      <span className="font-extrabold leading-5">{label}</span>
      {sub && <span className="text-xs text-cream-dim">{sub}</span>}
    </button>
  );
}

function Group({ title, aside, children, cols = "grid-cols-3" }: { title: string; aside?: ReactNode; children: ReactNode; cols?: string }) {
  return (
    <fieldset className="grid gap-1.5" role="radiogroup" aria-label={title}>
      <legend className="mb-1 flex w-full items-baseline justify-between gap-2">
        <span className="font-extrabold">{title}</span>
        {aside && <span className="text-xs text-cream-dim">{aside}</span>}
      </legend>
      <div className={`grid gap-1.5 ${cols}`}>{children}</div>
    </fieldset>
  );
}

function HorseSelect({ horses, value, onChange, testId }: { horses: QuickHorse[]; value: string; onChange: (id: string) => void; testId: string }) {
  const h = horses.find((x) => x.id === value);
  return (
    <label className="grid gap-1.5">
      <span className="font-extrabold">Your horse</span>
      <span className="flex items-center gap-3">
        {h && <HorsePortrait appearance={h.appearance} className="h-12 w-12 shrink-0" title={h.name} />}
        <select className="field min-w-0 flex-1" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
          {horses.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {x.rating ? ` · OR ${x.rating}` : ""} · {STYLE_LABEL[x.style]}
            </option>
          ))}
        </select>
      </span>
      {h && (
        <span className="text-xs text-cream-dim">
          Best at {formatDistance(h.bestTripM)} on {SURFACE_LABEL[h.surface].toLowerCase()} · a natural {STYLE_LABEL[h.style].toLowerCase()}
        </span>
      )}
    </label>
  );
}

function TacticGroup({ value, natural, onChange, prefix }: { value: RunningStyle; natural?: RunningStyle; onChange: (t: RunningStyle) => void; prefix: string }) {
  return (
    <Group title="Tactic" aside={natural ? `natural: ${STYLE_LABEL[natural].toLowerCase()}` : undefined}>
      {STYLES.map((t) => (
        <Choice key={t} on={value === t} onClick={() => onChange(t)} label={STYLE_LABEL[t]} testId={`${prefix}-tactic-${t}`} />
      ))}
    </Group>
  );
}

function Remaining({ left, perDay, what }: { left: number; perDay: number; what: string }) {
  return (
    <span className={`text-sm ${left === 0 ? "font-bold text-negative" : "text-cream-dim"}`} data-testid={`${what}-remaining`}>
      {left} of {perDay} {what} races left today
    </span>
  );
}

// ---------------------------------------------------------------------------
// The daily challenge
// ---------------------------------------------------------------------------

function DailyPanel({ d, signedIn, skew }: { d: DailyView; signedIn: boolean; skew: number }) {
  const router = useRouter();
  const [plan, setPlan] = useState<DailyRequest>({ tactic: d.horse.style, intensity: "normal", grade: "C" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function ride() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await post("/api/quick/daily", plan);
      router.push(`/quick/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const dateLabel = new Date(d.opensAtMs).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="grid gap-4" data-testid="daily-panel">
      <section className="surface grid gap-3 p-4" aria-labelledby="daily-h">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="daily-h" className="t-h2">
            Daily Challenge · {dateLabel}
          </h2>
          <span className="text-sm text-cream-dim">
            next in <Countdown targetMs={d.closesAtMs} skewMs={skew} doneLabel="a moment" />
          </span>
        </div>
        <p className="text-sm font-bold" data-testid="daily-conditions">
          {d.course.name} · {formatDistance(d.distanceM)} · {SURFACE_LABEL[d.surface]} · {GOING_LABEL[d.going]} · {WEATHER_LABEL[d.weather]}
        </p>
        <div className="flex items-center gap-3">
          <HorsePortrait appearance={d.horse.appearance} className="h-16 w-16 shrink-0" title={d.horse.name} />
          <div className="min-w-0">
            <p className="t-title">{d.horse.name}</p>
            <p className="text-sm text-cream-dim">
              The Club&rsquo;s horse for today · gate {d.gate} of {d.rivals.length + 1} · best at {formatDistance(d.horse.bestTripM)} on {SURFACE_LABEL[d.horse.surface].toLowerCase()} · a natural{" "}
              {STYLE_LABEL[d.horse.style].toLowerCase()}
            </p>
          </div>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer font-bold">The field ({d.rivals.length} Club rivals)</summary>
          <ol className="mt-2 grid gap-0.5">
            {[{ gate: d.gate, name: d.horse.name, tactic: d.horse.style, you: true }, ...d.rivals.map((r) => ({ ...r, you: false }))]
              .sort((a, b) => a.gate - b.gate)
              .map((r) => (
                <li key={r.gate} className={`flex items-baseline gap-2 px-1.5 py-0.5 ${r.you ? "whatif-mine font-extrabold" : ""}`}>
                  <span className="num w-5 text-right">{r.gate}</span>
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="text-xs text-cream-dim">{r.you ? "your ride" : STYLE_LABEL[r.tactic]}</span>
                </li>
              ))}
          </ol>
        </details>

        {d.mine ? (
          <div className="inset grid gap-2 p-3" data-testid="daily-mine">
            <p className="caption">Your attempt today</p>
            <p className="t-h2">
              {ordinal(d.mine.position)} in the race · {ordinal(d.mine.rank)} of {d.entrants} today
            </p>
            <p className="text-sm">
              {d.mine.points} {d.mine.points === 1 ? "point" : "points"}
              {d.mine.top && <span className="tag tag-ready ml-2">Top 10% so far</span>}
              <span className="text-cream-dim">
                {" "}
                · {STYLE_LABEL[d.mine.plan.tactic].toLowerCase()}, {INTENSITIES.find((i) => i.v === d.mine!.plan.intensity)?.label.toLowerCase()}, {GRADE_WORD(d.mine.plan.grade)}
              </span>
            </p>
            <Link href={`/quick/${d.mine.quickRaceId}`} className="btn btn-brass w-fit" data-testid="daily-watch">
              Watch your attempt
            </Link>
          </div>
        ) : !signedIn ? (
          <JoinNudge compact />
        ) : (
          <div className="grid gap-4" data-testid="daily-form">
            <TacticGroup value={plan.tactic} natural={d.horse.style} onChange={(t) => setPlan({ ...plan, tactic: t })} prefix="daily" />
            <Group title="The ride">
              {INTENSITIES.map((i) => (
                <Choice key={i.v} on={plan.intensity === i.v} onClick={() => setPlan({ ...plan, intensity: i.v })} label={i.label} sub={i.sub} testId={`daily-intensity-${i.v}`} />
              ))}
            </Group>
            <Group title="Rider" aside="a better rider carries more weight" cols="grid-cols-5">
              {GRADES.map((g) => (
                <Choice key={g} on={plan.grade === g} onClick={() => setPlan({ ...plan, grade: g })} label={g} sub={`${d.weights[g]} lb`} testId={`daily-grade-${g}`} />
              ))}
            </Group>
            {error && (
              <p className="font-bold text-negative" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-brass btn-lg" disabled={busy} onClick={ride} data-testid="daily-ride">
                {busy ? "Riding…" : "Take today's attempt"}
              </button>
              <span className="text-sm text-cream-dim">One attempt a day. Same horse, field and luck for everyone.</span>
            </div>
          </div>
        )}
      </section>

      <section className="surface grid gap-2 p-4" aria-labelledby="board-h" data-testid="daily-board">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="board-h" className="t-h2">
            Today&rsquo;s board
          </h2>
          <span className="text-sm text-cream-dim">{d.entrants === 1 ? "1 stable" : `${d.entrants} stables`}</span>
        </div>
        {d.board.length === 0 ? (
          <p className="t-meta">No one has ridden today&rsquo;s challenge yet.</p>
        ) : (
          <ol className="grid gap-0.5 text-sm">
            {d.board.map((l) => (
              <li key={`${l.rank}-${l.stableName}`} className={`flex items-center gap-2 px-1.5 py-1 ${l.mine ? "whatif-mine font-extrabold" : ""}`}>
                <span className="num w-7 shrink-0 text-right">{l.rank}</span>
                <SilksIcon silks={l.silks} className="h-6 w-6 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {l.stableName}
                  {l.top && <span className="ml-1.5 text-brass-bright" title="Top 10% of the day">★</span>}
                </span>
                <span className="num shrink-0">{ordinal(l.position)}</span>
                <span className="num w-14 shrink-0 text-right text-xs text-cream-dim">{raceTimeText(l.timeUs)}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-cream-dim">By finishing position, then time. Everyone&rsquo;s plans show once the day is over.</p>
      </section>

      {signedIn && (
        <div className="grid grid-cols-3 gap-2" data-testid="daily-stats">
          {(
            [
              ["Streak", d.streak.current, `best ${d.streak.best}`],
              ["Points", d.points, "all time"],
              ["Top 10% badges", d.badges, "finished days"],
            ] as const
          ).map(([k, v, sub]) => (
            <div key={k} className="surface grid gap-0.5 p-3 text-center">
              <span className="caption">{k}</span>
              <span className="num text-[1.5rem] leading-7">{v}</span>
              <span className="text-xs text-cream-dim">{sub}</span>
            </div>
          ))}
        </div>
      )}

      <HowItWorks label="Fair play: the sealed seed">
        <p>
          Today&rsquo;s luck was drawn when the challenge was published and sealed: its fingerprint is <HashValue value={d.seedCommitment} />. Every attempt today
          runs with that same luck, so the only difference between players is the plan. The seed itself is shown tomorrow, so nobody can try plans offline.
        </p>
        {d.yesterday && (
          <p data-testid="daily-yesterday">
            Yesterday&rsquo;s seed: <HashValue value={d.yesterday.seed} /> (fingerprint <HashValue value={d.yesterday.seedCommitment} />).{" "}
            {d.yesterday.mine ? (
              <>
                You were {ordinal(d.yesterday.mine.rank)} of {d.yesterday.entrants}
                {d.yesterday.mine.top ? " and earned a Top 10% badge" : ""}.{" "}
                <Link href={`/quick/${d.yesterday.mine.quickRaceId}`} className="link">
                  Replay
                </Link>
              </>
            ) : (
              <>{d.yesterday.entrants} stables rode it.</>
            )}
          </p>
        )}
        <p>
          Points: 10 for a win, 7 for 2nd, 5 for 3rd, 3 for 4th, 1 for taking part. The best tenth of the day earn a badge. No credits: the daily challenge is for
          bragging rights. <Link href="/wiki/quick-races" className="link">More in the wiki</Link>.
        </p>
      </HowItWorks>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match races
// ---------------------------------------------------------------------------

function useOpponentSearch(q: string): { results: MatchOpponent[]; loading: boolean } {
  const [results, setResults] = useState<MatchOpponent[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    setLoading(true);
    const id = window.setTimeout(() => {
      fetch(`/api/quick/opponents?q=${encodeURIComponent(t)}`)
        .then((r) => (r.ok ? (r.json() as Promise<MatchOpponent[]>) : []))
        .then((x) => live && setResults(x))
        .catch(() => live && setResults([]))
        .finally(() => live && setLoading(false));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [q]);
  return { results, loading };
}

function OpponentRow({ o, action }: { o: MatchOpponent; action: ReactNode }) {
  return (
    <li className="flex items-center gap-2 py-1.5">
      <HorsePortrait appearance={o.appearance} className="h-10 w-10 shrink-0" title={o.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-extrabold">{o.name}</span>
        <span className="block truncate text-xs text-cream-dim">
          {o.stableName}
          {o.rating ? ` · OR ${o.rating}` : ""} · {STYLE_LABEL[o.style]}
        </span>
      </span>
      {action}
    </li>
  );
}

function MatchPanel({ v, initialHorse, initialVs }: { v: QuickHubView; initialHorse?: string; initialVs?: string }) {
  const router = useRouter();
  const [horseId, setHorseId] = useState(v.horses.find((h) => h.id === initialHorse)?.id ?? v.horses[0]?.id ?? "");
  const horse = v.horses.find((h) => h.id === horseId);
  const [tactic, setTactic] = useState<RunningStyle>(horse?.style ?? "stalker");
  const [opponents, setOpponents] = useState<MatchOpponent[]>([]);
  const [q, setQ] = useState("");
  const { results, loading } = useOpponentSearch(q);
  const [courseId, setCourseId] = useState(v.courses[0]?.id ?? "ashcombe");
  const course = v.courses.find((c) => c.id === courseId) ?? v.courses[0]!;
  const [surface, setSurface] = useState<Surface>(horse?.surface && course.surfaces.includes(horse.surface) ? horse.surface : course.surfaces[0]!);
  const [distanceM, setDistanceM] = useState(() => (horse ? nearest(v.trips, horse.bestTripM) : 1600));
  const [going, setGoing] = useState<(typeof v.goings)[number]>("good");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = v.match.fieldMax - 1;

  // A challenge from a horse page, the racecard or a stable page: preload that horse.
  useEffect(() => {
    if (!initialVs) return;
    fetch(`/api/quick/opponents?ids=${encodeURIComponent(initialVs)}`)
      .then((r) => (r.ok ? (r.json() as Promise<MatchOpponent[]>) : []))
      .then((x) => x[0] && setOpponents((cur) => (cur.some((o) => o.id === x[0]!.id) ? cur : [x[0]!, ...cur].slice(0, max))))
      .catch(() => undefined);
  }, [initialVs, max]);

  function pickHorse(id: string) {
    setHorseId(id);
    const h = v.horses.find((x) => x.id === id);
    if (h) {
      setTactic(h.style);
      setDistanceM(nearest(v.trips, h.bestTripM));
    }
  }
  function pickCourse(id: string) {
    setCourseId(id);
    const c = v.courses.find((x) => x.id === id);
    if (c && !c.surfaces.includes(surface)) setSurface(c.surfaces[0]!);
  }
  const goingFor = (s: Surface) => (s === "synthetic" ? "good" : going);

  async function race() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await post("/api/quick/match", { horseId, opponentIds: opponents.map((o) => o.id), courseId, distanceM, surface, going: goingFor(surface), tactic });
      router.push(`/quick/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!v.signedIn) return <JoinNudge compact />;
  if (v.horses.length === 0) return <EmptyState title="No racing horses yet" text="A match race needs one of your racing horses. Young horses join in once they are of racing age." action={<Link href="/stable" className="btn">Your stable</Link>} />;
  const shown = results.filter((r) => !opponents.some((o) => o.id === r.id));
  return (
    <section className="surface grid gap-4 p-4" aria-labelledby="match-h" data-testid="match-panel">
      <div>
        <h2 id="match-h" className="t-h2">
          Match race
        </h2>
        <p className="text-sm text-cream-dim">Your horse against any other stable&rsquo;s, one-on-one or up to {v.match.fieldMax} runners. Unofficial: nothing on the books moves.</p>
      </div>
      <HorseSelect horses={v.horses} value={horseId} onChange={pickHorse} testId="match-horse" />

      <div className="grid gap-1.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-extrabold">Against</span>
          <span className="text-xs text-cream-dim">
            {opponents.length} of {max} picked
          </span>
        </span>
        {opponents.length > 0 && (
          <ul className="divide-y-2 divide-dotted divide-line" data-testid="match-opponents">
            {opponents.map((o) => (
              <OpponentRow
                key={o.id}
                o={o}
                action={
                  <button type="button" className="btn btn-sm shrink-0" onClick={() => setOpponents(opponents.filter((x) => x.id !== o.id))} aria-label={`Remove ${o.name}`}>
                    Remove
                  </button>
                }
              />
            ))}
          </ul>
        )}
        {opponents.length < max && (
          <>
            <input className="field" type="search" placeholder="Find a horse or stable" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a horse or stable to challenge" data-testid="match-search" />
            {q.trim().length >= 2 && (
              <ul className="divide-y-2 divide-dotted divide-line" data-testid="match-results">
                {loading && shown.length === 0 && <li className="py-1.5 text-sm text-cream-dim">Searching…</li>}
                {!loading && shown.length === 0 && <li className="py-1.5 text-sm text-cream-dim">No racing horse of another stable by that name.</li>}
                {shown.slice(0, 6).map((o) => (
                  <OpponentRow
                    key={o.id}
                    o={o}
                    action={
                      <button
                        type="button"
                        className="btn btn-sm shrink-0"
                        onClick={() => {
                          setOpponents([...opponents, o].slice(0, max));
                          setQ("");
                        }}
                        data-testid="match-add"
                      >
                        Add
                      </button>
                    }
                  />
                ))}
              </ul>
            )}
            {opponents.length === 0 && q.trim().length < 2 && <p className="text-xs text-cream-dim">Or tap Challenge on a horse&rsquo;s page, a racecard or a stable&rsquo;s page.</p>}
          </>
        )}
      </div>

      <TacticGroup value={tactic} natural={horse?.style} onChange={setTactic} prefix="match" />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="font-extrabold">Course</span>
          <select className="field" value={courseId} onChange={(e) => pickCourse(e.target.value)} data-testid="match-course">
            {v.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-cream-dim">{course.character}</span>
        </label>
        <label className="grid content-start gap-1.5">
          <span className="font-extrabold">Trip</span>
          <select className="field" value={distanceM} onChange={(e) => setDistanceM(Number(e.target.value))} data-testid="match-trip">
            {v.trips.map((m) => (
              <option key={m} value={m}>
                {formatDistance(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Group title="Surface" cols={course.surfaces.length === 3 ? "grid-cols-3" : "grid-cols-2"}>
        {course.surfaces.map((s) => (
          <Choice key={s} on={surface === s} onClick={() => setSurface(s)} label={SURFACE_LABEL[s]} testId={`match-surface-${s}`} />
        ))}
      </Group>
      <Group title="Going" aside={surface === "synthetic" ? "the all-weather always rides good" : undefined} cols="grid-cols-4">
        {v.goings.map((g) => (
          <Choice key={g} on={goingFor(surface) === g} disabled={surface === "synthetic" && g !== "good"} onClick={() => setGoing(g)} label={GOING_LABEL[g]} testId={`match-going-${g}`} />
        ))}
      </Group>

      {error && (
        <p className="font-bold text-negative" role="alert" data-testid="match-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-brass btn-lg" disabled={busy || opponents.length === 0 || v.match.remaining === 0} onClick={race} data-testid="match-run">
          {busy ? "Racing…" : opponents.length > 1 ? `Race the ${opponents.length + 1}` : "Race now"}
        </button>
        <Remaining left={v.match.remaining} perDay={v.match.perDay} what="match" />
      </div>
      <p className="text-xs text-cream-dim">Every horse runs as it is today, ridden by a C-grade Club rider, with fresh luck. No rating, fatigue, injury or credits; the other owner hears if their horse beat yours.</p>
    </section>
  );
}

function nearest(trips: number[], m: number): number {
  return [...trips].sort((a, b) => Math.abs(a - m) - Math.abs(b - m) || a - b)[0] ?? 1600;
}

// ---------------------------------------------------------------------------
// Ghost races
// ---------------------------------------------------------------------------

function GhostPanel({ v, initialHorse }: { v: QuickHubView; initialHorse?: string }) {
  const router = useRouter();
  const [horseId, setHorseId] = useState(v.horses.find((h) => h.id === initialHorse)?.id ?? v.horses[0]?.id ?? "");
  const horse = v.horses.find((h) => h.id === horseId);
  const [tactic, setTactic] = useState<RunningStyle>(horse?.style ?? "stalker");
  const [raceId, setRaceId] = useState<string | null>(v.ghost.sources[0]?.raceId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!raceId) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await post("/api/quick/ghost", { horseId, raceId, tactic });
      router.push(`/quick/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!v.signedIn) return <JoinNudge compact />;
  if (v.horses.length === 0) return <EmptyState title="No racing horses yet" text="A ghost race needs one of your racing horses." action={<Link href="/stable" className="btn">Your stable</Link>} />;
  return (
    <section className="surface grid gap-4 p-4" aria-labelledby="ghost-h" data-testid="ghost-panel">
      <div>
        <h2 id="ghost-h" className="t-h2">
          Ghost race
        </h2>
        <p className="text-sm text-cream-dim">
          Your horse against the first {v.ghost.top} home in a real Live race from yesterday or today, as they ran it: same course, trip and going, fresh luck. Would you have
          been placed?
        </p>
      </div>
      <HorseSelect
        horses={v.horses}
        value={horseId}
        onChange={(id) => {
          setHorseId(id);
          const h = v.horses.find((x) => x.id === id);
          if (h) setTactic(h.style);
        }}
        testId="ghost-horse"
      />
      <TacticGroup value={tactic} natural={horse?.style} onChange={setTactic} prefix="ghost" />
      <fieldset className="grid gap-1.5" role="radiogroup" aria-label="The race">
        <legend className="mb-1 font-extrabold">The race</legend>
        {v.ghost.sources.length === 0 ? (
          <p className="t-meta">No Live races have been run since yesterday yet. Check back after the next meeting.</p>
        ) : (
          <ul className="grid max-h-[26rem] gap-1.5 overflow-y-auto pr-1" data-testid="ghost-sources">
            {v.ghost.sources.map((s) => (
              <li key={s.raceId}>
                <GhostSource s={s} on={raceId === s.raceId} onClick={() => setRaceId(s.raceId)} />
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {error && (
        <p className="font-bold text-negative" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-brass btn-lg" disabled={busy || !raceId || v.ghost.remaining === 0} onClick={run} data-testid="ghost-run">
          {busy ? "Racing…" : "Race the ghosts"}
        </button>
        <Remaining left={v.ghost.remaining} perDay={v.ghost.perDay} what="ghost" />
      </div>
    </section>
  );
}

function GhostSource({ s, on, onClick }: { s: GhostSourceView; on: boolean; onClick: () => void }) {
  const time = new Date(s.postTimeMs).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} className={`whatif-choice ${on ? "is-on" : "inset"} grid w-full gap-0.5 px-3 py-2 text-left`} data-testid="ghost-source">
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-extrabold">{s.name}</span>
        <span className="shrink-0 text-xs text-cream-dim" suppressHydrationWarning>
          {time}
        </span>
      </span>
      <span className="text-xs text-cream-dim">
        {s.track} · {formatDistance(s.distanceM)} {SURFACE_LABEL[s.surface].toLowerCase()} · {GOING_LABEL[s.going].toLowerCase()} · {s.runners} ran
      </span>
      <span className="truncate text-xs">{s.top.map((t) => `${ordinal(t.position)} ${t.name}`).join(" · ")}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------

const TAB_LABEL: Record<QuickTab, string> = { daily: "Daily challenge", match: "Match race", ghost: "Ghost race" };

export function QuickHub({ v, tab: initialTab, horse, vs }: { v: QuickHubView; tab: QuickTab; horse?: string; vs?: string }) {
  const [tab, setTab] = useState<QuickTab>(initialTab);
  const skew = useClockSkew(v.serverNowMs);
  const select = (t: QuickTab) => {
    setTab(t);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", t);
      window.history.replaceState(null, "", u.toString());
    } catch {
      /* the tab still switches */
    }
  };
  const notes = useMemo(() => v.notes.flatMap((n) => n.lines).slice(0, 4), [v.notes]);
  return (
    <div className="grid gap-4">
      {notes.length > 0 && (
        <section className="surface grid gap-1 p-3" aria-label="Your horses beat challengers today" data-testid="match-notes">
          <p className="caption">Challengers beaten today</p>
          {notes.map((l) => (
            <Link key={l.quickRaceId} href={`/quick/${l.quickRaceId}`} className="link text-sm">
              {l.winner} beat {l.challenger}
            </Link>
          ))}
        </section>
      )}
      <div className="segmented" role="tablist" aria-label="Quick races">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => select(t)} data-testid={`quick-tab-${t}`}>
            {TAB_LABEL[t]}
            {t === "daily" && !v.daily.mine && v.signedIn && <span className="ml-1.5 inline-block h-2 w-2 bg-brass align-middle" aria-label="not ridden yet" />}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "daily" && <DailyPanel d={v.daily} signedIn={v.signedIn} skew={skew} />}
        {tab === "match" && <MatchPanel v={v} initialHorse={horse} initialVs={vs} />}
        {tab === "ghost" && <GhostPanel v={v} initialHorse={horse} />}
      </div>

      {v.recent.length > 0 && (
        <section aria-labelledby="recent-h" className="grid gap-2">
          <h2 id="recent-h" className="t-h2">
            Your latest quick races
          </h2>
          <ul className="surface rows" data-testid="quick-recent">
            {v.recent.map((r) => (
              <li key={r.id}>
                <Link href={`/quick/${r.id}`} className="row-link gap-3 px-4 py-2.5">
                  <span className="tag shrink-0">{QUICK_MODE_LABEL[r.mode]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{r.title}</span>
                    <span className="block text-xs text-cream-dim">{r.line}</span>
                  </span>
                  <span className="chev">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

