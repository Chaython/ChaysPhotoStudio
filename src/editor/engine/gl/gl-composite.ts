// ============================================================
// gl-composite — GPU (WebGL2) fast path for compositeDocument
//
// Mirrors the CPU compositing semantics of engine/document.ts:
//   · layer groups (base + clipping stack)
//   · per-layer opacity + all 17 blend modes (W3C compositing math,
//     matching Canvas2D globalCompositeOperation)
//   · layer masks (pre-applied by prepareLayer on the CPU, uploaded)
//   · adjustment layers via an uber-shader implementing 14 of the 17
//     adjustment types (missing: selective-color, camera-raw → CPU fallback)
//   · channel view + dialog live preview adjustment
//
// Integration: compositeDocument() calls glCompositeDocument(doc, target)
// FIRST; if it returns false (no GL / unsupported feature / runtime error)
// the original CPU path runs. GPU result must match CPU within ±2/255.
//
// Orientation contract: see gl-core.ts header comment — FBO row 0 = image
// top row, readPixels maps directly onto ImageData (no flip needed).
// ============================================================
import type { Layer, PsDocument, BlendMode, AdjustmentType } from '../../types'
import { prepareLayer } from '../document'
import { ADJUSTMENTS } from '../../image-ops/adjustments'
import { buildCurveLUT } from '../../image-ops/interp'
import { hexToRgbTriple } from '../../image-ops/color'
import {
  getGL, glAvailable, glInfo, compileProgram, drawQuad, bindTarget, acquireFBO, releaseFBO,
  bindUniformTex, uploadCanvas, uploadLUT, QUAD_VS,
} from './gl-core'

const BLEND_ID: Record<BlendMode, number> = {
  'normal': 0, 'multiply': 1, 'screen': 2, 'overlay': 3, 'darken': 4, 'lighten': 5,
  'color-dodge': 6, 'color-burn': 7, 'linear-dodge': 8, 'hard-light': 9, 'soft-light': 10,
  'difference': 11, 'exclusion': 12, 'hue': 13, 'saturation': 14, 'color': 15, 'luminosity': 16,
}

// adjustment modes implemented in the shader (order = uAdjMode)
const ADJ_MODE: Record<string, number> = {
  'curves': 0, 'levels': 1, 'brightness-contrast': 2, 'exposure': 3, 'vibrance': 4,
  'hue-saturation': 5, 'color-balance': 6, 'black-white': 7, 'photo-filter': 8,
  'channel-mixer': 9, 'gradient-map': 10, 'posterize': 11, 'threshold': 12, 'invert': 13,
}
const GL_SUPPORTED_ADJ = new Set(Object.keys(ADJ_MODE))

// ---------------------------------------------------------------- shaders

const BLEND_FS = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uSrc;
uniform sampler2D uBackdrop;
uniform float uOpacity;   // 0..1
uniform int uBlendMode;
uniform int uClipAlpha;   // 1 = clip source to the backdrop stack alpha

float Lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float Sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }

vec3 ClipColor(vec3 c) {
  float l = Lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / (l - n + 1e-6);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l + 1e-6);
  return clamp(c, 0.0, 1.0);
}
vec3 SetLum(vec3 c, float l) { return ClipColor(c + (l - Lum(c))); }

vec3 SetSat(vec3 c, float s) {
  float cmin = min(min(c.r, c.g), c.b);
  float cmax = max(max(c.r, c.g), c.b);
  vec3 outv = c;
  if (cmax > cmin) {
    // red is max
    if (c.r == cmax) {
      if (c.g < c.b) { // min g, mid b
        outv = vec3(s, 0.0, s * (c.b - c.g) / (cmax - cmin));
      } else {          // min b, mid g
        outv = vec3(s, s * (c.g - c.b) / (cmax - cmin), 0.0);
      }
    } else if (c.g == cmax) {
      if (c.r < c.b) {
        outv = vec3(0.0, s, s * (c.b - c.r) / (cmax - cmin));
      } else {
        outv = vec3(s * (c.r - c.b) / (cmax - cmin), s, 0.0);
      }
    } else { // blue is max
      if (c.r < c.g) {
        outv = vec3(0.0, s * (c.g - c.r) / (cmax - cmin), s);
      } else {
        outv = vec3(s * (c.r - c.g) / (cmax - cmin), 0.0, s);
      }
    }
  } else {
    outv = vec3(0.0);
  }
  return outv;
}

float softLightChan(float cb, float cs) {
  if (cs <= 0.5) return cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
  float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(cb);
  return cb + (2.0 * cs - 1.0) * (d - cb);
}

