/** Critically damped spring (exact solution, frame-rate independent). */
export class Spring {
  v = 0;
  constructor(
    public x: number,
    public omega: number,
  ) {}

  /** Move toward `target` that itself moves at `targetVel` (feed-forward removes lag). */
  step(target: number, dt: number, targetVel = 0): number {
    if (dt <= 0) return this.x;
    const w = this.omega;
    const goal = target + (2 * targetVel) / w;
    const c1 = this.x - goal;
    const c2 = this.v + w * c1;
    const e = Math.exp(-w * dt);
    this.x = goal + (c1 + c2 * dt) * e;
    this.v = (c2 - w * (c1 + c2 * dt)) * e;
    return this.x;
  }

  snap(x: number, v = 0): void {
    this.x = x;
    this.v = v;
  }
}
