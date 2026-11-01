/**
 * @thoroughbred/race-viewer — HD 2.5D playback of a stored RaceReplay.
 *
 * Main entry is Three-free at import time (three.js loads lazily on the client).
 * Dev helpers (fakeReplay, SpriteSheet) live in "@thoroughbred/race-viewer/dev".
 */
export { RaceViewer, prewarmRaceView, type RaceViewerProps } from "./RaceViewer";
export type { CameraMode, QualitySetting, RenderQuality, ViewMode } from "./types";
export { perfReport, type PerfLayout, type PerfReport } from "./perfReport";
export { sampleReplay, createReplaySampler, replayTiming, type HorseSample, type ReplaySampler, type ReplayTiming } from "./sampleReplay";
export { standingsAt, distanceToGoM, commentaryAt, lengthsLabel, type StandingRow } from "./timeline";
export { PlaybackClock, PLAYBACK_RATES, type ClockFrame, type PlaybackOptions } from "./playback";
export { CourseMap, describeCourse, type CourseMapProps, type CourseMapRunner } from "./hud/CourseMap";
export { courseGeometry, pointAt, runnerArcM, startArcM, type CourseGeometry, type CourseInfo, type CourseSceneryId, type CourseShapeId } from "./course/geometry";
export { SCENERY, sceneryFor, type SceneryRecipe } from "./trackside/scenery";
export { buildRaceCall, CALL_MIN_GAP_SEC, PHOTO_CALL_MM, type CallCourse, type CallKind, type CallLine, type LiveReplayView, type RaceCallInput } from "./call";
// The radio commentary (call/voice, docs/commentary.md): the spoken call, casters, clip library and timing.
export { buildVoicedRaceCall, type VoicedCallLine } from "./call/buildRaceCall";
export { VOCABULARY, SPOKEN, COURSE_NAMES, INTENSITIES, phraseId, speak, type Intensity, type Speech, type SpeechToken } from "./call/voice/speech";
export { CASTERS, CASTER_IDS, pickCaster, type Caster } from "./call/voice/casters";
export { COMMENTARY_BASE, MIX, nameKey, nameUrl, phraseUrl, makeResolver, clipsFor, type CommentaryManifest } from "./call/voice/library";
export { planSpeech, crowdCues, crowdAt, cheersBetween, joinAt, dueLines, SPEECH, type SpeechPlan, type PlannedLine, type CrowdCue, type CrowdBed } from "./call/voice/schedule";
export { RadioToggle } from "./hud/Hud";
export * from "./photo";
export { RaceCallFeed, callLineAt, type CallFeedOptions, type TickerPick } from "./call/ticker";
export { battleAt, distanceMarker, type Battle, type DistanceMarker } from "./hud/battle";
export { finalePlan, finaleSlides, isPhotoFinish, isCloseFinish, type FinalePlan, type FinaleSlide, type FinaleStep, type FinaleStepKind } from "./finale/plan";
export { officialHandoff } from "./finale/live";
export { checkSeal, type PortraitRenderer, type RunnerConnections, type SealState } from "./finale/FinaleOverlay";
export { WHAT_IF_BADGE, whatIfBadge, whatIfCall, whatIfFlags } from "./whatIf";
export { ClipShareButton, type ClipShareButtonProps } from "./clip/ClipShareButton";
export { recordRaceClip, ClipCancelled, clipDateLabel, type RecordClipOptions, type RecordedClip, type ClipMeta } from "./clip/record";
export { canShareClip, clipWindow, clipSchedule, clipFileName, endCardRows, CLIP_SIZES, CLIP_FPS, type ClipOrientation, type ClipSchedule } from "./clip/plan";
// Runner identity (V-03): saddle cloths in the gate colours (the racecard's single definition).
export { SADDLE_CLOTHS, saddleClothOf, clothOffByUrl, type SaddleClothLook } from "./cloth";
// Race on a phone (V-01 layout, V-02 close-up finish).
export { PHONE_PX, CloseUpFinish, closeUpByUrl, phoneLayoutByUrl } from "./phone";
