// ============================================================
// Chay's Photo Studio — PSD / PSB read + write (TASK 9-a)
// Reader: 8BPS header (v1 PSD + v2 PSB), merged composite from
// the Image Data section (raw / RLE / ZIP), Layer & Mask Info
// parsed into per-layer canvases (rect, channel ids incl. -1
// alpha / -2 user mask, blend key, opacity, visible, name
// (Pascal + 'luni' unicode), preserving 8-bit and 16-bit samples.
// Writer: RGB 8/16-bit, per-row RLE layers + composite — byte
// layout follows the Adobe spec (lengths BEFORE sections,
// 4-byte alignment, channel data length tables) so real
// Photoshop opens the files.
// ============================================================

import { createCanvas, ctx2d, getImageData, getFloat16ImageData, putFloat16Pixels, hdrFloat32ToPreviewCanvas } from '../utils/canvas'
import type { BlendMode, LayerFX } from '../types'

// ---------- blend mode mapping ----------
const PSD_TO_APP: Record<string, BlendMode> = {
  norm: 'normal', diss: 'normal', pass: 'normal', brst: 'normal',
  dark: 'darken', mul: 'multiply', mult: 'multiply',
  lite: 'lighten', scrn: 'screen', screen: 'screen',
  over: 'overlay', hard: 'hard-light', soft: 'soft-light',
  diff: 'difference', smud: 'difference', xclu: 'difference',
  hue: 'hue', sat: 'saturation', colr: 'color', lum: 'luminosity',
  div: 'color-dodge', idiv: 'color-burn', dded: 'linear-dodge',
  lbrn: 'normal', lbrg: 'normal', vlig: 'hard-light', llig: 'linear-dodge', plig: 'hard-light',
}
const APP_TO_PSD: Record<BlendMode, string> = {
  normal: 'norm', multiply: 'mul ', screen: 'scrn', overlay: 'over',
  darken: 'dark', lighten: 'lite', 'color-dodge': 'div ', 'color-burn': 'idiv',
  'linear-dodge': 'dded', 'hard-light': 'hard', 'soft-light': 'soft',
  difference: 'diff', exclusion: 'diff', hue: 'hue ', saturation: 'sat ',
  color: 'colr', luminosity: 'lum ',
}

export function psdBlendKeyToMode(key: string): BlendMode {
  const trimmed = key.replace(/\s+$/, '')
  return PSD_TO_APP[trimmed] ?? 'normal'
}

export function blendModeToPsdKey(mode: string): string {
  return APP_TO_PSD[mode as BlendMode] ?? 'norm'
}


function clampFx(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))
}

function fxBlockKey(block: Uint8Array): string {
  if (block.length < 8) return ''
  return String.fromCharCode(block[4], block[5], block[6], block[7])
}

function fixed16ToNumber(raw: number, signed = false): number {
  const v = signed && raw > 0x7fffffff ? raw - 0x100000000 : raw
  return v / 65536
}

function numberToFixed16(value: number, signed = false): number {
  const v = Math.round(value * 65536)
  return signed ? v | 0 : Math.max(0, Math.min(0xffffffff, v)) >>> 0
}

function psdColorToHex(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 10 > bytes.length) return '#000000'
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const space = dv.getUint16(offset)
  const a = dv.getUint16(offset + 2)
  const b = dv.getUint16(offset + 4)
  const cc = dv.getUint16(offset + 6)
  const d = dv.getUint16(offset + 8)
  let r = 0, g = 0, bl = 0
  if (space === 0) {
    r = a / 257; g = b / 257; bl = cc / 257
  } else if (space === 8) {
    r = g = bl = clampFx(a / 10000 * 255, 0, 255)
  } else if (space === 2) {
    // Legacy PSD stores CMYK components inverted (0xffff = 0% ink).
    const cyan = 1 - a / 65535
    const magenta = 1 - b / 65535
    const yellow = 1 - cc / 65535
    const black = 1 - d / 65535
    r = 255 * (1 - cyan) * (1 - black)
    g = 255 * (1 - magenta) * (1 - black)
    bl = 255 * (1 - yellow) * (1 - black)
  }
  const hex = (n: number) => Math.round(clampFx(n, 0, 255)).toString(16).padStart(2, '0')
  return '#' + hex(r) + hex(g) + hex(bl)
}

function hexToPsdRgbColor(hex: string): Uint8Array {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  const value = m?.[1] ?? '000000'
  const out = new Uint8Array(10)
  const dv = new DataView(out.buffer)
  dv.setUint16(0, 0) // RGB
  dv.setUint16(2, parseInt(value.slice(0, 2), 16) * 257)
  dv.setUint16(4, parseInt(value.slice(2, 4), 16) * 257)
  dv.setUint16(6, parseInt(value.slice(4, 6), 16) * 257)
  dv.setUint16(8, 0)
  return out
}

function readAscii4(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.length) return ''
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

function opacityByteToPercent(v: number): number {
  return Math.round(clampFx(v, 0, 255) * 10000 / 255) / 100
}

function percentToOpacityByte(v: number): number {
  return Math.round(clampFx(v, 0, 100) * 255 / 100)
}

function parseChaysLayerFxBlock(block: Uint8Array): LayerFX | null {
  if (fxBlockKey(block) !== 'chFX' || block.length < 12) return null
  try {
    const len = new DataView(block.buffer, block.byteOffset, block.byteLength).getUint32(8)
    const end = Math.min(block.length, 12 + len)
    const json = new TextDecoder().decode(block.subarray(12, end))
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed as LayerFX : null
  } catch {
    return null
  }
}

function parseLegacyLayerFxBlock(block: Uint8Array): LayerFX | null {
  if (fxBlockKey(block) !== 'lrFX' || block.length < 16) return null
  const dv = new DataView(block.buffer, block.byteOffset, block.byteLength)
  const payloadLen = Math.min(dv.getUint32(8), block.length - 12)
  const end = 12 + payloadLen
  let p = 12
  if (p + 4 > end) return null
  const version = dv.getUint16(p); p += 2
  const count = dv.getUint16(p); p += 2
  if (version !== 0 || count > 64) return null

  const fx: LayerFX = {}
  let recognized = 0
  for (let i = 0; i < count && p + 12 <= end; i++) {
    if (readAscii4(block, p) !== '8BIM') break
    const key = readAscii4(block, p + 4)
    const size = dv.getUint32(p + 8)
    const data = p + 12
    const next = data + size
    if (size > end - data || next > end) break

    try {
      if ((key === 'dsdw' || key === 'isdw') && size >= 41) {
        const effectVersion = dv.getUint32(data)
        const colorOffset = effectVersion >= 2 && size >= 51 ? data + 41 : data + 20
        const effect = {
          enabled: block[data + 38] !== 0,
          color: psdColorToHex(block, colorOffset),
          opacity: opacityByteToPercent(block[data + 40]),
          angle: fixed16ToNumber(dv.getUint32(data + 12), true),
          distance: fixed16ToNumber(dv.getUint32(data + 16)),
          blur: fixed16ToNumber(dv.getUint32(data + 4)),
          blendMode: psdBlendKeyToMode(readAscii4(block, data + 34)),
          spread: 0,
          noise: 0,
        }
        if (key === 'dsdw') fx.dropShadow = effect
        else fx.innerShadow = effect
        recognized++
      } else if (key === 'oglw' && size >= 32) {
        const effectVersion = dv.getUint32(data)
        const colorOffset = effectVersion >= 2 && size >= 42 ? data + 32 : data + 12
        fx.outerGlow = {
          enabled: block[data + 30] !== 0,
          color: psdColorToHex(block, colorOffset),
          opacity: opacityByteToPercent(block[data + 31]),
          blur: fixed16ToNumber(dv.getUint32(data + 4)),
          blendMode: psdBlendKeyToMode(readAscii4(block, data + 26)),
          spread: 0,
          noise: 0,
        }
        recognized++
      } else if (key === 'iglw' && size >= 32) {
        const effectVersion = dv.getUint32(data)
        const colorOffset = effectVersion >= 2 && size >= 43 ? data + 33 : data + 12
        fx.innerGlow = {
          enabled: block[data + 30] !== 0,
          color: psdColorToHex(block, colorOffset),
          opacity: opacityByteToPercent(block[data + 31]),
          blur: fixed16ToNumber(dv.getUint32(data + 4)),
          blendMode: psdBlendKeyToMode(readAscii4(block, data + 26)),
          source: effectVersion >= 2 && block[data + 32] !== 0 ? 'center' : 'edge',
          choke: 0,
          noise: 0,
        }
        recognized++
      } else if (key === 'bevl' && size >= 58) {
        const effectVersion = dv.getUint32(data)
        const highColor = effectVersion >= 2 && size >= 78 ? data + 58 : data + 32
        const shadowColor = effectVersion >= 2 && size >= 78 ? data + 68 : data + 42
        const styleByte = block[data + 52]
        fx.bevelEmboss = {
          enabled: block[data + 55] !== 0,
          style: styleByte === 0 ? 'outer-bevel' : styleByte === 1 ? 'inner-bevel' : 'emboss',
          technique: 'smooth',
          depth: 100,
          direction: block[data + 57] === 0 ? 'up' : 'down',
          size: Math.max(0, fixed16ToNumber(dv.getUint32(data + 8))),
          soften: Math.max(0, fixed16ToNumber(dv.getUint32(data + 12))),
          angle: fixed16ToNumber(dv.getUint32(data + 4), true),
          altitude: 30,
          highlightColor: psdColorToHex(block, highColor),
          highlightOpacity: opacityByteToPercent(block[data + 53]),
          shadowColor: psdColorToHex(block, shadowColor),
          shadowOpacity: opacityByteToPercent(block[data + 54]),
          highlightBlendMode: psdBlendKeyToMode(readAscii4(block, data + 20)),
          shadowBlendMode: psdBlendKeyToMode(readAscii4(block, data + 28)),
        }
        recognized++
      } else if (key === 'sofi' && size >= 34) {
        const effectVersion = dv.getUint32(data)
        if (effectVersion >= 2) {
          fx.colorOverlay = {
            enabled: block[data + 23] !== 0,
            color: psdColorToHex(block, data + 24),
            opacity: opacityByteToPercent(block[data + 22]),
            blendMode: psdBlendKeyToMode(readAscii4(block, data + 8)),
          }
          recognized++
        }
      }
    } catch {
      // Preserve malformed/unsupported blocks through the opaque path.
    }
    p = next
  }
  return recognized ? fx : null
}

