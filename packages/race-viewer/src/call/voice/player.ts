/**
 * The radio commentary player (browser only): Web Audio playback of the voiced race call,
 * following the race clock. Loaded lazily by the viewer when the "Radio commentary" toggle is on.
 *
 * - Fetches only what this race needs: the clips of the call lines it holds (a replay: the whole
 *   call; a live race: the lines so far, as they arrive), the runners' name clips for this
 *   race's caster, and the shared beds. Static files and long-cached name clips: no server work.
 * - Every frame, `update(t, rate, playing)` maps the speech plan (schedule.ts) onto the
 *   AudioContext clock: lines due in the next quarter second are started on time, a line in
 *   progress is joined part-way (a seek, joining mid-race), pause suspends, a seek or a speed
 *   change stops the voice and resyncs. At 2x / 4x / 0.5x only the key calls (finish, photo,
 *   result) are spoken, in real time; the crowd keeps following the race.
 * - Never blocks the race: loads are fire-and-forget, a line whose clips aren't ready in time is
 *   skipped, and every failure leaves the race silent rather than stalled.
 */
import type { VoicedCallLine } from "../buildRaceCall";
import { clipsFor, COMMENTARY_BASE, makeResolver, MIX, nameClipKey, nameUrl, phraseUrl, type ClipState, type CommentaryManifest } from "./library";
import { cheersBetween, crowdAt, crowdCues, dueLines, joinAt, planSpeech, type CrowdBed, type CrowdCue, type PlannedLine, type SpeechPlan } from "./schedule";
import { INTENSITIES, type Intensity } from "./speech";

const LOOKAHEAD_SEC = 0.25;
const JUMP_SEC = 0.35;

interface Playing {
  sources: AudioBufferSourceNode[];
  /** AudioContext time at which the line's start (race time) falls. */
  ctxStart: number;
  cut?: number;
}

export interface RadioPlayerOptions {
  caster: string;
  /** Runner names (for the name clips to prefetch). */
  names: readonly string[];
  base?: string;
  api?: string;
}

let manifestPromise: Promise<CommentaryManifest> | null = null;
function loadManifest(base: string): Promise<CommentaryManifest> {
  manifestPromise ??= fetch(`${base}/manifest.json`).then((r) => {
    if (!r.ok) throw new Error(`commentary manifest ${r.status}`);
    return r.json() as Promise<CommentaryManifest>;
  });
  manifestPromise.catch(() => (manifestPromise = null));
  return manifestPromise;
}

export class RadioPlayer {
  readonly ctx: AudioContext;
  private master: GainNode;
  private voiceBus: GainNode;
  private bedGains = new Map<CrowdBed, GainNode>();
  private buffers = new Map<string, AudioBuffer>();
  private state = new Map<string, ClipState>();
  private inflight = new Set<string>();
  private manifest: CommentaryManifest | null = null;
  private lines: readonly VoicedCallLine[] = [];
  private linesSig = "";
  private plan: SpeechPlan = { lines: [], waitingFrom: -1 };
  private cues: CrowdCue[] = [];
  private dirty = true;
  private playing = new Map<string, Playing>();
  private lastT = Number.NaN;
  private lastCtx = 0;
  private lastRate = 1;
  private bed: CrowdBed | null = null;
  private preOff = true;
  private disposed = false;
  private base: string;
  private api: string;

