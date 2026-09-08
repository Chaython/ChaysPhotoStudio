// ============================================================
// ADJUSTMENTS registry — production-quality tone & color ops.
// Every entry keeps a `controls` schema (auto-rendered by the generic
// dialog) and `defaults`, and mutates ImageData in place.
// Math notes inline. Pure functions — no DOM / engine imports.
// ============================================================

import type { AdjustmentDef, AdjustmentType } from '../types'
import { clamp } from '../utils/canvas'
import { computeHistogram } from './core'
import {
  hexToRgbTriple, hslToRgb, hueFamilyWeight, labToRgb, luma,
  rgbToHsl, rgbToHsv, rgbToLab,
} from './color'
import { buildCurveLUT, smoothRamp } from './interp'
import { blurImageData } from './blur'
import { applyLUT as applyColorLUT } from './lut'

const D = (img: ImageData) => img.data

function applyLUT(img: ImageData, lut: Uint8ClampedArray): void {
  const d = D(img)
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]]
    d[i + 1] = lut[d[i + 1]]
    d[i + 2] = lut[d[i + 2]]
  }
}

function applyLUT3(img: ImageData, rl: Uint8ClampedArray | null, gl: Uint8ClampedArray | null, bl: Uint8ClampedArray | null): void {
  if (!rl && !gl && !bl) return
  const d = D(img)
  for (let i = 0; i < d.length; i += 4) {
    if (rl) d[i] = rl[d[i]]
    if (gl) d[i + 1] = gl[d[i + 1]]
    if (bl) d[i + 2] = bl[d[i + 2]]
  }
}

// ------------------------------------------------------------------ curves
const curvesAdj: AdjustmentDef = {
  type: 'curves', label: 'Curves',
  controls: [
    { key: 'channel', label: 'Channel', type: 'select', options: [{ label: 'RGB', value: 'rgb' }, { label: 'Red', value: 'r' }, { label: 'Green', value: 'g' }, { label: 'Blue', value: 'b' }] },
    { key: 'points', label: 'Curve', type: 'custom', customId: 'curves-points' },
  ],
  defaults: {
    channel: 'rgb',
    points: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    pointsR: null, pointsG: null, pointsB: null,
  },
  apply(img, p) {
    // Monotone cubic (Fritsch–Carlson) — C1-continuous, no overshoot,
    // natural S-curves. Master + per-channel LUTs compose like Photoshop.
    applyLUT3(
      img,
      buildCurveLUT(p.pointsR),
      buildCurveLUT(p.pointsG),
      buildCurveLUT(p.pointsB),
    )
    const master = buildCurveLUT(p.points)
    if (master) applyLUT(img, master)
  },
}

// ------------------------------------------------------------------ levels
const levelsAdj: AdjustmentDef = {
  type: 'levels', label: 'Levels',
  controls: [
    { key: 'channel', label: 'Channel', type: 'select', options: [{ label: 'RGB', value: 'rgb' }, { label: 'Red', value: 'r' }, { label: 'Green', value: 'g' }, { label: 'Blue', value: 'b' }] },
    { key: 'inBlack', label: 'Input Black', type: 'slider', min: 0, max: 254, step: 1 },
    { key: 'gamma', label: 'Gamma', type: 'slider', min: 0.1, max: 9.99, step: 0.01 },
    { key: 'inWhite', label: 'Input White', type: 'slider', min: 1, max: 255, step: 1 },
    { key: 'outBlack', label: 'Output Black', type: 'slider', min: 0, max: 255, step: 1 },
    { key: 'outWhite', label: 'Output White', type: 'slider', min: 0, max: 255, step: 1 },
    { key: 'auto', label: 'Auto (per-channel clip)', type: 'toggle' },
  ],
  defaults: { channel: 'rgb', inBlack: 0, gamma: 1, inWhite: 255, outBlack: 0, outWhite: 255, auto: false, perChannel: null },
  apply(img, p) {
    const mk = (ib: number, g: number, iw: number, ob: number, ow: number) => {
      const lut = new Uint8ClampedArray(256)
      const range = Math.max(1, iw - ib)
      const invGamma = 1 / Math.max(0.01, g)
      for (let i = 0; i < 256; i++) {
        const v = clamp((i - ib) / range, 0, 1)
        lut[i] = ob + Math.pow(v, invGamma) * (ow - ob)
      }
      return lut
    }
    if (p.auto) {
      // per-channel 0.1% / 99.9% clip points from the histogram
      const h = computeHistogram(img)
      const chans = [h.r, h.g, h.b]
      const luts: (Uint8ClampedArray | null)[] = [null, null, null]
      for (let c = 0; c < 3; c++) {
        const hist = chans[c]
        const total = Math.max(1, h.total)
        const loTarget = total * 0.001
        const hiTarget = total * 0.999
        let lo = 0, hi = 255, acc = 0
        for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > loTarget) { lo = i; break } }
        acc = 0
        for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= hiTarget) { hi = i; break } }
        if (hi - lo < 8) { lo = 0; hi = 255 }
        luts[c] = mk(lo, p.gamma ?? 1, hi, p.outBlack ?? 0, p.outWhite ?? 255)
      }
      applyLUT3(img, luts[0], luts[1], luts[2])
      return
    }
    const base = mk(p.inBlack ?? 0, p.gamma ?? 1, p.inWhite ?? 255, p.outBlack ?? 0, p.outWhite ?? 255)
    const pc: any = p.perChannel
    const rL = pc?.r ? mk(pc.r.inBlack, pc.r.gamma, pc.r.inWhite, p.outBlack ?? 0, p.outWhite ?? 255) : null
    const gL = pc?.g ? mk(pc.g.inBlack, pc.g.gamma, pc.g.inWhite, p.outBlack ?? 0, p.outWhite ?? 255) : null
    const bL = pc?.b ? mk(pc.b.inBlack, pc.b.gamma, pc.b.inWhite, p.outBlack ?? 0, p.outWhite ?? 255) : null
    const d = D(img)
    for (let i = 0; i < d.length; i += 4) {
      d[i] = rL ? rL[d[i]] : base[d[i]]
      d[i + 1] = gL ? gL[d[i + 1]] : base[d[i + 1]]
      d[i + 2] = bL ? bL[d[i + 2]] : base[d[i + 2]]
    }
  },
}

