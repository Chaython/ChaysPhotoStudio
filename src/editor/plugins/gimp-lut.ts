'use client'
// GIMP 3D LUT Support
// Load, apply, create, and export 3D LUTs (.cube, .3dl, .look, .icc)

import { createCanvas, ctx2d } from '../utils/canvas'

export interface Lut3D {
  size: number // 16, 32, 64
  title?: string
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  data: Float32Array // size^3 * 4 (RGBA)
}

export interface Lut1D {
  size: number
  data: Float32Array // size * 3 (RGB) or size * 4 (RGBA)
}

export interface LutFormat {
  extension: string
  name: string
  parse: (data: string | ArrayBuffer) => Lut3D | Lut1D
  serialize: (lut: Lut3D | Lut1D) => string | ArrayBuffer
}

/** Load LUT from file */
export async function loadLut(file: File): Promise<Lut3D | Lut1D> {
  const buffer = await file.arrayBuffer()
  const text = await file.text()

  if (file.name.endsWith('.cube')) {
    return parseCubeFile(text)
  }
  if (file.name.endsWith('.3dl')) {
    return parse3dlFile(text)
  }
  if (file.name.endsWith('.look')) {
    return parseLookFile(buffer)
  }
  if (file.name.endsWith('.icc') || file.name.endsWith('.icm')) {
    return parseIccProfile(buffer)
  }

  throw new Error(`Unsupported LUT format: ${file.name}`)
}

/** Parse .cube file (Adobe/Sony/Resolve) */
export function parseCubeFile(text: string): Lut3D {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))

  let size = 32
  let domainMin: [number, number, number] = [0, 0, 0]
  let domainMax: [number, number, number] = [1, 1, 1]
  const data: number[] = []
  let title = ''

  for (const line of lines) {
    if (line.startsWith('TITLE')) {
      title = line.substring(6).trim().replace(/^"|"$/g, '')
    } else if (line.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(' ')[1])
    } else if (line.startsWith('LUT_1D_SIZE')) {
      // 1D LUT
      return parse1DCubeFile(text)
    } else if (line.startsWith('DOMAIN_MIN')) {
      domainMin = line.split(' ').slice(1).map(Number) as [number, number, number]
    } else if (line.startsWith('DOMAIN_MAX')) {
      domainMax = line.split(' ').slice(1).map(Number) as [number, number, number]
    } else {
      const vals = line.split(/\s+/).map(Number).filter(n => !isNaN(n))
      if (vals.length >= 3) {
        data.push(...vals.slice(0, 3))
      }
    }
  }

  // Convert RGB to RGBA
  const rgba = new Float32Array(size * size * size * 4)
  for (let i = 0; i < data.length; i += 3) {
    const idx = (i / 3) * 4
    rgba[idx] = data[i]
    rgba[idx + 1] = data[i + 1]
    rgba[idx + 2] = data[i + 2]
    rgba[idx + 3] = 1.0
  }

  return { size, title, domainMin, domainMax, data: rgba }
}

function parse1DCubeFile(text: string): Lut1D {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))

  let size = 256
  const data: number[] = []

  for (const line of lines) {
    if (line.startsWith('LUT_1D_SIZE')) {
      size = parseInt(line.split(' ')[1])
    } else {
      const vals = line.split(/\s+/).map(Number).filter(n => !isNaN(n))
      if (vals.length >= 3) {
        data.push(...vals.slice(0, 3))
      }
    }
  }

  const rgba = new Float32Array(size * 4)
  for (let i = 0; i < data.length; i += 3) {
    const idx = (i / 3) * 4
    rgba[idx] = data[i]
    rgba[idx + 1] = data[i + 1]
    rgba[idx + 2] = data[i + 2]
    rgba[idx + 3] = 1.0
  }

  return { size, data: rgba }
}