  constructor(private opts: RadioPlayerOptions) {
    this.base = opts.base ?? COMMENTARY_BASE;
    this.api = opts.api ?? "/api/commentary/names";
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "playback" });
    // Master: a fast limiter so voice + crowd never clip (the clips keep their own dynamics).
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.master = this.ctx.createGain();
    this.master.connect(limiter).connect(this.ctx.destination);
    this.voiceBus = this.ctx.createGain();
    this.voiceBus.gain.value = MIX.voice;
    this.voiceBus.connect(this.master);
    void this.start();
  }

  /** Call from a user gesture (autoplay rules): resumes the audio output. */
  resume(): void {
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
  }

  get blocked(): boolean {
    return this.ctx.state !== "running";
  }

  private async start(): Promise<void> {
    try {
      const m = await loadManifest(this.base);
      if (this.disposed) return;
      this.manifest = m;
      // Beds: the crowd loops (silent until the clock runs) and the radio static.
      for (const bed of ["murmur", "building", "roar", "hush"] as CrowdBed[]) {
        const g = this.ctx.createGain();
        g.gain.value = 0;
        g.connect(this.master);
        this.bedGains.set(bed, g);
        void this.fetchBuffer(`bed|${bed}`, `${this.base}/beds/${m.beds[bed].file}`).then((b) => b && this.loop(b, g));
      }
      void this.fetchBuffer("bed|cheer", `${this.base}/beds/${m.beds.cheer.file}`);
      const sg = this.ctx.createGain();
      sg.gain.value = MIX.static;
      sg.connect(this.master);
      void this.fetchBuffer("bed|static", `${this.base}/beds/${m.beds.static.file}`).then((b) => b && this.loop(b, sg));
      // The runners' names for this caster, every intensity (small, cached for good).
      for (const name of this.opts.names) for (const i of INTENSITIES) this.need(nameClipKey(this.opts.caster, i, name), name, i, "name");
      this.dirty = true;
      this.fetchFor(this.lines);
    } catch {
      /* no library: stay silent */
    }
  }

  private loop(buf: AudioBuffer, gain: GainNode): void {
    if (this.disposed) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    src.start();
  }

  /** The call lines the viewer holds now (whole call for a replay; grows while live). */
  setLines(lines: readonly VoicedCallLine[]): void {
    const last = lines[lines.length - 1];
    const sig = `${lines.length}|${last?.atSec ?? ""}|${last?.text ?? ""}`;
    if (sig === this.linesSig) return;
    this.linesSig = sig;
    this.lines = lines;
    this.dirty = true;
    this.fetchFor(lines);
  }

  private fetchFor(lines: readonly VoicedCallLine[]): void {
    if (!this.manifest) return;
    for (const l of lines) {
      if (!l.speech) continue;
      for (const c of clipsFor(l.speech, this.opts.caster)) this.need(c.key, c.id, c.intensity, c.kind);
    }
  }

  private need(key: string, id: string, intensity: Intensity, kind: "phrase" | "name"): void {
    const m = this.manifest;
    if (!m) return;
    const caster = this.opts.caster;
    if (this.state.has(key) || this.inflight.has(key)) return;
    if (kind === "name") {
      void this.fetchBuffer(key, nameUrl(m.recipe, caster, intensity, id, this.api));
      return;
    }
    if (!m.clips[caster]?.[intensity]?.[id]) {
      this.state.set(key, "missing");
      return;
    }
    void this.fetchBuffer(key, phraseUrl(caster, intensity, id, this.base));
  }

  private async fetchBuffer(key: string, url: string): Promise<AudioBuffer | null> {
    if (this.inflight.has(key)) return null;
    this.inflight.add(key);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status}`);
      const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
      this.buffers.set(key, buf);
      this.state.set(key, buf.duration);
      return buf;
    } catch {
      this.state.set(key, "missing");
      return null;
    } finally {
      this.inflight.delete(key);
      this.dirty = true;
    }
  }

  /**
   * One frame: the race clock is at `t` (race seconds), moving at `rate`, `playing` or not
   * (`ended`: stopped at the end of the replay, not paused). Cheap when nothing changes.
   */
  update(t: number, rate: number, playing: boolean, ended = false): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    if (!playing && ended) {
      // The race is over and the clock has stopped: let the last words and the cheer ring out.
      this.crowd(t, t, 1);
      this.lastT = Number.NaN;
      return;
    }
    if (!playing) {
      this.stopVoice();
      if (this.ctx.state === "running") void this.ctx.suspend().catch(() => undefined);
      this.lastT = Number.NaN;
      return;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
    if (this.ctx.state !== "running") {
      // Not allowed to play yet (no gesture since the page loaded) or still resuming: schedule
      // nothing on a stopped clock; the first running frame resyncs from wherever the race is.
      this.lastT = Number.NaN;
      return;
    }
    // A seek, a restart or a speed change: stop the voice and resync from here.
    const expected = this.lastT + (now - this.lastCtx) * this.lastRate;
    const jumped = !Number.isFinite(this.lastT) || Math.abs(t - expected) > JUMP_SEC || rate !== this.lastRate;
    if (jumped) this.stopVoice();
    const prevT = Number.isFinite(this.lastT) && !jumped ? this.lastT : t;
    this.lastT = t;
    this.lastCtx = now;
    this.lastRate = rate;
    if (this.dirty) this.replan(t);
    this.crowd(t, prevT, rate);
    for (const line of dueLines(this.plan, t, LOOKAHEAD_SEC, rate)) {
      if (this.playing.has(line.id)) continue;
      this.speak(line, t, rate, now);
    }
    // Forget lines that have finished.
    for (const [id, p] of this.playing) {
      const line = this.plan.lines.find((l) => l.id === id);
      if (!line || p.ctxStart + (line.end - line.start) < now - 0.5) this.playing.delete(id);
    }
  }

  private replan(t: number): void {
    this.dirty = false;
    const resolve = makeResolver(this.opts.caster, (k) => this.state.get(k));
    this.plan = planSpeech(this.lines, resolve, t);
    this.cues = crowdCues(this.plan);
    // A key line that now cuts into one already playing: stop that one at the cut.
    for (const line of this.plan.lines) {
      const p = this.playing.get(line.id);
      if (!p || line.cut === undefined || p.cut === line.cut) continue;
      p.cut = line.cut;
      const at = p.ctxStart + (line.cut - line.start);
      for (const s of p.sources) {
        try {
          s.stop(Math.max(this.ctx.currentTime, at));
        } catch {
          /* already stopped */
        }
      }
    }
  }

  private speak(line: PlannedLine, t: number, rate: number, now: number): void {
    // At normal speed the line keeps race time; at other speeds a key call plays in real time from its start.
    const ctxStart = rate === 1 ? now + (line.start - t) : now + Math.max(0, (line.start - t) / rate);
    const from = rate === 1 ? joinAt(line, t) : { clip: 0, offset: 0 };
    if (!from) return;
    const sources: AudioBufferSourceNode[] = [];
    const stopAt = line.cut !== undefined ? ctxStart + (line.cut - line.start) : Number.POSITIVE_INFINITY;
    for (let k = from.clip; k < line.clips.length; k++) {
      const c = line.clips[k]!;
      const buf = this.buffers.get(c.key);
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.voiceBus);
      const offset = k === from.clip ? from.offset : 0;
      const when = Math.max(now, ctxStart + c.at + offset);
      if (when >= stopAt) break;
      src.start(when, offset);
      if (Number.isFinite(stopAt)) src.stop(stopAt);
      sources.push(src);
    }
    this.playing.set(line.id, { sources, ctxStart, cut: line.cut });
  }

  private stopVoice(): void {
    for (const p of this.playing.values()) {
      for (const s of p.sources) {
        try {
          s.stop();
        } catch {
          /* not started */
        }
      }
    }
    this.playing.clear();
  }

  private crowd(t: number, prevT: number, rate: number): void {
    const bed = crowdAt(this.cues, t);
    const pre = t < 0;
    if (bed !== this.bed || pre !== this.preOff) {
      this.bed = bed;
      this.preOff = pre;
      const now = this.ctx.currentTime;
      for (const [b, g] of this.bedGains) {
        const target = b === bed ? MIX.beds[b] * (pre ? MIX.preOffCrowd : 1) : 0;
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(target, now, MIX.crowdFadeSec / 3);
      }
    }
    if (t > prevT && t - prevT < 1 * Math.max(1, rate)) {
      for (const _c of cheersBetween(this.cues, prevT, t)) this.cheer();
    }
  }

  private cheer(): void {
    const buf = this.buffers.get("bed|cheer");
    if (!buf) return;
    const g = this.ctx.createGain();
    g.gain.value = MIX.cheer;
    g.connect(this.master);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    src.start();
  }

  /** Silence, release everything (the toggle turned off, or the viewer unmounts). */
  dispose(): void {
    this.disposed = true;
    this.stopVoice();
    void this.ctx.close().catch(() => undefined);
  }
}