function additionalInfoBlock(key: string, data: Uint8Array): Uint8Array {
  const padded = data.length + (data.length & 1)
  const out = new Uint8Array(12 + padded)
  out.set(asciiBytes('8BIM'), 0)
  out.set(asciiBytes(key.slice(0, 4).padEnd(4, ' ')), 4)
  new DataView(out.buffer).setUint32(8, data.length)
  out.set(data, 12)
  return out
}

function chaysLayerFxBlock(fx: LayerFX): Uint8Array {
  return additionalInfoBlock('chFX', new TextEncoder().encode(JSON.stringify(fx)))
}

function fxU32(value: number, signed = false): Uint8Array {
  const out = new Uint8Array(4)
  const dv = new DataView(out.buffer)
  if (signed) dv.setInt32(0, numberToFixed16(value, true))
  else dv.setUint32(0, numberToFixed16(value))
  return out
}

function fxEffectRecord(key: string, payload: Uint8Array): Uint8Array {
  return concatUint8([asciiBytes('8BIM'), asciiBytes(key), u32(payload.length), payload])
}

function legacyShadowRecord(key: 'dsdw' | 'isdw', effect: NonNullable<LayerFX['dropShadow']>): Uint8Array {
  const payload = concatUint8([
    u32(2),
    fxU32(effect.blur),
    fxU32(0), // legacy Intensity is a contour parameter, not Spread
    fxU32(effect.angle, true),
    fxU32(effect.distance),
    hexToPsdRgbColor(effect.color),
    asciiBytes('8BIM'),
    asciiBytes(blendModeToPsdKey(effect.blendMode ?? 'multiply')),
    new Uint8Array([effect.enabled ? 1 : 0, 0, percentToOpacityByte(effect.opacity)]),
    hexToPsdRgbColor(effect.color),
  ])
  return fxEffectRecord(key, payload)
}

function legacyGlowRecord(key: 'oglw' | 'iglw', effect: NonNullable<LayerFX['outerGlow']>): Uint8Array {
  const inner = key === 'iglw'
  const payload = concatUint8([
    u32(2),
    fxU32(effect.blur),
    fxU32(0), // legacy Intensity is not Spread/Choke
    hexToPsdRgbColor(effect.color),
    asciiBytes('8BIM'),
    asciiBytes(blendModeToPsdKey(effect.blendMode ?? 'screen')),
    new Uint8Array([effect.enabled ? 1 : 0, percentToOpacityByte(effect.opacity)]),
    ...(inner ? [new Uint8Array([(effect as NonNullable<LayerFX['innerGlow']>).source === 'center' ? 1 : 0])] : []),
    hexToPsdRgbColor(effect.color),
  ])
  return fxEffectRecord(key, payload)
}

function legacyBevelRecord(effect: NonNullable<LayerFX['bevelEmboss']>): Uint8Array {
  const style = effect.style === 'outer-bevel' ? 0 : effect.style === 'inner-bevel' ? 1 : 2
  // The legacy block has one "depth/size" slot and no separate soften/altitude.
  const size = Math.max(0, effect.size)
  const payload = concatUint8([
    u32(2),
    fxU32(effect.angle, true),
    fxU32(size),
    fxU32(effect.soften),
    asciiBytes('8BIM'),
    asciiBytes(blendModeToPsdKey(effect.highlightBlendMode ?? 'screen')),
    asciiBytes('8BIM'),
    asciiBytes(blendModeToPsdKey(effect.shadowBlendMode ?? 'multiply')),
    hexToPsdRgbColor(effect.highlightColor),
    hexToPsdRgbColor(effect.shadowColor),
    new Uint8Array([
      style,
      percentToOpacityByte(effect.highlightOpacity),
      percentToOpacityByte(effect.shadowOpacity),
      effect.enabled ? 1 : 0,
      0,
      effect.direction === 'up' ? 0 : 1,
    ]),
    hexToPsdRgbColor(effect.highlightColor),
    hexToPsdRgbColor(effect.shadowColor),
  ])
  return fxEffectRecord('bevl', payload)
}

function legacyColorOverlayRecord(effect: NonNullable<LayerFX['colorOverlay']>): Uint8Array {
  const payload = concatUint8([
    u32(2),
    asciiBytes('8BIM'),
    asciiBytes(blendModeToPsdKey(effect.blendMode ?? 'normal')),
    hexToPsdRgbColor(effect.color),
    new Uint8Array([percentToOpacityByte(effect.opacity), effect.enabled ? 1 : 0]),
    hexToPsdRgbColor(effect.color),
  ])
  return fxEffectRecord('sofi', payload)
}

function legacyLayerFxBlock(fx: LayerFX): Uint8Array | null {
  const records: Uint8Array[] = []
  const supported = [
    fx.dropShadow, fx.innerShadow, fx.outerGlow, fx.innerGlow, fx.bevelEmboss, fx.colorOverlay,
  ].some(Boolean)
  if (!supported) return null

  const common = fxEffectRecord('cmnS', concatUint8([u32(0), new Uint8Array([1, 0, 0])]))
  records.push(common)
  if (fx.dropShadow) records.push(legacyShadowRecord('dsdw', fx.dropShadow))
  if (fx.innerShadow) records.push(legacyShadowRecord('isdw', fx.innerShadow))
  if (fx.outerGlow) records.push(legacyGlowRecord('oglw', fx.outerGlow))
  if (fx.innerGlow) records.push(legacyGlowRecord('iglw', fx.innerGlow))
  if (fx.bevelEmboss) records.push(legacyBevelRecord(fx.bevelEmboss))
  if (fx.colorOverlay) records.push(legacyColorOverlayRecord(fx.colorOverlay))

  const data = concatUint8([u16(0), u16(records.length), ...records])
  return additionalInfoBlock('lrFX', data)
}

// ============================================================
// reading
// ============================================================

export interface PsdLayer {
  name: string
  canvas: HTMLCanvasElement     // pixels of the layer rect (RGBA)
  left: number
  top: number
  width: number
  height: number
  opacity: number               // 0..100
  blendKey: string              // raw 4-char PSD key
  blendMode: string             // app blend mode id
  visible: boolean
  clipped: boolean
  mask: HTMLCanvasElement | null // full-document-size canvas, mask value in alpha
  /** Raw 32-bit/channel scene-linear pixels, never reduced to a canvas preview. */
  hdrPixels?: Float32Array
  /** Editable layer styles decoded from Chay's native style block or
   * Photoshop's legacy lrFX block when available. */
  fx: LayerFX | null
  /** Opaque additional-layer-information blocks retained byte-for-byte.
   * Known blocks that we regenerate ('luni', parsed 'lrFX', 'chFX') are excluded. */
  additionalInfo: Uint8Array[]
  /** Original Photoshop Blend If / blending-ranges bytes. */
  blendingRanges: Uint8Array
}

export interface PsdSectionMarker {
  /** A Photoshop-only non-rendering structure, not an editable native layer. */
  kind: 'group' | 'adjustment'
  /** Position among raster layers in the original Photoshop record sequence. */
  beforeLayerIndex: number
  name: string
  opacity: number
  visible: boolean
  blendKey: string
  /** Original opaque Photoshop lsct/lsdk and other layer-info records. */
  additionalInfo: Uint8Array[]
  blendingRanges: Uint8Array
}

