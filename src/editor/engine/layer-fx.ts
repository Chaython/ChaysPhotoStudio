// ============================================================
// Layer styles (fx) renderer — Photoshop-style non-destructive effects.
//
// Effects are derived from the layer's post-mask alpha silhouette and baked
// into the prepared layer canvas. The layer itself remains editable.
// ============================================================
import type {
  BevelEmbossFX, BlendMode, GradientStyleFX, LayerFX, PatternStyleFX, StrokeFX, StyleContourPoint,
} from '../types'
import { createCanvas, ctx2d, cloneCanvas, clamp, getImageData, putImageData } from '../utils/canvas'
import { BLEND_GCO } from '../constants/tools'
import { paintBuiltinPattern } from '../tools/patterns'

const DIRS: [number, number][] = (() => {
  const out: [number, number][] = []
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2
    out.push([Math.cos(a), Math.sin(a)])
  }
  return out
})()

function silhouetteOf(src: HTMLCanvasElement): HTMLCanvasElement {
  const s = cloneCanvas(src)
  const c = ctx2d(s)
  c.globalCompositeOperation = 'source-in'
  c.fillStyle = '#000000'
  c.fillRect(0, 0, s.width, s.height)
  return s
}

function dilate(sil: HTMLCanvasElement, r: number): HTMLCanvasElement {
  if (r <= 0) return cloneCanvas(sil)
  const out = createCanvas(sil.width, sil.height)
  const c = ctx2d(out)
  const steps = Math.max(3, Math.min(7, Math.ceil(r / 3)))
  for (let step = steps; step >= 1; step--) {
    const rr = r * (step / steps)
    for (const [dx, dy] of DIRS) c.drawImage(sil, Math.round(dx * rr), Math.round(dy * rr))
  }
  c.drawImage(sil, 0, 0)
  return out
}

function insideBand(sil: HTMLCanvasElement, r: number): HTMLCanvasElement {
  const w = sil.width, h = sil.height
  if (r <= 0) return createCanvas(w, h)
  const inv = createCanvas(w, h)
  const ic = ctx2d(inv)
  ic.fillStyle = '#000'
  ic.fillRect(0, 0, w, h)
  ic.globalCompositeOperation = 'destination-out'
  ic.drawImage(sil, 0, 0)
  const band = dilate(inv, r)
  const bc = ctx2d(band)
  bc.globalCompositeOperation = 'destination-in'
  bc.drawImage(sil, 0, 0)
  return band
}

function outerBand(sil: HTMLCanvasElement, r: number): HTMLCanvasElement {
  const ring = dilate(sil, r)
  const rc = ctx2d(ring)
  rc.globalCompositeOperation = 'destination-out'
  rc.drawImage(sil, 0, 0)
  return ring
}

function blurCanvas(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  if (radius <= 0.35) return cloneCanvas(src)
  const out = createCanvas(src.width, src.height)
  const c = ctx2d(out)
  try { c.filter = `blur(${Math.max(0, radius).toFixed(2)}px)` } catch { /* browser fallback = hard edge */ }
  c.drawImage(src, 0, 0)
  c.filter = 'none'
  return out
}

function contourLut(points: StyleContourPoint[] | undefined): Uint8Array | null {
  if (!points || points.length < 2) return null
  const sorted = points
    .map(p => ({ x: clamp(Number(p.x) || 0, 0, 1), y: clamp(Number(p.y) || 0, 0, 1) }))
    .sort((a, b) => a.x - b.x)
  const clean: StyleContourPoint[] = []
  for (const p of sorted) {
    const prev = clean[clean.length - 1]
    if (prev && Math.abs(prev.x - p.x) < 1e-4) clean[clean.length - 1] = p
    else clean.push(p)
  }
  if (!clean.length) return null
  if (clean[0].x > 0) clean.unshift({ x: 0, y: clean[0].y })
  if (clean[clean.length - 1].x < 1) clean.push({ x: 1, y: clean[clean.length - 1].y })
  if (clean.length === 2 && clean[0].y === 0 && clean[1].y === 1) return null

  const lut = new Uint8Array(256)
  let seg = 0
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    while (seg < clean.length - 2 && x > clean[seg + 1].x) seg++
    const a = clean[seg], b = clean[Math.min(clean.length - 1, seg + 1)]
    const span = Math.max(1e-6, b.x - a.x)
    const t = clamp((x - a.x) / span, 0, 1)
    lut[i] = Math.round(clamp(a.y + (b.y - a.y) * t, 0, 1) * 255)
  }
  return lut
}

