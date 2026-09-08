// ============================================================
// Layer styles (fx) renderer — drop shadow, outer glow, inner
// shadow, stroke, color overlay.
//
// All effects are computed from the layer's post-mask ALPHA
// silhouette (Photoshop semantics: the mask shapes the fx) and
// baked into the prepared doc-space canvas by prepareLayer().
// Compositing order:
//   under: drop shadow → outer glow → outside stroke
//   content
//   over : color overlay → inner shadow → inside stroke
//
// Primitives:
//  · silhouette  — black alpha copy of the content
//  · dilate      — union of shifted copies (3 rings × 16 dirs ≈
//                  a disc dilation, good to ~½ px on round edges)
//  · inside band — silhouette ∩ dilate(inverse): the boundary
//                  band of width ~r (approximate erosion ring)
//  · blur        — ctx.filter blur (Chromium), hard-edge fallback
//  · shadow cast — native ctx.shadow* + destination-out of the
//                  body → an offset blurred silhouette copy
// ============================================================
import type { LayerFX } from '../types'
import { createCanvas, ctx2d, cloneCanvas } from '../utils/canvas'

const DIRS: [number, number][] = (() => {
  const out: [number, number][] = []
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    out.push([Math.cos(a), Math.sin(a)])
  }
  return out
})()

/** black alpha silhouette of a canvas (alpha preserved, rgb = 0) */
function silhouetteOf(src: HTMLCanvasElement): HTMLCanvasElement {
  const s = cloneCanvas(src)
  const c = ctx2d(s)
  c.globalCompositeOperation = 'source-in'
  c.fillStyle = '#000000'
  c.fillRect(0, 0, s.width, s.height)
  return s
}

/** union of the silhouette shifted in 16 directions at 3 radii — approximates
 *  a disc dilation of radius r (star artifacts ≤ r/8 on smooth edges) */
function dilate(sil: HTMLCanvasElement, r: number): HTMLCanvasElement {
  if (r <= 0) return cloneCanvas(sil)
  const out = createCanvas(sil.width, sil.height)
  const c = ctx2d(out)
  for (const f of [1, 0.66, 0.33]) {
    const rr = r * f
    for (const [dx, dy] of DIRS) c.drawImage(sil, Math.round(dx * rr), Math.round(dy * rr))
  }
  c.drawImage(sil, 0, 0)
  return out
}

/** boundary band INSIDE the silhouette of width ~r (approx erosion ring) */
function insideBand(sil: HTMLCanvasElement, r: number): HTMLCanvasElement {
  const w = sil.width, h = sil.height
  if (r <= 0) return createCanvas(w, h) // empty
  // inverse of the silhouette (alpha where the shape is empty)
  const inv = createCanvas(w, h)
  const ic = ctx2d(inv)
  ic.fillStyle = '#000'
  ic.fillRect(0, 0, w, h)
  ic.globalCompositeOperation = 'destination-out'
  ic.drawImage(sil, 0, 0)
  // dilate the inverse → reaches ~r INTO the shape from every edge
  const dil = dilate(inv, r)
  // band = dilated-inverse ∩ silhouette
  const band = dil
  const bc = ctx2d(band)
  bc.globalCompositeOperation = 'destination-in'
  bc.drawImage(sil, 0, 0)
  return band
}

function blurCanvas(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  if (radius <= 0.4) return cloneCanvas(src)
  const out = createCanvas(src.width, src.height)
  const c = ctx2d(out)
  try { c.filter = `blur(${radius.toFixed(2)}px)` } catch { /* unsupported → hard edge */ }
  c.drawImage(src, 0, 0)
  c.filter = 'none'
  return out
}

/** recolor an alpha mask: keeps alpha, replaces rgb (source-in fill) */
function colorize(mask: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const out = cloneCanvas(mask)
  const c = ctx2d(out)
  c.globalCompositeOperation = 'source-in'
  c.fillStyle = color
  c.fillRect(0, 0, out.width, out.height)
  return out
}

/** blurred, offset copy of the shape WITHOUT the body (a cast shadow).
 *  globalAlpha applies the fx opacity at composite time. */
function castShadow(sil: HTMLCanvasElement, color: string, blur: number, dx: number, dy: number): HTMLCanvasElement {
  const out = createCanvas(sil.width, sil.height)
  const c = ctx2d(out)
  c.save()
  c.shadowColor = color
  c.shadowBlur = blur
  c.shadowOffsetX = dx
  c.shadowOffsetY = dy
  c.drawImage(sil, 0, 0)
  c.restore()
  // remove the casting body → only the shadow remains
  c.globalCompositeOperation = 'destination-out'
  c.drawImage(sil, 0, 0)
  return out
}

function angleOffset(angleDeg: number, distance: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180
  return [Math.cos(a) * distance, Math.sin(a) * distance]
}

