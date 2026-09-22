export const UPDATE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aVel;
layout(location = 2) in vec3 aHome;
layout(location = 3) in float aSeed;
uniform float uDt, uTime, uSpring, uDamp, uAssemble, uTurb;
uniform vec4 uTouch[5];
uniform vec2 uTouchVel[5];
uniform float uMode;
uniform float uEffectT;
uniform float uEffectAmp;
uniform vec2 uEffectOrigin;
out vec3 vPos;
out vec3 vVel;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash(i);
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

vec3 curlNoise(vec3 p) {
  float n1 = vnoise(p);
  float n2 = vnoise(p + vec3(17.1, 31.7, 9.4));
  float n3 = vnoise(p + vec3(5.2, 41.3, 23.8));
  return vec3(n2 - 0.5, n3 - 0.5, n1 - 0.5);
}

void main() {
  vec3 f = vec3(0.0);
  if (uMode > 4.5) {
    // Fill mode: particles drop from top and settle layer-by-layer from top to bottom
    float reach = smoothstep(uEffectT - 0.12, uEffectT + 0.08, aHome.y);
    vec3 springForce = (aHome - aPos) * (uSpring * 1.8);
    vec3 rainForce = vec3(
      (aHome.x - aPos.x) * 8.0 + sin(uTime * 8.0 + aSeed * 25.0) * 0.15,
      -1.5,
      (aHome.z - aPos.z) * 6.0
    );
    f += mix(rainForce, springForce, reach);
  } else {
    float k = smoothstep(aSeed * 0.6, aSeed * 0.6 + 0.4, uAssemble);
    f += (aHome - aPos) * uSpring * k;
  }

  for (int i = 0; i < 5; i++) {
    vec2 d = aPos.xy - uTouch[i].xy;
    float rz = max(uTouch[i].z, 0.0001);
    float g = exp(-dot(d, d) / (rz * rz));
    vec2 nrm = d * inversesqrt(dot(d, d) + 1e-6);
    f.xy += nrm * g * uTouch[i].w;
    f.xy += uTouchVel[i] * g * 2.0;
  }
  f += curlNoise(aPos * 0.8 + vec3(0.0, uTime * 0.1, uTime * 0.07)) * uTurb;

  if (uMode > 0.5 && uMode < 1.5) {
    vec2 t = aPos.xy - uEffectOrigin;
    f.xy += vec2(-t.y, t.x) * uEffectAmp * (1.0 - uAssemble * 0.25);
  } else if (uMode > 1.5 && uMode < 2.5) {
    float wave = smoothstep(uEffectOrigin.x - 0.55, uEffectOrigin.x + 0.15, aPos.x);
    f.x += uEffectAmp * wave;
    f.z += uEffectAmp * 0.18 * wave;
  } else if (uMode > 2.5 && uMode < 3.5) {
    vec2 d = aPos.xy - uEffectOrigin;
    float dist = length(d);
    float ring = exp(-pow(dist - uEffectT * 1.85, 2.0) * 26.0);
    f.xy += (d / (dist + 1e-4)) * ring * uEffectAmp;
  } else if (uMode > 3.5 && uMode < 4.5) {
    vec3 d = aPos - vec3(uEffectOrigin, 0.0);
    float dist = length(d);
    f += normalize(d + vec3(0.0, 0.0, 0.12) + 1e-4) * uEffectAmp * (0.45 + aSeed) / (dist + 0.18);
  }

  vVel = (aVel + f * uDt) * exp(-uDamp * uDt);
  vPos = aPos + vVel * uDt;
}
`;

export const UPDATE_FS = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }
`;

export const RENDER_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aTone;
layout(location = 2) in float aSeed;
layout(location = 3) in vec3 aColor;
uniform mat4 uViewProj;
uniform float uSize;
uniform float uDpr;
uniform vec2 uPointRange;
uniform float uTime;
uniform float uBreath;
uniform float uColorMode;
uniform float uColorMix;
uniform float uInvert;
out float vBright;
out vec3 vColor;

void main() {
  vec3 p = aPos;
  p.z += sin(uTime * 1.35 + aSeed * 6.28318) * uBreath;
  gl_Position = uViewProj * vec4(p, 1.0);
  float depthScale = 0.72 + 0.28 * (1.0 - clamp(p.z * 0.85 + 0.35, 0.0, 1.0));
  float size = uSize * uDpr * depthScale;
  gl_PointSize = clamp(size, uPointRange.x, uPointRange.y);
  float tone = aTone;
  // In invert mode, ensure dark features have solid ink opacity (no hazy fading)
  vBright = uInvert > 0.5
    ? (0.76 + 0.24 * tone) * (0.86 + 0.14 * depthScale)
    : (0.58 + 0.42 * tone) * (0.82 + 0.18 * depthScale);

  // 0.0 = Monochrome (all B&W/silver), 1.0 = Full Color (source image), 2.0 = Hybrid (mixed color + B&W)
  vec3 col;
  // Boost color vibrancy & luminance slightly so colors pop against dark background instead of looking dim or washed out
  vec3 c = aColor;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 vividColor = clamp(mix(vec3(lum), c, 1.25) * 1.15, 0.0, 1.0);

  if (uColorMode < 0.5) {
    col = vec3(1.0);
  } else if (uColorMode < 1.5) {
    col = vividColor;
  } else {
    float isCol = step(aSeed, clamp(uColorMix, 0.05, 0.95));
    col = mix(vec3(1.0), vividColor, isCol);
  }

  if (uInvert > 0.5) {
    // For inverted mode on fine-art paper:
    // - Monochrome: Rich sumi/carbon black ink
    // - Full Color: High-saturation print pigment derived from source
    // - Hybrid: Interwoven carbon ink + source color pigment
    vec3 inkBlack = vec3(0.04, 0.04, 0.05);
    vec3 richColor = clamp(pow(aColor, vec3(1.1)) * 0.95, 0.0, 1.0);
    if (uColorMode < 0.5) {
      col = inkBlack;
    } else if (uColorMode < 1.5) {
      col = richColor;
    } else {
      float isCol = step(aSeed, clamp(uColorMix, 0.05, 0.95));
      col = mix(inkBlack, richColor, isCol);
    }
  }
  vColor = col;
}
`;

export const RENDER_FS = `#version 300 es
precision mediump float;
in float vBright;
in vec3 vColor;
out vec4 fragColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 2.6) * vBright;
  fragColor = vec4(vColor * a, a);
}
`;
