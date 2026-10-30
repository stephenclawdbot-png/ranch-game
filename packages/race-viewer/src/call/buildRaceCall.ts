/**
 * The race call: a structured, deterministic commentary script built from frames and engine
 * events. Pure: no DOM, no three.js, no clock.
 *
 * No spoilers: the call is produced by a forward pass over the stored frames, one frame per
 * step. Step i reads frames 0..i and events with tick <= i*sampleEvery, nothing else. Every
 * line is emitted at the time of the step that produced it, so the lines up to time T depend
 * only on data up to T and never change when more frames arrive. `replay.result` is never
 * read: finishing order, margins and the photo call come from frame crossing times, so a live
 * race and its replay say exactly the same thing.
 */
import { FURLONG_MM, HORSE_LENGTH_MM, FRAME_FIELD, FRAME_STRIDE, type RaceEvent, type RaceReplay } from "@thoroughbred/shared";
import { TEMPLATES, type Beat } from "./templates";
import { capitalise, goingPhrase, hash32, lanePhrase, lengthsPhrase, listPhrase, marginPhrase, metresPhrase, ordinal, timePhrase } from "./phrases";

export type CallKind = "off" | "order" | "position" | "move" | "challenge" | "fraction" | "home" | "finish" | "photo" | "result" | "you";

export interface CallLine {
  /** Race time (s) at which the line is spoken. */
  atSec: number;
  text: string;
  kind: CallKind;
  /** Horses the line is about, most important first. */
  horseIds: string[];
  /** 0..100; higher matters more. The UI may drop low-priority lines that would overlap. */
  priority: number;
}

/** What the call reads from a live broadcast: the header plus frames and events received so far. */
export interface LiveReplayView {
  race?: { name?: string; going?: string };
  tickHz: number;
  sampleEvery: number;
  trackLengthMm: number;
  horses: ReadonlyArray<{ horseId: string; name?: string }>;
  frames: ReadonlyArray<ReadonlyArray<number>>;
  events: ReadonlyArray<RaceEvent>;
}

export interface CallCourse {
  name: string;
  homeStraightM: number;
  finishGradientPermille: number;
}

export interface RaceCallInput {
  replay: RaceReplay | LiveReplayView;
  /** horseId -> display name (falls back to the replay's names). */
  names: Record<string, string>;
  /** The viewer's horses. */
  mine?: string[];
  distanceM: number;
  course?: CallCourse;
  going?: string;
  /** Only data at or before this race time is used (pass the live edge while live). */
  uptoSec: number;
  /** Picks the phrasing; anything stable per race (never the unrevealed race seed while live). */
  seed: string;
}

/** Minimum time between two lines, seconds. */
export const CALL_MIN_GAP_SEC = 2.5;
/** Margin at the line under which the caller shouts "Photograph!" (about a head). */
export const PHOTO_CALL_MM = Math.round(HORSE_LENGTH_MM * 0.2);
const OFF_DELAY_SEC = 0.6;
const GAIN_WINDOW_SEC = 4;
/** Seconds the call may run past the last frame once every runner has finished. */
const POST_RACE_TAIL_SEC = 15;
/** Quiet time mid-race after which a filler position update is offered. */
const FILLER_AFTER_SEC = 11;
const YOU_POSITION_EVERY_SEC = 15;

interface Candidate {
  kind: CallKind;
  priority: number;
  created: number;
  seq: number;
  /** Dropped if not spoken by this time. */
  expires: number;
  /** Still allowed once the winner has crossed the line. */
  afterLine?: boolean;
  /** Allowed even when the leader is about to reach the line. */
  urgent?: boolean;
  render: () => { text: string; horseIds: string[] } | null;
}