// ------------------------------------------------------------------ brightness / contrast
const brightnessContrast: AdjustmentDef = {
  type: 'brightness-contrast', label: 'Brightness/Contrast',
  controls: [
    { key: 'brightness', label: 'Brightness', type: 'slider', min: -150, max: 150, step: 1 },
    { key: 'contrast', label: 'Contrast', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'legacy', label: 'Use Legacy', type: 'toggle' },
  ],
  defaults: { brightness: 0, contrast: 0, legacy: false },
  apply(img, p) {
    const b = (p.brightness ?? 0) / 255
    const c = (p.contrast ?? 0) / 100
    const d = D(img)
    if (p.legacy) {
      // classic linear model
      const f = c < 0 ? 1 + c : 1 / Math.max(0.01, 1 - c * 0.85)
      const lut = new Uint8ClampedArray(256)
      for (let i = 0; i < 256; i++) lut[i] = clamp((i - 128) * f + 128 + b * 255, 0, 255)
      applyLUT(img, lut)
      return
    }
    // modern model: brightness gently re-lights midtones, contrast blends
    // toward a smoothstep S-curve — endpoints are preserved, no clipping.
    const k = clamp(c * 2.2, -1.7, 2.2)
    const bAmt = clamp((p.brightness ?? 0) / 150, -1, 1) * 0.45
    for (let i = 0; i < d.length; i += 4) {
      for (let ch = 0; ch < 3; ch++) {
        let v = d[i + ch] / 255
        // brightness: shift weighted toward midtones (keeps some highlight room)
        v = v + bAmt * (1 - Math.abs(2 * v - 1) * 0.55)
        // contrast: blend with smoothstep S-curve
        const s = v * v * (3 - 2 * v)
        v = v + (s - v) * k
        d[i + ch] = clamp(v * 255, 0, 255)
      }
    }
  },
}

// ------------------------------------------------------------------ exposure
const exposureAdj: AdjustmentDef = {
  type: 'exposure', label: 'Exposure',
  controls: [
    { key: 'exposure', label: 'Exposure', type: 'slider', min: -5, max: 5, step: 0.05, unit: 'EV' },
    { key: 'offset', label: 'Offset', type: 'slider', min: -0.5, max: 0.5, step: 0.01 },
    { key: 'gamma', label: 'Gamma', type: 'slider', min: 0.1, max: 3, step: 0.01 },
  ],
  defaults: { exposure: 0, offset: 0, gamma: 1 },
  apply(img, p) {
    const gain = Math.pow(2, p.exposure ?? 0)
    const off = p.offset ?? 0
    const invGamma = 1 / Math.max(0.01, p.gamma ?? 1)
    const d = D(img)
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        // linear exposure, linear offset (shadows), then gamma correction
        let v = (d[i + c] / 255) * gain + off
        if (v < 0) v = 0
        v = Math.pow(v, invGamma)
        d[i + c] = v * 255
      }
    }
  },
}

// ------------------------------------------------------------------ vibrance
const vibranceAdj: AdjustmentDef = {
  type: 'vibrance', label: 'Vibrance',
  controls: [
    { key: 'vibrance', label: 'Vibrance', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'saturation', label: 'Saturation', type: 'slider', min: -100, max: 100, step: 1 },
  ],
  defaults: { vibrance: 0, saturation: 0 },
  apply(img, p) {
    const vib = (p.vibrance ?? 0) / 100
    const sat = (p.saturation ?? 0) / 100
    if (vib === 0 && sat === 0) return
    const d = D(img)
    const hsl = [0, 0, 0]
    const rgb = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2]
      rgbToHsl(r, g, b, hsl)
      const h = hsl[0], s = hsl[1], l = hsl[2]
      // skin protection: hues 10..45 get progressively less vibrance
      let hd = Math.abs(h - 28)
      if (hd > 180) hd = 360 - hd
      const skin = 1 - clamp((46 - hd) / 32, 0, 1) * 0.8
      // vibrance boosts under-saturated pixels more; plain saturation is uniform
      const sTarget = s * (1 + sat) + (1 - s) * vib * skin * 1.35
      const s2 = clamp(sTarget, 0, 1)
      hslToRgb(h, s2, l, rgb)
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]
    }
  },
}

