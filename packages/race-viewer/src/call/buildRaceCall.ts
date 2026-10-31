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
import { INTENSITIES, joinSpeech, speak, speakOrder, type Intensity, type NameToken, type Speech, type SpeechSlots, type SpokenBeat } from "./voice/speech";

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

/** A call line with its spoken form (the radio commentary; null when the line is not voiced). */
export interface VoicedCallLine extends CallLine {
  speech: Speech | null;
}

/** What the call reads from a live broadcast: the header plus frames and events received so far. */
export interface LiveReplayView {
  race?: { name?: string; going?: string };
  tickHz: number;
  sampleEvery: number;
  trackLengthMm: number;
  /** `gate` is the saddle-cloth number the commentary says until a name has a clip. */
  horses: ReadonlyArray<{ horseId: string; name?: string; gate?: number }>;
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
  render: () => Rendered | null;
}

interface Rendered {
  text: string;
  horseIds: string[];
  speech?: Speech | null;
}

/** Horses within this distance of the leader in the final furlong make it a duel (climax). */
export const DUEL_MM = HORSE_LENGTH_MM;
/** A leader this far clear late on is an easy winner: the caster stays calmer. */
export const EASY_MM = 3 * HORSE_LENGTH_MM;

export function buildRaceCall(input: RaceCallInput): CallLine[] {
  return buildVoicedRaceCall(input).map(({ speech: _speech, ...line }) => line);
}

/**
 * The race call with each line's spoken form. Same forward pass, same text as buildRaceCall
 * (the speech is built beside the text and never changes it), so the same no-spoiler rules hold.
 */
