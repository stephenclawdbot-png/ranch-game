/**
 * Dev harness for the pixel rig (used by apps/web/app/dev/rig). Browser only.
 *
 * Query params:
 *   mode=grid (default) | strip | bench | morph
 *   t=<seconds>       freeze time at t (with paused=1) for screenshots
 *   paused=1          no animation; phase / time from t
 *   phase=<0..1>      extra phase offset
 *   sun=<az>,<el>     sun azimuth / elevation in degrees (az 0 = from sprite right, 90 = from viewer)
 *   gen=1             force the code-generated parts (skip the PixelLab atlas)
 *   n=<count>         bench: number of rigs (default 16)
 *   speed=<m/s>       strip: speed for the strip horse (default 16)
 */
import * as THREE from "three";
import type { HorseAppearance } from "@thoroughbred/shared";
import { createHorseRigFactory, type HorseRig } from "../index";
import { strideFrequency } from "../gait";
import type { HorseLookOptions } from "../morph";
import type { PixelHorseRig, PixelHorseRigFactory } from "../runtime";

export interface HarnessHandle {
  dispose(): void;
  setSun(azDeg: number, elDeg: number): void;
  setPaused(p: boolean): void;
  setDrive(d: number): void;
  stats(): { rigs: number; updateMs: number; frameMs: number; source: string };
  /** Render `n` consecutive frames (dt apart) of rig `slot` at native res; returns a PNG data URL strip. */
  captureFrames(slot: number, n: number, dt: number, scale?: number): string;
}

const APPEARANCES: (HorseAppearance & { label: string; look?: HorseLookOptions })[] = [
  { label: "bay / idle", coat: "bay", face: "star", legs: ["none", "none", "none", "coronet"], silks: { primary: "#1d3fae", secondary: "#f2c230", pattern: "hoops", cap: "#f2c230" } },
  { label: "chestnut / walk", coat: "chestnut", face: "blaze", legs: ["sock", "none", "none", "sock"], silks: { primary: "#c0262d", secondary: "#ffffff", pattern: "stripes", cap: "#ffffff" } },
  { label: "grey / canter", coat: "dapple_grey", face: "none", legs: ["none", "none", "none", "none"], silks: { primary: "#16723d", secondary: "#f4efe2", pattern: "chevron", cap: "#16723d" } },
  { label: "black / gallop", coat: "black", face: "stripe", legs: ["none", "stocking", "none", "none"], silks: { primary: "#f08a1c", secondary: "#1b1b1b", pattern: "diamonds", cap: "#1b1b1b" } },
  { label: "palomino / gallop", coat: "palomino", face: "snip", legs: ["coronet", "coronet", "none", "none"], silks: { primary: "#6b2d8f", secondary: "#e8d44d", pattern: "sash", cap: "#e8d44d" } },
  { label: "dark bay / drive", coat: "dark_bay", face: "none", legs: ["none", "none", "none", "none"], silks: { primary: "#0f2a1d", secondary: "#d9a441", pattern: "quartered", cap: "#d9a441" } },
  { label: "roan / sabino", coat: "roan", face: "bald", legs: ["stocking", "sock", "none", "none"], silks: { primary: "#e9e3d3", secondary: "#7a1f1f", pattern: "stars", cap: "#7a1f1f" }, look: { sabino: 0.7 } },
  { label: "liver chestnut", coat: "liver_chestnut", face: "star", legs: ["none", "none", "sock", "none"], silks: { primary: "#2a8fd6", secondary: "#ffffff", pattern: "solid", cap: "#ffffff" } },
  { label: "buckskin", coat: "buckskin", face: "none", legs: ["none", "none", "none", "none"], silks: { primary: "#d63a7a", secondary: "#1e1e1e", pattern: "hoops", cap: "#d63a7a" } },
];
const GRID_SPEEDS = [0, 1.6, 7, 12.5, 16, 17.5];
const GRID_DRIVE = [0, 0, 0, 0, 0.2, 1];

function lightFrom(az: number, el: number): THREE.Vector3 {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  // az 0 = sun on the sprite's right (+x), 90 = towards the viewer (+z), 180 = left, 270 = behind
  return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).normalize();
}