// ------------------------------------------------------------------ hue / saturation
const hueSaturation: AdjustmentDef = {
  type: 'hue-saturation', label: 'Hue/Saturation',
  controls: [
    { key: 'hue', label: 'Hue', type: 'slider', min: -180, max: 180, step: 1, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'lightness', label: 'Lightness', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'colorize', label: 'Colorize', type: 'toggle' },
  ],
  defaults: { hue: 0, saturation: 0, lightness: 0, colorize: false },
  apply(img, p) {
    const hueShift = p.hue ?? 0
    const sat = (p.saturation ?? 0) / 100
    const lit = (p.lightness ?? 0) / 100
    const colorize = p.colorize === true
    const d = D(img)
    const hsl = [0, 0, 0]
    const rgb = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2]
      let h: number, s: number, l: number
      if (colorize) {
        // grayscale luminance becomes lightness; hue & saturation come from sliders
        l = luma(r, g, b) / 255
        h = ((hueShift < 0 ? hueShift + 360 : hueShift) || 30) % 360
        s = sat > 0 ? sat : 0.25
      } else {
        rgbToHsl(r, g, b, hsl)
        h = (hsl[0] + hueShift + 360) % 360
        s = clamp(hsl[1] * (1 + sat), 0, 1)
        l = hsl[2]
      }
      if (lit > 0) l = l + (1 - l) * lit
      else if (lit < 0) l = l * (1 + lit)
      hslToRgb(h, s, clamp(l, 0, 1), rgb)
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]
    }
  },
}

// ------------------------------------------------------------------ color balance (Lab, 3 tone ranges)
const colorBalance: AdjustmentDef = {
  type: 'color-balance', label: 'Color Balance',
  controls: [
    { key: 'sCyanRed', label: 'Cyan ↔ Red · Shadows', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'sMagentaGreen', label: 'Magenta ↔ Green · Shadows', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'sYellowBlue', label: 'Yellow ↔ Blue · Shadows', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'mCyanRed', label: 'Cyan ↔ Red · Midtones', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'mMagentaGreen', label: 'Magenta ↔ Green · Midtones', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'mYellowBlue', label: 'Yellow ↔ Blue · Midtones', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'hCyanRed', label: 'Cyan ↔ Red · Highlights', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'hMagentaGreen', label: 'Magenta ↔ Green · Highlights', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'hYellowBlue', label: 'Yellow ↔ Blue · Highlights', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'preserveLuminosity', label: 'Preserve Luminosity', type: 'toggle' },
  ],
  defaults: {
    sCyanRed: 0, sMagentaGreen: 0, sYellowBlue: 0,
    mCyanRed: 0, mMagentaGreen: 0, mYellowBlue: 0,
    hCyanRed: 0, hMagentaGreen: 0, hYellowBlue: 0,
    preserveLuminosity: true,
  },
  apply(img, p) {
    const g = (k: string) => ((p[k] ?? 0) / 100) * 30 // slider -> Lab units
    const aSh = g('sCyanRed') - g('sMagentaGreen')
    const bSh = g('sYellowBlue')
    const aMd = g('mCyanRed') - g('mMagentaGreen')
    const bMd = g('mYellowBlue')
    const aHi = g('hCyanRed') - g('hMagentaGreen')
    const bHi = g('hYellowBlue')
    const preserve = p.preserveLuminosity !== false
    const d = D(img)
    const lab = [0, 0, 0]
    const rgb = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2]
      const l01 = luma(r, gg, b) / 255
      // tone-range weights with soft overlap (shadows < 0.33 < highlights)
      const wS = 1 - smoothRamp(l01, 0.28, 0.62)
      const wH = smoothRamp(l01, 0.38, 0.72)
      const wM = clamp(1 - wS - wH, 0, 1)
      if (preserve) {
        // operate on a*/b* in Lab: hue shifts without luminance change
        rgbToLab(r, gg, b, lab)
        lab[1] += aSh * wS + aMd * wM + aHi * wH
        lab[2] += bSh * wS + bMd * wM + bHi * wH
        labToRgb(lab[0], lab[1], lab[2], rgb)
        d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]
      } else {
        // naive additive shifts in RGB
        const da = (aSh * wS + aMd * wM + aHi * wH) * 1.6
        const db = (bSh * wS + bMd * wM + bHi * wH) * 1.6
        d[i] = clamp(r + da - db * 0.4, 0, 255)
        d[i + 1] = clamp(gg - da * 0.4 - db * 0.4, 0, 255)
        d[i + 2] = clamp(b + db - da * 0.4, 0, 255)
      }
    }
  },
}

