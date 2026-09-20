// Shared color readout math for Eyedropper, Color Sampler and Info panel.
import { rgbToLab } from '../image-ops/color'

export interface ColorReadout {
  hex: string
  rgb: [number, number, number]
  hsl: [number, number, number]
  lab: [number, number, number]
  cmyk: [number, number, number, number]
}

export function hexRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const normalized = s.length === 3 ? s.split('').map(ch => ch + ch).join('') : s.padEnd(6, '0').slice(0, 6)
  const n = Number.parseInt(normalized, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb)
  let h = 0, s = 0
  const l = (max + min) / 2
  const d = max - min
  if (d > 1e-9) {
    s = d / Math.max(1e-9, 1 - Math.abs(2 * l - 1))
    if (max === rr) h = 60 * (((gg - bb) / d) % 6)
    else if (max === gg) h = 60 * (((bb - rr) / d) + 2)
    else h = 60 * (((rr - gg) / d) + 4)
    if (h < 0) h += 360
  }
  return [h, s * 100, l * 100]
}

/** Device-independent-ish display CMYK conversion from sRGB. */
export function rgbCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255
  const k = 1 - Math.max(rr, gg, bb)
  if (k >= .999999) return [0, 0, 0, 100]
  const c = (1 - rr - k) / (1 - k)
  const m = (1 - gg - k) / (1 - k)
  const y = (1 - bb - k) / (1 - k)
  return [c * 100, m * 100, y * 100, k * 100]
}

export function readColor(hex: string): ColorReadout {
  const rgb = hexRgb(hex)
  const hsl = rgbHsl(...rgb)
  const labOut = [0, 0, 0]
  rgbToLab(rgb[0], rgb[1], rgb[2], labOut)
  return {
    hex: hex.toUpperCase(),
    rgb,
    hsl,
    lab: [labOut[0], labOut[1], labOut[2]],
    cmyk: rgbCmyk(...rgb),
  }
}

export function colorReadoutLines(hex: string, mode = 'all'): string[] {
  const v = readColor(hex)
  const [r, g, b] = v.rgb
  const [h, s, l] = v.hsl
  const [ll, aa, bb] = v.lab
  const [c, m, y, k] = v.cmyk
  if (mode === 'hex') return [v.hex]
  if (mode === 'rgb') return [`RGB ${r}, ${g}, ${b}`]
  if (mode === 'hsl') return [`HSL ${Math.round(h)}°, ${Math.round(s)}%, ${Math.round(l)}%`]
  if (mode === 'lab') return [`Lab ${ll.toFixed(1)}, ${aa.toFixed(1)}, ${bb.toFixed(1)}`]
  if (mode === 'cmyk') return [`CMYK ${Math.round(c)}%, ${Math.round(m)}%, ${Math.round(y)}%, ${Math.round(k)}%`]
  return [
    v.hex,
    `RGB ${r}, ${g}, ${b}`,
    `HSL ${Math.round(h)}°, ${Math.round(s)}%, ${Math.round(l)}%`,
    `Lab ${ll.toFixed(1)}, ${aa.toFixed(1)}, ${bb.toFixed(1)}`,
    `CMYK ${Math.round(c)}%, ${Math.round(m)}%, ${Math.round(y)}%, ${Math.round(k)}%`,
  ]
}