function applyContour(mask: HTMLCanvasElement, points: StyleContourPoint[] | undefined): HTMLCanvasElement {
  const lut = contourLut(points)
  if (!lut) return mask
  const out = cloneCanvas(mask)
  const img = getImageData(out)
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = lut[img.data[i]]
  putImageData(out, img)
  return out
}

function applyNoise(mask: HTMLCanvasElement, amount: number | undefined): HTMLCanvasElement {
  const strength = clamp((Number(amount) || 0) / 100, 0, 1)
  if (strength <= 0) return mask
  const out = cloneCanvas(mask)
  const img = getImageData(out)
  const d = img.data
  for (let i = 3, p = 0; i < d.length; i += 4, p++) {
    // Stable integer hash: deterministic previews/history instead of flicker.
    let n = Math.imul(p ^ 0x9e3779b9, 0x85ebca6b)
    n ^= n >>> 13
    n = Math.imul(n, 0xc2b2ae35)
    n ^= n >>> 16
    const grain = (n >>> 0) / 0xffffffff
    const factor = (1 - strength) + strength * grain
    d[i] = Math.round(d[i] * factor)
  }
  putImageData(out, img)
  return out
}

function drawEffect(
  target: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  opacity: number,
  blendMode: BlendMode | undefined,
) {
  target.save()
  target.globalAlpha = clamp(Number(opacity) || 0, 0, 100) / 100
  target.globalCompositeOperation = BLEND_GCO[blendMode ?? 'normal'] ?? 'source-over'
  target.drawImage(image, 0, 0)
  target.restore()
}

function colorize(mask: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const out = cloneCanvas(mask)
  const c = ctx2d(out)
  c.globalCompositeOperation = 'source-in'
  c.fillStyle = color
  c.fillRect(0, 0, out.width, out.height)
  return out
}

function castShadow(
  source: HTMLCanvasElement,
  color: string,
  blur: number,
  dx: number,
  dy: number,
  cutout: HTMLCanvasElement = source,
): HTMLCanvasElement {
  const out = createCanvas(source.width, source.height)
  const c = ctx2d(out)
  c.save()
  c.shadowColor = color
  c.shadowBlur = blur
  c.shadowOffsetX = dx
  c.shadowOffsetY = dy
  c.drawImage(source, 0, 0)
  c.restore()
  c.globalCompositeOperation = 'destination-out'
  c.drawImage(cutout, 0, 0)
  return out
}

function angleOffset(angleDeg: number, distance: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180
  return [Math.cos(a) * distance, Math.sin(a) * distance]
}

function applyMask(canvas: HTMLCanvasElement, mask: HTMLCanvasElement) {
  const c = ctx2d(canvas)
  c.globalCompositeOperation = 'destination-in'
  c.drawImage(mask, 0, 0)
  c.globalCompositeOperation = 'source-over'
}

function gradientFill(
  mask: HTMLCanvasElement,
  opts: {
    startColor: string
    endColor: string
    angle: number
    scale: number
    style: 'linear' | 'radial'
    reverse?: boolean
  },
): HTMLCanvasElement {
  const out = createCanvas(mask.width, mask.height)
  const c = ctx2d(out)
  const w = out.width, h = out.height
  const cx = w / 2, cy = h / 2
  const first = opts.reverse ? opts.endColor : opts.startColor
  const second = opts.reverse ? opts.startColor : opts.endColor
  const scale = clamp(Number(opts.scale) || 100, 10, 400) / 100
  let grad: CanvasGradient
  if (opts.style === 'radial') {
    const radius = Math.max(1, Math.max(w, h) * .5 * scale)
    grad = c.createRadialGradient(cx, cy, 0, cx, cy, radius)
  } else {
    const a = (Number(opts.angle) || 0) * Math.PI / 180
    const half = Math.max(w, h) * .5 * scale
    const dx = Math.cos(a) * half, dy = Math.sin(a) * half
    grad = c.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
  }
  grad.addColorStop(0, first)
  grad.addColorStop(1, second)
  c.fillStyle = grad
  c.fillRect(0, 0, w, h)
  applyMask(out, mask)
  return out
}