vec3 blendB(int mode, vec3 Cb, vec3 Cs) {
  if (mode == 0) return Cs;                                    // normal
  if (mode == 1) return Cb * Cs;                               // multiply
  if (mode == 2) return Cb + Cs - Cb * Cs;                     // screen
  if (mode == 3) {                                             // overlay
    vec3 r;
    r.r = Cb.r < 0.5 ? 2.0 * Cb.r * Cs.r : 1.0 - 2.0 * (1.0 - Cb.r) * (1.0 - Cs.r);
    r.g = Cb.g < 0.5 ? 2.0 * Cb.g * Cs.g : 1.0 - 2.0 * (1.0 - Cb.g) * (1.0 - Cs.g);
    r.b = Cb.b < 0.5 ? 2.0 * Cb.b * Cs.b : 1.0 - 2.0 * (1.0 - Cb.b) * (1.0 - Cs.b);
    return r;
  }
  if (mode == 4) return min(Cb, Cs);                           // darken
  if (mode == 5) return max(Cb, Cs);                           // lighten
  if (mode == 6) return Cb / (1.0 - Cs + 1e-6);                // color-dodge
  if (mode == 7) return 1.0 - (1.0 - Cb) / (Cs + 1e-6);        // color-burn
  if (mode == 8) return Cb + Cs;                               // linear-dodge (add)
  if (mode == 9) {                                             // hard-light
    vec3 r;
    r.r = Cs.r < 0.5 ? 2.0 * Cs.r * Cb.r : 1.0 - 2.0 * (1.0 - Cs.r) * (1.0 - Cb.r);
    r.g = Cs.g < 0.5 ? 2.0 * Cs.g * Cb.g : 1.0 - 2.0 * (1.0 - Cs.g) * (1.0 - Cb.g);
    r.b = Cs.b < 0.5 ? 2.0 * Cs.b * Cb.b : 1.0 - 2.0 * (1.0 - Cs.b) * (1.0 - Cb.b);
    return clamp(r, 0.0, 1.0);
  }
  if (mode == 10) {                                            // soft-light (W3C)
    return vec3(softLightChan(Cb.r, Cs.r), softLightChan(Cb.g, Cs.g), softLightChan(Cb.b, Cs.b));
  }
  if (mode == 11) return abs(Cb - Cs);                         // difference
  if (mode == 12) return Cb + Cs - 2.0 * Cb * Cs;              // exclusion
  if (mode == 13) return SetLum(SetSat(Cs, Sat(Cb)), Lum(Cb)); // hue
  if (mode == 14) return SetLum(SetSat(Cb, Sat(Cs)), Lum(Cb)); // saturation
  if (mode == 15) return SetLum(SetSat(Cs, Sat(Cb)), Lum(Cb)); // color
  if (mode == 16) return SetLum(Cb, Lum(Cs));                  // luminosity
  return Cb;
}

void main() {
  vec4 src = texture2D(uSrc, vUV);
  vec4 bd = texture2D(uBackdrop, vUV);
  float aS = src.a * uOpacity;
  if (uClipAlpha == 1) aS *= bd.a;
  float aB = bd.a;

  if (uBlendMode == 8) {
    // 'add' — premultiplied summation
    float aO = min(1.0, aS + aB);
    vec3 co = (aS * src.rgb + aB * bd.rgb) / max(aO, 1e-6);
    gl_FragColor = vec4(clamp(co, 0.0, 1.0), aO);
    return;
  }

  vec3 Cs = src.rgb;
  vec3 Cb = bd.rgb;
  vec3 B = clamp(blendB(uBlendMode, Cb, Cs), 0.0, 2.0);
  // W3C straight-alpha blend
  vec3 co = aS * aB * B + aS * (1.0 - aB) * Cs + aB * (1.0 - aS) * Cb;
  float aO = aS + aB * (1.0 - aS);
  gl_FragColor = vec4(clamp(co / max(aO, 1e-6), 0.0, 1.0), aO);
}
`

const COPY_FS = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uSrc;
void main() { gl_FragColor = texture2D(uSrc, vUV); }
`

