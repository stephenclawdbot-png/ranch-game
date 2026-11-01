/**
 * Detached islands of a painted strip (a check, not a renderer): per frame, the opaque texels
 * 8-connected to the largest mass (the horse and its rider) and the islands apart from it. Used by
 * the tests to keep the code-drawn hair and the build warp from leaving loose pixels.
 */
export interface FrameIslands {
  frame: number;
  /** Sizes of every opaque island not connected to the main mass, largest first. */
  detached: number[];
  /** One texel of the smallest detached island (frame-local x, y), for messages. */
  at: [number, number] | null;
}

/** The detached islands of every frame of a strip (RGBA, frames side by side `frameW` apart). */
export function detachedIslands(rgba: ArrayLike<number>, width: number, height: number, frameW: number): FrameIslands[] {
  const frames = Math.max(1, Math.floor(width / frameW));
  const out: FrameIslands[] = [];
  const label = new Int32Array(frameW * height);
  const stack: number[] = [];
  for (let f = 0; f < frames; f++) {
    label.fill(0);
    const opaque = (x: number, y: number) => rgba[(y * width + f * frameW + x) * 4 + 3]! >= 128;
    const sizes: number[] = [0];
    const seeds: number[] = [0];
    let n = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < frameW; x++) {
        const i = y * frameW + x;
        if (label[i] || !opaque(x, y)) continue;
        n++;
        let size = 0;
        label[i] = n;
        stack.push(i);
        while (stack.length) {
          const p = stack.pop()!;
          size++;
          const px = p % frameW;
          const py = (p / frameW) | 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const qx = px + dx;
              const qy = py + dy;
              if (qx < 0 || qy < 0 || qx >= frameW || qy >= height) continue;
              const q = qy * frameW + qx;
              if (label[q] || !opaque(qx, qy)) continue;
              label[q] = n;
              stack.push(q);
            }
        }
        sizes.push(size);
        seeds.push(i);
      }
    let main = 0;
    for (let k = 1; k <= n; k++) if (sizes[k]! > (sizes[main] ?? 0)) main = k;
    const detached: { size: number; seed: number }[] = [];
    for (let k = 1; k <= n; k++) if (k !== main) detached.push({ size: sizes[k]!, seed: seeds[k]! });
    detached.sort((a, b) => b.size - a.size);
    const small = detached[detached.length - 1];
    out.push({ frame: f, detached: detached.map((d) => d.size), at: small ? [small.seed % frameW, (small.seed / frameW) | 0] : null });
  }
  return out;
}
