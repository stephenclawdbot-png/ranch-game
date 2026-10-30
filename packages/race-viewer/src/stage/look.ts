/**
 * ONE lighting look per race, from the weather and the local post hour (pure). Trackside and
 * the 3D view both read it: the same sky art and gradient, the sun on the same side of the
 * picture, the same fog/haze colour, grade, sprite tint, rain and motes.
 *
 * World convention shared by both views: x runs along the track left to right on screen,
 * y is up, z points from the far rail towards the camera (the near side). The sun stands
 * beyond the far rail, to the right of the picture (Trackside draws its glow at ~70 % of the
 * width); the key light that models the horses comes from the camera side, also from the
 * right, so the flank the viewer sees is lit in both views (front light, never back-lit).
 */
import type { Weather } from "@thoroughbred/shared";
import { lookFor, type TracksideLook, type TracksideLookId } from "../trackside/looks";
import { LOOKS, type Look } from "../three/pixelTextures";
import { mixHex } from "../three/color";

export type StageLookId = TracksideLookId;
export type SunSide = "left" | "right";

export interface StageLook {
  id: StageLookId;
  /** Side of the picture the sun (and the key light) is on, in both views. */
  sunSide: SunSide;
  /** The visible sun (null under cloud): azimuth right of the view axis, elevation, Trackside screen spot. */
  sun: { azimuthDeg: number; elevationDeg: number; screenX: number; screenY: number } | null;
  /** World direction towards the sun disc (beyond the far rail, right of the picture). */
  sunDir: [number, number, number];
  /** World direction of the key light (camera side, right): the visible flank is lit. */
  keyDir: [number, number, number];
  sky: { art: TracksideLook["sky"]; top: string; bottom: string };
  fog: string;
  spriteTint: [string, number];
  saturation: number;
  brightness: number;
  rain: boolean;
  /** Floating motes in the light (count at high quality). */
  motes: number;
  /** The Trackside grade (layer baking, rim light, rays): the source of everything above. */
  trackside: TracksideLook;
  /** The 3D renderer's parameters, derived from the same look. */
  three: Look;
}

const SUN: Record<StageLookId, { az: number; el: number } | null> = {
  dusk: { az: 20, el: 5 },
  golden: { az: 24, el: 14 },
  overcast: null,
  rain: null,
};

const BASE_3D: Record<StageLookId, Weather> = { dusk: "dusk", golden: "clear", overcast: "overcast", rain: "rain" };

function unit(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Direction towards a point `azDeg` right of the view axis (-z) and `elDeg` up. */
export function dirFromAngles(azDeg: number, elDeg: number): [number, number, number] {
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}

/** The local hour of a post time (null when unknown). */
export function postHour(postTimeMs: number | null | undefined): number | null {
  if (postTimeMs === null || postTimeMs === undefined || !Number.isFinite(postTimeMs)) return null;
  const h = new Date(postTimeMs).getHours();
  return Number.isFinite(h) ? h : null;
}

export function stageLook(weather: Weather, hour: number | null): StageLook {
  const ts = lookFor(weather, hour);
  const sun = SUN[ts.id];
  const sunDir = sun ? dirFromAngles(sun.az, sun.el) : dirFromAngles(30, 55);
  // Key light from the camera side and the sun's side, lower at dusk.
  const keyDir = unit(ts.id === "dusk" ? [0.6, 0.38, 0.7] : [0.5, 0.62, 0.6]);
  const base = LOOKS[BASE_3D[ts.id]];
  const [tc, ta] = ts.spriteTint;
  const sky = [ts.skyTop, mixHex(ts.skyTop, ts.skyBottom, 0.3), mixHex(ts.skyTop, ts.skyBottom, 0.55), mixHex(ts.skyTop, ts.skyBottom, 0.8), ts.skyBottom];
  const three: Look = {
    ...base,
    sky,
    sunDir,
    fog: ts.fog,
    billboardTint: mixHex("#ffffff", tc, Math.min(0.5, ta * 1.1)),
    grade: { tint: base.grade.tint, saturation: base.grade.saturation * ts.saturation, contrast: base.grade.contrast },
    sunIntensity: base.sunIntensity * ts.brightness,
    hemiIntensity: base.hemiIntensity * ts.brightness,
    rain: ts.rain,
  };
  return {
    id: ts.id,
    sunSide: "right",
    sun: sun && ts.sun ? { azimuthDeg: sun.az, elevationDeg: sun.el, screenX: ts.sun.x, screenY: ts.sun.y } : null,
    sunDir,
    keyDir,
    sky: { art: ts.sky, top: ts.skyTop, bottom: ts.skyBottom },
    fog: ts.fog,
    spriteTint: ts.spriteTint,
    saturation: ts.saturation,
    brightness: ts.brightness,
    rain: ts.rain,
    motes: ts.motes.count,
    trackside: ts,
    three,
  };
}