const CHANNEL_VIEW_FS = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uSrc;
uniform int uChannel; // 0 r, 1 g, 2 b
void main() {
  vec4 c = texture2D(uSrc, vUV);
  float v = uChannel == 0 ? c.r : (uChannel == 1 ? c.g : c.b);
  gl_FragColor = vec4(vec3(v), c.a);
}
`

// The adjustment uber-shader: applies an adjustment to the backdrop
// (optionally gated by a mask texture), then blends the result over the
// backdrop with opacity + blend mode — exactly what the CPU
// applyAdjustmentLayerOver() does.
const ADJUST_FS = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uBackdrop;
uniform sampler2D uMask;
uniform sampler2D uLut;
uniform int uHasMask;
uniform int uHasLut;
uniform int uOpacityI;  // opacity * 1000 to dodge int/float uniform pain
uniform int uBlendMode;
uniform int uAdjMode;
uniform int uReplace;   // 1 = write adjusted directly (final doc preview pass)
uniform vec4 uAdjA;
uniform vec4 uAdjB;
uniform vec4 uAdjC;

const float EPS_LAB = 0.008856;
const float K_LAB = 903.296;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float smoothRamp(float v, float a, float b) {
  if (b == a) return v >= b ? 1.0 : 0.0;
  float t = clamp((v - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float hueFamilyWeight(float h, float center) {
  float d = abs(h - center);
  if (d > 180.0) d = 360.0 - d;
  if (d <= 16.0) return 1.0;
  if (d >= 44.0) return 0.0;
  return 1.0 - (d - 16.0) / 28.0;
}

vec3 rgbToHsl(vec3 rgb) {
  float mx = max(max(rgb.r, rgb.g), rgb.b);
  float mn = min(min(rgb.r, rgb.g), rgb.b);
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  float h = 0.0, s = 0.0;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == rgb.r) h = 60.0 * mod((rgb.g - rgb.b) / d, 6.0);
    else if (mx == rgb.g) h = 60.0 * ((rgb.b - rgb.r) / d + 2.0);
    else h = 60.0 * ((rgb.r - rgb.g) / d + 4.0);
  }
  return vec3(mod(h + 360.0, 360.0), s, l);
}

vec3 hslToRgb(float h, float s, float l) {
  h = mod(mod(h, 360.0) + 360.0, 360.0);
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h / 60.0, 2.0) - 1.0));
  float m = l - c * 0.5;
  vec3 rgb;
  if (h < 60.0) rgb = vec3(c, x, 0.0);
  else if (h < 120.0) rgb = vec3(x, c, 0.0);
  else if (h < 180.0) rgb = vec3(0.0, c, x);
  else if (h < 240.0) rgb = vec3(0.0, x, c);
  else if (h < 300.0) rgb = vec3(x, 0.0, c);
  else rgb = vec3(c, 0.0, x);
  return rgb + vec3(m);
}

float srgbToLinear(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
float linearToSrgb(float v) {
  float c = v <= 0.0031308 ? 12.92 * v : 1.055 * pow(max(v, 1e-6), 1.0 / 2.4) - 0.055;
  return clamp(c, 0.0, 1.0);
}
vec3 rgbToLab(vec3 rgb) {
  float rl = srgbToLinear(rgb.r), gl = srgbToLinear(rgb.g), bl = srgbToLinear(rgb.b);
  float x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  float y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  float z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) / 1.08883;
  float fx = x > EPS_LAB ? pow(x, 1.0 / 3.0) : (K_LAB * x + 16.0) / 116.0;
  float fy = y > EPS_LAB ? pow(y, 1.0 / 3.0) : (K_LAB * y + 16.0) / 116.0;
  float fz = z > EPS_LAB ? pow(z, 1.0 / 3.0) : (K_LAB * z + 16.0) / 116.0;
  return vec3(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz));
}
vec3 labToRgb(float L, float a, float bb) {
  float fy = (L + 16.0) / 116.0;
  float fx = fy + a / 500.0;
  float fz = fy - bb / 200.0;
  float fx3 = fx * fx * fx, fz3 = fz * fz * fz;
  float x = (fx3 > EPS_LAB ? fx3 : (116.0 * fx - 16.0) / K_LAB) * 0.95047;
  float y = (L > K_LAB * EPS_LAB ? pow((L + 16.0) / 116.0, 3.0) : L / K_LAB);
  float z = (fz3 > EPS_LAB ? fz3 : (116.0 * fz - 16.0) / K_LAB) * 1.08883;
  float rl = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  float gl = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  float bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  return vec3(linearToSrgb(rl), linearToSrgb(gl), linearToSrgb(bl));
}

float hashNoise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 applyAdj(vec3 c) {
  int mode = uAdjMode;
  if (mode == 0 || mode == 1 || mode == 11) {
    // curves / levels / posterize — LUT texture (.r/.g/.b = per-channel out)
    if (uHasLut == 1) {
      vec3 lutv = vec3(
        texture2D(uLut, vec2(c.r, 0.5)).r,
        texture2D(uLut, vec2(c.g, 0.5)).g,
        texture2D(uLut, vec2(c.b, 0.5)).b
      );
      return lutv;
    }
    return c;
  }
  if (mode == 2) {
    // brightness/contrast
    float bright = uAdjA.x / 150.0;
    float contrast = uAdjA.y / 100.0;
    if (uAdjA.z > 0.5) {
      // legacy: linear around mid-gray (CPU: (i-128)*f + 128 + b*255, b = brightness/255)
      float f = contrast < 0.0 ? 1.0 + contrast : 1.0 / max(0.01, 1.0 - contrast * 0.85);
      return clamp((c - 0.50196) * f + 0.50196 + uAdjA.x * 0.00392, 0.0, 1.0);
    }
    float k = clamp(contrast * 2.2, -1.7, 2.2);
    float bAmt = clamp(uAdjA.x / 150.0, -1.0, 1.0) * 0.45;
    vec3 v = c;
    v = v + bAmt * (1.0 - abs(2.0 * v - 1.0) * 0.55);
    vec3 s = v * v * (3.0 - 2.0 * v);
    v = v + (s - v) * k;
    return clamp(v, 0.0, 1.0);
  }
  if (mode == 3) {
    // exposure
    float gain = pow(2.0, uAdjA.x);
    vec3 v = c * gain + uAdjA.y;
    v = max(v, 0.0);
    v = pow(v, vec3(1.0 / max(0.01, uAdjA.z)));
    return clamp(v, 0.0, 1.0);
  }
  if (mode == 4) {
    // vibrance
    float vib = uAdjA.x, sat = uAdjA.y;
    if (vib == 0.0 && sat == 0.0) return c;
    vec3 hsl = rgbToHsl(c);
    float hd = abs(hsl.x - 28.0);
    if (hd > 180.0) hd = 360.0 - hd;
    float skin = 1.0 - clamp((46.0 - hd) / 32.0, 0.0, 1.0) * 0.8;
    float sTarget = hsl.y * (1.0 + sat) + (1.0 - hsl.y) * vib * skin * 1.35;
    float s2 = clamp(sTarget, 0.0, 1.0);
    return clamp(hslToRgb(hsl.x, s2, hsl.z), 0.0, 1.0);
  }
  if (mode == 5) {
    // hue-saturation
    float hueShift = uAdjA.x, sat = uAdjA.y, lit = uAdjA.z;
    bool colorize = uAdjA.w > 0.5;
    float h, s, l;
    if (colorize) {
      l = luma(c);
      h = mod(mod(hueShift, 360.0) + 360.0, 360.0);
      if (h == 0.0 && hueShift != 0.0) h = 0.0;
      // CPU: ((hueShift<0?hueShift+360:hueShift) || 30) % 360 — 0 → 30
      if (abs(hueShift) < 1e-6) h = 30.0;
      s = sat > 0.0 ? sat : 0.25;
    } else {
      vec3 hsl = rgbToHsl(c);
      h = mod(hsl.x + hueShift + 360.0, 360.0);
      s = clamp(hsl.y * (1.0 + sat), 0.0, 1.0);
      l = hsl.z;
    }
    if (lit > 0.0) l = l + (1.0 - l) * lit;
    else if (lit < 0.0) l = l * (1.0 + lit);
    return clamp(hslToRgb(h, s, clamp(l, 0.0, 1.0)), 0.0, 1.0);
  }
  if (mode == 6) {
    // color balance
    float aSh = uAdjA.x, bSh = uAdjA.y, aMd = uAdjA.z, bMd = uAdjA.w;
    float aHi = uAdjB.x, bHi = uAdjB.y;
    bool preserve = uAdjB.z > 0.5;
    float l01 = luma(c);
    float wS = 1.0 - smoothRamp(l01, 0.28, 0.62);
    float wH = smoothRamp(l01, 0.38, 0.72);
    float wM = clamp(1.0 - wS - wH, 0.0, 1.0);
    if (preserve) {
      vec3 lab = rgbToLab(c);
      lab.y += aSh * wS + aMd * wM + aHi * wH;
      lab.z += bSh * wS + bMd * wM + bHi * wH;
      return labToRgb(lab.x, lab.y, lab.z);
    }
    float da = (aSh * wS + aMd * wM + aHi * wH) * 1.6;
    float db = (bSh * wS + bMd * wM + bHi * wH) * 1.6;
    return vec3(
      clamp(c.r + da - db * 0.4, 0.0, 1.0),
      clamp(c.g - da * 0.4 - db * 0.4, 0.0, 1.0),
      clamp(c.b + db - da * 0.4, 0.0, 1.0)
    );
  }
  if (mode == 7) {
    // black & white
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float gray = luma(c);
    float outv;
    if (mx - mn < 6.0 / 255.0) {
      outv = gray;
    } else {
      vec3 hsl = rgbToHsl(c);
      float h = hsl.x;
      float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
      float acc = 0.0;
      acc += hueFamilyWeight(h, 0.0)   * (uAdjA.x * mx - gray);
      acc += hueFamilyWeight(h, 60.0)  * (uAdjA.y * mx - gray);
      acc += hueFamilyWeight(h, 120.0) * (uAdjA.z * mx - gray);
      acc += hueFamilyWeight(h, 180.0) * (uAdjA.w * mx - gray);
      acc += hueFamilyWeight(h, 240.0) * (uAdjB.x * mx - gray);
      acc += hueFamilyWeight(h, 300.0) * (uAdjB.y * mx - gray);
      outv = gray + acc * sat;
    }
    return vec3(clamp(outv, 0.0, 1.0));
  }
  if (mode == 8) {
    // photo filter
    vec3 f = uAdjA.rgb;
    float density = uAdjA.w;
    vec3 n = c + (f - c) * density;
    if (uAdjB.x > 0.5) {
      float l0 = luma(c);
      float l1 = luma(n);
      if (l1 > 4.0 / 255.0) n *= l0 / l1;
    }
    return clamp(n, 0.0, 1.0);
  }
  if (mode == 9) {
    // channel mixer: A=(rr,rg,rb,mono), B=(gr,gg,gb,konst), C=(br,bg,bb,0)
    float konst = uAdjB.w;
    if (uAdjA.w > 0.5) {
      float v = clamp(c.r * uAdjA.x + c.g * uAdjA.y + c.b * uAdjA.z + konst, 0.0, 1.0);
      return vec3(v);
    }
    return vec3(
      clamp(c.r * uAdjA.x + c.g * uAdjA.y + c.b * uAdjA.z + konst, 0.0, 1.0),
      clamp(c.r * uAdjB.x + c.g * uAdjB.y + c.b * uAdjB.z + konst, 0.0, 1.0),
      clamp(c.r * uAdjC.x + c.g * uAdjC.y + c.b * uAdjC.z + konst, 0.0, 1.0)
    );
  }
  if (mode == 10) {
    // gradient map — LUT indexed by luminance (.rgb = gradient color)
    float v = luma(c);
    if (uAdjA.x > 0.5) v += (hashNoise(vUV * 997.0) - 0.5) * (1.6 / 255.0);
    v = clamp(v, 0.0, 1.0);
    return texture2D(uLut, vec2(v, 0.5)).rgb;
  }
  if (mode == 12) {
    // threshold
    float t = uAdjA.x;
    float v = luma(c) >= t ? 1.0 : 0.0;
    return vec3(v);
  }
  if (mode == 13) return 1.0 - c; // invert
  return c;
}

void main() {
  vec4 bd = texture2D(uBackdrop, vUV);
  vec3 adjusted = applyAdj(clamp(bd.rgb, 0.0, 1.0));

  if (uReplace == 1) {
    gl_FragColor = vec4(adjusted, bd.a);
    return;
  }

  float mask = 1.0;
  if (uHasMask == 1) mask = texture2D(uMask, vUV).a;
  float opacity = float(uOpacityI) / 1000.0;
  float aS = mask * opacity;
  float aB = bd.a;
  vec3 Cs = adjusted;
  vec3 Cb = bd.rgb;
  // blend over backdrop (adjustment layers default to 'normal')
  if (uBlendMode == 8) {
    float aO = min(1.0, aS + aB);
    vec3 co = (aS * Cs + aB * Cb) / max(aO, 1e-6);
    gl_FragColor = vec4(clamp(co, 0.0, 1.0), aO);
    return;
  }
  vec3 co = aS * aB * Cs + aS * (1.0 - aB) * Cs + aB * (1.0 - aS) * Cb;
  float aO = aS + aB * (1.0 - aS);
  gl_FragColor = vec4(clamp(co / max(aO, 1e-6), 0.0, 1.0), aO);
}
`