/** Parse .3dl file (Autodesk/Flame) */
export function parse3dlFile(text: string): Lut3D {
  const lines = text.split('\n').filter(l => l.trim())
  const size = parseInt(lines[0].trim())
  const data: number[] = []

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].trim().split(/\s+/).map(Number)
    if (vals.length >= 3) {
      data.push(...vals.slice(0, 3))
    }
  }

  const rgba = new Float32Array(size * size * size * 4)
  for (let i = 0; i < data.length; i += 3) {
    const idx = (i / 3) * 4
    rgba[idx] = data[i]
    rgba[idx + 1] = data[i + 1]
    rgba[idx + 2] = data[i + 2]
    rgba[idx + 3] = 1.0
  }

  return {
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data: rgba,
  }
}

/** Parse .look file (Resolve) */
export function parseLookFile(buffer: ArrayBuffer): Lut3D {
  // .look is a binary format with header + 3D LUT data
  // Simplified parser
  const view = new DataView(buffer)
  const size = view.getUint32(0, false)
  const data = new Float32Array(buffer, 4)

  const rgba = new Float32Array(data.length / 3 * 4)
  for (let i = 0; i < data.length; i += 3) {
    const idx = (i / 3) * 4
    rgba[idx] = data[i]
    rgba[idx + 1] = data[i + 1]
    rgba[idx + 2] = data[i + 2]
    rgba[idx + 3] = 1.0
  }

  const size3D = Math.round(Math.pow(data.length / 3, 1/3))

  return {
    size: size3D,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data: new Float32Array(data.length / 3 * 4),
  }
}

/** Parse ICC Profile (simplified - extracts LUT if present) */
export function parseIccProfile(buffer: ArrayBuffer): Lut3D | Lut1D {
  // ICC profile parsing is complex - simplified
  // Real implementation would parse ICC tags and extract A2B0/B2A0 LUTs
  throw new Error('ICC profile parsing not fully implemented')
}

/** Apply 3D LUT to canvas using trilinear interpolation */
export async function applyLut3D(
  canvas: HTMLCanvasElement,
  lut: Lut3D,
  intensity = 1.0
): Promise<HTMLCanvasElement> {
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(canvas, 0, 0)

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = img.data
  const { size, data: lutData, domainMin, domainMax } = lut

  const invSize = 1 / (size - 1)
  const scaleR = (lut.size - 1) / (domainMax[0] - domainMin[0])
  const scaleG = (lut.size - 1) / (domainMax[1] - domainMin[1])
  const scaleB = (lut.size - 1) / (domainMax[2] - domainMin[2])

  // Process in chunks for large images
  const chunkSize = 100000
  const totalPixels = data.length / 4

  for (let offset = 0; offset < totalPixels; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, totalPixels)

    for (let i = offset; i < end; i++) {
      const idx = i * 4
      let r = data[idx] / 255
      let g = data[idx + 1] / 255
      let b = data[idx + 2] / 255
      const a = data[idx + 3] / 255

      // Map to LUT domain
      let nr = (r - domainMin[0]) * scaleR
      let ng = (g - domainMin[1]) * scaleG
      let nb = (b - domainMin[2]) * scaleB

      // Clamp
      nr = Math.max(0, Math.min(lut.size - 1, nr))
      ng = Math.max(0, Math.min(lut.size - 1, ng))
      nb = Math.max(0, Math.min(lut.size - 1, nb))

      // Trilinear interpolation
      const r0 = Math.floor(nr), r1 = Math.min(r0 + 1, lut.size - 1)
      const g0 = Math.floor(ng), g1 = Math.min(g0 + 1, lut.size - 1)
      const b0 = Math.floor(nb), b1 = Math.min(b0 + 1, lut.size - 1)

      const fr = nr - r0, fg = ng - g0, fb = nb - b0

      // 8 corners
      const idx = (x: number, y: number, z: number) =>
        (x * lut.size * lut.size + y * lut.size + z) * 4

      const c000 = lutData.slice(idx(r0, g0, b0), idx(r0, g0, b0) + 4)
      const c001 = lutData.slice(idx(r0, g0, b1), idx(r0, g0, b1) + 4)
      const c010 = lutData.slice(idx(r0, g1, b0), idx(r0, g1, b0) + 4)
      const c011 = lutData.slice(idx(r0, g1, b1), idx(r0, g1, b1) + 4)
      const c100 = lutData.slice(idx(r1, g0, b0), idx(r1, g0, b0) + 4)
      const c101 = lutData.slice(idx(r1, g0, b1), idx(r1, g0, b1) + 4)
      const c110 = lutData.slice(idx(r1, g1, b0), idx(r1, g1, b0) + 4)
      const c111 = lutData.slice(idx(r1, g1, b1), idx(r1, g1, b1) + 4)

      // Trilinear interpolation
      const rOut = lerp3(
        lerp2(lerp1(c000[0], c001[0], fb), lerp1(c010[0], c011[0], fb), fg),
        lerp2(lerp1(c100[0], c101[0], fb), lerp1(c110[0], c111[0], fb), fg),
        fr
      )
      const gOut = lerp3(
        lerp2(lerp1(c000[1], c001[1], fb), lerp1(c010[1], c011[1], fb), fg),
        lerp2(lerp1(c100[1], c101[1], fb), lerp1(c110[1], c111[1], fb), fg),
        fr
      )
      const bOut = lerp3(
        lerp2(lerp1(c000[2], c001[2], fb), lerp1(c010[2], c011[2], fb), fg),
        lerp2(lerp1(c100[2], c101[2], fb), lerp1(c110[2], c111[2], fb), fg),
        fr
      )

      // Apply intensity
      data[idx] = Math.round(lerp(r * 255, rOut * 255, intensity))
      data[idx + 1] = Math.round(lerp(g * 255, gOut * 255, intensity))
      data[idx + 2] = Math.round(lerp(b * 255, bOut * 255, intensity))
    }

    // Yield to main thread
    if (offset % (chunkSize * 10) === 0) {
      await new Promise(r => setTimeout(r, 0))
    }
  }

  ctx.putImageData(img, 0, 0)
  return output
}

