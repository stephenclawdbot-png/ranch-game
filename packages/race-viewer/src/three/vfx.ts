/**
 * Pixel VFX drawn in code: square point sprites (whole-pixel sizes, no texture, no
 * smoothing) for hoof dust, turf clods and finish confetti; 1px streaks for rain.
 */
import type * as THREE from "three";
import { hexToRgb } from "./color";

const P_VERT = /* glsl */ `
attribute float size;
attribute vec4 color4;
uniform float pxScale;
varying vec4 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, floor(size * pxScale / max(0.1, -mv.z) + 0.5));
  vC = color4;
}
`;
const P_FRAG = /* glsl */ `
varying vec4 vC;
void main() {
  if (vC.a < 0.01) discard;
  gl_FragColor = vC;
  #include <colorspace_fragment>
}
`;

export type ParticleKind = "dust" | "clod" | "confetti";

interface Particle {
  alive: boolean;
  kind: ParticleKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  a: number;
  phase: number;
}

export class PixelParticles {
  readonly points: THREE.Points;
  private pool: Particle[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private cursor = 0;
  private colorCache = new Map<string, [number, number, number]>();
  density = 1;

  constructor(T: typeof THREE, capacity: number) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.geo = new T.BufferGeometry();
    this.geo.setAttribute("position", new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    this.geo.setAttribute("color4", new T.BufferAttribute(this.col, 4).setUsage(T.DynamicDrawUsage));
    this.geo.setAttribute("size", new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage));
    this.mat = new T.ShaderMaterial({ vertexShader: P_VERT, fragmentShader: P_FRAG, uniforms: { pxScale: { value: 400 } }, transparent: true, depthWrite: false });
    this.points = new T.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.pool.push({ alive: false, kind: "dust", x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.1, grow: 0, r: 1, g: 1, b: 1, a: 1, phase: 0 });
    }
  }

  /** Pixels per world unit at distance 1 (drawing-buffer height / (2 tan(fov/2))). */
  setPxScale(v: number): void {
    this.mat.uniforms.pxScale!.value = v;
  }

  private take(): Particle | null {
    for (let k = 0; k < this.pool.length; k++) {
      const p = this.pool[(this.cursor + k) % this.pool.length]!;
      if (!p.alive) {
        this.cursor = (this.cursor + k + 1) % this.pool.length;
        return p;
      }
    }
    return null;
  }

  emit(kind: ParticleKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, color: string, size: number, life: number, alpha = 1): void {
    if (kind !== "confetti" && Math.random() > this.density) return;
    const p = this.take();
    if (!p) return;
    let rgb = this.colorCache.get(color);
    if (!rgb) {
      rgb = hexToRgb(color);
      this.colorCache.set(color, rgb);
    }
    p.alive = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = 0;
    p.max = life;
    p.size = size;
    p.grow = kind === "dust" ? size * 0.3 : 0;
    p.r = rgb[0] / 255;
    p.g = rgb[1] / 255;
    p.b = rgb[2] / 255;
    p.a = alpha;
    p.phase = Math.random() * 6.28;
  }

  update(dt: number): void {
    let i = 0;
    for (const p of this.pool) {
      if (p.alive) {
        p.life += dt;
        if (p.kind === "clod") p.vy -= 9.8 * dt;
        else if (p.kind === "dust") {
          p.vy -= 0.2 * dt;
          p.vx *= Math.exp(-1.5 * dt);
          p.size += p.grow * dt;
        } else {
          p.vy = Math.max(p.vy - 3 * dt, -1.1);
          p.vx = Math.sin(p.life * 5 + p.phase) * 0.8;
          p.vz *= Math.exp(-0.5 * dt);
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.life >= p.max || p.y < -0.05) p.alive = false;
      }
      const o = i * 3;
      const c = i * 4;
      if (p.alive) {
        this.pos[o] = p.x;
        this.pos[o + 1] = p.y;
        this.pos[o + 2] = p.z;
        const fade = p.kind === "confetti" ? 1 : 1 - p.life / p.max;
        // Confetti flicker = flipping paper.
        const flip = p.kind === "confetti" ? 0.6 + 0.4 * Math.abs(Math.sin(p.life * 9 + p.phase)) : 1;
        this.col[c] = p.r * flip;
        this.col[c + 1] = p.g * flip;
        this.col[c + 2] = p.b * flip;
        this.col[c + 3] = p.a * fade;
        this.size[i] = p.size;
      } else {
        this.col[c + 3] = 0;
        this.size[i] = 0;
      }
      i++;
    }
    for (const name of ["position", "color4", "size"]) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** 1px rain streaks in a box that follows the camera. */
export class PixelRain {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private drops: { x: number; y: number; z: number; v: number }[] = [];
  private geo: THREE.BufferGeometry;
  private mat: THREE.LineBasicMaterial;

  constructor(T: typeof THREE, count: number) {
    this.pos = new Float32Array(count * 6);
    this.geo = new T.BufferGeometry();
    this.geo.setAttribute("position", new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    this.mat = new T.LineBasicMaterial({ color: 0xc9d6e2, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
    this.lines = new T.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    for (let i = 0; i < count; i++) this.drops.push({ x: Math.random() * 60 - 30, y: Math.random() * 18, z: Math.random() * 40 - 30, v: 14 + Math.random() * 6 });
  }

  update(dt: number, cx: number, cz: number): void {
    let i = 0;
    for (const d of this.drops) {
      d.y -= d.v * dt;
      d.x -= d.v * 0.18 * dt;
      if (d.y < 0) {
        d.y += 18;
        d.x = Math.random() * 60 - 30;
        d.z = Math.random() * 40 - 30;
      }
      const wx = cx + ((((d.x - cx * 0) % 60) + 90) % 60) - 30;
      const o = i * 6;
      this.pos[o] = wx;
      this.pos[o + 1] = d.y;
      this.pos[o + 2] = cz + d.z;
      this.pos[o + 3] = wx + 0.08;
      this.pos[o + 4] = d.y + 0.45;
      this.pos[o + 5] = cz + d.z;
      i++;
    }
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