// ------------------------------------------------------------------ black & white (hue-family mixing)
const blackWhite: AdjustmentDef = {
  type: 'black-white', label: 'Black & White',
  controls: [
    { key: 'reds', label: 'Reds', type: 'slider', min: -200, max: 300, step: 1, unit: '%' },
    { key: 'yellows', label: 'Yellows', type: 'slider', min: -200, max: 300, step: 1, unit: '%' },
    { key: 'greens', label: 'Greens', type: 'slider', min: -200, max: 300, step: 1, unit: '%' },
    { key: 'cyans', label: 'Cyans', type: 'slider', min: -200, max: 300, step: 1, unit: '%' },
    { key: 'blues', label: 'Blues', type: 'slider', min: -200, max: 300, step: 1, unit: '%' },
    { key: 'magentas', label: 'Magentas', type: 'slider', min: -200, max: 300, step: 1, unit: '%' },
  ],
  defaults: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 },
  apply(img, p) {
    const vr = (p.reds ?? 40) / 100
    const vy = (p.yellows ?? 60) / 100
    const vg = (p.greens ?? 40) / 100
    const vc = (p.cyans ?? 60) / 100
    const vb = (p.blues ?? 20) / 100
    const vm = (p.magentas ?? 80) / 100
    const d = D(img)
    const hsv = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2]
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      const gray = luma(r, g, b)
      let out: number
      if (mx - mn < 6) {
        // achromatic: sliders have nothing to remix
        out = gray
      } else {
        rgbToHsv(r, g, b, hsv)
        const h = hsv[0]
        const sat = mx > 0 ? (mx - mn) / mx : 0
        // each hue family pulls the mix between luma and slider·max
        let acc = 0
        acc += hueFamilyWeight(h, 0) * (vr * mx - gray)
        acc += hueFamilyWeight(h, 60) * (vy * mx - gray)
        acc += hueFamilyWeight(h, 120) * (vg * mx - gray)
        acc += hueFamilyWeight(h, 180) * (vc * mx - gray)
        acc += hueFamilyWeight(h, 240) * (vb * mx - gray)
        acc += hueFamilyWeight(h, 300) * (vm * mx - gray)
        out = gray + acc * sat
      }
      d[i] = out; d[i + 1] = out; d[i + 2] = out
    }
  },
}

// ------------------------------------------------------------------ photo filter
const photoFilter: AdjustmentDef = {
  type: 'photo-filter', label: 'Photo Filter',
  controls: [
    { key: 'color', label: 'Color', type: 'color' },
    { key: 'density', label: 'Density', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'preserveLuminosity', label: 'Preserve Luminosity', type: 'toggle' },
  ],
  defaults: { color: '#ec8a3a', density: 25, preserveLuminosity: true },
  apply(img, p) {
    const [fr, fg, fb] = hexToRgbTriple(p.color ?? '#ec8a3a')
    const density = clamp((p.density ?? 25) / 100, 0, 1)
    const preserve = p.preserveLuminosity !== false
    const d = D(img)
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2]
      let nr = r + (fr - r) * density
      let ng = g + (fg - g) * density
      let nb = b + (fb - b) * density
      if (preserve) {
        // rescale so the Rec.601 luminance of the result matches the source
        const l0 = luma(r, g, b)
        const l1 = luma(nr, ng, nb)
        if (l1 > 4) {
          const s = l0 / l1
          nr *= s; ng *= s; nb *= s
        }
      }
      d[i] = clamp(nr, 0, 255)
      d[i + 1] = clamp(ng, 0, 255)
      d[i + 2] = clamp(nb, 0, 255)
    }
  },
}

// ------------------------------------------------------------------ channel mixer
const channelMixer: AdjustmentDef = {
  type: 'channel-mixer', label: 'Channel Mixer',
  controls: [
    { key: 'monochrome', label: 'Monochrome', type: 'toggle' },
    { key: 'redRed', label: 'Red ← Red', type: 'slider', min: -200, max: 200, step: 1, unit: '%' },
    { key: 'redGreen', label: 'Red ← Green', type: 'slider', min: -200, max: 200, step: 1, unit: '%' },
    { key: 'redBlue', label: 'Red ← Blue', type: 'slider', min: -200, max: 200, step: 1, unit: '%' },
    { key: 'greenRed', label: 'Green ← Red', type: 'slider', min: -200, max: 200, step: 1, unit: '%' },
    { key: 'greenGreen', label: 'Green ← Green', type: 'slider', min: -200, max: 200, step: 1, unit: '%' },
    { key: 'greenBlue', label: 'Green ← Blue', type: 'slider', min: -200, max: 200, step: 1, unit: '%' },
    { key: 'blueRed', label: 'Blue ← Red', type: 'slider', min: -200, max: 200, step: 1, unit: '%' },
    { key: 'blueGreen', label: 'Blue ← Green', type: 'slider', min: -200, max: 200, step: 1, unit: '%' },
    { key: 'blueBlue', label: 'Blue ← Blue', type: 'slider', min: -200, max: 200, step: 1, unit: '%' },
    { key: 'constant', label: 'Constant', type: 'slider', min: -100, max: 100, step: 1 },
  ],
  defaults: { monochrome: false, redRed: 100, greenGreen: 100, blueBlue: 100, constant: 0 },
  apply(img, p) {
    const s = (k: string) => (p[k] ?? 0) / 100
    const rr = s('redRed'), rg = s('redGreen'), rb = s('redBlue')
    const gr = s('greenRed'), gg = s('greenGreen'), gb = s('greenBlue')
    const br = s('blueRed'), bg = s('blueGreen'), bb = s('blueBlue')
    const konst = (p.constant ?? 0) * 2.55
    const d = D(img)
    if (p.monochrome === true) {
      // monochrome uses the Red output row, like Photoshop
      for (let i = 0; i < d.length; i += 4) {
        const v = clamp(d[i] * rr + d[i + 1] * rg + d[i + 2] * rb + konst, 0, 255)
        d[i] = v; d[i + 1] = v; d[i + 2] = v
      }
    } else {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2]
        d[i] = clamp(r * rr + g * rg + b * rb + konst, 0, 255)
        d[i + 1] = clamp(r * gr + g * gg + b * gb + konst, 0, 255)
        d[i + 2] = clamp(r * br + g * bg + b * bb + konst, 0, 255)
      }
    }
  },
}