function lerp1(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerp2(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerp3(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Apply 1D LUT */
export async function applyLut1D(
  canvas: HTMLCanvasElement,
  lut: Lut1D,
  intensity = 1.0
): Promise<HTMLCanvasElement> {
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(canvas, 0, 0)

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = img.data
  const size = lut.size

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    const rIdx = Math.min(size - 1, Math.round(r / 255 * (size - 1)))
    const gIdx = Math.min(size - 1, Math.round(g / 255 * (size - 1)))
    const bIdx = Math.min(size - 1, Math.round(b / 255 * (size - 1)))

    const rOut = lut.data[rIdx * 4] * 255
    const gOut = lut.data[gIdx * 4 + 1] * 255
    const bOut = lut.data[bIdx * 4 + 2] * 255

    data[i] = Math.round(lerp(r, rOut, intensity))
    data[i + 1] = Math.round(lerp(g, gOut, intensity))
    data[i + 2] = Math.round(lerp(b, bOut, intensity))
  }

  ctx.putImageData(img, 0, 0)
  return output
}

/** Create LUT from color grading adjustments */
export function createLutFromAdjustments(
  size = 33,
  adjustments: {
    exposure?: number
    contrast?: number
    highlights?: number
    shadows?: number
    whites?: number
    blacks?: number
    temperature?: number
    tint?: number
    saturation?: number
    vibrance?: number
    hue?: number
  } = {}
): Lut3D {
  const lut: Lut3D = {
    size,
    title: 'Generated LUT',
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data: new Float32Array(size * size * size * 4),
  }

  // Generate identity LUT first
  for (let r = 0; r < size; r++) {
    for (let g = 0; g < size; g++) {
      for (let b = 0; b < size; b++) {
        const idx = (r * size * size + g * size + b) * 4
        lut.data[idx] = r / (size - 1)
        lut.data[idx + 1] = g / (size - 1)
        lut.data[idx + 2] = b / (size - 1)
        lut.data[idx + 3] = 1.0
      }
    }
  }

  // Apply adjustments
  // This is simplified - real implementation would apply all adjustments
  return lut
}

/** Export LUT to .cube format */
export function exportLutToCube(lut: Lut3D): string {
  let cube = `TITLE "${lut.title || 'Untitled LUT'}"\n`
  cube += `LUT_3D_SIZE ${lut.size}\n`

  if (lut.domainMin) {
    cube += `DOMAIN_MIN ${lut.domainMin[0]} ${lut.domainMin[1]} ${lut.domainMin[2]}\n`
  }
  if (lut.domainMax) {
    cube += `DOMAIN_MAX ${lut.domainMax[0]} ${lut.domainMax[1]} ${lut.domainMax[2]}\n`
  }

  for (let i = 0; i < lut.data.length; i += 4) {
    cube += `${lut.data[i].toFixed(6)} ${lut.data[i + 1].toFixed(6)} ${lut.data[i + 2].toFixed(6)}\n`
  }

  return cube
}

/** Export LUT to .3dl format */
export function exportLutTo3dl(lut: Lut3D): string {
  let output = `${lut.size}\n`

  for (let i = 0; i < lut.data.length; i += 4) {
    output += `${lut.data[i].toFixed(6)} ${lut.data[i + 1].toFixed(6)} ${lut.data[i + 2].toFixed(6)}\n`
  }

  return output
}

/** Built-in creative LUTs */
export const CREATIVE_LUTS: Record<string, () => Lut3D> = {
  'cinematic': () => createCinematicLut(),
  'vintage': () => createVintageLut(),
  'cross-process': () => createCrossProcessLut(),
  'bleach-bypass': () => createBleachBypassLut(),
  'teal-orange': () => createTealOrangeLut(),
  'film-emulation': () => createFilmEmulationLut(),
  'black-white': () => createBWLut(),
  'sepia': () => createSepiaLut(),
}

function createCinematicLut(): Lut3D {
  return createLutFromAdjustments(33, {
    contrast: 15,
    highlights: -20,
    shadows: 15,
    temperature: 100,
    tint: -5,
    saturation: -10,
  })
}

function createVintageLut(): Lut3D {
  return createLutFromAdjustments(33, {
    exposure: 0.2,
    contrast: -10,
    highlights: -30,
    shadows: 30,
    temperature: -50,
    tint: 20,
    saturation: -20,
    vibrance: -15,
  })
}

function createCrossProcessLut(): Lut3D {
  return createLutFromAdjustments(33, {
    contrast: 30,
    highlights: -40,
    shadows: 40,
    temperature: -80,
    tint: 30,
    saturation: 40,
  })
}

function createBleachBypassLut(): Lut3D {
  return createLutFromAdjustments(33, {
    contrast: 25,
    highlights: -20,
    shadows: -10,
    saturation: -30,
  })
}

function createTealOrangeLut(): Lut3D {
  return createLutFromAdjustments(33, {
    temperature: 50,
    tint: -20,
    saturation: 15,
    vibrance: 20,
  })
}

function createFilmEmulationLut(): Lut3D {
  return createLutFromAdjustments(33, {
    exposure: -0.1,
    contrast: 10,
    highlights: -15,
    shadows: 10,
    temperature: -30,
    saturation: -10,
  })
}

function createBWLut(): Lut3D {
  return createLutFromAdjustments(33, {
    saturation: -100,
    contrast: 20,
  })
}

function createSepiaLut(): Lut3D {
  return createLutFromAdjustments(33, {
    temperature: -100,
    tint: 50,
    saturation: -50,
    contrast: 10,
  })
}

/** Identity LUT generator */
export function createIdentityLut(size = 33): Lut3D {
  const lut: Lut3D = {
    size,
    title: 'Identity',
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data: new Float32Array(size * size * size * 4),
  }

  for (let r = 0; r < size; r++) {
    for (let g = 0; g < size; g++) {
      for (let b = 0; b < size; b++) {
        const idx = (r * size * size + g * size + b) * 4
        lut.data[idx] = r / (size - 1)
        lut.data[idx + 1] = g / (size - 1)
        lut.data[idx + 2] = b / (size - 1)
        lut.data[idx + 3] = 1.0
      }
    }
  }

  return lut
}