// ---------------------------------------------------------------- programs

let progBlend: WebGLProgram | null = null
let progCopy: WebGLProgram | null = null
let progChannel: WebGLProgram | null = null
let progAdjust: WebGLProgram | null = null

function programs(gl: WebGL2RenderingContext) {
  if (!progBlend) progBlend = compileProgram(gl, 'zphoto-blend', QUAD_VS, BLEND_FS)
  if (!progCopy) progCopy = compileProgram(gl, 'zphoto-copy', QUAD_VS, COPY_FS)
  if (!progChannel) progChannel = compileProgram(gl, 'zphoto-channel', QUAD_VS, CHANNEL_VIEW_FS)
  if (!progAdjust) progAdjust = compileProgram(gl, 'zphoto-adjust', QUAD_VS, ADJUST_FS)
  return { progBlend, progCopy, progChannel, progAdjust }
}

// ---------------------------------------------------------------- LUT building

function combinedCurveLUT(params: Record<string, any>): Uint8Array | null {
  const master = buildCurveLUT(params.points)
  const rL = buildCurveLUT(params.pointsR)
  const gL = buildCurveLUT(params.pointsG)
  const bL = buildCurveLUT(params.pointsB)
  if (!master && !rL && !gL && !bL) return null
  const out = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    const r = rL ? rL[i] : i
    const g = gL ? gL[i] : i
    const b = bL ? bL[i] : i
    out[i * 4] = master ? master[r] : r
    out[i * 4 + 1] = master ? master[g] : g
    out[i * 4 + 2] = master ? master[b] : b
    out[i * 4 + 3] = 255
  }
  return out
}

