/**
 * GLSL for the pixel rig (WebGL2 / GLSL3 via THREE.ShaderMaterial, glslVersion GLSL3).
 *
 * Pass 1 ("parts"): every part quad of one horse in a single draw call. The vertex shader
 * skins each quad with its bone (2x2 + translation, pixel-snapped on the CPU). The fragment
 * shader reads role / ramp / normal, lights the pixel from the sun, then quantises to a ramp
 * step with ordered dithering. Output is *data*: R = role, G = ramp index, B = layer.
 *
 * Pass 2 ("resolve"): palette lookup + 1-px selective outline around the silhouette (darker
 * step of the neighbour's own ramp, lighter on the lit side) + inner contour lines where a
 * front part (legs, jockey) overlaps a back part.
 */

export const MAX_PARTS = 40;

export const partsVertex = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
in vec4 aInfo;   // x part index, y far side (0/1), z leg index (-1 none, 0 LF, 1 RF, 2 LH, 3 RH), w depth group * 40
in float aSolid; // > 0: code-drawn part with this solid role (no texture)
in vec2 aVariant; // x slot (0 none, 1 head, 2 mane, 3 tail, 4 build), y variant index
in vec2 aSrc;     // rest-pose source-pixel position (continuous across parts, for patterns)
uniform vec4 uBones[${MAX_PARTS * 2}];
uniform vec2 uCanvas;
uniform vec2 uOffset;
uniform float uDefScale;  // render-target px per source px (density / rig unit)
uniform vec4 uVariants;   // selected variant per slot (head, mane, tail, build)
out vec2 vUv;
out vec2 vRot;
out vec4 vInfo;
out float vSolid;
out vec2 vSrc;
void main() {
  int slot = int(aVariant.x + 0.5);
  if (slot > 0) {
    float sel = slot == 1 ? uVariants.x : slot == 2 ? uVariants.y : slot == 3 ? uVariants.z : uVariants.w;
    if (abs(sel - aVariant.y) > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  }
  vSrc = aSrc;
  int i = int(aInfo.x + 0.5);
  vec4 m = uBones[i * 2];
  vec4 t = uBones[i * 2 + 1];
  vec2 p = vec2(m.x * position.x + m.y * position.y, m.z * position.x + m.w * position.y) + t.xy;
  p = p * uDefScale + uOffset;
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
  vUv = uv;
  vRot = normalize(vec2(m.w, -m.y) + vec2(1e-6, 0.0));
  vInfo = aInfo;
  vSolid = aSolid;
}
`;

export const partsFragment = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D uIndex;    // 4x RotSprite-style atlas (rotated parts)
uniform sampler2D uIndex1x;  // native atlas (unrotated parts: exact source pixels)
uniform sampler2D uNormal;
uniform sampler2D uAux;
uniform vec2 uAtlas;         // native atlas size, px
uniform vec3 uLight;         // sprite space: x right, y up, z towards the viewer
uniform float uAmbient;
uniform float uLightMix;     // 0 = keep the source's baked shading, 1 = fully relit
uniform float uDither;
uniform float uRim;
uniform float uFarShade;
uniform vec4 uLook;          // x face marking, y coat texture, z silks pattern, w far-limb darkening
uniform vec4 uLegMarks;      // marking per leg index (0 none 1 coronet 2 sock 3 stocking)
uniform vec4 uSilksFrame;    // origin.xy, axis.xy (native atlas px)
uniform vec4 uSeed;          // x per-horse seed (0..1), y sabino amount, z marking jitter, w gate number
uniform float uUnit;         // source px per base px (1 or 2)
uniform vec2 uCloth;         // saddle-cloth number box (top-right digit origin), source px
in vec2 vSrc;
in vec2 vUv;
in vec2 vRot;
in vec4 vInfo;
in float vSolid;
out vec4 fragColor;

const int COAT = 1, POINTS = 2, MANE = 3, HOOF = 4, MUZZLE = 5, MARKING = 7, SILKS1 = 8, SILKS2 = 9, CAP = 10;

float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(floor(p), 4.0));
  int i = q.x + q.y * 4;
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[i]) + 0.5) / 16.0;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

// 3x5 digits, bit 14 = top-left, row-major
const int DIGITS[10] = int[10](31599, 11415, 29671, 29647, 23497, 31183, 31215, 29330, 31727, 31695);
bool digitHit(int d, ivec2 q) {
  if (q.x < 0 || q.y < 0 || q.x > 2 || q.y > 4) return false;
  return ((DIGITS[d] >> (14 - (q.y * 3 + q.x))) & 1) == 1;
}
/** Saddle-cloth number: source pixel p, right edge at x = 64, top at y = 39. */
bool clothNumber(int n, ivec2 p) {
  if (n <= 0) return false;
  int ones = n % 10;
  int tens = n / 10;
  if (digitHit(ones, p - ivec2(62, 39))) return true;
  if (tens == 1) return p.x == 60 && p.y >= 39 && p.y <= 43;   // narrow 1
  if (tens > 1) return digitHit(tens, p - ivec2(58, 39));
  return false;
}

bool silkHit(int pattern, vec2 texel) {
  vec2 axis = uSilksFrame.zw;
  float len = max(length(axis), 1.0);
  vec2 a = axis / len;
  vec2 d = texel - uSilksFrame.xy;
  float u = dot(d, a) / len;          // 0 hip .. 1 shoulder
  float v = (d.x * a.y - d.y * a.x) / uUnit;  // base px across the torso
  len /= uUnit;
  if (pattern == 1) return mod(floor(u * 5.0 + 0.5), 2.0) > 0.5;                     // hoops
  if (pattern == 2) return mod(floor(v * 0.5 + 50.0), 2.0) > 0.5;                    // stripes
  if (pattern == 3) return fract(u * 2.2 + abs(v + 1.0) * 0.16) > 0.55;              // chevron
  if (pattern == 4) {                                                                 // diamonds
    vec2 c = abs(fract(vec2(u * 3.5, v / 5.0 + 0.25)) - 0.5) * 2.0;
    return c.x + c.y < 0.85;
  }
  if (pattern == 5) return abs((u - 0.5) * len + v * 1.1) < 2.2;                     // sash
  if (pattern == 6) return (u < 0.5) != (v < -0.5);                                   // quartered
  if (pattern == 7) {                                                                 // stars
    vec2 c = fract(vec2(u * 3.0, v / 4.5 + 0.5)) - 0.5;
    return abs(c.x) * 2.2 + abs(c.y) < 0.36;
  }
  return false;
}

void main() {
  vec2 texel = vUv * uAtlas;
  bool rotated = abs(vRot.y) > 1e-4;
  vec4 idx = rotated ? texture(uIndex, vUv) : texture(uIndex1x, vUv);
  vec3 n;
  vec4 aux = vec4(0.0);
  if (vSolid > 0.5) {
    idx = vec4(vSolid * 17.0 / 255.0, 0.25, 0.5, 1.0);
    n = vec3(0.0, 0.0, 1.0);
  } else {
    if (idx.a < 0.5) discard;
    vec4 nt = texture(uNormal, vUv);
    n = normalize(nt.xyz * 2.0 - 1.0);
    aux = texture(uAux, vUv);
  }
  int role = int(idx.r * 255.0 / 17.0 + 0.5);
  float tsrc = idx.g;
  float detail = idx.b * 2.0 - 1.0;
  bool far = vInfo.y > 0.5;
  int leg = int(vInfo.z + 0.5);

  // Rotate the normal with the part (sprite space is y-up, the bone matrix is y-down).
  float c = vRot.x, s = vRot.y;
  n.xy = vec2(c * n.x + s * n.y, -s * n.x + c * n.y);

  // --- markings (procedural pixel masks from the per-horse seed) ------------------------------
  int zone = int(aux.r * 255.0 / 85.0 + 0.5);
  vec2 sp = floor(vSrc);                       // source pixel (rest pose)
  vec2 bp = (sp + 0.5) / uUnit;                // the same point in base (128x96) pixels
  vec2 seedOff = vec2(uSeed.x * 97.0, uSeed.x * 61.0);
  float rag = (hash12(sp + seedOff) - 0.5) * uSeed.z; // ragged marking edges, +-base px
  if (role == COAT || role == POINTS || role == MUZZLE) {
    if (zone == 1) {
      float along = aux.g + (hash12(seedOff) - 0.5) * 0.12;
      float across = aux.b * 6.0 + rag;
      int face = int(uLook.x + 0.5);
      bool m = false;
      if (face == 1) m = along > 0.04 && along < 0.24 && across > 0.4 && across < 2.6;      // star
      if (face == 2) m = along > 0.78 && along < 0.95 && across < 2.0;                      // snip
      if (face == 3) m = along > 0.06 && along < 0.85 && across < 1.4;                      // stripe
      if (face == 4) m = along > 0.04 && along < 0.97 && across < 2.6;                      // blaze
      if (face == 5) m = along > 0.0 && across < 4.6;                                       // bald
      if (m) { role = MARKING; tsrc = 0.75 + 0.25 * tsrc; }
    } else if (zone == 2 && leg >= 0) {
      float along = aux.g * 2.0;
      float lm = leg == 0 ? uLegMarks.x : leg == 1 ? uLegMarks.y : leg == 2 ? uLegMarks.z : uLegMarks.w;
      float h = lm < 0.5 ? -1.0 : lm < 1.5 ? 0.16 : lm < 2.5 ? 0.55 : 1.25;
      h += lm > 1.5 ? (hash12(seedOff + float(leg)) - 0.5) * 0.25 + rag * 0.08 : 0.0;
      if (along < h) { role = MARKING; tsrc = 0.7 + 0.3 * tsrc; }
    }
    // sabino: irregular white patches rising from the belly and legs, plus a wide face
    if (uSeed.y > 0.0 && role != MARKING) {
      float blot = vnoise(bp * 0.16 + seedOff) * 0.65 + vnoise(bp * 0.4 + seedOff.yx) * 0.35;
      float low = clamp((bp.y - 46.0) / 22.0, 0.0, 1.0);
      float face = zone == 1 ? 0.35 : 0.0;
      if (blot * 0.7 + low * 0.6 + face + uSeed.y * 0.55 > 1.25) { role = MARKING; tsrc = 0.72 + 0.28 * tsrc; }
    }
  }
  if (role == HOOF && leg >= 0) {
    float lm = leg == 0 ? uLegMarks.x : leg == 1 ? uLegMarks.y : leg == 2 ? uLegMarks.z : uLegMarks.w;
    if (lm > 0.5) tsrc = min(1.0, tsrc + 0.45);   // white legs grow pale hooves
  }

  if (role == 15 && clothNumber(int(uSeed.w + 0.5), ivec2(sp) - ivec2(uCloth) + ivec2(64, 39))) { role = 6; tsrc = 0.2; }

  // --- silks pattern on the torso ------------------------------------------------------------
  int pattern = int(uLook.z + 0.5);
  if (role == SILKS1 && pattern > 0 && silkHit(pattern, floor(texel) + 0.5)) role = SILKS2;

  // --- lighting -------------------------------------------------------------------------------
  vec3 L = normalize(uLight);
  float ndl = dot(n, L);
  float diffuse = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);
  float lit = uAmbient + (1.0 - uAmbient) * diffuse;
  vec2 n2 = n.xy / max(length(n.xy), 1e-4);
  vec2 l2 = L.xy / max(length(L.xy), 1e-4);
  float edge = smoothstep(0.35, 0.9, 1.0 - n.z);
  float back = clamp(0.35 - L.z, 0.0, 1.0);   // stronger when the sun is behind the sprite plane
  float rim = uRim * edge * max(dot(n2, l2), 0.0) * (0.4 + back);
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float sheen = role == COAT ? 0.55 : (role == SILKS1 || role == SILKS2 || role == CAP) ? 0.75 : role == MANE ? 0.35 : 0.2;
  float spec = pow(max(dot(n, H), 0.0), 18.0) * sheen;

  // Relight around the source's own hand shading: the PixelLab ramp position carries the
  // pixel-art detail, the normals move it up or down with the real sun.
  float shade = tsrc + (lit - 0.62) * uLightMix + detail * 0.04 + rim;
  if (far) shade -= uFarShade;

  // coat textures
  int coatTex = int(uLook.y + 0.5);
  if (role == COAT && coatTex == 1) {
    vec2 q = (bp + seedOff) / vec2(5.0, 4.0);
    q.x += mod(floor(q.y), 2.0) * 0.5;
    float r = length((fract(q) - 0.5) * vec2(5.0, 4.0));
    shade += r < 1.1 ? 0.13 : r < 1.8 ? -0.05 : 0.0;
  }
  if (role == COAT && coatTex == 2 && hash12(sp + seedOff * 1.7) > 0.74) shade += 0.22;

  // ramp: 0 deep shadow .. 6 highlight, 7 sheen (reached by the brightest source pixels or spec)
  float f = 0.4 + clamp(shade, 0.0, 1.0) * 6.6 + spec * 2.2;
  float base = floor(f);
  float th = 0.5 + (bayer4(floor(texel)) - 0.5) * uDither;
  float level = clamp(base + ((f - base) > th ? 1.0 : 0.0), 0.0, 7.0);

  fragColor = vec4((float(role) * 16.0 + 8.0) / 255.0, (level * 32.0 + 16.0) / 255.0, vInfo.w / 255.0, 1.0);
}
`;

export const resolveVertex = /* glsl */ `
precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const resolveFragment = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D uData;
uniform sampler2D uPalette;
uniform vec2 uSize;
uniform vec3 uLight;
uniform float uOutline;
uniform float uInner;
out vec4 fragColor;

vec4 fetchData(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= int(uSize.x) || p.y >= int(uSize.y)) return vec4(0.0);
  return texelFetch(uData, p, 0);
}
int roleOf(vec4 d) { return int(d.r * 255.0 / 16.0); }
int levelOf(vec4 d) { return int(d.g * 255.0 / 32.0); }
vec4 pal(int role, int level) { return texelFetch(uPalette, ivec2(clamp(level, 0, 7), role), 0); }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 d = fetchData(p);
  // render-target y is up; the light's sprite-space y is up too
  ivec2 dirs[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
  vec2 l2 = normalize(uLight.xy + vec2(1e-4));
  if (d.a < 0.5) {
    if (uOutline < 0.5) { fragColor = vec4(0.0); return; }
    float bestLayer = -1.0;
    vec4 best = vec4(0.0);
    vec2 bestDir = vec2(0.0);
    for (int k = 0; k < 4; k++) {
      vec4 q = fetchData(p + dirs[k]);
      if (q.a > 0.5 && q.b > bestLayer) { bestLayer = q.b; best = q; bestDir = vec2(dirs[k]); }
    }
    if (bestLayer < 0.0) { fragColor = vec4(0.0); return; }
    int role = roleOf(best);
    int level = levelOf(best);
    // The outline pixel sits on the shape's (-dir) side: lighter where that side faces the sun.
    bool litSide = dot(-bestDir, l2) > 0.35;
    int o = litSide ? max(level - 2, 1) : max(min(level - 3, 1), 0);
    fragColor = vec4(pal(role, o).rgb, 1.0);
    return;
  }
  int role = roleOf(d);
  int level = levelOf(d);
  if (uInner > 0.5) {
    for (int k = 0; k < 4; k++) {
      vec4 q = fetchData(p + dirs[k]);
      if (q.a > 0.5 && (q.b - d.b) * 255.0 > 20.0 && d.b > 0.0) {
        level = max(min(level - 2, levelOf(q) - 1), 0);
        break;
      }
    }
  }
  fragColor = vec4(pal(role, level).rgb, 1.0);
}
`;