// ------------------------------------------------------------------ selective color (CMYK plates)
const SELECTIVE_PLATES = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'] as const
const PLATE_HUE_CENTER: Record<string, number> = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 }

const selectiveColor: AdjustmentDef = {
  type: 'selective-color', label: 'Selective Color',
  controls: [
    { key: 'plate', label: 'Colors', type: 'select', options: SELECTIVE_PLATES.map(v => ({ label: v[0].toUpperCase() + v.slice(1), value: v })) },
    { key: 'cyan', label: 'Cyan', type: 'slider', min: -100, max: 100, step: 1, unit: '%' },
    { key: 'magenta', label: 'Magenta', type: 'slider', min: -100, max: 100, step: 1, unit: '%' },
    { key: 'yellow', label: 'Yellow', type: 'slider', min: -100, max: 100, step: 1, unit: '%' },
    { key: 'black', label: 'Black', type: 'slider', min: -100, max: 100, step: 1, unit: '%' },
    { key: 'absolute', label: 'Absolute', type: 'toggle' },
  ],
  defaults: { plate: 'reds', cyan: 0, magenta: 0, yellow: 0, black: 0, absolute: false },
  apply(img, p) {
    const plate: string = p.plate ?? 'reds'
    const sC = (p.cyan ?? 0) / 100
    const sM = (p.magenta ?? 0) / 100
    const sY = (p.yellow ?? 0) / 100
    const sK = (p.black ?? 0) / 100
    if (sC === 0 && sM === 0 && sY === 0 && sK === 0) return
    const absolute = p.absolute === true
    const hueCenter = PLATE_HUE_CENTER[plate]
    const isHuePlate = hueCenter !== undefined
    const d = D(img)
    const hsv = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) {
      const rn = d[i] / 255, gn = d[i + 1] / 255, bn = d[i + 2] / 255
      const mx = Math.max(rn, gn, bn)
      const mn = Math.min(rn, gn, bn)
      const v = mx
      const sat = mx > 1e-6 ? (mx - mn) / mx : 0

      // ---- plate membership weight (soft, like Photoshop's ranges) ----
      let w: number
      if (isHuePlate) {
        rgbToHsv(d[i], d[i + 1], d[i + 2], hsv)
        w = hueFamilyWeight(hsv[0], hueCenter) * smoothRamp(sat, 0.05, 0.2)
      } else if (plate === 'whites') {
        w = smoothRamp(v, 0.78, 0.95) * (1 - smoothRamp(sat, 0.16, 0.42))
      } else if (plate === 'blacks') {
        w = 1 - smoothRamp(v, 0.05, 0.28)
      } else { // neutrals
        w = (1 - smoothRamp(sat, 0.1, 0.28)) * smoothRamp(v, 0.07, 0.25) * (1 - smoothRamp(v, 0.8, 0.94))
      }
      if (w <= 0.004) continue

      // ---- CMYK plate math ----
      // ink model with light black generation: the complements carry the
      // color, K (1 - max) tracks total darkness. Plate adjustments act on
      // the inks; relative scales existing ink (Adobe "relative"), absolute
      // adds the full amount (Adobe "absolute").
      let C = 1 - rn, M = 1 - gn, Y = 1 - bn
      if (absolute) {
        C += sC * w; M += sM * w; Y += sY * w
        // black slider raises total ink coverage
        C += sK * w; M += sK * w; Y += sK * w
      } else {
        C *= 1 + sC * w; M *= 1 + sM * w; Y *= 1 + sY * w
        if (sK !== 0) { const kf = 1 + sK * w; C *= kf; M *= kf; Y *= kf }
      }
      C = clamp(C, 0, 1); M = clamp(M, 0, 1); Y = clamp(Y, 0, 1)
      d[i] = (1 - C) * 255
      d[i + 1] = (1 - M) * 255
      d[i + 2] = (1 - Y) * 255
    }
  },
}

// ------------------------------------------------------------------ gradient map
const gradientMap: AdjustmentDef = {
  type: 'gradient-map', label: 'Gradient Map',
  controls: [
    { key: 'stops', label: 'Gradient', type: 'custom', customId: 'gradient-stops' },
    { key: 'dither', label: 'Dither', type: 'toggle' },
    { key: 'reverse', label: 'Reverse', type: 'toggle' },
  ],
  defaults: { stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }], dither: true, reverse: false },
  apply(img, p) {
    let stops: { pos: number; color: string }[] = p.stops ?? [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }]
    if (p.reverse === true) stops = stops.map(s => ({ pos: 1 - s.pos, color: s.color }))
    const sorted = [...stops].sort((a, b) => a.pos - b.pos)
    const lutR = new Uint8ClampedArray(256)
    const lutG = new Uint8ClampedArray(256)
    const lutB = new Uint8ClampedArray(256)
    const cols = sorted.map(s => hexToRgbTriple(s.color))
    for (let i = 0; i < 256; i++) {
      const t = i / 255
      let j = 0
      while (j < sorted.length - 2 && sorted[j + 1].pos < t) j++
      const a = sorted[j], b = sorted[Math.min(j + 1, sorted.length - 1)]
      const f = b.pos === a.pos ? 0 : clamp((t - a.pos) / (b.pos - a.pos), 0, 1)
      const ca = cols[j], cb = cols[Math.min(j + 1, cols.length - 1)]
      lutR[i] = ca[0] + (cb[0] - ca[0]) * f
      lutG[i] = ca[1] + (cb[1] - ca[1]) * f
      lutB[i] = ca[2] + (cb[2] - ca[2]) * f
    }
    const dither = p.dither !== false
    const d = D(img)
    for (let i = 0; i < d.length; i += 4) {
      let v = luma(d[i], d[i + 1], d[i + 2])
      if (dither) v += Math.random() * 1.6 - 0.8
      if (v < 0) v = 0
      if (v > 255) v = 255
      const idx = v | 0
      d[i] = lutR[idx]; d[i + 1] = lutG[idx]; d[i + 2] = lutB[idx]
    }
  },
}

