/**
 * @thoroughbred/race-viewer — HD 2.5D playback of a stored RaceReplay.
 *
 * Main entry is Pixi-free at import time (Pixi loads lazily on the client).
 * Dev helpers (fakeReplay, HorseStudio) live in "@thoroughbred/race-viewer/dev".
 */
export { RaceViewer, type RaceViewerProps } from "./RaceViewer";
export type { CameraMode, QualitySetting, RenderQuality } from "./types";
export { sampleReplay, createReplaySampler, replayTiming, type HorseSample, type ReplaySampler, type ReplayTiming } from "./sampleReplay";
export { standingsAt, distanceToGoM, commentaryAt, lengthsLabel, type StandingRow } from "./timeline";
export { PlaybackClock, PLAYBACK_RATES, type ClockFrame, type PlaybackOptions } from "./playback";
