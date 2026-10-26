/**
 * GLSL for the Trackside view (three.js ShaderMaterial, WebGL2; three adds the version
 * header and maps texture2D/gl_FragColor). Identifiers avoid GLSL reserved words (patch,
 * input, output, sample, filter, active, common...). Colours are handled in sRGB space
 * end to end, like the 2D dioramas (textures are uploaded raw, premultiplied).
 */

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Saturation / brightness grade shared by every pass. */
const GRADE = /* glsl */ `
uniform float uSat;
uniform float uBright;
vec3 gradeRgb(vec3 c, float a) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSat);
  return c * uBright;
}
`;

/**
 * Textured band / prop: uv = uvRect.xy + vUv * uvRect.zw (texel space / size), optional
 * "sharp pixel" sampling (crisp texels with a one-device-pixel antialiased seam at any
 * scale; needs a linear-filtered texture), optional horizontal motion blur, tint.
 */
export const BAND_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uTexSize;
uniform vec4 uUvRect;
uniform float uSharp;
uniform float uBlur;
uniform vec4 uTint;
uniform float uOpacity;
varying vec2 vUv;
${GRADE}
vec4 tap(vec2 uv) {
  if (uSharp > 0.5) {
    vec2 p = uv * uTexSize;
    vec2 seam = floor(p + 0.5);
    vec2 d = max(fwidth(p), vec2(1e-5));
    p = seam + clamp((p - seam) / d, -0.5, 0.5);
    uv = p / uTexSize;
  }
  return texture2D(uMap, uv);
}
void main() {
  vec2 uv = uUvRect.xy + vUv * uUvRect.zw;
  vec4 c;
  if (uBlur > 0.0) {
    float step1 = uBlur / uTexSize.x;
    c = (tap(uv - vec2(step1 * 0.5, 0.0)) + tap(uv - vec2(step1 * 0.25, 0.0)) + tap(uv) + tap(uv + vec2(step1 * 0.25, 0.0)) + tap(uv + vec2(step1 * 0.5, 0.0))) * 0.2;
  } else {
    c = tap(uv);
  }
  c.rgb = mix(c.rgb, uTint.rgb * c.a, uTint.a);
  c.rgb = gradeRgb(c.rgb, c.a);
  gl_FragColor = c * uOpacity;
}
`;

/** Flat colour / vertical gradient quad (sky wash, grade, flash). */
export const GRAD_FRAG = /* glsl */ `
uniform vec4 uTop;
uniform vec4 uMid;
uniform vec4 uBottom;
uniform float uMidAt;
varying vec2 vUv;
void main() {
  vec4 c = vUv.y < uMidAt ? mix(uTop, uMid, vUv.y / max(uMidAt, 1e-4)) : mix(uMid, uBottom, (vUv.y - uMidAt) / max(1.0 - uMidAt, 1e-4));
  gl_FragColor = vec4(c.rgb * c.a, c.a);
}
`;

/**
 * Perspective ground (mode-7 style): every screen row is a lane depth; texels are
 * world-anchored so the turf moves exactly under the hooves. Mowing stripes, the finish
 * line, aerial haze and a horizontal motion blur at speed.
 */
export const GROUND_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform vec2 uView;
uniform float uY0;
uniform float uPpm;
uniform float uCamH;
uniform float uK;
uniform float uLaneW;
uniform float uTexPerM;
uniform float uCxMod;
uniform float uFinishPx;
uniform float uBlurM;
uniform float uRailL;
uniform float uStripes;
uniform vec3 uFog;
uniform float uHaze;
uniform vec4 uTint;
varying vec2 vUv;
${GRADE}
void main() {
  float fx = gl_FragCoord.x;
  float fy = uView.y - gl_FragCoord.y;
  float hz = uY0 - uPpm * uCamH;
  float ls = (fy - hz) / max(1e-3, uY0 - hz);
  if (ls <= 0.0) discard;
  float lane = (1.0 / ls - 1.0) / uK;
  float rel = (fx - uView.x * 0.5) / (uPpm * ls);
  float wx = uCxMod + rel;
  vec2 uv = vec2(wx, lane * uLaneW) * uTexPerM / uTexSize;
  vec3 c = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float o = (float(i) * 0.25 - 0.5) * uBlurM;
    vec3 t = texture2D(uTex, uv + vec2(o * uTexPerM / uTexSize.x, 0.0)).rgb;
    float band = mod(floor((wx + o) / 4.0), 2.0);
    t *= 1.0 + uStripes * (band * 2.0 - 1.0);
    c += t;
  }
  c *= 0.2;
  // winning line across the track
  float fl = abs((fx - uView.x * 0.5) - uFinishPx * ls);
  if (fl < max(1.0, 0.06 * uPpm * ls) && lane < uRailL && lane > -1.2) c = mix(c, vec3(0.96, 0.94, 0.88), 0.92);
  c = mix(c, uFog, clamp((1.0 - ls) * 1.6, 0.0, 0.45) * uHaze);
  c = mix(c, uTint.rgb, uTint.a);
  gl_FragColor = vec4(gradeRgb(c, 1.0), 1.0);
}
`;