function combinedLevelsLUT(p: Record<string, any>): Uint8Array | null {
  const mk = (ib: number, g: number, iw: number, ob: number, ow: number) => {
    const lut = new Uint8Array(256)
    const range = Math.max(1, iw - ib)
    const invGamma = 1 / Math.max(0.01, g)
    for (let i = 0; i < 256; i++) {
      const v = Math.min(1, Math.max(0, (i - ib) / range))
      lut[i] = ob + Math.pow(v, invGamma) * (ow - ob)
    }
    return lut
  }
  const base = mk(p.inBlack ?? 0, p.gamma ?? 1, p.inWhite ?? 255, p.outBlack ?? 0, p.outWhite ?? 255)
  const pc: any = p.perChannel
  const rL = pc?.r ? mk(pc.r.inBlack, pc.r.gamma, pc.r.inWhite, p.outBlack ?? 0, p.outWhite ?? 255) : null
  const gL = pc?.g ? mk(pc.g.inBlack, pc.g.gamma, pc.g.inWhite, p.outBlack ?? 0, p.outWhite ?? 255) : null
  const bL = pc?.b ? mk(pc.b.inBlack, pc.b.gamma, pc.b.inWhite, p.outBlack ?? 0, p.outWhite ?? 255) : null
  const out = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    out[i * 4] = rL ? rL[i] : base[i]
    out[i * 4 + 1] = gL ? gL[i] : base[i]
    out[i * 4 + 2] = bL ? bL[i] : base[i]
    out[i * 4 + 3] = 255
  }
  return out
}

function posterizeLUT(p: Record<string, any>): Uint8Array {
  const n = Math.max(2, Math.round(p.levels ?? 6))
  const out = new Uint8Array(256 * 4)
  const step = 255 / (n - 1)
  for (let i = 0; i < 256; i++) {
    const v = Math.round(Math.round(i / step) * step)
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255
  }
  return out
}

function gradientMapLUT(p: Record<string, any>): Uint8Array {
  let stops: { pos: number; color: string }[] = p.stops ?? [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }]
  if (p.reverse === true) stops = stops.map(s => ({ pos: 1 - s.pos, color: s.color }))
  const sorted = [...stops].sort((a, b) => a.pos - b.pos)
  const cols = sorted.map(s => hexToRgbTriple(s.color))
  const out = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let j = 0
    while (j < sorted.length - 2 && sorted[j + 1].pos < t) j++
    const a = sorted[j], b = sorted[Math.min(j + 1, sorted.length - 1)]
    const f = b.pos === a.pos ? 0 : Math.min(1, Math.max(0, (t - a.pos) / (b.pos - a.pos)))
    const ca = cols[j], cb = cols[Math.min(j + 1, cols.length - 1)]
    out[i * 4] = ca[0] + (cb[0] - ca[0]) * f
    out[i * 4 + 1] = ca[1] + (cb[1] - ca[1]) * f
    out[i * 4 + 2] = ca[2] + (cb[2] - ca[2]) * f
    out[i * 4 + 3] = 255
  }
  return out
}