// ------------------------------------------------------------------ posterize / threshold / invert
const posterizeAdj: AdjustmentDef = {
  type: 'posterize', label: 'Posterize',
  controls: [{ key: 'levels', label: 'Levels', type: 'slider', min: 2, max: 255, step: 1 }],
  defaults: { levels: 6 },
  apply(img, p) {
    const n = Math.max(2, Math.round(p.levels ?? 6))
    const lut = new Uint8ClampedArray(256)
    const step = 255 / (n - 1)
    for (let i = 0; i < 256; i++) lut[i] = Math.round(Math.round(i / step) * step)
    applyLUT(img, lut)
  },
}

const thresholdAdj: AdjustmentDef = {
  type: 'threshold', label: 'Threshold',
  controls: [{ key: 'level', label: 'Threshold Level', type: 'slider', min: 1, max: 255, step: 1 }],
  defaults: { level: 128 },
  apply(img, p) {
    const t = p.level ?? 128
    const d = D(img)
    for (let i = 0; i < d.length; i += 4) {
      const v = luma(d[i], d[i + 1], d[i + 2]) >= t ? 255 : 0
      d[i] = v; d[i + 1] = v; d[i + 2] = v
    }
  },
}

const invertAdj: AdjustmentDef = {
  type: 'invert', label: 'Invert',
  controls: [], defaults: {},
  apply(img) {
    const d = D(img)
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255 - d[i]
      d[i + 1] = 255 - d[i + 1]
      d[i + 2] = 255 - d[i + 2]
    }
  },
}

// ------------------------------------------------------------------ camera raw (basic panel)
const cameraRaw: AdjustmentDef = {
  type: 'camera-raw', label: 'Camera Raw Basic',
  controls: [
    { key: 'temperature', label: 'Temperature', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'tint', label: 'Tint', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'exposure', label: 'Exposure', type: 'slider', min: -4, max: 4, step: 0.05, unit: 'EV' },
    { key: 'contrast', label: 'Contrast', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'highlights', label: 'Highlights', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'shadows', label: 'Shadows', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'whites', label: 'Whites', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'blacks', label: 'Blacks', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'clarity', label: 'Clarity', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'vibrance', label: 'Vibrance', type: 'slider', min: -100, max: 100, step: 1 },
    { key: 'saturation', label: 'Saturation', type: 'slider', min: -100, max: 100, step: 1 },
  ],
  defaults: {
    temperature: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0,
    whites: 0, blacks: 0, clarity: 0, vibrance: 0, saturation: 0,
  },
  apply(img, p) {
    const t = (p.temperature ?? 0) / 100
    const tint = (p.tint ?? 0) / 100
    const exp = Math.pow(2, p.exposure ?? 0)
    const contrast = (p.contrast ?? 0) / 100
    const hi = (p.highlights ?? 0) / 100
    const sh = (p.shadows ?? 0) / 100
    const wh = (p.whites ?? 0) / 100
    const bl = (p.blacks ?? 0) / 100
    const clarity = (p.clarity ?? 0) / 100
    const vib = (p.vibrance ?? 0) / 100
    const sat = (p.saturation ?? 0) / 100
    const d = D(img)

    // white balance gains (temperature warms red / cools blue quadratically)
    const rGain = 1 + 0.32 * t + 0.10 * t * t
    const bGain = 1 - 0.32 * t + 0.10 * t * t
    const gGain = 1 + 0.20 * tint

    // ---- pass 1: white balance, exposure, tone ----
    for (let i = 0; i < d.length; i += 4) {
      let r = (d[i] / 255) * rGain
      let g = (d[i + 1] / 255) * gGain
      let b = (d[i + 2] / 255) * bGain
      r *= exp; g *= exp; b *= exp
      if (r > 1) r = 1; if (g > 1) g = 1; if (b > 1) b = 1
      // luminance of the post-exposure pixel drives the tone masks
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      const hiMask = smoothRamp(lum, 0.42, 0.95)
      const shMask = 1 - smoothRamp(lum, 0.05, 0.58)
      const hiK = hi * 0.34 * hiMask
      const shK = sh * 0.42 * shMask
      const whK = wh * 0.34
      const blK = bl * 0.34
      const cf = 1 + contrast * 1.35
      r = applyRawTone(r, hiK, shK, whK, blK, cf)
      g = applyRawTone(g, hiK, shK, whK, blK, cf)
      b = applyRawTone(b, hiK, shK, whK, blK, cf)
      d[i] = clamp(r * 255, 0, 255)
      d[i + 1] = clamp(g * 255, 0, 255)
      d[i + 2] = clamp(b * 255, 0, 255)
    }

    // ---- pass 2: clarity (local contrast) + vibrance / saturation ----
    if (clarity !== 0) {
      const blurred = new ImageData(img.width, img.height)
      blurred.data.set(d)
      const sigma = clamp(Math.min(img.width, img.height) / 40, 3, 40)
      blurImageData(blurred, sigma)
      const amt = clarity * 1.7
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const hp = d[i + c] - blurred.data[i + c]
          // clarity only pushes midtone contrast, not extremes (halo guard)
          const v = d[i + c] / 255
          const gate = 1 - Math.abs(2 * v - 1) * 0.75
          d[i + c] = clamp(d[i + c] + hp * amt * gate, 0, 255)
        }
      }
    }
    if (vib !== 0 || sat !== 0) {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2]
        const l = luma(r, g, b)
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
        const psat = mx > 1e-6 ? (mx - mn) / mx : 0
        // hue-weighted skin protection
        const rBias = r - (g + b) * 0.5
        const skin = 1 - clamp(rBias / 70, 0, 1) * 0.7
        const f = 1 + sat * 0.85 + vib * (1 - psat) * 1.4 * skin
        d[i] = clamp(l + (r - l) * f, 0, 255)
        d[i + 1] = clamp(l + (g - l) * f, 0, 255)
        d[i + 2] = clamp(l + (b - l) * f, 0, 255)
      }
    }
  },
}

