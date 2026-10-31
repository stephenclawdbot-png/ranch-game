/**
 * Finale runner (pure state machine, no DOM): starts the finale when playback crosses the
 * plan's start (or at once on a live -> official hand-off past it), advances it in real
 * seconds, and lets the viewer skip a step or the whole finale. A seek or restart re-arms it.
 */
import { finaleSceneTime, finaleStepAt, stepStart, type FinalePlan, type FinaleStep } from "./plan";

export type FinaleState = "idle" | "running" | "done";

export class FinaleRunner {
  plan: FinalePlan | null = null;
  state: FinaleState = "idle";
  /** Real seconds since the finale started. */
  elapsed = 0;
  paused = false;

  /**
   * Hand over the plan (only ever built from an official result). `atTime` is the playback
   * time now: a viewer that opens after the finale's start doesn't play it (it shows the
   * result board straight away), unless `startNow` (the live broadcast just went official).
   */
  setPlan(plan: FinalePlan | null, atTime: number, startNow = false): void {
    this.plan = plan;
    this.elapsed = 0;
    this.paused = false;
    if (!plan) {
      this.state = "idle";
      return;
    }
    if (startNow && atTime >= plan.startAt - 1e-6) this.state = "running";
    else this.state = atTime > plan.startAt + 1e-6 ? "done" : "idle";
  }

  /** Re-arm after a seek / restart (the finale plays again when the playhead next crosses it). */
  rearm(atTime: number): void {
    if (!this.plan) return;
    this.elapsed = 0;
    this.paused = false;
    this.state = atTime > this.plan.startAt + 1e-6 ? "done" : "idle";
  }

  /** One frame: playback went from `prevT` to `t` (race time), `dt` real seconds passed. */
  update(prevT: number, t: number, dt: number): void {
    const p = this.plan;
    if (!p) return;
    if (this.state === "idle" && prevT < p.startAt && t >= p.startAt) {
      this.state = "running";
      this.elapsed = 0;
      return;
    }
    if (this.state !== "running" || this.paused) return;
    this.elapsed += Math.max(0, Math.min(dt, 0.25));
    if (this.elapsed >= p.total) this.finish();
  }

  get running(): boolean {
    return this.state === "running";
  }

  current(): { index: number; step: FinaleStep | null; into: number } {
    if (!this.plan || this.state !== "running") return { index: -1, step: null, into: 0 };
    return finaleStepAt(this.plan, this.elapsed);
  }

  /** Race time the scene draws, or null for the playback clock's own time. */
  sceneTime(): number | null {
    if (!this.plan || this.state !== "running") return null;
    return finaleSceneTime(this.plan, this.elapsed);
  }

  /** Next step (tap / click). */
  skip(): void {
    if (!this.plan || this.state !== "running") return;
    const { index } = finaleStepAt(this.plan, this.elapsed);
    if (index + 1 >= this.plan.steps.length) this.finish();
    else this.elapsed = stepStart(this.plan, index + 1);
  }

  /** Dev / tests: show step `index`, `into` seconds in (starts the finale if needed). */
  goto(index: number, into = 0): void {
    if (!this.plan) return;
    this.state = "running";
    this.elapsed = Math.min(this.plan.total - 1e-3, stepStart(this.plan, index) + Math.max(0, into));
  }

  /** The whole finale (Esc): straight to the result board. */
  skipAll(): void {
    if (this.plan && this.state !== "done") this.finish();
  }

  private finish(): void {
    this.state = "done";
    this.elapsed = this.plan?.total ?? 0;
  }
}