// ---------------------------------------------------------------- per-pass helpers

interface AdjSetup {
  mode: number
  lut: Uint8Array | null
  A: [number, number, number, number]
  B: [number, number, number, number]
  C: [number, number, number, number]
}

function adjSetupFor(type: AdjustmentType, rawParams: Record<string, any>): AdjSetup | null {
  const defaults = ADJUSTMENTS[type]?.defaults ?? {}
  const p = { ...defaults, ...rawParams }
  switch (type) {
    case 'curves':
      return { mode: 0, lut: combinedCurveLUT(p), A: [0, 0, 0, 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0] }
    case 'levels':
      if (p.auto === true) return null // histogram-driven — CPU fallback
      return { mode: 1, lut: combinedLevelsLUT(p), A: [0, 0, 0, 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0] }
    case 'brightness-contrast':
      return { mode: 2, lut: null, A: [p.brightness ?? 0, p.contrast ?? 0, p.legacy ? 1 : 0, 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0] }
    case 'exposure':
      return { mode: 3, lut: null, A: [p.exposure ?? 0, p.offset ?? 0, p.gamma ?? 1, 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0] }
    case 'vibrance':
      return { mode: 4, lut: null, A: [(p.vibrance ?? 0) / 100, (p.saturation ?? 0) / 100, 0, 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0] }
    case 'hue-saturation':
      return { mode: 5, lut: null, A: [p.hue ?? 0, (p.saturation ?? 0) / 100, (p.lightness ?? 0) / 100, p.colorize ? 1 : 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0] }
    case 'color-balance': {
      const g = (k: string) => ((p[k] ?? 0) / 100) * 30
      return {
        mode: 6, lut: null,
        A: [g('sCyanRed') - g('sMagentaGreen'), g('sYellowBlue'), g('mCyanRed') - g('mMagentaGreen'), g('mYellowBlue')],
        B: [g('hCyanRed') - g('hMagentaGreen'), g('hYellowBlue'), p.preserveLuminosity !== false ? 1 : 0, 0],
        C: [0, 0, 0, 0],
      }
    }
    case 'black-white':
      return {
        mode: 7, lut: null,
        A: [(p.reds ?? 40) / 100, (p.yellows ?? 60) / 100, (p.greens ?? 40) / 100, (p.cyans ?? 60) / 100],
        B: [(p.blues ?? 20) / 100, (p.magentas ?? 80) / 100, 0, 0],
        C: [0, 0, 0, 0],
      }
    case 'photo-filter': {
      const [r, g, b] = hexToRgbTriple(p.color ?? '#ec8a3a')
      return {
        mode: 8, lut: null,
        A: [r / 255, g / 255, b / 255, Math.min(1, Math.max(0, (p.density ?? 25) / 100))],
        B: [p.preserveLuminosity !== false ? 1 : 0, 0, 0, 0],
        C: [0, 0, 0, 0],
      }
    }
    case 'channel-mixer': {
      const s = (k: string) => (p[k] ?? 0) / 100
      return {
        mode: 9, lut: null,
        A: [s('redRed'), s('redGreen'), s('redBlue'), p.monochrome === true ? 1 : 0],
        B: [s('greenRed'), s('greenGreen'), s('greenBlue'), (p.constant ?? 0) * 0.0255],
        C: [s('blueRed'), s('blueGreen'), s('blueBlue'), 0],
      }
    }
    case 'gradient-map':
      return { mode: 10, lut: gradientMapLUT(p), A: [p.dither !== false ? 1 : 0, 0, 0, 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0] }
    case 'posterize':
      return { mode: 11, lut: posterizeLUT(p), A: [0, 0, 0, 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0] }
    case 'threshold':
      return { mode: 12, lut: null, A: [p.level ?? 128, 0, 0, 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0] }
    case 'invert':
      return { mode: 13, lut: null, A: [0, 0, 0, 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0] }
    default:
      return null
  }
}

// ---------------------------------------------------------------- main entry

let lastGpuActive = 0
/** timestamp of the last successful GPU composite (for the status bar) */
export function glLastActiveTime(): number { return lastGpuActive }

