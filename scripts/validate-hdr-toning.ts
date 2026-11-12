import assert from 'node:assert/strict'
import { applyHdrToning, HDR_TONING_DEFAULTS } from '../src/editor/image-ops/hdr-toning'
import { ADJUSTMENTS, applyAdjustment } from '../src/editor/image-ops'
import type { PixelImage } from '../src/editor/image-ops/pixel-data'

function image(pixels: number[][]): ImageData {
  const data = new Uint8ClampedArray(pixels.length * 4)
  pixels.forEach((p, i) => {
    data[i * 4] = p[0]; data[i * 4 + 1] = p[1]; data[i * 4 + 2] = p[2]; data[i * 4 + 3] = p[3] ?? 255
  })
  return { width: pixels.length, height: 1, data } as ImageData
}

const rgb = (img: ImageData) => Array.from({ length: img.width }, (_, i) => [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]])

// ------------------------------------------------------------------ registry

assert.ok(ADJUSTMENTS['hdr-toning'], 'HDR Toning is a registered adjustment')
assert.ok(ADJUSTMENTS['desaturate'], 'Desaturate is a registered adjustment')
assert.equal(ADJUSTMENTS['hdr-toning'].label, 'HDR Toning')

// ------------------------------------------------------------------ exposure/gamma

const neutral = image([[120, 80, 40, 255], [10, 200, 250, 255]])
const before = rgb(neutral)
applyAdjustment(neutral, 'hdr-toning', {
  method: 'exposure-gamma', exposure: 0, gamma: 1, saturation: 0, vibrance: 0,
})
const after = rgb(neutral)
for (let i = 0; i < before.length; i++) {
  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(after[i][c] - before[i][c]) <= 1, `neutral exposure/gamma is a no-op (${after[i]} vs ${before[i]})`)
  }
}

// one stop brighter — the lift happens in linear light, so an sRGB
// midtone lands near 176 rather than at a naive 8-bit doubling
const brighter = image([[128, 128, 128, 255]])
applyAdjustment(brighter, 'hdr-toning', { method: 'exposure-gamma', exposure: 1, gamma: 1, saturation: 0, vibrance: 0 })
assert.ok(rgb(brighter)[0][0] > 170 && rgb(brighter)[0][0] < 182, `+1 EV lifts the midtone in linear light (got ${rgb(brighter)[0][0]})`)

// a lower gamma means more contrast: the shadows are pulled down
// harder than the highlights
const contrasty = image([[64, 64, 64, 255], [192, 192, 192, 255]])
applyAdjustment(contrasty, 'hdr-toning', { method: 'exposure-gamma', exposure: 0, gamma: 0.5, saturation: 0, vibrance: 0 })
const [dark, light] = rgb(contrasty)
assert.ok(dark[0] < 64, `a lower gamma darkens the shadows (got ${dark[0]})`)
assert.ok(light[0] - dark[0] > 128, `a lower gamma widens the tonal spread (got ${light[0] - dark[0]})`)

// ------------------------------------------------------------------ local adaptation

// a scene with a very bright patch: local adaptation must bring the
// whole thing back into the display range instead of clipping
const wide: number[][] = []
for (let i = 0; i < 32; i++) wide.push([20 + i * 2, 20 + i * 2, 20 + i * 2, 255])
wide.push([255, 255, 255, 255])
const wideImg = image(wide)
applyAdjustment(wideImg, 'hdr-toning', {
  method: 'local-adaptation', exposure: 0, gamma: 1, radius: 8, strength: 0.5,
  detail: 30, shadow: 0, highlight: 0, saturation: 0, vibrance: 0,
})
const wideOut = rgb(wideImg)
assert.ok(wideOut.every(p => p[0] <= 255 && p[0] >= 0), 'local adaptation stays inside the display range')
assert.ok(wideOut[0][0] > 20, `local adaptation lifts the dark end (got ${wideOut[0][0]})`)

// ------------------------------------------------------------------ scene-linear HDR

const hdr: PixelImage = {
  width: 2, height: 1, precision: 'float32', dynamicRange: 'scene-linear',
  data: new Float32Array([600, 300, 100, 1, 80, 40, 20, 1]),
}
applyHdrToning(hdr, { ...HDR_TONING_DEFAULTS, method: 'exposure-gamma', exposure: 0, gamma: 1, saturation: 0, vibrance: 0 })
assert.ok(hdr.data[0] <= 255, `an HDR highlight is tone mapped into the display range (got ${hdr.data[0]})`)
assert.ok(hdr.data[0] > 80, `the tone map does not crush the scene (got ${hdr.data[0]})`)

// an SDR buffer is decoded from sRGB and a scene-linear one is not, so
// the same code value means a different colour and a non-linear tone
// curve separates them
const sdr: ImageData = image([[64, 64, 64, 255]])
const sdrLinear: PixelImage = {
  width: 1, height: 1, precision: 'float32', dynamicRange: 'scene-linear',
  data: new Float32Array([64, 64, 64, 1]),
}
const curve = { ...HDR_TONING_DEFAULTS, method: 'exposure-gamma' as const, exposure: 0, gamma: 0.5, saturation: 0, vibrance: 0 }
applyHdrToning(sdr, curve)
applyHdrToning(sdrLinear, curve)
assert.ok(
  Math.abs(sdr.data[0] - sdrLinear.data[0]) >= 4,
  `an SDR buffer is decoded from sRGB and a scene-linear one is not (${sdr.data[0]} vs ${sdrLinear.data[0]})`,
)

// ------------------------------------------------------------------ desaturate

const colour = image([[200, 100, 50, 255], [30, 120, 220, 255]])
applyAdjustment(colour, 'desaturate', { method: 'luminance' })
for (const p of rgb(colour)) {
  assert.ok(Math.abs(p[0] - p[1]) <= 1 && Math.abs(p[1] - p[2]) <= 1, `desaturate produces a neutral grey (got ${p})`)
}

const colour2 = image([[200, 100, 50, 255], [30, 120, 220, 255]])
applyAdjustment(colour2, 'desaturate', { method: 'lightness' })
for (const p of rgb(colour2)) {
  assert.ok(Math.abs(p[0] - p[1]) <= 1 && Math.abs(p[1] - p[2]) <= 1, `lightness desaturate produces a neutral grey (got ${p})`)
}

// the two neutral definitions really differ: a saturated green is far
// brighter by HSL lightness than by luminance
const greenLuma = image([[0, 255, 0, 255]])
const greenLight = image([[0, 255, 0, 255]])
applyAdjustment(greenLuma, 'desaturate', { method: 'luminance' })
applyAdjustment(greenLight, 'desaturate', { method: 'lightness' })
assert.ok(rgb(greenLuma)[0][0] > 215, `luminance keeps a green bright (got ${rgb(greenLuma)[0][0]})`)
assert.ok(Math.abs(rgb(greenLight)[0][0] - 128) <= 1, `HSL lightness keeps a green mid-grey (got ${rgb(greenLight)[0][0]})`)

console.log('HDR Toning: exposure/gamma, local adaptation, scene-linear HDR and Desaturate passed')