export interface PsdDecoded {
  canvas: HTMLCanvasElement      // merged composite
  width: number
  height: number
  /** Original PSD/PSB component depth. 16-bit files are retained in
   * float16 canvases when the runtime supports them. */
  depth: 8 | 16 | 32
  /** Raw merged 32-bit/channel scene-linear pixels when present. */
  hdrPixels?: Float32Array
  hasAlpha: boolean
  layers: PsdLayer[]             // storage order
  /** Photoshop folder and opaque zero-channel adjustment records retained separately. */
  sectionMarkers: PsdSectionMarker[]
  /** ResolutionInfo image-resource metadata, pixels per inch. */
  resolutionPpi: number
  /** Opaque non-resolution image-resource blocks retained byte-for-byte. */
  imageResources: Uint8Array[]
  /** Original Photoshop color-mode section payload (especially 32-bit hdrt). */
  colorModeData: Uint8Array
  /** Unsupported Photoshop objects retained as opaque blocks only. */
  warnings: string[]
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  // (data is a view over a possibly-larger buffer — cast for BlobPart strictness)
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

interface PsdChannelInfo { id: number; len: number }

interface PsdLayerRecord {
  top: number
  left: number
  bottom: number
  right: number
  channels: PsdChannelInfo[]
  blendKey: string
  opacity: number
  visible: boolean
  clipped: boolean
  name: string
  maskRect: [number, number, number, number] | null // top, left, bottom, right
  fx: LayerFX | null
  additionalInfo: Uint8Array[]
  blendingRanges: Uint8Array
}

type PsdPlane = Uint8Array | Uint16Array | Float32Array

function emptyPsdPlane(depth: number, n: number): PsdPlane {
  return depth === 32 ? new Float32Array(n) : depth === 16 ? new Uint16Array(n) : new Uint8Array(n)
}

function psdPlaneFromBytes(raw: Uint8Array, depth: number, n: number): PsdPlane {
  if (depth === 8) {
    const out = new Uint8Array(n)
    out.set(raw.subarray(0, n))
    return out
  }
  if (depth === 32) {
    const out = new Float32Array(n)
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    for (let i = 0; i < Math.min(n, raw.length >>> 2); i++) out[i] = view.getFloat32(i * 4, false)
    return out
  }
  const out = new Uint16Array(n)
  const count = Math.min(n, raw.length >> 1)
  for (let i = 0, p = 0; i < count; i++, p += 2) out[i] = (raw[p] << 8) | raw[p + 1]
  return out
}

/** Reverse Photoshop's ZIP-with-prediction transform on one planar channel.
 * 8/16-bit delta prediction runs on samples; 32-bit floats are byte-shuffled,
 * delta-predicted as bytes, then unshuffled by component. */
export function restorePsdPrediction(encoded: Uint8Array, width: number, height: number, depth: number): Uint8Array {
  const bytesPerSample = depth >>> 3
  if (![8, 16, 32].includes(depth) || encoded.length !== width * height * bytesPerSample) {
    throw new Error('Invalid PSD predicted ZIP channel length or bit depth')
  }
  const raw = new Uint8Array(encoded)
  const rowBytes = width * bytesPerSample
  if (depth === 16) {
    const view = new DataView(raw.buffer)
    for (let y = 0; y < height; y++) {
      const offset = y * rowBytes
      for (let x = 1; x < width; x++) {
        const at = offset + x * 2
        view.setUint16(at, (view.getUint16(at) + view.getUint16(at - 2)) & 0xffff, false)
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      const offset = y * rowBytes
      for (let i = 1; i < rowBytes; i++) raw[offset + i] = (raw[offset + i] + raw[offset + i - 1]) & 255
    }
    if (depth === 32) {
      const restored = new Uint8Array(raw.length)
      for (let y = 0; y < height; y++) {
        const offset = y * rowBytes
        for (let x = 0; x < width; x++) for (let component = 0; component < 4; component++) {
          restored[offset + x * 4 + component] = raw[offset + component * width + x]
        }
      }
      return restored
    }
  }
  return raw
}

/** Decode one channel (raw / RLE / ZIP) without reducing 16/32-bit samples. */
async function decodePsdChannel(
  bytes: Uint8Array, view: DataView, pos: number, compr: number,
  w: number, h: number, depth: number, dataLen: number, rowLenBytes: 2 | 4 = 2,
): Promise<PsdPlane> {
  const bpc = depth >> 3
  const rowBytes = w * bpc
  const n = w * h
  if (w <= 0 || h <= 0) return emptyPsdPlane(depth, n)
  if (compr === 0) {
    if (rowBytes * h > Math.min(dataLen, bytes.length - pos)) throw new Error('Truncated raw PSD channel')
    const raw = bytes.subarray(pos, pos + rowBytes * h)
    return psdPlaneFromBytes(raw, depth, n)
  }
  if (compr === 1) {
    if (pos + rowLenBytes * h > bytes.length) throw new Error('Truncated PSD RLE row-length table')
    // Photoshop stores the entire table of compressed row lengths FIRST,
    // followed by all encoded rows. The former interleaved parser consumed
    // row-length bytes as pixel data and corrupted even simple PSD imports.
    const tableEnd = pos + rowLenBytes * h
    if (tableEnd > bytes.length || tableEnd > pos + dataLen) throw new Error('Truncated PSD RLE row table')
    const lengths: number[] = []
    for (let y = 0, p = pos; y < h; y++, p += rowLenBytes) {
      lengths.push(rowLenBytes === 4 ? view.getUint32(p) : view.getUint16(p))
    }
    const raw = new Uint8Array(rowBytes * h)
    const channelEnd = Math.min(bytes.length, pos + dataLen)
    let p = tableEnd
    for (let y = 0; y < h; y++) {
      const rowLen = lengths[y]
      if (rowLen > channelEnd - p) throw new Error('Truncated PSD RLE row')
      decodePackBitsRow(bytes, p, p + rowLen, raw, y * rowBytes, rowBytes)
      p += rowLen
    }
    return psdPlaneFromBytes(raw, depth, n)
  }
  if (compr === 2 || compr === 3) {
    const data = await inflateZlib(bytes.subarray(pos, pos + Math.max(0, dataLen)))
    if (data.length !== rowBytes * h) throw new Error('Invalid Photoshop ZIP channel size')
    return psdPlaneFromBytes(compr === 3 ? restorePsdPrediction(data, w, h, depth) : data, depth, n)
  }
  throw new Error(`Unsupported PSD channel compression ${compr}`)
}

export function decodePackBitsRow(src: Uint8Array, start: number, end: number, out: Uint8Array, outOff: number, outLen: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > src.length ||
      start > end || outOff < 0 || outLen < 0 || outOff + outLen > out.length) {
    throw new Error('Invalid Photoshop PackBits row bounds')
  }
  let sp = start
  let op = outOff
  const outEnd = outOff + outLen
  while (sp < end && op < outEnd) {
    const n = src[sp++]
    if (n < 128) {
      const count = n + 1
      if (sp + count > end || op + count > outEnd) throw new Error('Truncated or oversized Photoshop PackBits literal')
      out.set(src.subarray(sp, sp + count), op)
      op += count
      sp += count
    } else if (n > 128) {
      const count = 257 - n
      if (sp >= end || op + count > outEnd) throw new Error('Truncated or oversized Photoshop PackBits run')
      const value = src[sp++]
      out.fill(value, op, op + count)
      op += count
    }
    // 128 is a PackBits no-op.
  }
  if (op !== outEnd) throw new Error('Incomplete Photoshop PackBits row')
}

/** combine channel planes → RGBA (RGBA / gray / CMYK / indexed) */
function channelsToRgba(
  chans: Map<number, PsdPlane>, w: number, h: number,
  colorMode: number, clut: Uint8Array | null, transparentIndex: number | null = null,
): { rgba: Uint8ClampedArray<ArrayBuffer>; rgba16?: Uint16Array; rgbaFloat?: Float32Array; hasAlpha: boolean } {
  const n = w * h
  const out = new Uint8ClampedArray(n * 4)
  const floating = Array.from(chans.values()).some(v => v instanceof Float32Array)
  const high = Array.from(chans.values()).some(v => v instanceof Uint16Array)
  const out16 = high ? new Uint16Array(n * 4) : undefined
  const outFloat = floating ? new Float32Array(n * 4) : undefined
  const r = chans.get(0), g = chans.get(1), b = chans.get(2), k = chans.get(3), a = chans.get(-1)
  const sFloat = (p: PsdPlane | undefined, i: number, fallback = 0): number =>
    !p ? fallback : p instanceof Float32Array ? p[i] : p instanceof Uint16Array ? p[i] / 65535 : p[i] / 255
  const s16 = (p: PsdPlane | undefined, i: number, fallback = 0): number =>
    !p ? fallback : p instanceof Float32Array ? Math.round(Math.max(0, Math.min(1, p[i])) * 65535) : p instanceof Uint16Array ? p[i] : p[i] * 257
  const s8 = (p: PsdPlane | undefined, i: number, fallback = 0): number =>
    !p ? fallback : p instanceof Float32Array ? Math.round(Math.max(0, Math.min(1, p[i])) * 255) : p instanceof Uint16Array ? Math.round(p[i] / 257) : p[i]
  let hasAlpha = false

  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const av16 = a ? s16(a, i, 65535) : 65535
    const av8 = Math.round(av16 / 257)
    out[o + 3] = av8
    if (out16) out16[o + 3] = av16
    if ((floating ? sFloat(a, i, 1) : av16 / 65535) < 1) hasAlpha = true
    if (outFloat) {
      const alpha = sFloat(a, i, 1)
      if (![sFloat(r, i), sFloat(g, i), sFloat(b, i), alpha].every(Number.isFinite)) throw new Error('Invalid floating-point PSD sample')
      outFloat[o] = sFloat(r, i)
      outFloat[o + 1] = sFloat(g, i)
      outFloat[o + 2] = sFloat(b, i)
      outFloat[o + 3] = alpha
    }

    let rr16 = 0, gg16 = 0, bb16 = 0
    switch (colorMode) {
      case 3:
        rr16 = s16(r, i); gg16 = s16(g, i); bb16 = s16(b, i)
        break
      case 1:
      case 8:
        rr16 = gg16 = bb16 = s16(r, i)
        break
      case 4: {
        // In Photoshop PSD storage, 0 means 100% ink and max means 0% ink.
        // Values are already inverted relative to the usual normalized CMYK
        // equation. Multiply by the (inverted) K channel instead of inverting
        // again. An embedded CMYK ICC profile would give better print colors;
        // this remains an explicitly approximate RGB preview conversion.
        const cc = s16(r, i), mm = s16(g, i), yy = s16(b, i), kk = s16(k, i)
        rr16 = Math.round((cc * kk) / 65535)
        gg16 = Math.round((mm * kk) / 65535)
        bb16 = Math.round((yy * kk) / 65535)
        break
      }
      case 9: {
        // Photoshop Lab storage: L in 0..100 and a/b encoded with 128 as
        // the neutral 8-bit center. Convert D50 Lab to display sRGB using a
        // fixed D50-adapted matrix. This is an approximate RGB preview, not
        // a replacement for full ICC/Lab editing or Lab-preserving export.
        const L = s16(r, i) * (100 / 65535)
        const aLab = s16(g, i) * (255 / 65535) - 128
        const bLab = s16(b, i) * (255 / 65535) - 128
        const fy = (L + 16) / 116
        const fx = fy + aLab / 500
        const fz = fy - bLab / 200
        const delta = 6 / 29
        const cube = (t: number) => t > delta ? t * t * t : 3 * delta * delta * (t - 4 / 29)
        const X = cube(fx) * 0.96422
        const Y = cube(fy)
        const Z = cube(fz) * 0.82521
        const gamma = (v: number) => {
          const c = Math.max(0, Math.min(1, v))
          return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
        }
        rr16 = Math.round(gamma(3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z) * 65535)
        gg16 = Math.round(gamma(-0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z) * 65535)
        bb16 = Math.round(gamma(0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z) * 65535)
        break
      }
      case 2: {
        // Adobe PSD indexed palettes are PLANAR, not RGB triplets:
        // [256 red samples][256 green samples][256 blue samples].
        const index = s8(r, i)
        if (clut && clut.length >= 768) {
          rr16 = clut[index] * 257
          gg16 = clut[256 + index] * 257
          bb16 = clut[512 + index] * 257
        }
        if (transparentIndex === index) {
          out[o + 3] = 0
          if (out16) out16[o + 3] = 0
          if (outFloat) outFloat[o + 3] = 0
          hasAlpha = true
        }
        break
      }
      default:
        throw new Error(`Unsupported PSD color mode ${colorMode}`)
    }
    out[o] = Math.round(rr16 / 257)
    out[o + 1] = Math.round(gg16 / 257)
    out[o + 2] = Math.round(bb16 / 257)
    if (out16) {
      out16[o] = rr16; out16[o + 1] = gg16; out16[o + 2] = bb16
    }
  }
  return { rgba: out, rgba16: out16, rgbaFloat: outFloat, hasAlpha }
}