export function glCompositeDocument(doc: PsDocument, target: HTMLCanvasElement): boolean {
  const gl = getGL()
  if (!gl || !glAvailable()) return false
  if (doc.width === 0 || doc.height === 0) return false
  const info = { max: (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) }
  if (doc.width > info.max || doc.height > info.max) return false

  // feature gates — anything the shaders can't reproduce exactly → CPU
  if (doc.previewFilter) return false
  if (doc.previewAdjustment && !GL_SUPPORTED_ADJ.has(doc.previewAdjustment.type)) return false
  for (const l of doc.layers) {
    if (l.blendIf) return false
    if (l.kind === 'adjustment' && l.adjustment) {
      if (!GL_SUPPORTED_ADJ.has(l.adjustment.type)) return false
      if (l.adjustment.type === 'levels' && (l.adjustment.params?.auto === true)) return false
      if (l.blendMode !== 'normal') return false // adjust shader supports normal (+add) only
    }
    // smart filters with non-default params run on the CPU inside prepareLayer
    // (cached) — fine, still GPU-composited.
  }

  const { progBlend, progCopy, progChannel, progAdjust } = programs(gl)
  if (!progBlend || !progCopy || !progChannel || !progAdjust) return false

  const W = doc.width, H = doc.height
  // Keep compositing/adjustment math in half-float render targets where the
  // driver can render RGBA16F. Source layers are still today's 8-bit canvases,
  // but repeated blends/adjustments no longer quantize every intermediate
  // compositor pass back to 8-bit.
  const precision = glInfo().float16Fbo ? 'rgba16f' as const : 'rgba8' as const
  const fboA = acquireFBO(gl, W, H, precision)
  const fboB = acquireFBO(gl, W, H, precision)
  const fboS = acquireFBO(gl, W, H, precision)
  const fboT = acquireFBO(gl, W, H, precision)
  if (!fboA || !fboB || !fboS || !fboT) {
    releaseFBO(gl, fboA); releaseFBO(gl, fboB); releaseFBO(gl, fboS); releaseFBO(gl, fboT)
    return false
  }

  try {
    // clear the accumulation FBO
    bindTarget(gl, fboA)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    let acc = fboA, accTmp = fboB
    let stackF = fboS, stackTmp = fboT

    const layers = doc.layers
    let i = 0
    while (i < layers.length) {
      const base = layers[i]
      let j = i + 1
      const stack: Layer[] = []
      while (j < layers.length && layers[j].clipped) { stack.push(layers[j]); j++ }
      i = j

      if (!base.visible) continue

      if (base.kind === 'adjustment') {
        if (!base.clipped && base.adjustment) {
          const ok = adjustPass(gl, progAdjust, acc, accTmp, base, doc)
          if (!ok) throw new Error('adjust pass failed')
          ;[acc, accTmp] = [accTmp, acc]
        }
        continue
      }

      // ---- raster-ish base: build the stack FBO ----
      const basePrepared = prepareLayer(doc, base)
      if (!basePrepared) continue
      bindTarget(gl, stackF)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      {
        const tex = uploadCanvas(gl, basePrepared, (base as any)._cacheKey ?? `${base._v}`)
        if (!tex) throw new Error('base upload failed')
        gl.useProgram(progCopy)
        bindUniformTex(gl, progCopy, 'uSrc', tex, 0)
        drawQuad(gl, progCopy)
      }

      let sFrom = stackF, sTo = stackTmp
      for (const cl of stack) {
        if (!cl.visible) continue
        if (cl.kind === 'adjustment') {
          if (cl.adjustment) {
            const ok = adjustPassOn(gl, progAdjust, sFrom, sTo, cl, doc)
            if (!ok) throw new Error('clipped adjust failed')
            ;[sFrom, sTo] = [sTo, sFrom]
          }
          continue
        }
        const c = prepareLayer(doc, cl)
        if (!c) continue
        const tex = uploadCanvas(gl, c, (cl as any)._cacheKey ?? `${cl._v}`)
        if (!tex) throw new Error('clip upload failed')
        // blend clipped layer onto the stack, clipped to stack alpha
        const bdTex = sFrom.tex
        bindTarget(gl, sTo)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.useProgram(progBlend)
        bindUniformTex(gl, progBlend, 'uSrc', tex, 0)
        bindUniformTex(gl, progBlend, 'uBackdrop', bdTex, 1)
        gl.uniform1f(gl.getUniformLocation(progBlend, 'uOpacity'), cl.opacity / 100)
        gl.uniform1i(gl.getUniformLocation(progBlend, 'uBlendMode'), BLEND_ID[cl.blendMode] ?? 0)
        gl.uniform1i(gl.getUniformLocation(progBlend, 'uClipAlpha'), 1)
        drawQuad(gl, progBlend)
        ;[sFrom, sTo] = [sTo, sFrom]
      }

      // ---- blend the stack over the accumulation ----
      bindTarget(gl, accTmp)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(progBlend)
      bindUniformTex(gl, progBlend, 'uSrc', sFrom.tex, 0)
      bindUniformTex(gl, progBlend, 'uBackdrop', acc.tex, 1)
      gl.uniform1f(gl.getUniformLocation(progBlend, 'uOpacity'), base.opacity / 100)
      gl.uniform1i(gl.getUniformLocation(progBlend, 'uBlendMode'), BLEND_ID[base.blendMode] ?? 0)
      gl.uniform1i(gl.getUniformLocation(progBlend, 'uClipAlpha'), 0)
      drawQuad(gl, progBlend)
      ;[acc, accTmp] = [accTmp, acc]
    }

    // ---- channel view ----
    if (doc.channelView !== 'rgb') {
      bindTarget(gl, accTmp)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(progChannel)
      bindUniformTex(gl, progChannel, 'uSrc', acc.tex, 0)
      gl.uniform1i(gl.getUniformLocation(progChannel, 'uChannel'), doc.channelView === 'r' ? 0 : doc.channelView === 'g' ? 1 : 2)
      drawQuad(gl, progChannel)
      ;[acc, accTmp] = [accTmp, acc]
    }

    // ---- dialog live-preview adjustment (applied to the whole composite) ----
    if (doc.previewAdjustment) {
      const setup = adjSetupFor(doc.previewAdjustment.type, doc.previewAdjustment.params)
      if (setup) {
        const lutTex = setup.lut ? uploadLUT(gl, setup.lut, `prev-${doc.previewAdjustment.type}-${hashParams(doc.previewAdjustment.params)}`) : null
        bindTarget(gl, accTmp)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.useProgram(progAdjust)
        bindUniformTex(gl, progAdjust, 'uBackdrop', acc.tex, 0)
        gl.uniform1i(gl.getUniformLocation(progAdjust, 'uHasMask'), 0)
        gl.uniform1i(gl.getUniformLocation(progAdjust, 'uHasLut'), lutTex ? 1 : 0)
        if (lutTex) bindUniformTex(gl, progAdjust, 'uLut', lutTex, 2)
        gl.uniform1i(gl.getUniformLocation(progAdjust, 'uOpacityI'), 1000)
        gl.uniform1i(gl.getUniformLocation(progAdjust, 'uBlendMode'), 0)
        gl.uniform1i(gl.getUniformLocation(progAdjust, 'uAdjMode'), setup.mode)
        gl.uniform1i(gl.getUniformLocation(progAdjust, 'uReplace'), 1)
        gl.uniform4fv(gl.getUniformLocation(progAdjust, 'uAdjA'), setup.A)
        gl.uniform4fv(gl.getUniformLocation(progAdjust, 'uAdjB'), setup.B)
        gl.uniform4fv(gl.getUniformLocation(progAdjust, 'uAdjC'), setup.C)
        drawQuad(gl, progAdjust)
        ;[acc, accTmp] = [accTmp, acc]
      }
    }

    // ---- read back into the target 2D canvas ----
    // readPixels(UNSIGNED_BYTE) is not portable from an RGBA16F attachment.
    // Resolve once into an 8-bit target at the very end; this is the single
    // quantization boundary for the GPU compositing chain.
    let readTarget = acc
    let resolve8: ReturnType<typeof acquireFBO> = null
    if (acc.precision === 'rgba16f') {
      resolve8 = acquireFBO(gl, W, H, 'rgba8')
      if (!resolve8) throw new Error('8-bit resolve FBO unavailable')
      bindTarget(gl, resolve8)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(progCopy)
      bindUniformTex(gl, progCopy, 'uSrc', acc.tex, 0)
      drawQuad(gl, progCopy)
      readTarget = resolve8
    }

    bindTarget(gl, readTarget)
    const buf = new Uint8Array(W * H * 4)
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    const outCtx = target.getContext('2d')!
    const imgData = new ImageData(new Uint8ClampedArray(buf.buffer, 0, W * H * 4), W, H)
    outCtx.putImageData(imgData, 0, 0)
    releaseFBO(gl, resolve8)

    lastGpuActive = performance.now()
    releaseFBO(gl, fboA); releaseFBO(gl, fboB); releaseFBO(gl, fboS); releaseFBO(gl, fboT)
    return true
  } catch (err) {
    releaseFBO(gl, fboA); releaseFBO(gl, fboB); releaseFBO(gl, fboS); releaseFBO(gl, fboT)
    if (typeof console !== 'undefined') console.warn('[gl-composite] fallback to CPU:', err)
    return false
  }
}

