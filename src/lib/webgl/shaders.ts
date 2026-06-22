// GLSL ES 1.00 (WebGL1). Single full-screen pass that:
//   1. samples the background billboard,
//   2. inverse-maps each fragment into the user image via the homography,
//   3. applies Reinhard color transfer (lαβ) + manual grade,
//   4. feathers the edges, blends, optionally respects an occlusion mask,
//   5. adds film grain.

export const VERT_SRC = /* glsl */ `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  // a_pos is a full-screen triangle in clip space.
  // image-uv with TOP-LEFT origin (matches normalized corners + texture upload)
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const FRAG_SRC = /* glsl */ `
precision highp float;

varying vec2 v_uv;

uniform sampler2D u_bg;
uniform sampler2D u_user;
uniform sampler2D u_mask;

uniform bool  u_hasUser;
uniform bool  u_hasMask;

uniform mat3  u_destToSrc;   // image-uv -> user source uv
uniform vec2  u_cropCenter;   // center of the visible source-image crop
uniform vec2  u_cropSpan;     // visible source UV width/height after cover + zoom
uniform vec2  u_cropFlip;     // per-axis sample-offset sign (-1 mirrors that axis)

uniform vec3  u_srcMean;
uniform vec3  u_srcStd;
uniform vec3  u_tgtMean;
uniform vec3  u_tgtStd;
uniform float u_autoStrength;

uniform float u_brightness;  // multiplier
uniform float u_contrast;    // multiplier
uniform float u_saturation;  // multiplier
uniform float u_temperature; // -1..1

uniform float u_opacity;
uniform float u_feather;     // uv units
uniform int   u_blendMode;   // 0 normal,1 multiply,2 soft-light,3 screen
uniform float u_grain;
uniform vec2  u_resolution;
uniform float u_seed;

const float EPS = 1e-4;
float log10(float x) { return log(x) / log(10.0); }

vec3 rgb2lab(vec3 c) {
  float L = 0.3811 * c.r + 0.5783 * c.g + 0.0402 * c.b;
  float M = 0.1967 * c.r + 0.7244 * c.g + 0.0782 * c.b;
  float S = 0.0241 * c.r + 0.1288 * c.g + 0.8444 * c.b;
  L = log10(max(L, EPS));
  M = log10(max(M, EPS));
  S = log10(max(S, EPS));
  return vec3(
    (L + M + S) / sqrt(3.0),
    (L + M - 2.0 * S) / sqrt(6.0),
    (L - M) / sqrt(2.0)
  );
}

vec3 lab2rgb(vec3 lab) {
  float L = lab.x / sqrt(3.0) + lab.y / sqrt(6.0) + lab.z / sqrt(2.0);
  float M = lab.x / sqrt(3.0) + lab.y / sqrt(6.0) - lab.z / sqrt(2.0);
  float S = lab.x / sqrt(3.0) - 2.0 * lab.y / sqrt(6.0);
  L = pow(10.0, L);
  M = pow(10.0, M);
  S = pow(10.0, S);
  vec3 rgb;
  rgb.r =  4.468670 * L - 3.588676 * M + 0.119604 * S;
  rgb.g = -1.219717 * L + 2.383088 * M - 0.162630 * S;
  rgb.b =  0.058508 * L - 0.261078 * M + 1.205666 * S;
  return clamp(rgb, 0.0, 1.0);
}

// Match luminance (l) fully but damp the chroma channels (α, β) so the scene's
// lighting transfers while the user's hue / brand colour mostly survives —
// otherwise a vivid source collapses toward the target's average colour.
const vec3 CHANNEL_WEIGHT = vec3(1.0, 0.6, 0.6);

vec3 reinhard(vec3 c) {
  vec3 lab = rgb2lab(c);
  vec3 ratio = u_tgtStd / max(u_srcStd, vec3(1e-3));
  ratio = clamp(ratio, 0.25, 4.0);
  vec3 transferred = (lab - u_srcMean) * ratio + u_tgtMean;
  lab = mix(lab, transferred, u_autoStrength * CHANNEL_WEIGHT);
  return lab2rgb(lab);
}

vec3 grade(vec3 c) {
  c *= u_brightness;
  c = (c - 0.5) * u_contrast + 0.5;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(luma), c, u_saturation);
  c.r += u_temperature * 0.12;
  c.b -= u_temperature * 0.12;
  return clamp(c, 0.0, 1.0);
}

vec3 blendPix(vec3 base, vec3 src, int mode) {
  if (mode == 1) return base * src;
  if (mode == 2) return (1.0 - 2.0 * src) * base * base + 2.0 * src * base;
  if (mode == 3) return 1.0 - (1.0 - base) * (1.0 - src);
  return src;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 outc = texture2D(u_bg, v_uv).rgb;

  if (u_hasUser) {
    vec3 h = u_destToSrc * vec3(v_uv, 1.0);
    vec2 surfaceUV = h.xy / h.z;

    float inside =
      step(0.0, surfaceUV.x) * step(surfaceUV.x, 1.0) *
      step(0.0, surfaceUV.y) * step(surfaceUV.y, 1.0);

    if (inside > 0.5) {
      float edge = min(
        min(surfaceUV.x, 1.0 - surfaceUV.x),
        min(surfaceUV.y, 1.0 - surfaceUV.y)
      );
      float fa = smoothstep(0.0, max(u_feather, 1e-4), edge);
      float alpha = fa * u_opacity;

      if (u_hasMask) {
        alpha *= 1.0 - texture2D(u_mask, v_uv).r;
      }

      if (alpha > 0.0) {
        vec2 suv = u_cropCenter + (surfaceUV - 0.5) * u_cropSpan * u_cropFlip;
        vec3 fg = texture2D(u_user, suv).rgb;
        fg = reinhard(fg);
        fg = grade(fg);
        vec3 blended = blendPix(outc, fg, u_blendMode);
        outc = mix(outc, blended, alpha);
      }
    }
  }

  if (u_grain > 0.0) {
    // Hash a fixed virtual grid in uv space (not the pixel resolution) so the
    // grain pattern and spatial frequency are identical in the live preview and
    // the higher-resolution export — preview must equal download.
    const float GRAIN_SCALE = 1024.0;
    float g = (hash(v_uv * GRAIN_SCALE + u_seed) - 0.5) * u_grain * 0.16;
    outc += g;
  }

  gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
`;