function rgbaToCanvas2(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number, rgba16?: Uint16Array, rgbaFloat?: Float32Array): HTMLCanvasElement {
  if (rgbaFloat) return hdrFloat32ToPreviewCanvas(rgbaFloat, w, h)
  const c = createCanvas(w, h, { bitDepth: rgba16 ? 16 : 8, colorSpace: 'srgb' })
  if (rgba16) {
    const values = new Float32Array(rgba16.length)
    for (let i = 0; i < rgba16.length; i++) values[i] = rgba16[i] / 65535
    if (putFloat16Pixels(c, values, 'srgb')) return c
  }
  ctx2d(c).putImageData(new ImageData(rgba, w, h), 0, 0)
  return c
}

export async function decodePsd(bytes: Uint8Array): Promise<PsdDecoded> {
  if (bytes.length < 26) throw new Error('Truncated PSD file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (sig !== '8BPS') throw new Error('Not a PSD/PSB file')
  const version = view.getUint16(4)
  if (version !== 1 && version !== 2) throw new Error(`Unsupported PSD version ${version}`)
  const psb = version === 2
  const lenSize = psb ? 8 : 4
  const channels = view.getUint16(12)
  const height = view.getUint32(14)
  const width = view.getUint32(18)
  const depth = view.getUint16(22)
  const colorMode = view.getUint16(24)
  if (width <= 0 || height <= 0 || width * height > 268435456) {
    throw new Error(`Invalid PSD dimensions ${width}×${height}`)
  }
  if (depth !== 8 && depth !== 16 && depth !== 32) throw new Error(`Unsupported PSD depth ${depth} bits (only 8/16/32)`)
  if (depth === 32 && colorMode !== 3) throw new Error('32-bit PSD currently supports RGB color mode only')
  if (colorMode === 0 || colorMode === 7) {
    throw new Error(`Unsupported PSD color mode ${colorMode} (bitmap / multichannel)`)
  }
  const readLength = (p: number): number =>
    psb ? view.getUint32(p) * 4294967296 + view.getUint32(p + 4) : view.getUint32(p)
  const str4 = (p: number): string => String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3])

  let pos = 26
  // ---- color mode data (holds the CLUT for indexed files) ----
  const cmdLen = view.getUint32(pos)
  pos += 4
  if (cmdLen > bytes.length - pos) throw new Error('Truncated Photoshop color-mode data')
  const colorModeData = bytes.slice(pos, pos + cmdLen)
  const clut = colorMode === 2 && cmdLen >= 768 ? colorModeData.subarray(0, 768) : null
  pos += cmdLen
  // ---- image resources ----
  const resLen = view.getUint32(pos)
  pos += 4
  const resStart = pos
  const resEnd = Math.min(bytes.length, resStart + resLen)
  let resolutionPpi = 72
  let transparencyIndex: number | null = null
  const imageResources: Uint8Array[] = []
  // Parse Photoshop Image Resource Blocks enough to recover ResolutionInfo
  // (0x0400). The Pascal name is padded to an even byte boundary and resource
  // data is also even-padded.
  while (pos + 12 <= resEnd) {
    const blockStart = pos
    const signature = str4(pos)
    if (signature !== '8BIM' && signature !== 'MeSa') break
    const id = view.getUint16(pos + 4)
    pos += 6
    const nameLen = bytes[pos] ?? 0
    pos += 1 + nameLen
    if ((1 + nameLen) & 1) pos++
    if (pos + 4 > resEnd) break
    const dataLen = view.getUint32(pos)
    pos += 4
    const dataStart = pos
    if (id === 0x0417 && colorMode === 2 && dataLen >= 2 && dataStart + 2 <= resEnd) {
      const candidate = view.getUint16(dataStart)
      if (candidate < 256) transparencyIndex = candidate
    }
    // Photoshop's ResolutionInfo resource is 1005 (0x03ED), NOT 1024
    // (0x0400). Some older Studio exports accidentally used 0x0400, so
    // recognize that legacy 16-byte payload only when its units match.
    const legacyResolution = id === 0x0400 && dataLen === 16 && dataStart + 16 <= resEnd &&
      view.getUint16(dataStart + 4) === 1 && view.getUint16(dataStart + 12) === 1
    if ((id === 0x03ed || legacyResolution) && dataLen >= 16 && dataStart + 16 <= resEnd) {
      const hFixed = view.getUint32(dataStart)
      const vFixed = view.getUint32(dataStart + 8)
      const h = hFixed / 65536
      const v = vFixed / 65536
      const ppi = Number.isFinite(h) && Number.isFinite(v) ? (h + v) / 2 : h
      if (Number.isFinite(ppi) && ppi > 0) resolutionPpi = Math.max(1, Math.min(12000, ppi))
    }
    pos = dataStart + dataLen + (dataLen & 1)
    if (id !== 0x03ed && !legacyResolution && pos <= resEnd) imageResources.push(bytes.slice(blockStart, pos))
  }
  pos = resEnd
  // ---- layer & mask info ----
  const lmLen = readLength(pos)
  pos += lenSize
  const lmEnd = pos + lmLen

  const compatibilityWarnings = new Set<string>()
  if (colorMode === 9) compatibilityWarnings.add('Photoshop Lab was converted to an approximate sRGB preview; editable Lab/ICC color data is not retained')
  if (colorMode === 4) compatibilityWarnings.add('Photoshop CMYK was converted to an approximate RGB preview; an ICC-managed conversion is not available')
  const records: PsdLayerRecord[] = []
  const layerChannels: Map<number, PsdPlane>[] = []
  if (lmLen > 0 && lmEnd <= bytes.length) {
    // Photoshop stores 16/32-bit layer records in the global Lr16/Lr32
    // tagged block instead of the ordinary (8-bit) layer-info section.
    // Retain the legacy location as a compatibility fallback for third-party writers.
    let liLen = readLength(pos)
    pos += lenSize
    if (liLen === 0 && (depth === 16 || depth === 32)) {
      let scan = pos
      if (scan + 4 <= lmEnd) {
        const globalMaskLength = view.getUint32(scan)
        scan += 4 + globalMaskLength
      }
      const tagKey = depth === 16 ? 'Lr16' : 'Lr32'
      while (scan + 12 <= lmEnd) {
        const signature = str4(scan)
        if (signature !== '8BIM' && signature !== '8B64') break
        const key = str4(scan + 4)
        const taggedLengthSize = psb && (key === 'Lr16' || key === 'Lr32') ? 8 : 4
        if (scan + 8 + taggedLengthSize > lmEnd) break
        const size = taggedLengthSize === 8
          ? view.getUint32(scan + 8) * 4294967296 + view.getUint32(scan + 12)
          : view.getUint32(scan + 8)
        const dataStart = scan + 8 + taggedLengthSize
        if (!Number.isSafeInteger(size) || size < 0 || dataStart + size > lmEnd) break
        if (key === tagKey) {
          liLen = size
          pos = dataStart
          break
        }
        scan = dataStart + size + (size & 1)
      }
    }
    const liEnd = pos + liLen
    if (liLen > 0) {
      const layerCount = Math.abs(view.getInt16(pos))
      pos += 2
      for (let i = 0; i < layerCount; i++) {
        const top = view.getInt32(pos)
        const left = view.getInt32(pos + 4)
        const bottom = view.getInt32(pos + 8)
        const right = view.getInt32(pos + 12)
        pos += 16
        const chCount = view.getUint16(pos)
        pos += 2
        const channels: PsdChannelInfo[] = []
        for (let c = 0; c < chCount; c++) {
          const id = view.getInt16(pos)
          const len = psb ? view.getUint32(pos + 2) * 4294967296 + view.getUint32(pos + 6) : view.getUint32(pos + 2)
          channels.push({ id, len })
          pos += 2 + lenSize
        }
        pos += 4 // blend signature '8BIM'
        const blendKey = str4(pos)
        pos += 4
        const opacity = bytes[pos]
        const clipping = bytes[pos + 1]
        const flags = bytes[pos + 2]
        pos += 4 // opacity, clipping, flags, filler
        const extraLen = view.getUint32(pos)
        pos += 4
        const extraEnd = pos + extraLen
        // layer mask data
        let maskRect: [number, number, number, number] | null = null
        const maskLen = view.getUint32(pos)
        pos += 4
        if (maskLen > 0) {
          if (maskLen >= 16) {
            maskRect = [view.getInt32(pos), view.getInt32(pos + 4), view.getInt32(pos + 8), view.getInt32(pos + 12)]
          }
          pos += maskLen
        }
        // layer blending ranges
        const brLen = view.getUint32(pos)
        pos += 4
        if (brLen > extraEnd - pos) throw new Error('Truncated Photoshop blending ranges')
        const blendingRanges = bytes.slice(pos, pos + brLen)
        pos += brLen
        // pascal name (padded to multiple of 4 including the length byte)
        const nameLen = bytes[pos]
        pos += 1
        let name = ''
        for (let ci = 0; ci < nameLen && pos + ci < bytes.length; ci++) name += String.fromCharCode(bytes[pos + ci])
        pos += nameLen
        pos += (4 - ((1 + nameLen) & 3)) & 3
        // additional layer info blocks: retain unsupported Photoshop metadata
        // byte-for-byte while regenerating names and any style blocks we can edit.
        const additionalInfo: Uint8Array[] = []
        let fx: LayerFX | null = null
        let legacyFx: LayerFX | null = null
        let hasDescriptorFx = false
        while (pos + 8 + lenSize <= extraEnd) {
          const blockStart = pos
          const s0 = bytes[pos]
          const s1 = bytes[pos + 1]
          if (s0 !== 0x38 /* 8 */ || s1 !== 0x42 /* B */) break
          const key = str4(pos + 4)
          pos += 8
          // Only specific PSB tagged blocks use 64-bit lengths; normal 8BIM
          // layer descriptors still have 32-bit lengths (Adobe specification).
          const uses64Length = psb && ['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD'].includes(key)
          const blockLen = uses64Length ? readLength(pos) : view.getUint32(pos)
          pos += uses64Length ? 8 : 4
          const dataStart = pos
          if (key === 'luni' && blockLen >= 4 && dataStart + 4 <= bytes.length) {
            const charCount = view.getUint32(dataStart)
            let uni = ''
            for (let ci = 0; ci < charCount && dataStart + 4 + ci * 2 + 1 < bytes.length; ci++) {
              uni += String.fromCharCode(view.getUint16(dataStart + 4 + ci * 2))
            }
            if (uni) name = uni
          }
          const blockEnd = Math.min(extraEnd, dataStart + blockLen + (blockLen & 1))
          if (blockEnd > blockStart && key !== 'luni') {
            const raw = bytes.slice(blockStart, blockEnd)
            if (key === 'chFX') {
              const parsed = parseChaysLayerFxBlock(raw)
              if (parsed) fx = parsed
              else additionalInfo.push(raw)
            } else if (key === 'lrFX') {
              const parsed = parseLegacyLayerFxBlock(raw)
              if (parsed) legacyFx = parsed
              else additionalInfo.push(raw)
            } else {
              if (key === 'lfx2' || key === 'lmfx' || key === 'lfxs') {
                hasDescriptorFx = true
                compatibilityWarnings.add('Modern Photoshop layer styles are retained as opaque descriptors, not fully editable')
              }
              if (key === 'lsct' || key === 'lsdk') compatibilityWarnings.add('Photoshop layer groups are not reconstructed; saving can lose folder organization')
              if (key === 'TySh') compatibilityWarnings.add('Native Photoshop text layer editing is not yet supported')
              if (key === 'SoLd' || key === 'PlLd' || key === 'lnk2') compatibilityWarnings.add('Embedded/linked Photoshop Smart Objects are not reconstructed as native editable objects')
              if (key === 'vmsk' || key === 'vsms') compatibilityWarnings.add('Photoshop vector masks are retained as opaque descriptors, not native editable masks')
              additionalInfo.push(raw)
            }
          }
          pos = blockEnd
        }
        // Photoshop ignores lrFX when a modern object-effects descriptor exists.
        // Our own chFX remains authoritative because it represents a prior native
        // Chay's Studio style stack and is intentionally ignored by Photoshop.
        if (!fx && !hasDescriptorFx) fx = legacyFx
        pos = extraEnd
        records.push({
          top, left, bottom, right, channels, blendKey,
          opacity, visible: (flags & 2) === 0, clipped: clipping === 1, name, maskRect, fx, additionalInfo, blendingRanges,
        })
      }

      // channel image data (follows the records)
      for (const rec of records) {
        const chans = new Map<number, PsdPlane>()
        const lw = rec.right - rec.left
        const lh = rec.bottom - rec.top
        for (const ch of rec.channels) {
          const chStart = pos
          const compr = view.getUint16(pos)
          pos += 2
          const isMask = ch.id === -2
          const mw = isMask && rec.maskRect ? rec.maskRect[3] - rec.maskRect[1] : lw
          const mh = isMask && rec.maskRect ? rec.maskRect[2] - rec.maskRect[0] : lh
          try {
            chans.set(ch.id, await decodePsdChannel(bytes, view, pos, compr, Math.max(0, mw), Math.max(0, mh), depth, Math.max(0, ch.len - 2), psb ? 4 : 2))
          } catch (error) {
            throw new Error(`Cannot decode PSD layer ${rec.name} channel ${ch.id}: ${error instanceof Error ? error.message : String(error)}`)
          }
          pos = chStart + ch.len // lengths cover compression + row table + data
        }
        layerChannels.push(chans)
      }
      pos = liEnd
    }
    pos = lmEnd // skip global mask info + global additional blocks
  }

  // ---- build layer canvases ----
  const layers: PsdLayer[] = []
  const sectionMarkers: PsdSectionMarker[] = []
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    const chans = layerChannels[i]
    const lw = rec.right - rec.left
    const lh = rec.bottom - rec.top
    if (lw <= 0 || lh <= 0) {
      // Group boundaries are zero-sized, zero-channel layer records with a
      // section-divider tag. Retain their Photoshop metadata and position.
      const divider = rec.additionalInfo.find(block =>
        block.length >= 16 && ['lsct', 'lsdk'].includes(String.fromCharCode(...block.subarray(4, 8))))
      const sectionType = divider ? new DataView(divider.buffer, divider.byteOffset).getUint32(12) : 0
      const isGroup = !!divider && [1, 2, 3].includes(sectionType)
      // Only zero-pixel, zero-channel adjustments can be preserved verbatim
      // without interpreting pixel/mask channels that the editor cannot render.
      const adjustmentKeys = new Set(['levl', 'curv', 'brit', 'hue2', 'blnc', 'blwh',
        'selc', 'vibA', 'expA', 'grdm', 'phfl', 'SoCo', 'GdFl', 'PtFl'])
      const isAdjustment = rec.additionalInfo.some(block =>
        block.length >= 12 && adjustmentKeys.has(String.fromCharCode(...block.subarray(4, 8))))
      if ((isGroup || isAdjustment) && rec.channels.length === 0) {
        sectionMarkers.push({
          kind: isGroup ? 'group' : 'adjustment',
          beforeLayerIndex: layers.length, name: rec.name, visible: rec.visible,
          opacity: Math.round(rec.opacity * 100 / 255), blendKey: rec.blendKey,
          additionalInfo: rec.additionalInfo.map(b => b.slice()),
          blendingRanges: rec.blendingRanges.slice(),
        })
        if (isAdjustment) compatibilityWarnings.add('Photoshop adjustment records are retained for re-export but not rendered or editable in Studio')
      } else compatibilityWarnings.add('One or more non-raster Photoshop layer records could not be preserved')
      continue
    }
    let canvas: HTMLCanvasElement
    let hdrPixels: Float32Array | undefined
    try {
      const { rgba, rgba16, rgbaFloat } = channelsToRgba(chans, lw, lh, colorMode, clut, transparencyIndex)
      hdrPixels = rgbaFloat
      canvas = rgbaToCanvas2(rgba, lw, lh, rgba16, rgbaFloat)
    } catch (error) {
      throw new Error(`Unable to restore Photoshop layer ${rec.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
    // user mask → full-document-size canvas with the mask value in alpha
    let mask: HTMLCanvasElement | null = null
    if (rec.maskRect) {
      const mTop = rec.maskRect[0], mLeft = rec.maskRect[1]
      const mw = rec.maskRect[3] - mLeft
      const mh = rec.maskRect[2] - mTop
      const mch = chans.get(-2)
      if (mw > 0 && mh > 0 && mch && mch.length >= mw * mh) {
        mask = createCanvas(width, height)
        const mimg = new ImageData(width, height)
        const md = mimg.data
        for (let y = 0; y < Math.min(mh, height - mTop); y++) {
          for (let x = 0; x < Math.min(mw, width - mLeft); x++) {
            const docX = mLeft + x, docY = mTop + y
            if (docX < 0 || docX >= width || docY < 0 || docY >= height) continue
            const o = (docY * width + docX) * 4
            md[o] = 255; md[o + 1] = 255; md[o + 2] = 255
            const pixel = mch[y * mw + x]
            md[o + 3] = mch instanceof Float32Array ? Math.round(pixel * 255) : mch instanceof Uint16Array ? Math.round(pixel / 257) : pixel
          }
        }
        ctx2d(mask).putImageData(mimg, 0, 0)
      }
    }
    layers.push({
      name: rec.name || `Layer ${i + 1}`,
      canvas,
      hdrPixels,
      left: rec.left,
      top: rec.top,
      width: lw,
      height: lh,
      opacity: Math.round((rec.opacity * 100) / 255),
      blendKey: rec.blendKey.replace(/\s+$/, ''),
      blendMode: psdBlendKeyToMode(rec.blendKey),
      visible: rec.visible,
      clipped: rec.clipped,
      mask,
      fx: rec.fx ? structuredClone(rec.fx) : null,
      additionalInfo: rec.additionalInfo.map(b => b.slice()),
      blendingRanges: rec.blendingRanges.slice(),
    })
  }

  // ---- merged composite (Image Data section) ----
  let composite: HTMLCanvasElement | null = null
  let hdrComposite: Float32Array | undefined
  let hasAlpha = false
  try {
    pos = Math.min(lmEnd, bytes.length)
    const compr = view.getUint16(pos)
    pos += 2
    const bpc = depth >> 3
    const rowBytes = width * bpc
    const chans = new Map<number, PsdPlane>()
    const compositeId = (c: number): number =>
      (colorMode === 3 && c < 3) || (colorMode === 4 && c < 4) || (colorMode === 1 && c < 1) || (colorMode === 2 && c < 1) || (colorMode === 8 && c < 1) || (colorMode === 9 && c < 3) ? c : -1
    if (compr === 0) {
      for (let c = 0; c < channels; c++) {
        const chan = await decodePsdChannel(bytes, view, pos, compr, width, height, depth, rowBytes * height)
        chans.set(compositeId(c), chan)
        pos += rowBytes * height
      }
    } else if (compr === 1) {
      // shared row table: channels × height 2-byte entries, then all rows
      const totalRows = channels * height
      const rowLens: number[] = []
      for (let i = 0; i < totalRows && pos + 2 <= bytes.length; i++) {
        rowLens.push(psb ? view.getUint32(pos) : view.getUint16(pos))
        pos += psb ? 4 : 2
      }
      for (let c = 0; c < channels; c++) {
        const raw = new Uint8Array(rowBytes * height)
        for (let y = 0; y < height; y++) {
          const rl = rowLens[c * height + y] ?? 0
          decodePackBitsRow(bytes, pos, pos + rl, raw, y * rowBytes, rowBytes)
          pos += rl
        }
        chans.set(compositeId(c), psdPlaneFromBytes(raw, depth, width * height))
      }
    } else if (compr === 2 || compr === 3) {
      const data = await inflateZlib(bytes.subarray(pos))
      const channelBytes = rowBytes * height
      if (data.length !== channelBytes * channels) throw new Error('Invalid Photoshop ZIP composite size')
      for (let ci = 0; ci < channels; ci++) {
        const raw = data.subarray(ci * channelBytes, (ci + 1) * channelBytes)
        chans.set(compositeId(ci), psdPlaneFromBytes(compr === 3 ? restorePsdPrediction(raw, width, height, depth) : raw, depth, width * height))
      }
    } else {
      throw new Error(`Unsupported composite compression ${compr}`)
    }
    const res = channelsToRgba(chans, width, height, colorMode, clut, transparencyIndex)
    composite = rgbaToCanvas2(res.rgba, width, height, res.rgba16, res.rgbaFloat)
    hdrComposite = res.rgbaFloat
    hasAlpha = res.hasAlpha
  } catch {
    composite = null
  }

  if (!composite) {
    // fallback: render the composite from the decoded layers
    composite = createCanvas(width, height)
    const cctx = ctx2d(composite)
    for (const l of layers) {
      if (!l.visible) continue
      cctx.save()
      cctx.globalAlpha = l.opacity / 100
      try { cctx.globalCompositeOperation = l.blendMode as GlobalCompositeOperation } catch { /* keep default */ }
      cctx.drawImage(l.canvas, l.left, l.top)
      cctx.restore()
    }
  }

  return { canvas: composite, width, height, depth: depth as 8 | 16 | 32, hdrPixels: hdrComposite, hasAlpha, layers, sectionMarkers, resolutionPpi, imageResources, colorModeData, warnings: [...compatibilityWarnings] }
}

// ============================================================
// writing — buildPsd(): RGB 8/16-bit PSD v1, per-row RLE
// ============================================================

export interface PsdLayerInput {
  name: string
  canvas: HTMLCanvasElement
  left: number
  top: number
  opacity: number    // 0..100
  blendMode: string  // app blend mode id ('normal', 'multiply', …)
  visible: boolean
  clipped?: boolean
  /** full-document-size mask canvas — mask value lives in the ALPHA channel */
  mask?: HTMLCanvasElement | null
  /** Authoritative linear RGB floats for 32-bit Photoshop interchange. */
  hdrPixels?: Float32Array
  /** Native editable layer style stack. Photoshop-readable legacy effects
   * are regenerated; the complete stack is retained in chFX for Chay's Studio. */
  fx?: LayerFX | null
  /** Opaque PSD additional-layer-information blocks to preserve. */
  additionalInfo?: Uint8Array[]
  /** Lossless passthrough of Photoshop source/destination blending ranges. */
  blendingRanges?: Uint8Array
  /** Non-rendering Photoshop group delimiter. Has no pixel channels. */
  sectionMarker?: boolean
  /** Exact Photoshop folder blend key, e.g. 'pass'; other layer kinds use mapped modes. */
  rawBlendKey?: string
}

/** PackBits-encode one row; returns the packed bytes */
function packBitsRow(src: Uint8Array, off: number, n: number): Uint8Array {
  const out = new Uint8Array(n + 64 + (n >> 6) * 2) // literal worst case + margin
  let o = 0
  let i = 0
  while (i < n) {
    let run = 1
    while (i + run < n && src[off + i + run] === src[off + i] && run < 128) run++
    if (run >= 3) {
      out[o++] = 257 - run
      out[o++] = src[off + i]
      i += run
    } else {
      const start = i
      i += run
      while (i < n && i - start < 128) {
        if (i + 2 < n && src[off + i] === src[off + i + 1] && src[off + i] === src[off + i + 2]) break
        i++
      }
      const cnt = i - start
      out[o++] = cnt - 1
      for (let k = 0; k < cnt; k++) out[o++] = src[off + start + k]
    }
  }
  return out.subarray(0, o)
}

/** one channel block: [u16 compression=1][2h row lengths][packed rows] */
function encodeRleChannel(chan: Uint8Array, w: number, h: number, rowLenBytes: 2 | 4 = 2): Uint8Array {
  const rows: Uint8Array[] = []
  const rowLens: number[] = []
  let dataBytes = 0
  for (let y = 0; y < h; y++) {
    const row = packBitsRow(chan, y * w, w)
    rows.push(row)
    rowLens.push(row.length)
    dataBytes += row.length
  }
  // PSD stores 16-bit RLE row sizes; a too-wide row must use raw data.
  if (rowLenBytes === 2 && rowLens.some(len => len > 0xffff)) {
    const raw = new Uint8Array(2 + chan.length)
    raw.set(chan, 2)
    return raw
  }
  const out = new Uint8Array(2 + rowLenBytes * h + dataBytes)
  const view = new DataView(out.buffer)
  view.setUint16(0, 1)
  for (let y = 0; y < h; y++) {
    if (rowLenBytes === 4) view.setUint32(2 + y * 4, rowLens[y])
    else view.setUint16(2 + y * 2, rowLens[y])
  }
  let o = 2 + rowLenBytes * h
  for (const row of rows) { out.set(row, o); o += row.length }
  return out
}

function splitCanvasChannels(canvas: HTMLCanvasElement, depth: 8 | 16 | 32, hdrPixels?: Float32Array): { r: Uint8Array; g: Uint8Array; b: Uint8Array; a: Uint8Array } {
  const n = canvas.width * canvas.height
  const bpc = depth >> 3
  const r = new Uint8Array(n * bpc), g = new Uint8Array(n * bpc), b = new Uint8Array(n * bpc), a = new Uint8Array(n * bpc)
  if (depth === 32) {
    if (!hdrPixels || hdrPixels.length !== n * 4) throw new Error('32-bit PSD export requires full-resolution Float32 pixels for every layer')
    const views = [r, g, b, a].map(buf => new DataView(buf.buffer))
    for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) {
      const value = hdrPixels[i * 4 + c]
      if (!Number.isFinite(value)) throw new Error('Non-finite PSD HDR pixel value')
      views[c].setFloat32(i * 4, value, false)
    }
    return { r, g, b, a }
  }
  if (depth === 16) {
    const hi = getFloat16ImageData(canvas)
    const fallback = hi?.data ? null : getImageData(canvas).data
    const src = hi?.data as ArrayLike<number> | undefined
    const write = (dst: Uint8Array, i: number, value: number) => {
      const v = Math.max(0, Math.min(65535, Math.round(value)))
      dst[i * 2] = v >>> 8
      dst[i * 2 + 1] = v & 255
    }
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      if (src) {
        write(r, i, Number(src[o]) * 65535)
        write(g, i, Number(src[o + 1]) * 65535)
        write(b, i, Number(src[o + 2]) * 65535)
        write(a, i, Number(src[o + 3]) * 65535)
      } else {
        write(r, i, (fallback?.[o] ?? 0) * 257)
        write(g, i, (fallback?.[o + 1] ?? 0) * 257)
        write(b, i, (fallback?.[o + 2] ?? 0) * 257)
        write(a, i, (fallback?.[o + 3] ?? 255) * 257)
      }
    }
    return { r, g, b, a }
  }
  const d = getImageData(canvas).data
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    r[i] = d[o]; g[i] = d[o + 1]; b[i] = d[o + 2]; a[i] = d[o + 3]
  }
  return { r, g, b, a }
}

function maskChannelBytes(canvas: HTMLCanvasElement, depth: 8 | 16 | 32): Uint8Array {
  const d = getImageData(canvas).data
  const n = canvas.width * canvas.height
  if (depth === 8) {
    const out = new Uint8Array(n)
    for (let i = 0, o = 3; i < n; i++, o += 4) out[i] = d[o]
    return out
  }
  const out = new Uint8Array(n * (depth >> 3))
  if (depth === 32) {
    const view = new DataView(out.buffer)
    for (let i = 0; i < n; i++) view.setFloat32(i * 4, d[i * 4 + 3] / 255, false)
    return out
  }
  for (let i = 0, o = 3; i < n; i++, o += 4) {
    const v = d[o] * 257
    out[i * 2] = v >>> 8
    out[i * 2 + 1] = v & 255
  }
  return out
}

function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

function concatUint8(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

function pad4(n: number): number {
  return n + ((4 - (n & 3)) & 3)
}

function u64(v: number): Uint8Array {
  if (!Number.isSafeInteger(v) || v < 0) throw new Error('Invalid PSB section length')
  const out = new Uint8Array(8)
  const view = new DataView(out.buffer)
  view.setUint32(0, Math.floor(v / 0x100000000))
  view.setUint32(4, v >>> 0)
  return out
}

function u32(v: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, v)
  return out
}
function u16(v: number): Uint8Array {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, v)
  return out
}
function i32(v: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setInt32(0, v)
  return out
}

function unicodeLayerNameBlock(name: string): Uint8Array {
  const text = name || 'Layer'
  const data = new Uint8Array(4 + text.length * 2)
  const dv = new DataView(data.buffer)
  dv.setUint32(0, text.length)
  for (let i = 0; i < text.length; i++) dv.setUint16(4 + i * 2, text.charCodeAt(i))
  const padded = data.length + (data.length & 1)
  const out = new Uint8Array(12 + padded)
  out.set(asciiBytes('8BIM'), 0)
  out.set(asciiBytes('luni'), 4)
  new DataView(out.buffer).setUint32(8, data.length)
  out.set(data, 12)
  return out
}

function saneAdditionalInfoBlock(block: Uint8Array): boolean {
  if (!(block instanceof Uint8Array) || block.length < 12) return false
  const sig = String.fromCharCode(block[0], block[1], block[2], block[3])
  return sig === '8BIM' || sig === '8B64'
}

export function buildPsd(
  width: number, height: number,
  layers: PsdLayerInput[],
  composite: HTMLCanvasElement,
  options: { resolutionPpi?: number; depth?: 8 | 16 | 32; imageResources?: Uint8Array[]; format?: 'psd' | 'psb'; compositeHdrPixels?: Float32Array; colorModeData?: Uint8Array } = {},
): Blob {
  const depth: 8 | 16 | 32 = options.depth === 32 ? 32 : options.depth === 16 ? 16 : 8
  const psb = options.format === 'psb'
  // Photoshop 32-bit RGB documents require their HDR tone-preview data
  // ('hdrt') in the color-mode section. No verified generic writer exists
  // yet; round-trip the Photoshop-authored bytes instead of fabricating it.
  const colorModeData = depth === 32 ? options.colorModeData : undefined
  if (depth === 32 && !(colorModeData instanceof Uint8Array && colorModeData.length >= 8 &&
    String.fromCharCode(...colorModeData.subarray(0, 4)) === 'hdrt')) {
    throw new Error('32-bit PSD/PSB export requires Photoshop-origin HDR color-mode data (hdrt); use the native project format for new HDR documents')
  }
  if (!psb && (width > 30000 || height > 30000)) throw new Error('PSD maximum dimension exceeded; export PSB instead')
  if (width > 300000 || height > 300000 || width < 1 || height < 1) throw new Error('Invalid PSD/PSB dimensions')
  const sectionLength = psb ? u64 : u32
  const rowLenBytes: 2 | 4 = psb ? 4 : 2
  const bpc = depth >> 3
  // normalize: composite must be doc-size
  let flat = composite
  if (composite.width !== width || composite.height !== height) {
    flat = createCanvas(width, height)
    ctx2d(flat).drawImage(composite, 0, 0, width, height)
  }
  let list = layers.filter(l => l.sectionMarker || (l.canvas && l.canvas.width > 0 && l.canvas.height > 0))
  if (!list.some(l => !l.sectionMarker)) {
    list = [{ name: 'Background', canvas: flat, left: 0, top: 0, opacity: 100, blendMode: 'normal', visible: true }]
  }

  // ---- per-layer channel blocks (bottom layer first, like PSD storage) ----
  interface Prepared {
    input: PsdLayerInput
    channels: { id: number; block: Uint8Array }[]
    maskDoc: { w: number; h: number; chan: Uint8Array } | null
  }
  if (list.length > 32767) throw new Error('Photoshop PSD/PSB supports at most 32767 layer records per layer-info section')
  const prepared: Prepared[] = []
  for (const input of list) {
    if (input.sectionMarker) {
      prepared.push({ input, channels: [], maskDoc: null })
      continue
    }
    const w = input.canvas.width
    const h = input.canvas.height
    const { r, g, b, a } = splitCanvasChannels(input.canvas, depth, input.hdrPixels)
    const rowBytes = w * bpc
    const channels: { id: number; block: Uint8Array }[] = [
      { id: 0, block: encodeRleChannel(r, rowBytes, h, rowLenBytes) },
      { id: 1, block: encodeRleChannel(g, rowBytes, h, rowLenBytes) },
      { id: 2, block: encodeRleChannel(b, rowBytes, h, rowLenBytes) },
      { id: -1, block: encodeRleChannel(a, rowBytes, h, rowLenBytes) },
    ]
    // mask: full-document-size canvas → doc-sized channel
    let maskDoc: { w: number; h: number; chan: Uint8Array } | null = null
    if (input.mask && input.mask.width > 0 && input.mask.height > 0) {
      let mCanvas = input.mask
      if (mCanvas.width !== width || mCanvas.height !== height) {
        mCanvas = createCanvas(width, height)
        ctx2d(mCanvas).drawImage(input.mask, 0, 0, width, height)
      }
      const mchan = maskChannelBytes(mCanvas, depth)
      maskDoc = { w: width, h: height, chan: mchan }
    }
    prepared.push({ input, channels, maskDoc })
  }

  // ---- layer records ----
  // A negative layer count tells Photoshop channel 4 is merged transparency,
  // not an unrelated extra alpha channel. The ordinary layer order is unchanged.
  const compositeAlpha = depth === 32 && options.compositeHdrPixels
    ? options.compositeHdrPixels.some((v, i) => i % 4 === 3 && v < 1)
    : getImageData(flat).data.some((v, i) => i % 4 === 3 && v < 255)
  const recordParts: Uint8Array[] = [i16(compositeAlpha ? -prepared.length : prepared.length)]
  const channelDataParts: Uint8Array[] = []
  for (const p of prepared) {
    const w = p.input.sectionMarker ? 0 : p.input.canvas.width
    const h = p.input.sectionMarker ? 0 : p.input.canvas.height
    const allChannels = p.maskDoc
      ? [...p.channels, { id: -2, block: encodeRleChannel(p.maskDoc.chan, p.maskDoc.w * bpc, p.maskDoc.h, rowLenBytes) }]
      : p.channels
    // record
    recordParts.push(
      i32(p.input.top), i32(p.input.left), i32(p.input.top + h), i32(p.input.left + w),
      u16(allChannels.length),
    )
    for (const ch of allChannels) {
      recordParts.push(i16(ch.id), sectionLength(ch.block.length))
    }
    recordParts.push(asciiBytes('8BIM'), asciiBytes(p.input.sectionMarker && p.input.rawBlendKey?.length === 4
      ? p.input.rawBlendKey : blendModeToPsdKey(p.input.blendMode)))
    recordParts.push(new Uint8Array([
      Math.max(0, Math.min(255, Math.round((p.input.opacity * 255) / 100))), // opacity
      p.input.clipped ? 1 : 0,   // clipping
      p.input.visible ? 0 : 2,   // Photoshop bit 1 is HIDDEN (inverted)
      0,                          // filler
    ]))
    // extra data: mask block + blending ranges + pascal name
    const name = (p.input.name || 'Layer').slice(0, 255)
    const nameBytes = asciiBytes(name)
    const pascalTotal = 1 + nameBytes.length
    const pascalPad = (4 - (pascalTotal & 3)) & 3
    const replacingFx = !!p.input.fx
    const preservedInfo = (p.input.additionalInfo ?? [])
      .filter(saneAdditionalInfoBlock)
      .filter(block => {
        if (!replacingFx) return true
        const key = fxBlockKey(block)
        return key !== 'lrFX' && key !== 'chFX' && key !== 'lfx2' && key !== 'lmfx' && key !== 'lfxs'
      })
    const generatedFx: Uint8Array[] = []
    if (p.input.fx) {
      // chFX is an app-private, ignored-by-Photoshop copy of the complete
      // native stack. lrFX provides interoperable shadows/glows/bevel/fill.
      generatedFx.push(chaysLayerFxBlock(p.input.fx))
      const legacy = legacyLayerFxBlock(p.input.fx)
      if (legacy) generatedFx.push(legacy)
    }
    const unicodeName = unicodeLayerNameBlock(p.input.name || 'Layer')
    const additionalInfoBytes = [...preservedInfo, ...generatedFx].reduce((n, b) => n + b.length, unicodeName.length)
    const blendingRanges = p.input.blendingRanges ?? new Uint8Array(0)
    const extraLen = (p.maskDoc ? 4 + 20 : 4) + 4 + blendingRanges.length + pascalTotal + pascalPad + additionalInfoBytes
    recordParts.push(u32(extraLen))
    if (p.maskDoc) {
      // layer mask data: length 20 = rect(16) + default color + flags + pad
      recordParts.push(
        u32(20),
        i32(0), i32(0), i32(height), i32(width), // mask rect = full document
        new Uint8Array([0, 0, 0, 0]),            // default color 0, flags 0, 2 pad
      )
    } else {
      recordParts.push(u32(0)) // no mask
    }
    recordParts.push(u32(blendingRanges.length), blendingRanges) // original Photoshop Blend If ranges
    recordParts.push(new Uint8Array([nameBytes.length]), nameBytes, new Uint8Array(pascalPad))
    recordParts.push(unicodeName, ...preservedInfo, ...generatedFx)
    // channel image data blocks follow all records — store for later
    for (const ch of allChannels) channelDataParts.push(ch.block)
  }

  // ---- layer info section (records + channel data, padded to 4) ----
  const layerInfoContent = concatUint8([...recordParts, ...channelDataParts])
  const liPad = (4 - (layerInfoContent.length & 3)) & 3
  const highDepthTag = depth === 16 || depth === 32
    ? concatUint8([
        asciiBytes(psb ? '8B64' : '8BIM'),
        asciiBytes(depth === 16 ? 'Lr16' : 'Lr32'),
        sectionLength(pad4(layerInfoContent.length)),
        layerInfoContent,
        new Uint8Array(liPad),
      ]) : null
  const layerInfo = highDepthTag ? sectionLength(0)
    : concatUint8([sectionLength(pad4(layerInfoContent.length)), layerInfoContent, new Uint8Array(liPad)])

  // ---- layer & mask info: high-depth Photoshop layers live in Lr16/Lr32 ----
  const lmContent = concatUint8(highDepthTag ? [layerInfo, u32(0), highDepthTag] : [layerInfo, u32(0)])
  const lmPad = (4 - (lmContent.length & 3)) & 3
  const lmSection = concatUint8([sectionLength(pad4(lmContent.length)), lmContent, new Uint8Array(lmPad)])

  // ---- image resources: Photoshop ResolutionInfo (1005 / 0x03ED) ----
  const resolutionPpi = Math.max(1, Math.min(12000, Number(options.resolutionPpi) || 72))
  const fixedPpi = Math.max(1, Math.min(0xffffffff, Math.round(resolutionPpi * 65536)))
  const resData = new Uint8Array(16)
  const resView = new DataView(resData.buffer)
  resView.setUint32(0, fixedPpi)    // hRes, fixed 16.16
  resView.setUint16(4, 1)           // hResUnit: pixels per inch
  resView.setUint16(6, 1)           // widthUnit
  resView.setUint32(8, fixedPpi)    // vRes
  resView.setUint16(12, 1)          // vResUnit
  resView.setUint16(14, 1)          // heightUnit
  const resolutionResource = concatUint8([asciiBytes('8BIM'), u16(0x03ed), new Uint8Array([0, 0]), u32(resData.length), resData])
  const preservedResources = (options.imageResources ?? []).filter(block => {
    if (!(block instanceof Uint8Array) || block.length < 12) return false
    const sig = String.fromCharCode(block[0], block[1], block[2], block[3])
    const id = (block[4] << 8) | block[5]
    // Writer owns the canonical ResolutionInfo resource; do not duplicate it.
    return (sig === '8BIM' || sig === 'MeSa') && id !== 0x03ed
  })
  const resources = concatUint8([resolutionResource, ...preservedResources])

  // ---- merged composite: RLE with a shared channels × height row table ----
  const comp = splitCanvasChannels(flat, depth, options.compositeHdrPixels)
  const compChannels: { id: number; chan: Uint8Array }[] = [
    { id: 0, chan: comp.r }, { id: 1, chan: comp.g }, { id: 2, chan: comp.b }, { id: -1, chan: comp.a },
  ]
  const compRows: Uint8Array[][] = compChannels.map(c => {
    const rows: Uint8Array[] = []
    for (let y = 0; y < height; y++) rows.push(packBitsRow(c.chan, y * width * bpc, width * bpc))
    return rows
  })
  const oversizedPsdRow = !psb && compRows.some(rows => rows.some(row => row.length > 0xffff))
  const tableSize = rowLenBytes * compChannels.length * height
  let compDataBytes = 0
  for (const rows of compRows) for (const r of rows) compDataBytes += r.length
  let compositeSection: Uint8Array
  if (oversizedPsdRow) {
    // Both PSD and PSB accept raw composite channels. Never truncate RLE row sizes.
    compositeSection = concatUint8([u16(0), ...compChannels.map(c => c.chan)])
  } else {
    compositeSection = new Uint8Array(2 + tableSize + compDataBytes)
    const compView = new DataView(compositeSection.buffer)
    compView.setUint16(0, 1)
    let cp = 2
    for (const rows of compRows) {
      for (const r of rows) {
        if (psb) compView.setUint32(cp, r.length)
        else compView.setUint16(cp, r.length)
        cp += rowLenBytes
      }
    }
    for (const rows of compRows) {
      for (const r of rows) {
        compositeSection.set(r, cp)
        cp += r.length
      }
    }
  }

  // ---- header ----
  const header = new Uint8Array(26)
  const hv = new DataView(header.buffer)
  header.set([0x38, 0x42, 0x50, 0x53], 0) // '8BPS'
  hv.setUint16(4, psb ? 2 : 1) // PSD=1, large-document PSB=2
  // bytes 6..11 reserved (zero)
  hv.setUint16(12, 4)     // channels
  hv.setUint32(14, height)
  hv.setUint32(18, width)
  hv.setUint16(22, depth) // depth
  hv.setUint16(24, 3)     // color mode: RGB

  const colorModeSection = depth === 32 ? colorModeData! : new Uint8Array(0)
  return new Blob([header, u32(colorModeSection.length), colorModeSection, u32(resources.length), resources, lmSection, compositeSection] as unknown as BlobPart[], {
    type: 'image/vnd.adobe.photoshop',
  })
}

function i16(v: number): Uint8Array {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setInt16(0, v)
  return out
}
