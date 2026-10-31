/**
 * @thoroughbred/race-viewer — HD 2.5D playback of a stored RaceReplay.
 *
 * Main entry is Three-free at import time (three.js loads lazily on the client).
 * Dev helpers (fakeReplay, SpriteSheet) live in "@thoroughbred/race-viewer/dev".
 */
export { RaceViewer, type RaceViewerProps } from "./RaceViewer";
export type { CameraMode, QualitySetting, RenderQuality, ViewMode } from "./types";
export { perfReport, type PerfReport } from "./perfReport";
export { sampleReplay, createReplaySampler, replayTiming, type HorseSample, type ReplaySampler, type ReplayTiming } from "./sampleReplay";
export { standingsAt, distanceToGoM, commentaryAt, lengthsLabel, type StandingRow } from "./timeline";
export { PlaybackClock, PLAYBACK_RATES, type ClockFrame, type PlaybackOptions } from "./playback";
export { CourseMap, describeCourse, type CourseMapProps, type CourseMapRunner } from "./hud/CourseMap";
export { courseGeometry, pointAt, runnerArcM, startArcM, type CourseGeometry, type CourseInfo, type CourseSceneryId, type CourseShapeId } from "./course/geometry";
export { SCENERY, sceneryFor, type SceneryRecipe } from "./trackside/scenery";
export { buildRaceCall, CALL_MIN_GAP_SEC, PHOTO_CALL_MM, type CallCourse, type CallKind, type CallLine, type LiveReplayView, type RaceCallInput } from "./call";
export * from "./photo";
export { RaceCallFeed, callLineAt, type CallFeedOptions, type TickerPick } from "./call/ticker";
export { battleAt, distanceMarker, type Battle, type DistanceMarker } from "./hud/battle";
export { finalePlan, finaleSlides, isPhotoFinish, isCloseFinish, type FinalePlan, type FinaleSlide, type FinaleStep, type FinaleStepKind } from "./finale/plan";
export { officialHandoff } from "./finale/live";
export { checkSeal, type PortraitRenderer, type RunnerConnections, type SealState } from "./finale/FinaleOverlay";
export { WHAT_IF_BADGE, whatIfCall, whatIfFlags } from "./whatIf";