function patternFill(
  mask: HTMLCanvasElement,
  opts: {
    pattern: string
    scale: number
    offsetX: number
    offsetY: number
    fg: string
    bg: string
  },
): HTMLCanvasElement {
  const out = createCanvas(mask.width, mask.height)
  const c = ctx2d(out)
  paintBuiltinPattern(c, out.width, out.height, {
    kind: opts.pattern || 'checker',
    scale: clamp((Number(opts.scale) || 100) / 100, .25, 4),
    offsetX: Number(opts.offsetX) || 0,
    offsetY: Number(opts.offsetY) || 0,
    fg: opts.fg || '#ffffff',
    bg: opts.bg || '#000000',
  })
  applyMask(out, mask)
  return out
}

function strokePaint(mask: HTMLCanvasElement, fx: StrokeFX): HTMLCanvasElement {
  if (fx.fillType === 'gradient') {
    return gradientFill(mask, {
      startColor: fx.gradientStart ?? fx.color,
      endColor: fx.gradientEnd ?? '#000000',
      angle: fx.gradientAngle ?? 0,
      scale: fx.gradientScale ?? 100,
      style: 'linear',
    })
  }
  if (fx.fillType === 'pattern') {
    return patternFill(mask, {
      pattern: fx.pattern ?? 'checker',
      scale: fx.patternScale ?? 100,
      offsetX: fx.patternOffsetX ?? 0,
      offsetY: fx.patternOffsetY ?? 0,
      fg: fx.patternFg ?? fx.color,
      bg: fx.patternBg ?? '#000000',
    })
  }
  return colorize(mask, fx.color)
}

function directionalDifference(
  base: HTMLCanvasElement,
  clip: HTMLCanvasElement,
  dx: number,
  dy: number,
): HTMLCanvasElement {
  const out = cloneCanvas(base)
  const c = ctx2d(out)
  c.globalCompositeOperation = 'destination-out'
  c.drawImage(base, dx, dy)
  c.globalCompositeOperation = 'destination-in'
  c.drawImage(clip, 0, 0)
  c.globalCompositeOperation = 'source-over'
  return out
}

function bevelMasks(sil: HTMLCanvasElement, fx: BevelEmbossFX) {
  const size = Math.max(1, Number(fx.size) || 1)
  const alt = clamp(Number(fx.altitude) || 30, 0, 90) * Math.PI / 180
  const offset = Math.max(.75, size * (.25 + .75 * Math.sin(alt)))
  let [dx, dy] = angleOffset(Number(fx.angle) || 120, offset)
  if (fx.direction === 'down') { dx = -dx; dy = -dy }

  let clip: HTMLCanvasElement
  let base: HTMLCanvasElement
  if (fx.style === 'outer-bevel') {
    clip = outerBand(sil, size)
    base = dilate(sil, size)
  } else if (fx.style === 'emboss') {
    clip = createCanvas(sil.width, sil.height)
    const cc = ctx2d(clip)
    cc.drawImage(outerBand(sil, Math.max(1, size / 2)), 0, 0)
    cc.drawImage(insideBand(sil, Math.max(1, size / 2)), 0, 0)
    base = dilate(sil, Math.max(1, size / 2))
  } else {
    clip = insideBand(sil, size)
    base = sil
  }

  let highlight = directionalDifference(base, clip, -dx, -dy)
  let shadow = directionalDifference(base, clip, dx, dy)
  const technique = fx.technique ?? 'smooth'
  const soften = Math.max(0, Number(fx.soften) || 0)
  const blur = technique === 'chisel-hard' ? soften * .25
    : technique === 'chisel-soft' ? Math.max(.5, soften + size * .14)
      : Math.max(.5, soften + size * .24)
  if (blur > .3) {
    highlight = blurCanvas(highlight, blur)
    shadow = blurCanvas(shadow, blur)
    applyMask(highlight, clip)
    applyMask(shadow, clip)
  }
  return { highlight, shadow }
}

export function hasEnabledFX(fx: LayerFX | null | undefined): boolean {
  if (!fx) return false
  return !!(
    fx.bevelEmboss?.enabled ||
    fx.stroke?.enabled ||
    fx.innerShadow?.enabled ||
    fx.innerGlow?.enabled ||
    fx.satin?.enabled ||
    fx.colorOverlay?.enabled ||
    fx.gradientOverlay?.enabled ||
    fx.patternOverlay?.enabled ||
    fx.outerGlow?.enabled ||
    fx.dropShadow?.enabled
  )
}