/** one channel through the highlight/shadow/white/black + contrast stack */
function applyRawTone(v: number, hiK: number, shK: number, whK: number, blK: number, contrast: number): number {
  // highlights: recovery/lift with headroom weighting
  v += hiK * (0.25 + 0.75 * (1 - v))
  // shadows: lift with more power in the darks
  v += shK * (0.15 + 0.85 * (1 - v))
  // whites: parabolic stretch of the top end
  v += whK * v * v
  // blacks: parabolic stretch of the bottom end
  v += blK * (1 - v) * (1 - v)
  // contrast around 0.5
  v = 0.5 + (v - 0.5) * contrast
  return v
}

// ------------------------------------------------------------------ shadow / highlight
const shadowHighlight: AdjustmentDef = {
  type: 'shadow-highlight', label: 'Shadow/Highlight',
  controls: [
    { key: 'shadowsAmount', label: 'Shadows · Amount', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'shadowsWidth', label: 'Shadows · Tonal Width', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'shadowsRadius', label: 'Shadows · Radius', type: 'slider', min: 0, max: 120, step: 1, unit: 'px' },
    { key: 'highlightsAmount', label: 'Highlights · Amount', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'highlightsWidth', label: 'Highlights · Tonal Width', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'highlightsRadius', label: 'Highlights · Radius', type: 'slider', min: 0, max: 120, step: 1, unit: 'px' },
  ],
  defaults: { shadowsAmount: 35, shadowsWidth: 50, shadowsRadius: 30, highlightsAmount: 0, highlightsWidth: 50, highlightsRadius: 30 },
  apply(img, p) {
    const sAmt = (p.shadowsAmount ?? 35) / 100
    const sW = (p.shadowsWidth ?? 50) / 100
    const sR = Math.max(1, p.shadowsRadius ?? 30)
    const hAmt = (p.highlightsAmount ?? 0) / 100
    const hW = (p.highlightsWidth ?? 50) / 100
    const hR = Math.max(1, p.highlightsRadius ?? 30)
    if (sAmt === 0 && hAmt === 0) return

    // luminance + local-mean (blur) maps — local contrast is what makes
    // Photoshop's S/H work: regions darker than their neighborhood are
    // shadows, brighter are highlights, regardless of global tone.
    const w = img.width, h = img.height
    const d = D(img)
    const lum = new Float32Array(w * h)
    for (let i = 0, j = 0; i < d.length; i += 4, j++) lum[j] = luma(d[i], d[i + 1], d[i + 2]) / 255

    const blurLuma = (radius: number): Float32Array => {
      const copy = new ImageData(w, h)
      copy.data.set(d)
      blurImageData(copy, radius)
      const out = new Float32Array(w * h)
      const bd = copy.data
      for (let i = 0, j = 0; i < bd.length; i += 4, j++) out[j] = luma(bd[i], bd[i + 1], bd[i + 2]) / 255
      return out
    }
    const localS = sAmt > 0 ? blurLuma(sR) : null
    const localH = hAmt > 0 ? blurLuma(hR) : null

    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = lum[j]
      let delta = 0
      if (localS) {
        // shadow mask: how much darker than the local mean, gated by tonal width
        const diff = localS[j] - v                       // > 0 → darker than surroundings
        const center = 0.5 * sW                          // tonal center moves with width
        const mask = clamp(1 - Math.abs(v - center) / (0.5 * sW + 0.08), 0, 1)
        const m = clamp(diff * 2.2, 0, 1) * mask
        if (m > 0) delta += sAmt * 0.85 * m              // lift toward local mean
      }
      if (localH) {
        const diff = v - localH[j]                       // > 0 → brighter than surroundings
        const center = 1 - 0.5 * hW
        const mask = clamp(1 - Math.abs(v - center) / (0.5 * hW + 0.08), 0, 1)
        const m = clamp(diff * 2.2, 0, 1) * mask
        if (m > 0) delta -= hAmt * 0.85 * m              // pull highlights back
      }
      if (delta !== 0) {
        for (let c = 0; c < 3; c++) {
          const old = d[i + c] / 255
          // lift/pull in exposure space keeps hue stable
          let nv = delta >= 0 ? old + (1 - old) * delta : old * (1 + delta)
          d[i + c] = clamp(nv * 255, 0, 255)
        }
      }
    }
  },
}