/** any effect enabled at all? (cheap guard for prepareLayer) */
export function hasEnabledFX(fx: LayerFX | null | undefined): boolean {
  if (!fx) return false
  return !!(
    (fx.dropShadow?.enabled) ||
    (fx.outerGlow?.enabled) ||
    (fx.innerShadow?.enabled) ||
    (fx.stroke?.enabled) ||
    (fx.colorOverlay?.enabled)
  )
}

/**
 * Bake the layer styles into the prepared doc-space content.
 * Returns a NEW canvas (input untouched). `content` must already carry the
 * layer mask (the silhouette is the fx shape).
 */
export function applyLayerFX(content: HTMLCanvasElement, fx: LayerFX): HTMLCanvasElement {
  const w = content.width, h = content.height
  const sil = silhouetteOf(content)

  const under = createCanvas(w, h) // drawn beneath the content
  const over = createCanvas(w, h)  // drawn on top of the content
  const uc = ctx2d(under)
  const oc = ctx2d(over)

  // ---- under: drop shadow ----
  if (fx.dropShadow?.enabled) {
    const fxv = fx.dropShadow
    const [dx, dy] = angleOffset(fxv.angle, fxv.distance)
    const sh = castShadow(sil, fxv.color, fxv.blur, dx, dy)
    uc.save()
    uc.globalAlpha = fxv.opacity / 100
    uc.drawImage(sh, 0, 0)
    uc.restore()
  }

  // ---- under: outer glow ----
  if (fx.outerGlow?.enabled) {
    const fxv = fx.outerGlow
    const glow = castShadow(sil, fxv.color, fxv.blur, 0, 0)
    uc.save()
    uc.globalAlpha = fxv.opacity / 100
    uc.drawImage(glow, 0, 0)
    uc.restore()
  }

  // ---- under: outside stroke ----
  if (fx.stroke?.enabled && fx.stroke.position === 'outside') {
    const fxv = fx.stroke
    const ring = dilate(sil, fxv.size)
    const rc = ctx2d(ring)
    rc.globalCompositeOperation = 'destination-out'
    rc.drawImage(sil, 0, 0) // ring = dilated − silhouette
    const colored = colorize(ring, fxv.color)
    uc.save()
    uc.globalAlpha = fxv.opacity / 100
    uc.drawImage(colored, 0, 0)
    uc.restore()
  }

  // ---- over: color overlay ----
  if (fx.colorOverlay?.enabled) {
    const fxv = fx.colorOverlay
    const fill = colorize(sil, fxv.color)
    oc.save()
    oc.globalAlpha = fxv.opacity / 100
    oc.drawImage(fill, 0, 0)
    oc.restore()
  }

  // ---- over: inner shadow ----
  if (fx.innerShadow?.enabled) {
    const fxv = fx.innerShadow
    const band = insideBand(sil, fxv.blur + fxv.distance + 1)
    const [dx, dy] = angleOffset(fxv.angle, fxv.distance)
    // shift the band toward the light source, keep only the part still inside
    const shifted = createCanvas(w, h)
    const sc = ctx2d(shifted)
    sc.drawImage(band, dx, dy)
    sc.globalCompositeOperation = 'destination-in'
    sc.drawImage(sil, 0, 0)
    const soft = blurCanvas(shifted, fxv.blur / 2)
    const colored = colorize(soft, fxv.color)
    oc.save()
    oc.globalAlpha = fxv.opacity / 100
    oc.drawImage(colored, 0, 0)
    oc.restore()
  }

  // ---- over: inside stroke ----
  if (fx.stroke?.enabled && fx.stroke.position === 'inside') {
    const fxv = fx.stroke
    const band = insideBand(sil, fxv.size)
    const colored = colorize(band, fxv.color)
    oc.save()
    oc.globalAlpha = fxv.opacity / 100
    oc.drawImage(colored, 0, 0)
    oc.restore()
  }

  // ---- assemble: under + content + over ----
  const out = createCanvas(w, h)
  const c = ctx2d(out)
  c.drawImage(under, 0, 0)
  c.drawImage(content, 0, 0)
  c.drawImage(over, 0, 0)
  return out
}

/** sensible factory defaults used by the dialog "add effect" buttons */
export function defaultFX(): LayerFX {
  return {
    dropShadow: { enabled: true, color: '#000000', opacity: 55, angle: 135, distance: 12, blur: 16 },
    outerGlow: { enabled: true, color: '#ffd27a', opacity: 60, blur: 24 },
    innerShadow: { enabled: true, color: '#000000', opacity: 55, angle: 135, distance: 8, blur: 12 },
    stroke: { enabled: true, color: '#ffffff', opacity: 100, size: 3, position: 'outside' },
    colorOverlay: { enabled: true, color: '#e8a33d', opacity: 100 },
  }
}
