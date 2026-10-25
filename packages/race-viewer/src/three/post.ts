/**
 * Screen-space lens for the HD-2D look: depth-of-field (sharp at the focus horse,
 * tilt-shift falloff), soft bloom, colour grade and vignette. Sprites stay crisp
 * because the scene target is sampled 1:1 with nearest filtering; only the
 * defocused mix uses the blurred quarter-res copy.
 */
import type * as THREE from "three";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + texel * vec2(1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + texel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}
`;

const BLUR = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 dir; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += texture2D(tSrc, vUv + dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv - dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv + dir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSrc, vUv - dir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

const COMPOSITE = /* glsl */ `
#include <packing>
uniform sampler2D tScene; uniform sampler2D tDepth; uniform sampler2D tBlur;
uniform float cameraNear; uniform float cameraFar;
uniform float focusDist; uniform float focusRange; uniform float dofAmount; uniform float tiltShift;
uniform float bloomAmount; uniform float bloomThreshold;
uniform vec3 tint; uniform float saturation; uniform float contrast; uniform float vignette;
uniform float flash;
varying vec2 vUv;
void main() {
  vec3 sharp = texture2D(tScene, vUv).rgb;
  float depth = texture2D(tDepth, vUv).x;
  float z = -perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
  float coc = clamp((abs(z - focusDist) - focusRange) / max(1.0, focusDist * 3.0), 0.0, 1.0);
  float ts = smoothstep(0.22, 0.0, vUv.y) + smoothstep(0.78, 1.0, vUv.y);
  coc = clamp(max(coc, ts * tiltShift) * dofAmount, 0.0, 1.0);
  vec3 blur = texture2D(tBlur, vUv).rgb;
  vec3 col = mix(sharp, blur, coc);
  col += max(blur - bloomThreshold, 0.0) * bloomAmount;
  col *= tint;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, saturation);
  col = 0.18 * pow(max(col, 0.0) / 0.18, vec3(contrast));
  vec2 q = vUv - 0.5;
  col *= 1.0 - vignette * dot(q, q) * 2.2;
  col = mix(col, vec3(1.0), flash);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface PostParams {
  focusDist: number;
  focusRange: number;
  dofAmount: number;
  tiltShift: number;
  bloom: number;
  tint: [number, number, number];
  saturation: number;
  contrast: number;
  vignette: number;
  flash: number;
}

export class PostFX {
  private rtScene: THREE.WebGLRenderTarget;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private cam: THREE.OrthographicCamera;
  private scene: THREE.Scene;
  private down: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  private comp: THREE.ShaderMaterial;

  constructor(
    private T: typeof THREE,
    private renderer: THREE.WebGLRenderer,
  ) {
    const rtOpts = { type: T.HalfFloatType, magFilter: T.NearestFilter, minFilter: T.NearestFilter, depthBuffer: true };
    this.rtScene = new T.WebGLRenderTarget(4, 4, rtOpts);
    this.rtScene.depthTexture = new T.DepthTexture(4, 4);
    const half = { type: T.HalfFloatType, magFilter: T.LinearFilter, minFilter: T.LinearFilter, depthBuffer: false };
    this.rtA = new T.WebGLRenderTarget(2, 2, half);
    this.rtB = new T.WebGLRenderTarget(2, 2, half);
    this.cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new T.Scene();
    this.down = new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: DOWN, uniforms: { tSrc: { value: null }, texel: { value: new T.Vector2() } }, depthTest: false, depthWrite: false });
    this.blur = new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR, uniforms: { tSrc: { value: null }, dir: { value: new T.Vector2() } }, depthTest: false, depthWrite: false });
    this.comp = new T.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.rtScene.texture },
        tDepth: { value: this.rtScene.depthTexture },
        tBlur: { value: this.rtB.texture },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        focusDist: { value: 15 },
        focusRange: { value: 4 },
        dofAmount: { value: 1 },
        tiltShift: { value: 0.6 },
        bloomAmount: { value: 0.3 },
        bloomThreshold: { value: 0.72 },
        tint: { value: new T.Vector3(1, 1, 1) },
        saturation: { value: 1 },
        contrast: { value: 1 },
        vignette: { value: 0.35 },
        flash: { value: 0 },
      },
    });
    this.quad = new T.Mesh(new T.PlaneGeometry(2, 2), this.comp);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(w: number, h: number): void {
    w = Math.max(4, Math.floor(w));
    h = Math.max(4, Math.floor(h));
    this.rtScene.setSize(w, h);
    const qw = Math.max(2, Math.floor(w / 4));
    const qh = Math.max(2, Math.floor(h / 4));
    this.rtA.setSize(qw, qh);
    this.rtB.setSize(qw, qh);
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, p: PostParams): void {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);
    // Quarter-res copy, then a separable blur (two iterations for a wider kernel).
    this.down.uniforms.tSrc!.value = this.rtScene.texture;
    this.down.uniforms.texel!.value.set(1 / this.rtScene.width, 1 / this.rtScene.height);
    this.pass(this.down, this.rtB);
    const qx = 1 / this.rtA.width;
    const qy = 1 / this.rtA.height;
    for (let i = 0; i < 2; i++) {
      this.blur.uniforms.tSrc!.value = this.rtB.texture;
      this.blur.uniforms.dir!.value.set(qx * (1 + i), 0);
      this.pass(this.blur, this.rtA);
      this.blur.uniforms.tSrc!.value = this.rtA.texture;
      this.blur.uniforms.dir!.value.set(0, qy * (1 + i));
      this.pass(this.blur, this.rtB);
    }
    const u = this.comp.uniforms;
    u.cameraNear!.value = camera.near;
    u.cameraFar!.value = camera.far;
    u.focusDist!.value = p.focusDist;
    u.focusRange!.value = p.focusRange;
    u.dofAmount!.value = p.dofAmount;
    u.tiltShift!.value = p.tiltShift;
    u.bloomAmount!.value = p.bloom;
    u.tint!.value.set(...p.tint);
    u.saturation!.value = p.saturation;
    u.contrast!.value = p.contrast;
    u.vignette!.value = p.vignette;
    u.flash!.value = p.flash;
    this.pass(this.comp, null);
  }

  dispose(): void {
    this.rtScene.depthTexture?.dispose();
    this.rtScene.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
    this.down.dispose();
    this.blur.dispose();
    this.comp.dispose();
    this.quad.geometry.dispose();
  }
}