/** adjustment-layer pass applied to the accumulation FBO */
function adjustPass(gl: WebGL2RenderingContext, prog: WebGLProgram, from: FBORef, to: FBORef, layer: Layer, doc: PsDocument): boolean {
  return adjustPassOn(gl, prog, from, to, layer, doc)
}

type FBORef = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number; precision: 'rgba8' | 'rgba16f' }

/** adjustment pass: adjust(from) masked by layer.mask, blended into to */
function adjustPassOn(gl: WebGL2RenderingContext, prog: WebGLProgram, from: FBORef, to: FBORef, layer: Layer, doc: PsDocument): boolean {
  if (!layer.adjustment) return true
  const setup = adjSetupFor(layer.adjustment.type, layer.adjustment.params)
  if (!setup) return false
  const lutTex = setup.lut
    ? uploadLUT(gl, setup.lut, `adj-${layer.id}-${hashParams(layer.adjustment.params)}`)
    : null
  const useMask = !!(layer.maskEnabled && layer.mask)
  const maskTex = useMask ? uploadCanvas(gl, layer.mask!, `${doc._epoch}_${layer._mv}`) : null

  bindTarget(gl, to)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.useProgram(prog)
  bindUniformTex(gl, prog, 'uBackdrop', from.tex, 0)
  if (maskTex) bindUniformTex(gl, prog, 'uMask', maskTex, 1)
  gl.uniform1i(gl.getUniformLocation(prog, 'uHasMask'), maskTex ? 1 : 0)
  gl.uniform1i(gl.getUniformLocation(prog, 'uHasLut'), lutTex ? 1 : 0)
  if (lutTex) bindUniformTex(gl, prog, 'uLut', lutTex, 2)
  gl.uniform1i(gl.getUniformLocation(prog, 'uOpacityI'), Math.round(layer.opacity * 10))
  gl.uniform1i(gl.getUniformLocation(prog, 'uBlendMode'), BLEND_ID[layer.blendMode] ?? 0)
  gl.uniform1i(gl.getUniformLocation(prog, 'uAdjMode'), setup.mode)
  gl.uniform1i(gl.getUniformLocation(prog, 'uReplace'), 0)
  gl.uniform4fv(gl.getUniformLocation(prog, 'uAdjA'), setup.A)
  gl.uniform4fv(gl.getUniformLocation(prog, 'uAdjB'), setup.B)
  gl.uniform4fv(gl.getUniformLocation(prog, 'uAdjC'), setup.C)
  drawQuad(gl, prog)
  return true
}

function hashParams(params: Record<string, any>): string {
  try { return JSON.stringify(params) } catch { return String(Date.now()) }
}
