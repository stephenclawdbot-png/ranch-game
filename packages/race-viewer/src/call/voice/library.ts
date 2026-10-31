/**
 * Where the commentary clips live and how a speech token becomes clips (pure, no fetch).
 *
 *   /audio/commentary/manifest.json                        the phrase library (static, per deploy)
 *   /audio/commentary/<caster>/<intensity>/<phrase>.mp3    a phrase clip
 *   /audio/commentary/beds/*.mp3                           crowd beds and radio static
 *   /api/commentary/names/<recipe>/<caster>/<intensity>/<name key>   a horse name (404 until voiced)
 */
import type { ClipRef, ClipResolver, CrowdBed } from "./schedule";
import type { Intensity, Speech, SpeechToken } from "./speech";

export const COMMENTARY_BASE = "/audio/commentary";

export interface CommentaryManifest {
  recipe: number;
  sampleRate: number;
  casters: string[];
  intensities: Intensity[];
  beds: Record<CrowdBed | "cheer" | "static", { file: string; duration: number; loop: boolean }>;
  /** caster -> intensity -> phrase id -> { d: seconds, h: render hash }. */
  clips: Record<string, Record<string, Record<string, { d: number; h: string }>>>;
}

/** Mixer levels (linear gain) for the voice, the crowd beds, the cheer and the static. KNOBS: "Radio commentary". */
export const MIX = {
  voice: 1,
  beds: { murmur: 0.2, building: 0.32, roar: 0.5, hush: 0.1 } as Record<CrowdBed, number>,
  cheer: 0.55,
  static: 1,
  /** Seconds a crowd bed change takes (time constant of the gain ramp x3). */
  crowdFadeSec: 0.8,
  /** Before the off the crowd is quieter still (x this). */
  preOffCrowd: 0.7,
};

/** The clip key for a horse name: Unicode-normalised, trimmed, single spaces, lowercase (db commentaryNameKey). */
export function nameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export const phraseKey = (caster: string, intensity: Intensity, id: string) => `p|${caster}|${intensity}|${id}`;
export const nameClipKey = (caster: string, intensity: Intensity, name: string) => `n|${caster}|${intensity}|${nameKey(name)}`;

export function phraseUrl(caster: string, intensity: Intensity, id: string, base = COMMENTARY_BASE): string {
  return `${base}/${caster}/${intensity}/${id}.mp3`;
}

export function nameUrl(recipe: number, caster: string, intensity: Intensity, name: string, api = "/api/commentary/names"): string {
  return `${api}/${recipe}/${caster}/${intensity}/${encodeURIComponent(nameKey(name))}`;
}

/** Every clip a speech needs, phrases and names (a name is fetched; its number is the fallback). */
export function clipsFor(s: Speech, caster: string): Array<{ key: string; kind: "phrase" | "name"; id: string; intensity: Intensity }> {
  const out: Array<{ key: string; kind: "phrase" | "name"; id: string; intensity: Intensity }> = [];
  const i = s.intensity;
  for (const t of s.tokens) {
    if (t.k === "p") out.push({ key: phraseKey(caster, i, t.id), kind: "phrase", id: t.id, intensity: i });
    else {
      if (t.your) out.push({ key: phraseKey(caster, i, "your"), kind: "phrase", id: "your", intensity: i });
      out.push({ key: nameClipKey(caster, i, t.name), kind: "name", id: t.name, intensity: i });
      out.push({ key: phraseKey(caster, i, `num_${t.num}`), kind: "phrase", id: `num_${t.num}`, intensity: i });
    }
  }
  return out;
}

/** What the player knows about a clip: its length once decoded, "missing" (404 / failed), or still loading (absent). */
export type ClipState = number | "missing";

/**
 * Token -> clips from what has loaded: a phrase plays its clip; a horse plays its name clip,
 * or "number N" when the name has no clip; null while a needed clip is still loading.
 */
export function makeResolver(caster: string, state: (key: string) => ClipState | undefined): ClipResolver {
  const ref = (key: string): ClipRef | null | "missing" => {
    const s = state(key);
    if (s === undefined) return null;
    if (s === "missing") return "missing";
    return { key, dur: s };
  };
  return (tok: SpeechToken, intensity: Intensity) => {
    if (tok.k === "p") {
      const r = ref(phraseKey(caster, intensity, tok.id));
      return r === null ? null : r === "missing" ? [] : [r];
    }
    const out: ClipRef[] = [];
    if (tok.your) {
      const y = ref(phraseKey(caster, intensity, "your"));
      if (y === null) return null;
      if (y !== "missing") out.push(y);
    }
    const n = ref(nameClipKey(caster, intensity, tok.name));
    if (n === null) return null;
    if (n !== "missing") return [...out, n];
    const num = ref(phraseKey(caster, intensity, `num_${tok.num}`));
    if (num === null) return null;
    return num === "missing" ? out : [...out, num];
  };
}