export function applyLayerFX(content: HTMLCanvasElement, fx: LayerFX): HTMLCanvasElement {
  const w = content.width, h = content.height
  const sil = silhouetteOf(content)
  const under = createCanvas(w, h)
  const over = createCanvas(w, h)
  const uc = ctx2d(under)
  const oc = ctx2d(over)

  // Drop Shadow
  if (fx.dropShadow?.enabled) {
    const v = fx.dropShadow
    const [dx, dy] = angleOffset(v.angle, v.distance)
    const sh = applyContour(castShadow(sil, v.color, v.blur, dx, dy), v.contour)
    uc.save(); uc.globalAlpha = clamp(v.opacity, 0, 100) / 100; uc.drawImage(sh, 0, 0); uc.restore()
  }

  // Outer Glow
  if (fx.outerGlow?.enabled) {
    const v = fx.outerGlow
    const glow = applyContour(castShadow(sil, v.color, v.blur, 0, 0), v.contour)
    uc.save(); uc.globalAlpha = clamp(v.opacity, 0, 100) / 100; uc.drawImage(glow, 0, 0); uc.restore()
  }

  // Outside / center outer half Stroke
  if (fx.stroke?.enabled && (fx.stroke.position === 'outside' || fx.stroke.position === 'center')) {
    const v = fx.stroke
    const ring = outerBand(sil, v.position === 'center' ? Math.max(.5, v.size / 2) : v.size)
    const painted = strokePaint(ring, v)
    uc.save(); uc.globalAlpha = clamp(v.opacity, 0, 100) / 100; uc.drawImage(painted, 0, 0); uc.restore()
  }

  // Content overlays
  if (fx.colorOverlay?.enabled) {
    const v = fx.colorOverlay
    const fill = colorize(sil, v.color)
    oc.save(); oc.globalAlpha = clamp(v.opacity, 0, 100) / 100; oc.drawImage(fill, 0, 0); oc.restore()
  }

  if (fx.gradientOverlay?.enabled) {
    const v: GradientStyleFX = fx.gradientOverlay
    const fill = gradientFill(sil, v)
    oc.save(); oc.globalAlpha = clamp(v.opacity, 0, 100) / 100; oc.drawImage(fill, 0, 0); oc.restore()
  }

  if (fx.patternOverlay?.enabled) {
    const v: PatternStyleFX = fx.patternOverlay
    const fill = patternFill(sil, v)
    oc.save(); oc.globalAlpha = clamp(v.opacity, 0, 100) / 100; oc.drawImage(fill, 0, 0); oc.restore()
  }

  // Satin
  if (fx.satin?.enabled) {
    const v = fx.satin
    const [dx, dy] = angleOffset(v.angle, v.distance)
    const satin = createCanvas(w, h)
    const sc = ctx2d(satin)
    sc.drawImage(sil, dx, dy)
    sc.globalCompositeOperation = 'xor'
    sc.drawImage(sil, -dx, -dy)
    sc.globalCompositeOperation = 'destination-in'
    sc.drawImage(sil, 0, 0)
    sc.globalCompositeOperation = 'source-over'
    const soft = applyContour(blurCanvas(satin, Math.max(.5, v.size / 2)), v.contour)
    if (v.invert) {
      const inv = cloneCanvas(sil)
      const ic = ctx2d(inv)
      ic.globalCompositeOperation = 'destination-out'
      ic.drawImage(soft, 0, 0)
      const colored = colorize(inv, v.color)
      oc.save(); oc.globalAlpha = clamp(v.opacity, 0, 100) / 100; oc.drawImage(colored, 0, 0); oc.restore()
    } else {
      const colored = colorize(soft, v.color)
      oc.save(); oc.globalAlpha = clamp(v.opacity, 0, 100) / 100; oc.drawImage(colored, 0, 0); oc.restore()
    }
  }

  // Inner Glow
  if (fx.innerGlow?.enabled) {
    const v = fx.innerGlow
    const chokePx = Math.max(0, (Number(v.choke) || 0) / 100 * v.blur)
    let mask: HTMLCanvasElement
    if (v.source === 'center') {
      mask = cloneCanvas(sil)
      const mc = ctx2d(mask)
      mc.globalCompositeOperation = 'destination-out'
      mc.drawImage(insideBand(sil, Math.max(1, v.blur + chokePx)), 0, 0)
      mc.globalCompositeOperation = 'source-over'
      mask = blurCanvas(mask, Math.max(.5, v.blur / 2))
      applyMask(mask, sil)
    } else {
      mask = insideBand(sil, Math.max(1, v.blur + chokePx))
      mask = blurCanvas(mask, Math.max(.5, v.blur / 2))
      applyMask(mask, sil)
    }
    mask = applyContour(mask, v.contour)
    const colored = colorize(mask, v.color)
    oc.save(); oc.globalAlpha = clamp(v.opacity, 0, 100) / 100; oc.drawImage(colored, 0, 0); oc.restore()
  }

  // Inner Shadow
  if (fx.innerShadow?.enabled) {
    const v = fx.innerShadow
    const band = insideBand(sil, v.blur + v.distance + 1)
    const [dx, dy] = angleOffset(v.angle, v.distance)
    const shifted = createCanvas(w, h)
    const sc = ctx2d(shifted)
    sc.drawImage(band, dx, dy)
    sc.globalCompositeOperation = 'destination-in'
    sc.drawImage(sil, 0, 0)
    const soft = applyContour(blurCanvas(shifted, v.blur / 2), v.contour)
    const colored = colorize(soft, v.color)
    oc.save(); oc.globalAlpha = clamp(v.opacity, 0, 100) / 100; oc.drawImage(colored, 0, 0); oc.restore()
  }

  // Bevel & Emboss
  if (fx.bevelEmboss?.enabled) {
    const v = fx.bevelEmboss
    const masks = bevelMasks(sil, v)
    const highlight = applyContour(masks.highlight, v.contour)
    const shadow = applyContour(masks.shadow, v.contour)
    const depth = clamp((Number(v.depth) || 100) / 100, .01, 10)
    const hi = colorize(highlight, v.highlightColor)
    const sh = colorize(shadow, v.shadowColor)
    oc.save()
    oc.globalAlpha = clamp(v.highlightOpacity * Math.min(depth, 2.5), 0, 100) / 100
    oc.drawImage(hi, 0, 0)
    oc.restore()
    oc.save()
    oc.globalAlpha = clamp(v.shadowOpacity * Math.min(depth, 2.5), 0, 100) / 100
    oc.drawImage(sh, 0, 0)
    oc.restore()
  }

  // Inside / center inner half Stroke
  if (fx.stroke?.enabled && (fx.stroke.position === 'inside' || fx.stroke.position === 'center')) {
    const v = fx.stroke
    const band = insideBand(sil, v.position === 'center' ? Math.max(.5, v.size / 2) : v.size)
    const painted = strokePaint(band, v)
    oc.save(); oc.globalAlpha = clamp(v.opacity, 0, 100) / 100; oc.drawImage(painted, 0, 0); oc.restore()
  }

  const out = createCanvas(w, h)
  const c = ctx2d(out)
  c.drawImage(under, 0, 0)
  c.drawImage(content, 0, 0)
  c.drawImage(over, 0, 0)
  return out
}