// ------------------------------------------------------------------ color lookup (LUT)
const colorLookupAdj: AdjustmentDef = {
  type: 'color-lookup', label: 'Color Lookup', icon: 'Layers',
  controls: [
    // custom control: LUT picker with .cube import (generic-dialogs.tsx /
    // channels-actions-properties.tsx render customId 'lut'); the params ONLY
    // carry the lutId STRING — the Float32 tables live in the module-level
    // LUT_REGISTRY (lut.ts) so history snapshots stay JSON-serializable
    { key: 'lutId', label: 'LUT', type: 'custom', customId: 'lut' },
    { key: 'strength', label: 'Strength', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  ],
  defaults: { lutId: 'teal-orange', strength: 100 },
  apply: (img, p) => {
    // (aliased import — this file already has a private 1-channel applyLUT)
    applyColorLUT(img, String(p.lutId ?? 'teal-orange'), Number(p.strength ?? 100))
  },
}

// ------------------------------------------------------------------ equalize
/** CDF histogram-equalization LUT with the classic first-nonzero-bin
 *  normalization (h(v) = (cdf(v) − cdf_min) / (total − cdf_min) · 255). */
function equalizeLUT(hist: Uint32Array, total: number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  if (total <= 0) { for (let v = 0; v < 256; v++) lut[v] = v; return lut }
  let acc = 0
  let cdfMin = 0
  let cdfMinSet = false
  const cdf = new Uint32Array(256)
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    cdf[v] = acc
    if (!cdfMinSet && hist[v] > 0) { cdfMin = acc; cdfMinSet = true }
  }
  const denom = total - cdfMin
  if (denom <= 0) { for (let v = 0; v < 256; v++) lut[v] = v; return lut }
  for (let v = 0; v < 256; v++) lut[v] = ((cdf[v] - cdfMin) / denom) * 255
  return lut
}

const equalizeAdj: AdjustmentDef = {
  type: 'equalize', label: 'Equalize',
  controls: [
    // Photoshop's Equalize redistributes each RGB channel's histogram
    // independently — that's the default here; off = luminance equalization
    // applied proportionally to RGB (hue-stable)
    { key: 'perChannel', label: 'Per-channel (Photoshop-style)', type: 'toggle' },
  ],
  defaults: { perChannel: true },
  apply(img, p) {
    const d = D(img)
    const perChannel = p.perChannel !== false
    if (perChannel) {
      for (let c = 0; c < 3; c++) {
        const hist = new Uint32Array(256)
        let total = 0
        for (let i = c; i < d.length; i += 4) {
          if (d[i + 3] < 8) continue
          hist[d[i]]++
          total++
        }
        const lut = equalizeLUT(hist, total)
        for (let i = c; i < d.length; i += 4) d[i] = lut[d[i]]
      }
      return
    }
    // luminance mode: equalize the luma histogram, rescale RGB by the
    // mapped-luma ratio (additive fallback near black keeps hue stable)
    const hist = new Uint32Array(256)
    let total = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue
      hist[Math.round(luma(d[i], d[i + 1], d[i + 2]))]++
      total++
    }
    const lut = equalizeLUT(hist, total)
    for (let i = 0; i < d.length; i += 4) {
      const l = luma(d[i], d[i + 1], d[i + 2])
      const nl = lut[Math.round(l)]
      if (l >= 8) {
        const k = nl / l
        d[i] = clamp(d[i] * k, 0, 255)
        d[i + 1] = clamp(d[i + 1] * k, 0, 255)
        d[i + 2] = clamp(d[i + 2] * k, 0, 255)
      } else {
        const add = nl - l
        d[i] = clamp(d[i] + add, 0, 255)
        d[i + 1] = clamp(d[i + 1] + add, 0, 255)
        d[i + 2] = clamp(d[i + 2] + add, 0, 255)
      }
    }
  },
}

// ------------------------------------------------------------------ registry
export const ADJUSTMENTS: Record<AdjustmentType, AdjustmentDef> = {
  'curves': curvesAdj,
  'levels': levelsAdj,
  'brightness-contrast': brightnessContrast,
  'exposure': exposureAdj,
  'vibrance': vibranceAdj,
  'hue-saturation': hueSaturation,
  'color-balance': colorBalance,
  'black-white': blackWhite,
  'photo-filter': photoFilter,
  'channel-mixer': channelMixer,
  'selective-color': selectiveColor,
  'gradient-map': gradientMap,
  'posterize': posterizeAdj,
  'threshold': thresholdAdj,
  'invert': invertAdj,
  'camera-raw': cameraRaw,
  'shadow-highlight': shadowHighlight,
  'color-lookup': colorLookupAdj,
  'equalize': equalizeAdj,
}
