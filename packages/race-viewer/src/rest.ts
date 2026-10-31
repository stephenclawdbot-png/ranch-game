/**
 * Rest: when the host page shows its results under the stage (`RaceViewerProps.rest`), the
 * viewer pauses once and then stops drawing while nothing on the stage can change. A results
 * page then costs no GPU or main-thread time, so navigating away from it is quick (first-hour
 * playtest: a page that kept rendering the replay took 20-140 s to leave on a busy machine).
 * Play, a seek, a camera change or a resize draws again at once.
 */

/** Unchanged frames still drawn after the last change (about 0.75 s at 60 fps: eases settle). */
export const REST_FRAMES = 45;

export class RestGate {
  private key: string | null = null;
  private same = 0;

  /**
   * Whether to draw this frame. `resting`: the host asked for rest and nothing is playing (no
   * clock running, no finale). `key`: everything a frame depends on (scene time, camera, size...).
   */
  draw(resting: boolean, key: string): boolean {
    if (!resting || key !== this.key) {
      this.key = key;
      this.same = 0;
      return true;
    }
    this.same++;
    return this.same <= REST_FRAMES;
  }

  /** True while frames are being skipped. */
  get idle(): boolean {
    return this.same > REST_FRAMES;
  }
}

/**
 * Whether turning rest on pauses the clock: only a replay clock that is playing past the finish
 * (the run-out), and never during the finale. A live clock, or a replay still before the line
 * (the broadcast running behind the result), plays on to the end and stops there by itself.
 */
export function shouldPauseForRest(clock: { kind: "replay"; time: number; duration: number; playing: boolean } | null, finaleRunning: boolean): boolean {
  return !!clock && clock.playing && !finaleRunning && clock.time >= clock.duration;
}