export function defaultFX(): LayerFX {
  return {
    bevelEmboss: {
      enabled: true, style: 'inner-bevel', technique: 'smooth', depth: 100, direction: 'up',
      size: 5, soften: 0, angle: 120, altitude: 30,
      highlightColor: '#ffffff', highlightOpacity: 75,
      shadowColor: '#000000', shadowOpacity: 75,
    },
    stroke: {
      enabled: true, color: '#ffffff', opacity: 100, size: 3, position: 'outside',
      fillType: 'color', gradientStart: '#ffffff', gradientEnd: '#000000',
      gradientAngle: 0, gradientScale: 100, pattern: 'checker', patternScale: 100,
      patternOffsetX: 0, patternOffsetY: 0, patternFg: '#ffffff', patternBg: '#000000',
    },
    innerShadow: { enabled: true, color: '#000000', opacity: 55, angle: 135, distance: 8, blur: 12 },
    innerGlow: { enabled: true, color: '#fff4b8', opacity: 65, blur: 18, source: 'edge', choke: 0 },
    satin: { enabled: true, color: '#000000', opacity: 50, angle: 19, distance: 11, size: 14, invert: false },
    colorOverlay: { enabled: true, color: '#e8a33d', opacity: 100 },
    gradientOverlay: {
      enabled: true, opacity: 100, startColor: '#ffffff', endColor: '#000000',
      angle: 90, scale: 100, style: 'linear', reverse: false,
    },
    patternOverlay: {
      enabled: true, opacity: 100, pattern: 'checker', scale: 100,
      offsetX: 0, offsetY: 0, fg: '#ffffff', bg: '#000000',
    },
    outerGlow: { enabled: true, color: '#ffd27a', opacity: 60, blur: 24 },
    dropShadow: { enabled: true, color: '#000000', opacity: 55, angle: 135, distance: 12, blur: 16 },
  }
}