export function startRigHarness(canvas: HTMLCanvasElement, params: URLSearchParams, artBaseUrl = "/art"): HarnessHandle {
  const mode = params.get("mode") ?? "grid";
  const paused0 = params.get("paused") === "1";
  const t0 = Number(params.get("t") ?? 0);
  const phaseOff = Number(params.get("phase") ?? 0);
  const [az0, el0] = (params.get("sun") ?? "35,40").split(",").map(Number) as [number, number];

  const W = canvas.width;
  const H = canvas.height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#7f9a73");
  const camera = new THREE.OrthographicCamera(0, W, H, 0, -10, 10);

  const num = (k: string) => (params.has(k) ? Number(params.get(k)) : undefined);
  const lighting = Object.fromEntries(
    Object.entries({
      lightMix: num("lm"),
      dither: num("dither"),
      rim: num("rim"),
      ambient: num("amb"),
      farShade: num("far"),
      outline: params.has("outline") ? params.get("outline") !== "0" : undefined,
      innerLines: params.has("inner") ? params.get("inner") !== "0" : undefined,
    }).filter(([, v]) => v !== undefined),
  );
  const factory = createHorseRigFactory({ artBaseUrl, loadSourceArt: params.get("gen") !== "1", lighting }) as PixelHorseRigFactory;
  const neutral = params.get("neutral") === "1";

  type Slot = { rig: HorseRig; speed: number; drive: number; phase: number; quad: THREE.Mesh; label?: string; shadow?: THREE.Mesh };
  const slots: Slot[] = [];
  const groundMat = new THREE.MeshBasicMaterial({ color: "#5f7d4c" });
  const shadowMat = new THREE.MeshBasicMaterial({ color: "#1f2a17", transparent: true, opacity: 0.35 });
  const addRig = (app: HorseAppearance & { look?: HorseLookOptions }, x: number, y: number, scale: number, speed: number, drive: number, phase: number, look?: HorseLookOptions) => {
    const rig = factory.create(app, {
      gate: slots.length + 1,
      ...(neutral ? { morph: { legLength: 1, neckLength: 1, girth: 1, height: 1, headSize: 1 } } : {}),
      ...(app.look ?? {}),
      ...(look ?? {}),
    });
    const mat = new THREE.MeshBasicMaterial({ map: rig.texture, transparent: true, alphaTest: 0.5 });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(rig.width * scale, rig.height * scale), mat);
    // (x, y) = top-left of the cell in canvas px (y down)
    quad.position.set(Math.round(x + (rig.width * scale) / 2), Math.round(H - y - (rig.height * scale) / 2), 1);
    scene.add(quad);
    const gy = H - y - rig.anchor.y * scale;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(rig.width * scale, (rig.height - rig.anchor.y) * scale), groundMat);
    ground.position.set(x + (rig.width * scale) / 2, gy - ((rig.height - rig.anchor.y) * scale) / 2, 0);
    scene.add(ground);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), shadowMat);
    shadow.scale.set(30 * scale, 3 * scale, 1);
    shadow.position.set(x + rig.anchor.x * scale, gy, 0.5);
    scene.add(shadow);
    slots.push({ rig, speed, drive, phase, quad, shadow });
  };

  if (mode === "grid") {
    // 3 x 2 horses at 2x, close-up of the galloping one at 4x
    GRID_SPEEDS.forEach((v, i) => addRig(APPEARANCES[i]!, 8 + (i % 3) * 264, 8 + Math.floor(i / 3) * 200, 2, v, GRID_DRIVE[i]!, i * 0.37));
    const ci = Number(params.get("close") ?? 4);
    addRig(APPEARANCES[ci % APPEARANCES.length]!, 8 + 3 * 264, 8, 4, Number(params.get("cspeed") ?? 16), Number(params.get("cdrive") ?? 0.2), ci * 0.37);
    // bottom row: more coats at 2x (sabino, roan...) galloping
    [6, 7, 8].forEach((k, i) => addRig(APPEARANCES[k]!, 8 + i * 264, 408, 2, 15 + i, 0.4, 0.21 * i));
  } else if (mode === "strip") {
    const v = Number(params.get("speed") ?? 16);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const s = { ...APPEARANCES[4]!, look: { seed: 7 } };
      addRig(s, 8 + (i % 4) * 264, 8 + Math.floor(i / 4) * 200, 2, v, 0, i / n);
    }
  } else if (mode === "morph") {
    const looks: HorseLookOptions[] = [
      { morph: { legLength: 0.86, neckLength: 0.9, girth: 1.12, height: 0.92, headSize: 1.08 }, variants: { mane: 0, tail: 0 } },
      { morph: { legLength: 1, neckLength: 1, girth: 1, height: 1, headSize: 1 }, variants: { mane: 0, tail: 0 } },
      { morph: { legLength: 1.14, neckLength: 1.18, girth: 0.9, height: 1.06, headSize: 0.92 }, variants: { mane: 1, tail: 1 } },
      { morph: { legLength: 1.05 }, variants: { mane: 1, tail: 0 }, sabino: 0.5 },
      { seed: 1 },
      { seed: 2 },
    ];
    looks.forEach((lk, i) => addRig(APPEARANCES[(i + 1) % APPEARANCES.length]!, 8 + (i % 3) * 264, 8 + Math.floor(i / 3) * 200, 2, i < 3 ? 0 : 15, 0, 0.3, lk));
  } else if (mode === "bench") {
    const n = Number(params.get("n") ?? 16);
    for (let i = 0; i < n; i++) addRig(APPEARANCES[i % APPEARANCES.length]!, 4 + (i % 8) * 130, 4 + Math.floor(i / 8) * 100, 1, 14 + (i % 5), i % 3 === 0 ? 0.8 : 0, i * 0.13);
  }

  const light = lightFrom(az0, el0);
  let paused = paused0;
  let driveOverride: number | null = null;
  let time = t0;
  let last = performance.now();
  let raf = 0;
  let updateMs = 0;
  let frameMs = 16;
  const state = { phase: 0, speedMs: 0, drive: 0, lightDir: light, time: 0 };

  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    frameMs = frameMs * 0.95 + (now - last) * 0.05;
    last = now;
    if (!paused) time += dt;
    const u0 = performance.now();
    for (const s of slots) {
      if (!paused) s.phase += strideFrequency(s.speed) * dt;
      state.phase = s.phase + phaseOff + (paused ? strideFrequency(s.speed) * time : 0);
      state.speedMs = s.speed;
      state.drive = driveOverride ?? s.drive;
      state.time = time;
      s.rig.update(renderer, state);
    }
    updateMs = updateMs * 0.9 + (performance.now() - u0) * 0.1;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  // A paused screenshot still needs the springs to settle: run a short warm-up sequence.
  if (paused0) {
    for (let k = 30; k >= 0; k--) {
      for (const s of slots) {
        state.phase = s.phase + phaseOff + strideFrequency(s.speed) * (t0 - k / 60);
        state.speedMs = s.speed;
        state.drive = s.drive;
        state.time = t0 - k / 60;
        s.rig.update(renderer, state);
      }
    }
  }
  raf = requestAnimationFrame(frame);

  // drag anywhere to move the sun
  const onMove = (e: PointerEvent) => {
    if (e.buttons !== 1) return;
    const r = canvas.getBoundingClientRect();
    const az = ((e.clientX - r.left) / r.width) * 360 - 90;
    const el = 85 - ((e.clientY - r.top) / r.height) * 100;
    light.copy(lightFrom(az, el));
    (window as unknown as { __rigSun?: number[] }).__rigSun = [Math.round(az), Math.round(el)];
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onMove);

  const handle: HarnessHandle = {
    dispose() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onMove);
      for (const s of slots) s.rig.dispose();
      factory.dispose();
      renderer.dispose();
    },
    setSun(az, el) {
      light.copy(lightFrom(az, el));
    },
    setPaused(p) {
      paused = p;
    },
    setDrive(d) {
      driveOverride = d < 0 ? null : d;
    },
    stats: () => ({ rigs: slots.length, updateMs, frameMs, source: factory.source }),
    captureFrames(slot, n, dt, scale = 1) {
      const s = slots[slot]!;
      const w = s.rig.width;
      const h = s.rig.height;
      const out = document.createElement("canvas");
      out.width = w * n * scale;
      out.height = h * scale;
      const ctx = out.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      const tmp = document.createElement("canvas");
      tmp.width = w;
      tmp.height = h;
      const tctx = tmp.getContext("2d")!;
      const buf = new Uint8Array(w * h * 4);
      const rt = (s.rig as unknown as { rt: THREE.WebGLRenderTarget }).rt;
      let ph = s.phase;
      let tm = time;
      for (let k = 0; k < n; k++) {
        ph += strideFrequency(s.speed) * dt;
        tm += dt;
        s.rig.update(renderer, { phase: ph, speedMs: s.speed, drive: s.drive, lightDir: light, time: tm });
        renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
        const img = tctx.createImageData(w, h);
        for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        tctx.putImageData(img, 0, 0);
        ctx.drawImage(tmp, k * w * scale, 0, w * scale, h * scale);
      }
      return out.toDataURL("image/png");
    },
  };
  (window as unknown as { __rig?: HarnessHandle; __rigFactory?: PixelHorseRigFactory; __rigs?: PixelHorseRig[] }).__rig = handle;
  (window as unknown as { __rigFactory?: PixelHorseRigFactory }).__rigFactory = factory;
  return handle;
}
