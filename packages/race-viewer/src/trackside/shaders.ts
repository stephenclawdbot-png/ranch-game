/**
 * GLSL for the Trackside view (three.js ShaderMaterial, WebGL2; three adds the version
 * header and maps texture2D/gl_FragColor). Identifiers avoid GLSL reserved words (patch,
 * input, output, sample, filter, active, common...). Colours are handled in sRGB space
 * end to end, like the 2D dioramas (textures are uploaded raw, premultiplied).
 */

import { LUT_W } from "./strips";

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Saturation / brightness grade shared by every pass. */
/** LUT width as a GLSL float literal (strips.ts LUT_W). */
const LUT_W_GLSL = `${LUT_W}.0`;

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
// Finish-gradient tilt of the track layer: undo it (about uPivot, buffer px, y down) so the
// screen-space ground maths sees the level track.
uniform vec2 uPivot;
uniform vec2 uRotCS;
varying vec2 vUv;
${GRADE}
void main() {
  float sx = gl_FragCoord.x - uPivot.x;
  float sy = (uView.y - gl_FragCoord.y) - uPivot.y;
  float fx = uRotCS.x * sx + uRotCS.y * sy + uPivot.x;
  float fy = -uRotCS.y * sx + uRotCS.x * sy + uPivot.y;
  float hz = uY0 - uPpm * uCamH;
  float ls = (fy - hz) / max(1e-3, uY0 - hz);
  if (ls <= 0.0) discard;
  float lane = (1.0 / ls - 1.0) / uK;
  float rel = (fx - uView.x * 0.5) / (uPpm * ls);
  float wx = uCxMod + rel;
  vec2 uv = vec2(wx, lane * uLaneW) * uTexPerM / uTexSize;
  vec3 c = vec3(0.0);
  // Motion blur taps only while the camera is moving (one tap at rest).
  int taps = uBlurM > 0.01 ? 5 : 1;
  for (int i = 0; i < 5; i++) {
    if (i >= taps) break;
    float o = taps == 1 ? 0.0 : (float(i) * 0.25 - 0.5) * uBlurM;
    vec3 t = texture2D(uTex, uv + vec2(o * uTexPerM / uTexSize.x, 0.0)).rgb;
    float band = mod(floor((wx + o) / 4.0), 2.0);
    t *= 1.0 + uStripes * (band * 2.0 - 1.0);
    c += t;
  }
  c /= float(taps);
  // winning line across the track
  float fl = abs((fx - uView.x * 0.5) - uFinishPx * ls);
  if (fl < max(1.0, 0.06 * uPpm * ls) && lane < uRailL && lane > -1.2) c = mix(c, vec3(0.96, 0.94, 0.88), 0.92);
  c = mix(c, uFog, clamp((1.0 - ls) * 1.6, 0.0, 0.45) * uHaze);
  c = mix(c, uTint.rgb, uTint.a);
  gl_FragColor = vec4(gradeRgb(c, 1.0), 1.0);
}
`;

/**
 * Horse sprite: palette-index strip + per-runner LUT row (coat, silks, silks pattern), the coat
 * layers (art-pipeline coatLayers: patterns, markings, shades, feathered long hair) sampled from
 * the layer atlas in horse space (masks derived from the strip by the shared coat geometry),
 * the rider's look, normal-map rim light, "sharp pixel" 2x2 resolve (crisp at any scale, AA
 * seams), grade.
 */
export const HORSE_FRAG = /* glsl */ `
uniform sampler2D uIdx;
uniform sampler2D uNrm;
uniform sampler2D uLut;
uniform sampler2D uMsk;
uniform sampler2D uMsk2;
uniform sampler2D uMsk3;
uniform sampler2D uAtlas;
uniform sampler2D uKeyInfo;
uniform vec2 uIdxSize;
uniform vec2 uMskSize;
uniform vec2 uMskOrigin;
uniform vec2 uAtlasSize;
uniform float uHasAtlas;
uniform float uGeoH;
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
#define LUTW ${LUT_W_GLSL}
bool silkHit(float pat, vec2 uv, vec2 p) {
  if (pat < 1.5) return mod(floor(p.x / 3.0), 2.0) > 0.5;
  if (pat < 2.5) return mod(floor(p.y / 2.0), 2.0) > 0.5;
  if (pat < 3.5) return (uv.x < 0.5) != (uv.y < 0.5);
  if (pat < 4.5) { float d = uv.x - uv.y * 0.8; return d > 0.15 && d < 0.45; }
  if (pat < 5.5) return mod(floor((p.x + abs(uv.y - 0.5) * 10.0) / 3.0), 2.0) > 0.5;
  if (pat < 6.5) return abs(mod(p.x, 6.0) - 3.0) + abs(mod(p.y, 6.0) - 3.0) <= 1.5;
  return abs(mod(p.x, 5.0) - 2.0) < 0.5 && abs(mod(p.y, 4.0) - 1.0) < 0.5;
}
bool capHit(float pat, vec2 uv) {
  if (pat < 1.5) return (uv.y > 0.3 && uv.y < 0.5) || (uv.y > 0.7 && uv.y < 0.88);
  if (pat < 2.5) return mod(floor(uv.x * 6.0), 2.0) > 0.5;
  if (pat < 3.5) return (uv.x < 0.5) != (uv.y < 0.55);
  if (pat < 5.5) return false;
  if (pat < 6.5) return mod(floor(uv.x * 6.0) + floor(uv.y * 4.0), 2.0) < 0.5;
  return abs(uv.x - 0.5) * 6.0 + abs(uv.y - 0.45) * 5.0 < 1.0;
}
vec4 lutAt(float x, float rowV) {
  return texture2D(uLut, vec2((x + 0.5) / LUTW, rowV));
}
float byteOf(float v) {
  return floor(v * 255.0 + 0.5);
}
// coat layers (art-pipeline coatLayers.ts): one atlas cell per drawn variant, four horse spaces
float atlasAt(float cell, vec2 xy) {
  vec2 o = vec2(mod(cell, 8.0) * 256.0, floor(cell / 8.0) * 144.0);
  vec2 p = o + clamp(floor(xy), vec2(0.0), vec2(255.0, 143.0));
  return byteOf(texture2D(uAtlas, (p + 0.5) / uAtlasSize).r);
}
// cell-local position of a geometry point (coatLayers.spaceXY); z = 1 inside a space
vec3 spaceXY(float greg, float p1, float p2, vec2 uv) {
  float H = uGeoH;
  if (greg > 0.5 && greg < 4.5) {
    float sx = (p2 / H + 0.45) / 0.7;
    if (sx < 0.0 || sx > 1.0) return vec3(0.0);
    return vec3((greg - 1.0) * 34.0 + sx * 33.0, 94.0 + (1.0 - clamp(p1, 0.0, 1.0)) * 47.0, 1.0);
  }
  if (greg > 4.5 && greg < 5.5) {
    float ex = p2 / H / 0.8;
    if (ex > 1.0) return vec3(0.0);
    return vec3(204.0 + max(0.0, ex) * 37.0, clamp(p1, 0.0, 1.0) * 47.0, 1.0);
  }
  if (greg > 7.5) {
    float lx = (p2 / H + 0.35) / 0.7;
    if (lx < 0.0 || lx > 1.0) return vec3(0.0);
    return vec3(204.0 + lx * 33.0, 50.0 + clamp(p1, 0.0, 1.0) * 47.0, 1.0);
  }
  float bx = (uv.x / H + 0.6) / 4.2;
  float by = (uv.y / H + 0.3) / 1.9;
  if (bx < 0.0 || bx > 1.0 || by < 0.0 || by > 1.0) return vec3(0.0);
  return vec3(bx * 200.6, by * 90.2, 1.0);
}
vec4 keyInfo(float idx) {
  return texture2D(uKeyInfo, vec2((idx + 0.5) / 64.0, 0.25));
}
float maneKey(float shade) {
  return byteOf(texture2D(uKeyInfo, vec2((floor(clamp(shade, 0.0, 1.0) * 15.0 + 0.5) + 0.5) / 64.0, 0.75)).r);
}
vec3 whiteAt(vec3 w, float s) {
  vec3 dark = mix(w, vec3(120.0, 116.0, 128.0) / 255.0, 0.55);
  return s < 0.6 ? mix(dark, w, s / 0.6) : mix(w, vec3(1.0), (s - 0.6) / 0.4);
}
vec4 texelAt(vec2 t, vec4 flags, vec3 markW) {
  if (t.x < 0.0 || t.y < 0.0 || t.x >= uFrame.z || t.y >= uFrame.w) return vec4(0.0);
  vec2 at = (uFrame.xy + t + 0.5) / uIdxSize;
  float idx = floor(texture2D(uIdx, at).r * 255.0 + 0.5);
  float rowV = (uRow + 0.5) / uLutRows;
  // masks are sampled at source-strip resolution so they stay registered at every LOD
  vec2 srcP = uMskOrigin + (t + 0.5) * uLodS;
  vec4 mk = texture2D(uMsk, srcP / uMskSize);
  float region = byteOf(mk.r);
  vec4 rider = lutAt(138.0, rowV);
  bool woman = rider.r > 0.5 && rider.b > 0.5;
  if (woman && region > 9.5 && region < 10.5) return vec4(0.0); // her slimmer back
  if (woman && region > 10.5 && region < 11.5) {
    idx = byteOf(mk.g);
    region = 0.0;
  }
  if (region > 7.5 && region < 8.5 && rider.r > 0.5 && !woman) {
    float hg = byteOf(mk.g);
    bool tail = mod(floor(hg / 32.0), 2.0) > 0.5;
    if ((tail && rider.g > 0.5) || (!tail && idx > 0.5)) return vec4(lutAt(135.0 + floor(hg / 64.0), rowV).rgb, 1.0);
  }
  // the horse in horse space (12 mane, 13 tail; +16 an empty texel where long hair may grow)
  bool hairCand = region > 15.5;
  float hreg = hairCand ? region - 16.0 : region;
  bool horseReg = (hreg > 0.5 && hreg < 6.5) || (hreg > 11.5 && hreg < 13.5);
  float greg = hreg > 12.5 ? 8.0 : hreg > 11.5 ? 7.0 : hreg;
  vec4 cells = lutAt(156.0, rowV);
  float faceCell = byteOf(cells.r);
  float featherCell = byteOf(cells.g);
  float nSlots = byteOf(cells.b);
  bool coat = uHasAtlas > 0.5 && horseReg;
  vec3 sp = vec3(0.0);
  vec4 m3 = vec4(0.0);
  float hairV = 0.0;
  if (coat) {
    vec4 m2 = texture2D(uMsk2, srcP / uMskSize);
    m3 = texture2D(uMsk3, srcP / uMskSize);
    vec2 uv = vec2(byteOf(m2.r) + byteOf(m2.g) * 256.0 - 32768.0, byteOf(m2.b) + byteOf(m2.a) * 256.0 - 32768.0) / 4.0;
    sp = spaceXY(greg, m3.r, (byteOf(m3.g) - 128.0) / 4.0, uv);
    if (featherCell < 254.5 && sp.z > 0.5) hairV = atlasAt(featherCell, sp.xy);
  }
  if (hairCand) {
    if (hairV < 0.5) return vec4(0.0);
    idx = greg < 4.5 ? byteOf(m3.b) : maneKey((hairV - 1.0) / 254.0);
  }
  if (idx < 0.5) return vec4(0.0);
  vec3 c = lutAt(idx, rowV).rgb;
  if (region > 8.5 && region < 11.5) {
    // the cap: its own pattern (the bust's cap wears the same)
    vec4 cc = lutAt(64.0 + idx, rowV);
    if (uPattern > 0.5 && cc.a > 0.5 && capHit(uPattern, mk.gb)) c = cc.rgb;
  } else if (region > 6.5 && region < 7.5) {
    // the rider's face in the jockey's skin
    if (rider.r > 0.5) c = lutAt(131.0 + floor(mk.g * 255.0 / 64.0), rowV).rgb;
  } else if (uPattern > 0.5) {
    vec4 pc = lutAt(64.0 + idx, rowV);
    if (pc.a > 0.5) {
      vec2 sp2 = floor((t + 0.5) * uLodS) - uSilk.xy;
      if (silkHit(uPattern, sp2 / uSilk.zw, sp2)) c = pc.rgb;
    }
  }
  if (coat) {
    vec4 ki = keyInfo(idx);
    float role = floor(byteOf(ki.r) / 64.0 + 0.5);
    float shade = ki.g;
    if (role > 0.5) {
      bool isHair = role > 2.5;
      if (hairV > 0.5 && greg > 5.5) {
        if (!hairCand) {
          float mi = maneKey((hairV - 1.0) / 254.0);
          c = lutAt(mi, rowV).rgb;
          shade = keyInfo(mi).g;
        }
        isHair = true;
      }
      bool white = false;
      for (int k = 0; k < 8; k++) {
        if (float(k) >= nSlots) break;
        if (sp.z < 0.5) break;
        vec4 pr = lutAt(140.0 + float(k) * 2.0, rowV);
        float mode = byteOf(pr.g);
        if (mode > 4.5 && (greg < 4.5 || greg > 5.5)) continue; // skin: the face only
        float v = atlasAt(byteOf(pr.r), sp.xy);
        if (v < 0.5) continue;
        vec3 col = lutAt(141.0 + float(k) * 2.0, rowV).rgb;
        if (mode < 1.5) {
          // white patterns reach the tail but never the mane
          if (v >= 127.5 && !(isHair && greg < 7.5)) white = true;
        } else if (isHair) {
          continue; // shading and ticking stay on the coat
        } else if (mode < 2.5) {
          if (v >= 127.5 && !white) c = mix(c, vec3(1.0), 0.45);
        } else if (mode < 4.5) {
          c = mix(c, col, min(1.0, (v / 255.0) * pr.b * (mode > 3.5 ? 0.75 : 0.85)));
        } else if (v >= 127.5) {
          c = mix(c, col, 0.8);
        }
      }
      if (sp.z > 0.5 && greg > 4.5 && greg < 5.5 && faceCell < 254.5 && role < 2.5 && atlasAt(faceCell, sp.xy) >= 127.5) white = true;
      if (sp.z > 0.5 && greg < 4.5) {
        // near legs are the off (right) side: front-near FR, front-far FL, hind-near HR, hind-far HL
        vec4 legs = lutAt(157.0, rowV);
        float lc = byteOf(greg < 1.5 ? legs.g : greg < 2.5 ? legs.r : greg < 3.5 ? legs.a : legs.b);
        if (lc < 254.5 && atlasAt(lc, sp.xy) >= 127.5) white = true;
      }
      if (white) c = whiteAt(markW, isHair ? 0.55 + shade * 0.45 : shade);
      if (hairV > 0.5) c = min(vec3(1.0), c * (0.84 + 0.3 * ((hairV - 1.0) / 254.0)));
    }
  } else if (horseReg && hreg < 4.5) {
    // no coat-layer atlas: plain leg markings (legacy)
    float legsB = byteOf(flags.r);
    float sh = hreg < 1.5 ? 4.0 : hreg < 2.5 ? 1.0 : hreg < 3.5 ? 64.0 : 16.0;
    float lvl = mod(floor(legsB / sh), 4.0);
    float lim = lvl < 1.5 ? 0.14 : lvl < 2.5 ? 0.36 : 0.62;
    if (lvl > 0.5 && mk.g < lim) c = markW;
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
  float rowV = (uRow + 0.5) / uLutRows;
  vec4 flags = lutAt(128.0, rowV);
  vec3 markW = lutAt(129.0, rowV).rgb;
  vec2 p = vUv * uFrame.zw;
  vec2 d = max(fwidth(p), vec2(1e-4));
  vec2 b = floor(p - 0.5);
  vec2 f = p - 0.5 - b;
  vec2 w = clamp((f - 0.5) / d + 0.5, 0.0, 1.0);
  vec4 col;
  if ((w.x <= 0.0 || w.x >= 1.0) && (w.y <= 0.0 || w.y >= 1.0)) {
    col = texelAt(b + w, flags, markW);
  } else {
    vec4 c00 = texelAt(b, flags, markW);
    vec4 c10 = texelAt(b + vec2(1.0, 0.0), flags, markW);
    vec4 c01 = texelAt(b + vec2(0.0, 1.0), flags, markW);
    vec4 c11 = texelAt(b + vec2(1.0, 1.0), flags, markW);
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