export function buildRaceCall(input: RaceCallInput): CallLine[] {
  const { replay, seed } = input;
  const frames = replay.frames;
  const n = replay.horses.length;
  const dt = replay.sampleEvery / replay.tickHz;
  if (!frames.length || n === 0 || !(dt > 0)) return [];
  const L = replay.trackLengthMm;
  const mine = new Set(input.mine ?? []);
  const ids = replay.horses.map((h) => h.horseId);
  const raceName = ("race" in replay && replay.race?.name) || "race";
  const goingRaw = input.going ?? (("race" in replay && replay.race?.going) || undefined);
  const going = goingPhrase(goingRaw);
  const course = input.course;
  // Once the whole field is home no frame can change the call, so it may run on past the
  // last frame (for the result) without waiting for data.
  const lastFrame = frames.length - 1;
  const tailSteps = Math.ceil(POST_RACE_TAIL_SEC / dt);
  const lastStep = Math.min(lastFrame + tailSteps, Number.isFinite(input.uptoSec) ? Math.floor(Math.max(0, input.uptoSec) / dt + 1e-9) : lastFrame + tailSteps);
  if (input.uptoSec < 0) return [];

  const events = [...replay.events].map((e, k) => ({ e, k })).sort((a, b) => a.e.tick - b.e.tick || a.k - b.k).map((x) => x.e);
  const indexOf = new Map(ids.map((id, h) => [id, h]));

  // ---- phrasing --------------------------------------------------------------------------
  const used = new Map<Beat, number>();
  const lastIdx = new Map<Beat, number>();
  const pickIdx = (beat: Beat): number => {
    const list = TEMPLATES[beat];
    const count = used.get(beat) ?? 0;
    used.set(beat, count + 1);
    let idx = hash32(`${seed}|${beat}|${count}`) % list.length;
    if (list.length > 1 && idx === lastIdx.get(beat)) idx = (idx + 1) % list.length;
    lastIdx.set(beat, idx);
    return idx;
  };
  const say = (beat: Beat, vars: Record<string, string>): string => {
    const tpl: string = TEMPLATES[beat][pickIdx(beat)]!;
    return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
  };
  const name = (h: number): string => input.names[ids[h]!] ?? replay.horses[h]!.name ?? ids[h]!;
  /** Name as said mid-race: the viewer's horses are "your X". */
  const call = (h: number): string => (mine.has(ids[h]!) ? `your ${name(h)}` : name(h));

  // ---- per-step state --------------------------------------------------------------------
  const x = new Array<number>(n).fill(0);
  const lane = new Array<number>(n).fill(0);
  const v = new Array<number>(n).fill(0);
  const crossT: (number | null)[] = new Array(n).fill(null);
  const crossV = new Array<number>(n).fill(0);
  let order: number[] = ids.map((_, h) => h);
  const pos = new Array<number>(n).fill(0);
  const posHistory: number[][] = [];
  let t = 0;

  const read = (f: number, h: number, field: keyof typeof FRAME_FIELD) => frames[Math.min(f, lastFrame)]![h * FRAME_STRIDE + FRAME_FIELD[field]] ?? 0;
  const gapTo = (h: number) => Math.max(0, x[order[0]!]! - x[h]!);

  // ---- candidate queue -------------------------------------------------------------------
  const lines: CallLine[] = [];
  let pending: Candidate[] = [];
  let seq = 0;
  let lastAt = Number.NEGATIVE_INFINITY;
  const queue = (c: Omit<Candidate, "created" | "seq">) => pending.push({ ...c, created: t, seq: seq++ });

  // ---- beat flags ------------------------------------------------------------------------
  let offDone = false;
  let offQueued = false;
  let orderQueued = false;
  let orderDone = false;
  const slowAtOff = new Set<number>();
  const fractionsDone = new Set<number>();
  const checkpointsDone = new Set<number>();
  let homeDone = false;
  let hillDone = false;
  let twoOutDone = false;
  let furlongDone = false;
  let furlongEvent = false;
  let hundredDone = false;
  let duelDone = false;
  const challenged = new Set<number>();
  const lastGainCall = new Array<number>(n).fill(Number.NEGATIVE_INFINITY);
  const lastFrontCall = new Array<number>(n).fill(Number.NEGATIVE_INFINITY);
  let winner = -1;
  let winnerT = 0;
  let photo = false;
  let resultQueued = false;
  let resultDone = false;
  const youFinishQueued = new Set<number>();
  let ev = 0;

  const lastYouPos = new Array<number>(n).fill(Number.NEGATIVE_INFINITY);
  const queueYouPositions = (exclude: Set<number>, settle: boolean) => {
    for (const id of mine) {
      const h = indexOf.get(id);
      if (h === undefined || exclude.has(h)) continue;
      queue({
        kind: "you",
        priority: settle ? 70 : 61,
        expires: t + 8,
        render: () => {
          // Routine updates on your horse: no more than one every YOU_POSITION_EVERY_SEC.
          if (crossT[h] !== null || (!settle && t - lastYouPos[h]! < YOU_POSITION_EVERY_SEC)) return null;
          lastYouPos[h] = t;
          const vars = { a: name(h), pos: ordinal(pos[h]!), lane: lanePhrase(lane[h]!), gap: lengthsPhrase(gapTo(h)) };
          if (pos[h] === 1) return { text: say("youLead", { ...vars, gap: lengthsPhrase(x[h]! - x[order[1] ?? h]!) }), horseIds: [id] };
          return { text: say(settle ? "youSettle" : "youPos", vars), horseIds: [id] };
        },
      });
    }
  };

  const positionLine = (spread: boolean): { text: string; horseIds: string[] } => {
    const [a, b, c, d] = order;
    if (b === undefined) return { text: capitalise(`${call(a!)} is out on their own.`), horseIds: [ids[a!]!] };
    const gap = lengthsPhrase(x[a!]! - x[b]!);
    let text: string;
    const hs = [a!, b];
    if (c === undefined) text = say("positionTwo", { a: call(a!), b: call(b), gap });
    else {
      text = say("position", { a: call(a!), b: call(b), c: call(c), gap });
      hs.push(c);
      if (d !== undefined && n >= 6) {
        text = text.replace(/[.!]$/, "") + say("fourth", { d: call(d) });
        hs.push(d);
      }
    }
    if (spread && n >= 4) {
      const span = x[order[0]!]! - x[order[n - 1]!]!;
      if (span > 12 * HORSE_LENGTH_MM) text += ` ${say("strung", { gap: lengthsPhrase(span) })}`;
      else if (span < 4 * HORSE_LENGTH_MM) text += ` ${say("bunched", { gap: lengthsPhrase(span) })}`;
    }
    return { text: capitalise(text), horseIds: hs.map((h) => ids[h]!) };
  };

  /** The first call: every runner, leader to last. Splits a big field over two lines. */
  const queueOrder = () => {
    queue({
      kind: "order",
      priority: 80,
      expires: Number.POSITIVE_INFINITY,
      urgent: true,
      render: () => {
        const snap = [...order];
        const gaps = snap.map((h, k) => (k === 0 ? 0 : x[snap[k - 1]!]! - x[h]!));
        const item = (k: number) => (gaps[k]! > 3 * HORSE_LENGTH_MM ? `a gap of ${lengthsPhrase(gaps[k]!)} to ${name(snap[k]!)}` : name(snap[k]!));
        const rear = (k: number) => {
          const adrift = gaps[k]! > 3 * HORSE_LENGTH_MM ? `, ${lengthsPhrase(gaps[k]!)} adrift` : "";
          return say("orderRear", { a: name(snap[k]!) }) + adrift;
        };
        const open = say("orderOpen", { a: name(snap[0]!), b: snap[1] !== undefined ? item(1) : "" });
        if (n === 1) return { text: `${name(snap[0]!)} goes round alone.`, horseIds: [ids[snap[0]!]!] };
        if (n === 2) return { text: `${open}.`, horseIds: snap.map((h) => ids[h]!) };
        const split = n > 7 ? Math.ceil(n / 2) : n;
        let text: string;
        if (split === n) {
          const mid = [];
          for (let k = 2; k < n - 1; k++) mid.push(item(k));
          text = mid.length ? `${open}, ${say("orderJoin", {})} ${listPhrase(mid)}, ${rear(n - 1)}.` : `${open}, ${rear(n - 1)}.`;
        } else {
          const mid = [];
          for (let k = 2; k < split; k++) mid.push(item(k));
          text = mid.length ? `${open}, ${say("orderJoin", {})} ${listPhrase(mid)}.` : `${open}.`;
          const restIds = snap.slice(split);
          queue({
            kind: "order",
            priority: 80,
            expires: Number.POSITIVE_INFINITY,
            urgent: true,
            render: () => {
              const items = [];
              for (let k = split; k < n - 1; k++) items.push(item(k));
              const rest = items.length ? `${listPhrase(items)}, ${rear(n - 1)}` : rear(n - 1);
              orderDone = true;
              queueYouPositions(new Set(), true);
              return { text: say("orderCont", { rest }), horseIds: restIds.map((h) => ids[h]!) };
            },
          });
          return { text: capitalise(text), horseIds: snap.slice(0, split).map((h) => ids[h]!) };
        }
        orderDone = true;
        queueYouPositions(new Set(), true);
        return { text: capitalise(text), horseIds: snap.map((h) => ids[h]!) };
      },
    });
  };

  const handleEvent = (e: RaceEvent, prevLeader: number) => {
    const h = e.horseId !== undefined ? indexOf.get(e.horseId) : undefined;
    const leaderX = x[order[0]!]!;
    const late = leaderX >= L - 400_000;
    switch (e.type) {
      case "final_furlong":
        furlongEvent = true;
        return;
      case "slow_start":
        if (h === undefined) return;
        if (!offDone) slowAtOff.add(h);
        else queue({ kind: "move", priority: 50, expires: t + 4, render: () => ({ text: capitalise(say("slowLate", { a: call(h) })), horseIds: [ids[h]!] }) });
        return;
      case "lead_change": {
        if (h === undefined || !offDone) return;
        const b = prevLeader !== h ? prevLeader : order.find((o) => o !== h);
        if (mine.has(ids[h]!)) {
          lastFrontCall[h] = t;
          queue({ kind: "you", priority: 78, expires: t + 2.5, render: () => ({ text: say("youFront", { a: name(h) }), horseIds: [ids[h]!] }) });
          return;
        }
        if (b === undefined) return;
        lastFrontCall[h] = t;
        queue({
          kind: late ? "challenge" : "move",
          priority: late ? 80 : 58,
          expires: t + (late ? 2 : 3),
          render: () => ({ text: capitalise(say(late ? "leadLate" : "leadTake", { a: call(h), b: call(b) })), horseIds: [ids[h]!, ids[b]!] }),
        });
        return;
      }
      case "move":
        if (h === undefined) return;
        if (mine.has(ids[h]!)) {
          queue({ kind: "you", priority: 64, expires: t + 3, render: () => ({ text: say("youGain", { a: name(h), pos: ordinal(pos[h]!) }), horseIds: [ids[h]!] }) });
          return;
        }
        queue({ kind: "move", priority: 55, expires: t + 3, render: () => ({ text: capitalise(say(lane[h]! >= 1.5 ? "moveWide" : "moveInside", { a: call(h) })), horseIds: [ids[h]!] }) });
        return;
      case "boxed_in":
        if (h === undefined) return;
        if (mine.has(ids[h]!)) queue({ kind: "you", priority: 62, expires: t + 3, render: () => ({ text: say("youBoxed", { a: name(h) }), horseIds: [ids[h]!] }) });
        else queue({ kind: "move", priority: 50, expires: t + 3, render: () => ({ text: capitalise(say("boxedIn", { a: call(h) })), horseIds: [ids[h]!] }) });
        return;
      case "kick":
        if (h === undefined) return;
        queue({ kind: "move", priority: mine.has(ids[h]!) ? 63 : 57, expires: t + 2.5, render: () => ({ text: capitalise(say("kick", { a: call(h) })), horseIds: [ids[h]!] }) });
        return;
      case "tiring": {
        if (h === undefined) return;
        const heavy = goingRaw === "soft" || goingRaw === "heavy";
        const beat: Beat = heavy && hash32(`${seed}|tiring|${e.tick}`) % 2 === 0 ? "tiringGoing" : "tiring";
        queue({
          kind: "move",
          priority: pos[h] === 1 ? 60 : 45,
          expires: t + 3,
          render: () => ({ text: capitalise(say(beat, { a: call(h), going })), horseIds: [ids[h]!] }),
        });
        return;
      }
      default:
        return;
    }
  };

  // ---- the forward pass ------------------------------------------------------------------
  for (let i = 0; i <= lastStep; i++) {
    if (i > lastFrame && crossT.some((c) => c === null)) break;
    t = i * dt;
    const prevLeader = order[0]!;
    for (let h = 0; h < n; h++) {
      x[h] = read(i, h, "distanceMm");
      lane[h] = read(i, h, "laneMilli") / 1000;
      v[h] = read(i, h, "speedMmS");
      if (crossT[h] === null && x[h]! >= L) {
        if (i === 0) {
          crossT[h] = 0;
        } else {
          const d0 = read(i - 1, h, "distanceMm");
          const v0 = read(i - 1, h, "speedMmS");
          const u = v0 > 0 ? (L - d0) / (v0 * dt) : x[h]! > d0 ? (L - d0) / (x[h]! - d0) : 1;
          crossT[h] = (i - 1 + Math.min(1, Math.max(0, u))) * dt;
          crossV[h] = v0;
        }
      }
    }
    order = ids.map((_, h) => h).sort((a, b) => {
      const ca = crossT[a]!;
      const cb = crossT[b]!;
      if (crossT[a] !== null && crossT[b] !== null) return ca - cb || a - b;
      if ((crossT[a] !== null) !== (crossT[b] !== null)) return crossT[a] !== null ? -1 : 1;
      return x[b]! - x[a]! || a - b;
    });
    order.forEach((h, r) => (pos[h] = r + 1));
    posHistory.push([...pos]);
    const leader = order[0]!;
    const second = order[1];
    const leaderX = x[leader]!;

    // Engine events up to this step.
    while (ev < events.length && events[ev]!.tick <= i * replay.sampleEvery) handleEvent(events[ev++]!, prevLeader);

    // The off.
    if (!offQueued && t >= OFF_DELAY_SEC) {
      offQueued = true;
      queue({
        kind: "off",
        priority: 90,
        expires: Number.POSITIVE_INFINITY,
        urgent: true,
        render: () => {
          offDone = true;
          const slow = [...slowAtOff];
          const vars = { race: raceName, going, n: `${n}`, rest: listPhrase(slow.map(call)) };
          const text = capitalise(slow.length ? say("offSlow", vars) : say("off", vars));
          return { text, horseIds: slow.map((h) => ids[h]!) };
        },
      });
    }

    // The first call, once they've settled.
    if (!orderQueued && t >= 4 && leaderX >= Math.max(0.08 * L, 120_000)) {
      orderQueued = true;
      queueOrder();
    }

    // Fractions at the quarter marks.
    for (const q of [1, 2, 3]) {
      const mark = (L * q) / 4;
      if (fractionsDone.has(q) || leaderX < mark || i === 0 || L < 800_000) continue;
      fractionsDone.add(q);
      if (q === 3 && L - mark < 450_000) continue;
      let best = 0;
      for (let h = 0; h < n; h++) best = Math.max(best, read(i - 1, h, "distanceMm"));
      const u = leaderX > best ? (mark - best) / (leaderX - best) : 1;
      const at = (i - 1 + Math.min(1, Math.max(0, u))) * dt;
      const vars = { dist: metresPhrase(mark / 1000), time: timePhrase(at), a: call(leader) };
      queue({ kind: "fraction", priority: 50, expires: t + 4, render: () => ({ text: capitalise(say(q === 2 ? "half" : "fraction", vars)), horseIds: [ids[leader]!] }) });
    }

    // Position checkpoints, with your horses after.
    for (const cp of [0.4, 0.62]) {
      if (checkpointsDone.has(cp) || leaderX < cp * L || L - cp * L < 350_000) continue;
      checkpointsDone.add(cp);
      queue({
        kind: "position",
        priority: 45,
        expires: t + 5,
        render: () => {
          const line = positionLine(cp === 0.4);
          queueYouPositions(new Set(order.slice(0, n >= 6 ? 4 : 3)), false);
          return line;
        },
      });
    }

    // Filler when the call has gone quiet mid-race.
    if (orderDone && winner < 0 && t - lastAt >= FILLER_AFTER_SEC && leaderX > 0.25 * L && leaderX < L - 450_000 && !pending.some((c) => c.kind === "position")) {
      queue({
        kind: "position",
        priority: 30,
        expires: t + 1,
        render: () => {
          queueYouPositions(new Set(order.slice(0, n >= 6 ? 4 : 3)), false);
          return positionLine(false);
        },
      });
    }

    // Course-aware moments.
    const hs = course ? course.homeStraightM * 1000 : Math.min(450_000, 0.35 * L);
    if (!homeDone && winner < 0 && hs < L - 100_000 && L >= 1000_000 && leaderX >= L - hs) {
      homeDone = true;
      const beat: Beat = !course ? "home" : hs >= 450_000 ? "homeLong" : hs <= 300_000 ? "homeShort" : "homeCourse";
      queue({
        kind: "home",
        priority: 65,
        expires: t + 4,
        render: () => {
          queueYouPositions(new Set(order.slice(0, 1)), false);
          return { text: capitalise(say(beat, { a: call(order[0]!), course: course?.name ?? "" })), horseIds: [ids[order[0]!]!] };
        },
      });
    }
    if (!hillDone && course && Math.abs(course.finishGradientPermille) >= 8 && leaderX >= L - Math.min(300_000, hs * 0.7)) {
      hillDone = true;
      const beat: Beat = course.finishGradientPermille > 0 ? "hillUp" : "hillDown";
      queue({ kind: "home", priority: 55, expires: t + 3, render: () => ({ text: capitalise(say(beat, { a: call(order[0]!), course: course.name })), horseIds: [ids[order[0]!]!] }) });
    }
    if (!twoOutDone && second !== undefined && L >= 1000_000 && leaderX >= L - 2 * FURLONG_MM && winner < 0) {
      twoOutDone = true;
      // The turn for home already marks this point.
      if (Math.abs(hs - 2 * FURLONG_MM) >= 100_000 || hs >= L - 100_000)
      queue({
        kind: "home",
        priority: 68,
        expires: t + 3,
        render: () => ({ text: capitalise(say("twoOut", { a: call(order[0]!), b: call(order[1]!), gap: lengthsPhrase(gapTo(order[1]!)) })), horseIds: [ids[order[0]!]!, ids[order[1]!]!] }),
      });
    }
    if (!furlongDone && winner < 0 && (furlongEvent || leaderX >= L - FURLONG_MM)) {
      furlongDone = true;
      queue({
        kind: "home",
        priority: 85,
        expires: t + 3,
        render: () => {
          const [a, b] = order;
          const gap = b !== undefined ? x[a!]! - x[b]! : Number.POSITIVE_INFINITY;
          const clear = gap > 3 * HORSE_LENGTH_MM;
          const text = say(clear ? "finalFurlongClear" : "finalFurlong", { a: call(a!), b: b !== undefined ? call(b) : "", gap: lengthsPhrase(gap) });
          return { text: capitalise(text), horseIds: clear || b === undefined ? [ids[a!]!] : [ids[a!]!, ids[b]!] };
        },
      });
    }

    // Challenges and the duel in the last 400 m.
    if (winner < 0 && second !== undefined && leaderX >= L - 400_000) {
      const gap = leaderX - x[second]!;
      if (!duelDone && leaderX >= L - 250_000 && gap < 0.3 * HORSE_LENGTH_MM) {
        duelDone = true;
        queue({ kind: "challenge", priority: 76, expires: t + 2, render: () => ({ text: capitalise(say("duel", { a: call(leader), b: call(second) })), horseIds: [ids[leader]!, ids[second]!] }) });
      } else if (!challenged.has(second) && gap < 0.75 * HORSE_LENGTH_MM && v[second]! > v[leader]! + 200) {
        challenged.add(second);
        queue({ kind: "challenge", priority: 72, expires: t + 2, render: () => ({ text: capitalise(say("challenge", { a: call(leader), b: call(second) })), horseIds: [ids[second]!, ids[leader]!] }) });
      }
    }
    if (!hundredDone && winner < 0 && leaderX >= L - 100_000) {
      hundredDone = true;
      queue({
        kind: "home",
        priority: 75,
        expires: t + 1.5,
        render: () => ({ text: capitalise(say("hundred", { a: call(order[0]!), b: order[1] !== undefined ? call(order[1]) : call(order[0]!) })), horseIds: order.slice(0, 2).map((h) => ids[h]!) }),
      });
    }

    // Moves from position deltas: big gains, and every gain or lead for the viewer's horses.
    const back = posHistory[i - Math.round(GAIN_WINDOW_SEC / dt)];
    const back3 = posHistory[i - Math.round(3 / dt)];
    if (orderDone && winner < 0 && leaderX < L - 100_000) {
      for (let h = 0; h < n; h++) {
        const isMine = mine.has(ids[h]!);
        if (isMine && pos[h] === 1 && posHistory[i - 1]?.[h] !== 1 && t - lastFrontCall[h]! > 10) {
          lastFrontCall[h] = t;
          queue({ kind: "you", priority: 78, expires: t + 2.5, render: () => ({ text: say("youFront", { a: name(h) }), horseIds: [ids[h]!] }) });
          continue;
        }
        if (t - lastGainCall[h]! < 10) continue;
        if (isMine && back3 && back3[h]! - pos[h]! >= 2 && pos[h]! > 1) {
          lastGainCall[h] = t;
          queue({ kind: "you", priority: 66, expires: t + 2, render: () => ({ text: say("youGain", { a: name(h), pos: ordinal(pos[h]!) }), horseIds: [ids[h]!] }) });
        } else if (back && back[h]! - pos[h]! >= 3 && pos[h]! > 1) {
          lastGainCall[h] = t;
          queue({ kind: "move", priority: 54, expires: t + 2, render: () => ({ text: capitalise(say("gain", { a: call(h), pos: ordinal(pos[h]!) })), horseIds: [ids[h]!] }) });
        }
      }
    }

    // The line: called by eye at the moment the first horse crosses.
    if (winner < 0 && crossT[leader] !== null) {
      winner = leader;
      winnerT = crossT[leader]!;
      pending = pending.filter((c) => c.afterLine);
      const w = leader;
      const r = second;
      let gapMm = Number.POSITIVE_INFINITY;
      if (r !== undefined) {
        const f0 = Math.max(0, i - 1);
        const x2 = crossT[r] !== null ? L : Math.min(L, read(f0, r, "distanceMm") + (read(f0, r, "speedMmS") * (winnerT - f0 * dt)));
        gapMm = crossT[r] !== null ? (crossT[r]! - winnerT) * (crossV[r] || v[r]!) : L - x2;
      }
      photo = r !== undefined && gapMm < PHOTO_CALL_MM;
      const beat: Beat = photo ? "photo" : gapMm < HORSE_LENGTH_MM ? "finishClose" : gapMm > 5 * HORSE_LENGTH_MM ? "finishEasy" : "finish";
      queue({
        kind: photo ? "photo" : "finish",
        priority: 100,
        expires: Number.POSITIVE_INFINITY,
        afterLine: true,
        urgent: true,
        render: () => {
          // In a photo nobody is named the winner yet: "a" is simply the inside horse.
          const [a, b] = photo && lane[r!]! < lane[w]! ? [r!, w] : [w, r];
          const text = say(beat, { a: call(a), b: b !== undefined ? call(b) : "", race: raceName });
          return { text: capitalise(text), horseIds: b !== undefined && (photo || beat === "finishClose") ? [ids[a]!, ids[b]!] : [ids[a]!] };
        },
      });
    }

    // The result, once the placed horses are home.
    const placed = order.slice(0, Math.min(3, n));
    if (winner >= 0 && !resultQueued && placed.every((h) => crossT[h] !== null) && t >= winnerT + (photo ? 6 : 3)) {
      resultQueued = true;
      const [a, b, c] = placed;
      queue({
        kind: "result",
        priority: 95,
        expires: Number.POSITIVE_INFINITY,
        afterLine: true,
        urgent: true,
        render: () => {
          resultDone = true;
          if (b === undefined) return { text: `${name(a!)} completes the course.`, horseIds: [ids[a!]!] };
          const marginMm = (crossT[b]! - crossT[a!]!) * (crossV[b] || v[b]!);
          const vars = { a: name(a!), b: name(b), c: c !== undefined ? name(c) : "", margin: marginPhrase(marginMm) };
          const beat: Beat = marginMm < 10 ? "deadHeat" : c === undefined ? "resultTwo" : photo ? "resultPhoto" : "result";
          return { text: say(beat, vars), horseIds: placed.map((h) => ids[h]!) };
        },
      });
    }

    // Your horses at the line, after the result.
    if (resultDone) {
      for (const id of mine) {
        const h = indexOf.get(id);
        if (h === undefined || youFinishQueued.has(h) || crossT[h] === null) continue;
        youFinishQueued.add(h);
        const p = pos[h]!;
        const beat: Beat = p === 1 ? "youWon" : p <= 3 ? "youPlaced" : "youOther";
        queue({ kind: "you", priority: 60, expires: Number.POSITIVE_INFINITY, afterLine: true, urgent: true, render: () => ({ text: say(beat, { a: name(h), pos: ordinal(p) }), horseIds: [id] }) });
      }
    }

    // Speak at most one line per step, spaced by CALL_MIN_GAP_SEC.
    pending = pending.filter((c) => c.expires >= t - 1e-9);
    if (t - lastAt < CALL_MIN_GAP_SEC - 1e-9 || !pending.length) continue;
    const eta = winner < 0 && v[leader]! > 0 ? (L - leaderX) / v[leader]! : Number.POSITIVE_INFINITY;
    const ranked = [...pending].sort((p, q) => q.priority - p.priority || p.created - q.created || p.seq - q.seq);
    for (const c of ranked) {
      // Keep the air clear for the call at the line.
      if (!c.urgent && eta < CALL_MIN_GAP_SEC + 0.75) continue;
      pending = pending.filter((p) => p !== c);
      const out = c.render();
      if (!out) continue;
      lines.push({ atSec: Math.round(t * 1000) / 1000, text: out.text, kind: c.kind, horseIds: out.horseIds, priority: c.priority });
      lastAt = t;
      break;
    }
  }
  return lines;
}
