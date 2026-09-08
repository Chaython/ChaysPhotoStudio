// Built-in sample plugins — plain JS source strings executed in the sandbox
// worker. They demonstrate the full zphoto API surface: pixel transfer in/out,
// direct pixel math, image-ops calls and toasts. Install via the Plugin Manager.
import type { StoredPlugin } from './plugin-types'

const GOLDEN_HOUR = String.raw`
zphoto.registerCommand('apply', 'Apply Golden Hour', async () => {
  const info = await zphoto.document.info()
  const px = await zphoto.layer.getPixels()
  const d = new Uint8ClampedArray(px.rgba)
  const w = px.width, h = px.height
  const cx = w / 2, cy = h / 2
  const maxR = Math.hypot(cx, cy)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (d[i + 3] === 0) continue
      // warm lift: push red up, pull blue slightly, add golden midtone glow
      const r = d[i], g = d[i + 1], b = d[i + 2]
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      const warm = (255 - lum) * 0.12
      d[i] = r + warm + 8
      d[i + 1] = g + warm * 0.45
      d[i + 2] = b - warm * 0.55
      // soft vignette
      const vr = Math.hypot(x - cx, y - cy) / maxR
      const vig = 1 - Math.max(0, vr - 0.55) * 0.55
      d[i] *= vig; d[i + 1] *= vig; d[i + 2] *= vig
    }
  }
  await zphoto.layer.setPixels(d.buffer, w, h)
  await zphoto.toast('Golden Hour applied to ' + info.name, 'success')
})
`

const AUTO_VIGNETTE = String.raw`
zphoto.registerCommand('apply', 'Apply Auto Vignette', async () => {
  const px = await zphoto.layer.getPixels()
  const d = new Uint8ClampedArray(px.rgba)
  const w = px.width, h = px.height
  // mean luminance of opaque pixels → adapt strength
  let sum = 0, n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    n++
  }
  const mean = n ? sum / n : 128
  const strength = mean > 140 ? 0.55 : 0.35 // bright images can take a stronger vignette
  const cx = w / 2, cy = h / 2
  const maxR = Math.hypot(cx, cy)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (d[i + 3] === 0) continue
      const vr = Math.hypot(x - cx, y - cy) / maxR
      const f = 1 - strength * Math.max(0, (vr - 0.45) / 0.55) ** 1.6
      d[i] *= f; d[i + 1] *= f; d[i + 2] *= f
    }
  }
  await zphoto.layer.setPixels(d.buffer, w, h)
  await zphoto.toast('Auto Vignette (mean luma ' + Math.round(mean) + ')', 'success')
})
`

const DUOTONE_PRINT = String.raw`
zphoto.registerCommand('apply', 'Apply Duotone Print', async () => {
  const px = await zphoto.layer.getPixels()
  const d = new Uint8ClampedArray(px.rgba)
  // shadow ink / highlight paper
  const sr = 26, sg = 42, sb = 74
  const hr = 242, hg = 230, hb = 201
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
    // smoothstep ramp for a classic duotone feel
    const t = lum * lum * (3 - 2 * lum)
    d[i] = sr + (hr - sr) * t
    d[i + 1] = sg + (hg - sg) * t
    d[i + 2] = sb + (hb - sb) * t
  }
  await zphoto.layer.setPixels(d.buffer, px.width, px.height)
  await zphoto.toast('Duotone Print applied', 'success')
})
`

export const SAMPLE_PLUGINS: StoredPlugin[] = [
  {
    manifest: { id: 'sample-golden-hour', name: 'Golden Hour', version: '1.0.0', description: 'Warm cinematic grade with golden midtones and a soft vignette.', apiVersion: 1 },
    code: GOLDEN_HOUR, enabled: true, commands: [{ id: 'apply', label: 'Apply Golden Hour' }],
  },
  {
    manifest: { id: 'sample-auto-vignette', name: 'Auto Vignette', version: '1.0.0', description: 'Luminance-aware edge darkening — stronger on bright images.', apiVersion: 1 },
    code: AUTO_VIGNETTE, enabled: true, commands: [{ id: 'apply', label: 'Apply Auto Vignette' }],
  },
  {
    manifest: { id: 'sample-duotone', name: 'Duotone Print', version: '1.0.0', description: 'Maps luminance to an indigo/cream duotone ramp.', apiVersion: 1 },
    code: DUOTONE_PRINT, enabled: true, commands: [{ id: 'apply', label: 'Apply Duotone Print' }],
  },
]