export function buildVoicedRaceCall(input: RaceCallInput): VoicedCallLine[] {
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

  // ---- speech (the radio commentary) -----------------------------------------------------
  const gateOf = (h: number): number => {
    const g = (replay.horses[h] as { gate?: number }).gate;
    return typeof g === "number" && g > 0 ? g : h + 1;
  };
  const nameToken = (h: number, called?: boolean): NameToken => {
    const tok: NameToken = { k: "name", name: name(h), num: gateOf(h) };
    if (called && mine.has(ids[h]!)) tok.your = true;
    return tok;
  };
  const voice = (beat: SpokenBeat, slots: SpeechSlots, intensity: Intensity): Speech | null => speak(beat, slots, intensity, { name: nameToken, key: `${seed}|${lines.length}` });
  /** Positions at halfway, for comebacks (a horse in the back half there, in the first two late on). */
  let halfwayPos: number[] | null = null;
  const backHalf = (p: number) => p >= Math.max(4, Math.ceil(n / 2) + 1);
  const comeback = (h: number): boolean => !!halfwayPos && n >= 4 && x[order[0]!]! >= L - 3 * FURLONG_MM && backHalf(halfwayPos[h]!) && pos[h]! <= 2;
  /**
   * The intensity of a line from the race state now: `base` for the beat, raised for a
   * comeback horse late on and to climax for a duel in the final furlong (the first two within
   * DUEL_MM), capped at building when the leader is clear late (an easy winner).
   */
  const heat = (base: Intensity, involved: number[] = []): Intensity => {
    let i = INTENSITIES.indexOf(base);
    const lx = x[order[0]!]!;
    const late = lx >= L - 2 * FURLONG_MM;
    const last = lx >= L - FURLONG_MM;
    const gap12 = order[1] !== undefined ? lx - x[order[1]]! : Number.POSITIVE_INFINITY;
    if (involved.some(comeback)) i = Math.max(i, last ? 2 : 1);
    if (last && gap12 < DUEL_MM) i = 2;
    if (late && gap12 > EASY_MM) i = Math.min(i, 1);
    return INTENSITIES[i]!;
  };
  /** calm early, building from 60% of the trip. */
  const phase = (): Intensity => (x[order[0]!]! >= 0.6 * L ? "building" : "calm");

  // ---- candidate queue -------------------------------------------------------------------
  const lines: VoicedCallLine[] = [];
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
          const slots: SpeechSlots = { a: h, pos: pos[h]!, lane: lane[h]! };
          if (pos[h] === 1) return { text: say("youLead", { ...vars, gap: lengthsPhrase(x[h]! - x[order[1] ?? h]!) }), horseIds: [id], speech: voice("youLead", slots, heat(phase(), [h])) };
          return { text: say(settle ? "youSettle" : "youPos", vars), horseIds: [id], speech: voice(settle ? "youSettle" : "youPos", slots, heat(phase(), [h])) };
        },
      });
    }
  };

  const positionLine = (spread: boolean): Rendered => {
    const [a, b, c, d] = order;
    if (b === undefined) return { text: capitalise(`${call(a!)} is out on their own.`), horseIds: [ids[a!]!], speech: null };
    const gapMm = x[a!]! - x[b]!;
    const gap = lengthsPhrase(gapMm);
    let text: string;
    const hs = [a!, b];
    const level = heat(phase(), [a!, b]);
    const slots: SpeechSlots = { a: a!, b, c, d, gap: gapMm, called: true };
    let speech: Speech | null;
    if (c === undefined) {
      text = say("positionTwo", { a: call(a!), b: call(b), gap });
      speech = voice("positionTwo", slots, level);
    } else {
      text = say("position", { a: call(a!), b: call(b), c: call(c), gap });
      speech = voice("position", slots, level);
      hs.push(c);
      if (d !== undefined && n >= 6) {
        text = text.replace(/[.!]$/, "") + say("fourth", { d: call(d) });
        speech = joinSpeech(speech, voice("fourth", slots, level));
        hs.push(d);
      }
    }
    if (spread && n >= 4) {
      const span = x[order[0]!]! - x[order[n - 1]!]!;
      if (span > 12 * HORSE_LENGTH_MM) {
        text += ` ${say("strung", { gap: lengthsPhrase(span) })}`;
        speech = joinSpeech(speech, voice("strung", {}, level));
      } else if (span < 4 * HORSE_LENGTH_MM) {
        text += ` ${say("bunched", { gap: lengthsPhrase(span) })}`;
        speech = joinSpeech(speech, voice("bunched", {}, level));
      }
    }
    return { text: capitalise(text), horseIds: hs.map((h) => ids[h]!), speech };
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
        if (n === 1) return { text: `${name(snap[0]!)} goes round alone.`, horseIds: [ids[snap[0]!]!], speech: null };
        const split0 = n > 7 ? Math.ceil(n / 2) : n;
        // Spoken: the leader, second, a couple more and (whole field in one line) the backmarker.
        const spokenFirst = speakOrder((split0 === n ? snap : snap.slice(0, split0)).map((h) => nameToken(h)), "calm", false, split0 === n);
        if (n === 2) return { text: `${open}.`, horseIds: snap.map((h) => ids[h]!), speech: spokenFirst };
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
              return { text: say("orderCont", { rest }), horseIds: restIds.map((h) => ids[h]!), speech: speakOrder(restIds.map((h) => nameToken(h)), "calm", true) };
            },
          });
          return { text: capitalise(text), horseIds: snap.slice(0, split).map((h) => ids[h]!), speech: spokenFirst };
        }
        orderDone = true;
        queueYouPositions(new Set(), true);
        return { text: capitalise(text), horseIds: snap.map((h) => ids[h]!), speech: spokenFirst };
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
        else queue({ kind: "move", priority: 50, expires: t + 4, render: () => ({ text: capitalise(say("slowLate", { a: call(h) })), horseIds: [ids[h]!], speech: voice("slowLate", { a: h, called: true }, "calm") }) });
        return;
      case "lead_change": {
        if (h === undefined || !offDone) return;
        const b = prevLeader !== h ? prevLeader : order.find((o) => o !== h);
        if (mine.has(ids[h]!)) {
          lastFrontCall[h] = t;
          queue({ kind: "you", priority: 78, expires: t + 2.5, render: () => ({ text: say("youFront", { a: name(h) }), horseIds: [ids[h]!], speech: voice("youFront", { a: h }, heat("building", [h])) }) });
          return;
        }
        if (b === undefined) return;
        lastFrontCall[h] = t;
        queue({
          kind: late ? "challenge" : "move",
          priority: late ? 80 : 58,
          expires: t + (late ? 2 : 3),
          render: () => ({
            text: capitalise(say(late ? "leadLate" : "leadTake", { a: call(h), b: call(b) })),
            horseIds: [ids[h]!, ids[b]!],
            speech: voice(late ? "leadLate" : "leadTake", { a: h, b, called: true }, late ? heat("climax", [h]) : heat(phase(), [h])),
          }),
        });
        return;
      }
      case "move":
        if (h === undefined) return;
        if (mine.has(ids[h]!)) {
          queue({ kind: "you", priority: 64, expires: t + 3, render: () => ({ text: say("youGain", { a: name(h), pos: ordinal(pos[h]!) }), horseIds: [ids[h]!], speech: voice("youGain", { a: h, pos: pos[h]! }, heat(phase(), [h])) }) });
          return;
        }
        queue({
          kind: "move",
          priority: 55,
          expires: t + 3,
          render: () => ({
            text: capitalise(say(lane[h]! >= 1.5 ? "moveWide" : "moveInside", { a: call(h) })),
            horseIds: [ids[h]!],
            speech: voice(lane[h]! >= 1.5 ? "moveWide" : "moveInside", { a: h, called: true }, heat(phase(), [h])),
          }),
        });
        return;
      case "boxed_in":
        if (h === undefined) return;
        if (mine.has(ids[h]!)) queue({ kind: "you", priority: 62, expires: t + 3, render: () => ({ text: say("youBoxed", { a: name(h) }), horseIds: [ids[h]!], speech: voice("youBoxed", { a: h }, heat(phase())) }) });
        else queue({ kind: "move", priority: 50, expires: t + 3, render: () => ({ text: capitalise(say("boxedIn", { a: call(h) })), horseIds: [ids[h]!], speech: voice("boxedIn", { a: h, called: true }, heat(phase())) }) });
        return;
      case "kick":
        if (h === undefined) return;
        queue({
          kind: "move",
          priority: mine.has(ids[h]!) ? 63 : 57,
          expires: t + 2.5,
          render: () => ({ text: capitalise(say("kick", { a: call(h) })), horseIds: [ids[h]!], speech: voice("kick", { a: h, called: true }, heat("building", [h])) }),
        });
        return;
      case "tiring": {
        if (h === undefined) return;
        const heavy = goingRaw === "soft" || goingRaw === "heavy";
        const beat: Beat = heavy && hash32(`${seed}|tiring|${e.tick}`) % 2 === 0 ? "tiringGoing" : "tiring";
        queue({
          kind: "move",
          priority: pos[h] === 1 ? 60 : 45,
          expires: t + 3,
          render: () => ({ text: capitalise(say(beat, { a: call(h), going })), horseIds: [ids[h]!], speech: voice(beat, { a: h, going: goingRaw, called: true }, "calm") }),
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
    if (!halfwayPos && x[order[0]!]! >= 0.5 * L) halfwayPos = [...pos];
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
          const speech = voice(slow.length ? "offSlow" : "off", { rest: slow, going: goingRaw, called: true }, "building");
          return { text, horseIds: slow.map((h) => ids[h]!), speech };
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
      queue({
        kind: "fraction",
        priority: 50,
        expires: t + 4,
        // Times aren't voiced: only halfway is spoken (who leads there).
        render: () => ({ text: capitalise(say(q === 2 ? "half" : "fraction", vars)), horseIds: [ids[leader]!], speech: q === 2 ? voice("half", { a: leader, called: true }, "calm") : null }),
      });
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
          const slots: SpeechSlots = { a: order[0]!, course: course?.name, called: true };
          const level = heat(x[order[0]!]! - x[order[1] ?? order[0]!]! > 5 * HORSE_LENGTH_MM ? "calm" : "building", [order[0]!]);
          const speech = voice(beat, slots, level) ?? voice("home", slots, level);
          return { text: capitalise(say(beat, { a: call(order[0]!), course: course?.name ?? "" })), horseIds: [ids[order[0]!]!], speech };
        },
      });
    }
    if (!hillDone && course && Math.abs(course.finishGradientPermille) >= 8 && leaderX >= L - Math.min(300_000, hs * 0.7)) {
      hillDone = true;
      const beat: Beat = course.finishGradientPermille > 0 ? "hillUp" : "hillDown";
      queue({
        kind: "home",
        priority: 55,
        expires: t + 3,
        render: () => ({ text: capitalise(say(beat, { a: call(order[0]!), course: course.name })), horseIds: [ids[order[0]!]!], speech: voice(beat, { a: order[0]!, called: true }, heat("building", [order[0]!])) }),
      });
    }
    if (!twoOutDone && second !== undefined && L >= 1000_000 && leaderX >= L - 2 * FURLONG_MM && winner < 0) {
      twoOutDone = true;
      // The turn for home already marks this point.
      if (Math.abs(hs - 2 * FURLONG_MM) >= 100_000 || hs >= L - 100_000)
      queue({
        kind: "home",
        priority: 68,
        expires: t + 3,
        render: () => ({
          text: capitalise(say("twoOut", { a: call(order[0]!), b: call(order[1]!), gap: lengthsPhrase(gapTo(order[1]!)) })),
          horseIds: [ids[order[0]!]!, ids[order[1]!]!],
          speech: voice("twoOut", { a: order[0]!, b: order[1]!, called: true }, heat("building", [order[0]!, order[1]!])),
        }),
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
          const speech = voice(clear || b === undefined ? "finalFurlongClear" : "finalFurlong", { a: a!, b, called: true }, heat("building", b === undefined ? [a!] : [a!, b]));
          return { text: capitalise(text), horseIds: clear || b === undefined ? [ids[a!]!] : [ids[a!]!, ids[b]!], speech };
        },
      });
    }

    // Challenges and the duel in the last 400 m.
    if (winner < 0 && second !== undefined && leaderX >= L - 400_000) {
      const gap = leaderX - x[second]!;
      if (!duelDone && leaderX >= L - 250_000 && gap < 0.3 * HORSE_LENGTH_MM) {
        duelDone = true;
        queue({
          kind: "challenge",
          priority: 76,
          expires: t + 2,
          render: () => ({ text: capitalise(say("duel", { a: call(leader), b: call(second) })), horseIds: [ids[leader]!, ids[second]!], speech: voice("duel", { a: leader, b: second }, "climax") }),
        });
      } else if (!challenged.has(second) && gap < 0.75 * HORSE_LENGTH_MM && v[second]! > v[leader]! + 200) {
        challenged.add(second);
        queue({
          kind: "challenge",
          priority: 72,
          expires: t + 2,
          render: () => ({
            text: capitalise(say("challenge", { a: call(leader), b: call(second) })),
            horseIds: [ids[second]!, ids[leader]!],
            speech: voice("challenge", { a: leader, b: second, called: true }, heat("building", [leader, second])),
          }),
        });
      }
    }
    if (!hundredDone && winner < 0 && leaderX >= L - 100_000) {
      hundredDone = true;
      queue({
        kind: "home",
        priority: 75,
        expires: t + 1.5,
        render: () => ({
          text: capitalise(say("hundred", { a: call(order[0]!), b: order[1] !== undefined ? call(order[1]) : call(order[0]!) })),
          horseIds: order.slice(0, 2).map((h) => ids[h]!),
          speech: voice("hundred", { a: order[0]!, b: order[1] ?? order[0]!, called: true }, heat("building", order.slice(0, 2))),
        }),
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
          queue({ kind: "you", priority: 78, expires: t + 2.5, render: () => ({ text: say("youFront", { a: name(h) }), horseIds: [ids[h]!], speech: voice("youFront", { a: h }, heat("building", [h])) }) });
          continue;
        }
        if (t - lastGainCall[h]! < 10) continue;
        if (isMine && back3 && back3[h]! - pos[h]! >= 2 && pos[h]! > 1) {
          lastGainCall[h] = t;
          queue({ kind: "you", priority: 66, expires: t + 2, render: () => ({ text: say("youGain", { a: name(h), pos: ordinal(pos[h]!) }), horseIds: [ids[h]!], speech: voice("youGain", { a: h, pos: pos[h]! }, heat(phase(), [h])) }) });
        } else if (back && back[h]! - pos[h]! >= 3 && pos[h]! > 1) {
          lastGainCall[h] = t;
          const from = back[h]!;
          queue({
            kind: "move",
            priority: 54,
            expires: t + 2,
            render: () => {
              // Big ground late from the back half of the field: the comeback call.
              const late = x[order[0]!]! >= 0.6 * L && (backHalf(from) || (!!halfwayPos && backHalf(halfwayPos[h]!)));
              const speech = late || comeback(h) ? voice("comeback", { a: h, called: true }, heat("building", [h])) : voice("gain", { a: h, pos: pos[h]!, called: true }, heat(phase(), [h]));
              return { text: capitalise(say("gain", { a: call(h), pos: ordinal(pos[h]!) })), horseIds: [ids[h]!], speech };
            },
          });
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
      const wonFromBack = !!halfwayPos && n >= 4 && backHalf(halfwayPos[w]!);
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
          // A photo, a close finish or a comeback winner is the climax; an easy winner is called calmer.
          const level: Intensity = photo || beat === "finishClose" || wonFromBack ? "climax" : "building";
          const speech = voice(beat, { a, b, called: true }, level);
          return { text: capitalise(text), horseIds: b !== undefined && (photo || beat === "finishClose") ? [ids[a]!, ids[b]!] : [ids[a]!], speech };
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
          if (b === undefined) return { text: `${name(a!)} completes the course.`, horseIds: [ids[a!]!], speech: null };
          const marginMm = (crossT[b]! - crossT[a!]!) * (crossV[b] || v[b]!);
          const vars = { a: name(a!), b: name(b), c: c !== undefined ? name(c) : "", margin: marginPhrase(marginMm) };
          const beat: Beat = marginMm < 10 ? "deadHeat" : c === undefined ? "resultTwo" : photo ? "resultPhoto" : "result";
          // The verdict of a photograph is shouted; an easy result is read out calmly.
          const level: Intensity = beat === "deadHeat" || beat === "resultPhoto" ? "climax" : marginMm > EASY_MM ? "calm" : "building";
          const speech = voice(beat, { a: a!, b, c, margin: marginMm }, level);
          return { text: say(beat, vars), horseIds: placed.map((h) => ids[h]!), speech };
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
        const level: Intensity = p === 1 ? "climax" : p <= 3 ? "building" : "calm";
        queue({ kind: "you", priority: 60, expires: Number.POSITIVE_INFINITY, afterLine: true, urgent: true, render: () => ({ text: say(beat, { a: name(h), pos: ordinal(p) }), horseIds: [id], speech: voice(beat, { a: h, pos: p }, level) }) });
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
      lines.push({ atSec: Math.round(t * 1000) / 1000, text: out.text, kind: c.kind, horseIds: out.horseIds, priority: c.priority, speech: out.speech ?? null });
      lastAt = t;
      break;
    }
  }
  return lines;
}