/**
 * Horse sprite: palette-index strip + per-runner LUT row (coat, silks, silks pattern),
 * normal-map rim light, "sharp pixel" 2x2 resolve (crisp at any scale, AA seams), grade.
 */
export const HORSE_FRAG = /* glsl */ `
uniform sampler2D uIdx;
uniform sampler2D uNrm;
uniform sampler2D uLut;
uniform vec2 uIdxSize;
uniform vec4 uFrame;
uniform float uLodS;
uniform vec4 uSilk;
uniform float uPattern;
uniform float uRow;
uniform float uLutRows;
uniform float uUseNrm;
uniform vec3 uLight;
uniform vec3 uRimCol;
uniform float uRimAmt;
uniform vec4 uTint;
uniform float uOpacity;
varying vec2 vUv;
${GRADE}
bool silkHit(float pat, vec2 uv, vec2 p) {
  if (pat < 1.5) return mod(floor(p.x / 3.0), 2.0) > 0.5;
  if (pat < 2.5) return mod(floor(p.y / 2.0), 2.0) > 0.5;
  if (pat < 3.5) return (uv.x < 0.5) != (uv.y < 0.5);
  if (pat < 4.5) { float d = uv.x - uv.y * 0.8; return d > 0.15 && d < 0.45; }
  if (pat < 5.5) return mod(floor((p.x + abs(uv.y - 0.5) * 10.0) / 3.0), 2.0) > 0.5;
  if (pat < 6.5) return abs(mod(p.x, 6.0) - 3.0) + abs(mod(p.y, 6.0) - 3.0) <= 1.5;
  return abs(mod(p.x, 5.0) - 2.0) < 0.5 && abs(mod(p.y, 4.0) - 1.0) < 0.5;
}
vec4 texelAt(vec2 t) {
  if (t.x < 0.0 || t.y < 0.0 || t.x >= uFrame.z || t.y >= uFrame.w) return vec4(0.0);
  vec2 at = (uFrame.xy + t + 0.5) / uIdxSize;
  float idx = floor(texture2D(uIdx, at).r * 255.0 + 0.5);
  if (idx < 0.5) return vec4(0.0);
  float rowV = (uRow + 0.5) / uLutRows;
  vec3 c = texture2D(uLut, vec2((idx + 0.5) / 128.0, rowV)).rgb;
  if (uPattern > 0.5) {
    vec4 pc = texture2D(uLut, vec2((64.0 + idx + 0.5) / 128.0, rowV));
    if (pc.a > 0.5) {
      vec2 sp = floor((t + 0.5) * uLodS) - uSilk.xy;
      if (silkHit(uPattern, sp / uSilk.zw, sp)) c = pc.rgb;
    }
  }
  if (uUseNrm > 0.5) {
    vec3 n = texture2D(uNrm, at).xyz * 2.0 - 1.0;
    float edge = 1.0 - clamp(n.z, 0.0, 1.0);
    float facing = dot(normalize(n.xy + vec2(1e-4)), normalize(uLight.xy));
    float rim = clamp(facing, 0.0, 1.0) * edge;
    float bands = step(0.3, rim) * 0.5 + step(0.52, rim) * 0.5;
    float key = clamp(dot(normalize(n), normalize(uLight)), -1.0, 1.0);
    c *= 1.0 + 0.1 * key * uRimAmt;
    c = min(vec3(1.0), c + uRimCol * bands * uRimAmt * 0.55);
  }
  return vec4(c, 1.0);
}
void main() {
  vec2 p = vUv * uFrame.zw;
  vec2 d = max(fwidth(p), vec2(1e-4));
  vec2 b = floor(p - 0.5);
  vec2 f = p - 0.5 - b;
  vec2 w = clamp((f - 0.5) / d + 0.5, 0.0, 1.0);
  vec4 col;
  if ((w.x <= 0.0 || w.x >= 1.0) && (w.y <= 0.0 || w.y >= 1.0)) {
    col = texelAt(b + w);
  } else {
    vec4 c00 = texelAt(b);
    vec4 c10 = texelAt(b + vec2(1.0, 0.0));
    vec4 c01 = texelAt(b + vec2(0.0, 1.0));
    vec4 c11 = texelAt(b + vec2(1.0, 1.0));
    col = mix(mix(c00, c10, w.x), mix(c01, c11, w.x), w.y);
  }
  if (col.a < 0.004) discard;
  col.rgb = mix(col.rgb, uTint.rgb * col.a, uTint.a);
  col.rgb = gradeRgb(col.rgb, col.a);
  gl_FragColor = col * uOpacity;
}
`;

/** Square pixel points (dust, motes) and soft bokeh discs. */
export const POINTS_VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aCol;
attribute float aSoft;
varying vec4 vCol;
varying float vSoft;
void main() {
  vCol = aCol;
  vSoft = aSoft;
  gl_PointSize = aSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const POINTS_FRAG = /* glsl */ `
varying vec4 vCol;
varying float vSoft;
void main() {
  float a = vCol.a;
  if (vSoft > 0.5) {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    a *= 1.0 - smoothstep(0.35, 1.0, r);
  }
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol.rgb * a, a);
}
`;

export const LINES_VERT = /* glsl */ `
attribute float aAlpha;
varying float vA;
void main() {
  vA = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const LINES_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor * vA, vA);
}
`;
