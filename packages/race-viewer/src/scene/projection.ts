/**
 * 2.5D projection for an unwrapped straight seen side-on.
 *
 * Depth t runs across the track: 0 = inner rail (far, top of the band),
 * 1 = outer rail (near, bottom). Each depth has a perspective scale s(t) in
 * [S_FAR, S_NEAR]; screen x and object size use it, so far lanes scroll slower
 * and look smaller, which gives finish lines and stripes a true perspective slant.
 */
export const S_FAR = 0.8;
export const S_NEAR = 1.0;

export class Projection {
  W = 1;
  H = 1;
  /** Base pixels per metre at zoom 1 on the near rail. */
  ppm = 40;
  camX = 0;
  zoom = 1;
  farY = 0;
  nearY = 0;
  pivotY = 0;
  /** Screen x (fraction of W) of the camera centre. */
  anchor = 0.5;

  setSize(W: number, H: number): void {
    this.W = W;
    this.H = H;
    this.ppm = Math.min(H / 12.5, W / 18.5);
    this.farY = H * 0.545;
    this.nearY = H * 0.865;
    this.pivotY = (this.farY + this.nearY) / 2;
  }

  /** Vertical zoom is softened so the track band never collapses. */
  get zoomV(): number {
    return 1 + (this.zoom - 1) * 0.7;
  }

  s(t: number): number {
    return S_FAR + (S_NEAR - S_FAR) * t;
  }

  /** Ground-line screen y at depth t. */
  y(t: number): number {
    const base = this.farY + (this.nearY - this.farY) * t;
    return this.pivotY + (base - this.pivotY) * this.zoomV;
  }

  /** Pixels per metre at depth t. */
  k(t: number): number {
    return this.ppm * this.zoom * this.s(t);
  }

  x(worldX: number, t: number): number {
    return this.W * this.anchor + (worldX - this.camX) * this.k(t);
  }

  worldXAt(screenX: number, t: number): number {
    return this.camX + (screenX - this.W * this.anchor) / this.k(t);
  }

  /** Half the visible width in metres at depth t. */
  halfWidthM(t = 0.5): number {
    return (this.W * 0.5) / this.k(t);
  }

  /** Screen x for a background layer scrolling at `factor` of the camera. */
  layerX(layerX: number, factor: number): number {
    return this.W * this.anchor + (layerX - this.camX * factor) * this.ppm * this.layerZoom(factor);
  }

  layerZoom(factor: number): number {
    return 1 + (this.zoom - 1) * Math.min(1, factor);
  }
}
