'use client'
// GIMP PSD Import/Export
// Photoshop PSD/PSB format support with layers, masks, effects, adjustment layers

import { createCanvas, ctx2d } from '../utils/canvas'

export interface PsdLayer {
  id: string
  name: string
  type: 'layer' | 'group' | 'adjustment' | 'text' | 'shape' | 'smart-object'
  visible: boolean
  opacity: number // 0-255
  blendMode: string
  clipping: boolean
  x: number
  y: number
  width: number
  height: number
  mask?: PsdMask
  effects?: PsdLayerEffects
  adjustment?: PsdAdjustment
  text?: PsdText
  smartObject?: PsdSmartObject
  channels: PsdChannel[]
  children?: PsdLayer[]
}

export interface PsdMask {
  enabled: boolean
  canvas: HTMLCanvasElement
  density: number
  feather: number
  invert: boolean
  relativeToLayer: boolean
}

export interface PsdChannel {
  id: number
  name: string
  type: 'red' | 'green' | 'blue' | 'alpha' | 'mask' | 'spot'
  data: Uint8Array | Uint16Array
  compression: 'raw' | 'rle' | 'zip' | 'zip-prediction'
}

export interface PsdLayerEffects {
  dropShadow?: PsdDropShadow
  innerShadow?: PsdInnerShadow
  outerGlow?: PsdOuterGlow
  innerGlow?: PsdInnerGlow
  bevelEmboss?: PsdBevelEmboss
  satin?: PsdSatin
  colorOverlay?: PsdColorOverlay
  gradientOverlay?: PsdGradientOverlay
  patternOverlay?: PsdPatternOverlay
  stroke?: PsdStroke
}

export interface PsdDropShadow {
  enabled: boolean
  blendMode: string
  color: { r: number; g: number; b: number; a: number }
  opacity: number
  angle: number
  distance: number
  spread: number
  size: number
  noise: number
  layerKnocksOut: boolean
}

export interface PsdInnerShadow {
  enabled: boolean
  blendMode: string
  color: { r: number; g: number; b: number; a: number }
  opacity: number
  angle: number
  distance: number
  choke: number
  size: number
  noise: number
}

export interface PsdOuterGlow {
  enabled: boolean
  blendMode: string
  color: { r: number; g: number; b: number; a: number }
  opacity: number
  noise: number
  technique: 'softer' | 'precise'
  spread: number
  size: number
  contour: string
  range: number
  jitter: number
}

export interface PsdInnerGlow {
  enabled: boolean
  blendMode: string
  color: { r: number; g: number; b: number; a: number }
  opacity: number
  noise: number
  technique: 'softer' | 'precise'
  source: 'center' | 'edge'
  choke: number
  size: number
  contour: string
  range: number
  jitter: number
}

export interface PsdBevelEmboss {
  enabled: boolean
  style: 'outer' | 'inner' | 'emboss' | 'pillow' | 'stroke'
  technique: 'smooth' | 'chisel-hard' | 'chisel-soft'
  depth: number
  direction: 'up' | 'down'
  size: number
  soften: number
  angle: number
  altitude: number
  glossContour: string
  highlightMode: string
  highlightColor: { r: number; g: number; b: number; a: number }
  highlightOpacity: number
  shadowMode: string
  shadowColor: { r: number; g: number; b: number; a: number }
  shadowOpacity: number
  useGlobalLight: boolean
}

export interface PsdSatin {
  enabled: boolean
  blendMode: string
  color: { r: number; g: number; b: number; a: number }
  opacity: number
  angle: number
  distance: number
  size: number
  contour: string
  antiAliased: boolean
  invert: boolean
}

export interface PsdColorOverlay {
  enabled: boolean
  blendMode: string
  color: { r: number; g: number; b: number; a: number }
  opacity: number
}

export interface PsdGradientOverlay {
  enabled: boolean
  blendMode: string
  opacity: number
  gradient: GradientStop[]
  style: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond'
  angle: number
  scale: number
  alignWithLayer: boolean
  reverse: boolean
  dither: boolean
  interpolation: 'rgb' | 'hsl' | 'lab'
}

export interface PsdPatternOverlay {
  enabled: boolean
  blendMode: string
  opacity: number
  pattern: HTMLCanvasElement
  scale: number
  alignWithLayer: boolean
  linkWithLayer: boolean
}

export interface PsdStroke {
  enabled: boolean
  size: number
  position: 'outside' | 'inside' | 'center'
  blendMode: string
  opacity: number
  fillType: 'color' | 'gradient' | 'pattern'
  color?: { r: number; g: number; b: number; a: number }
  gradient?: PsdGradientOverlay['gradient']
  gradientStyle?: PsdGradientOverlay['style']
  gradientAngle?: number
  gradientScale?: number
  pattern?: HTMLCanvasElement
}

export interface GradientStop {
  position: number
  color: { r: number; g: number; b: number; a: number }
}

export interface PsdAdjustment {
  type: string
  params: Record<string, any>
}

export interface PsdText {
  text: string
  font: PsdFont
  paragraph: PsdParagraph
  color: { r: number; g: number; b: number; a: number }
  transform: PsdTransform
}

export interface PsdFont {
  name: string
  size: number
  style: 'normal' | 'italic' | 'oblique'
  weight: number
  stretch: string
  family: string
}

export interface PsdParagraph {
  alignment: 'left' | 'center' | 'right' | 'justify'
  leading: number
  tracking: number
  baselineShift: number
  indent: number
  spaceBefore: number
  spaceAfter: number
  hyphenation: boolean
  language: string
}

export interface PsdTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  skewX: number
  skewY: number
}

export interface PsdSmartObject {
  type: 'embedded' | 'linked'
  data?: ArrayBuffer
  filename?: string
  width: number
  height: number
  transform: PsdTransform
  filters?: any[]
}

export interface PsdDocument {
  width: number
  height: number
  depth: number // 8, 16, 32
  colorMode: 'bitmap' | 'grayscale' | 'indexed' | 'rgb' | 'cmyk' | 'multichannel' | 'duotone' | 'lab'
  channels: number
  resolution: { x: number; y: number }
  units: 'pixels' | 'inches' | 'cm' | 'mm' | 'points' | 'picas'
  layers: PsdLayer[]
  colorProfile?: ArrayBuffer
  metadata?: Record<string, any>
  guides?: PsdGuide[]
  slices?: PsdSlice[]
}

export interface PsdGuide {
  id: string
  orientation: 'horizontal' | 'vertical'
  position: number
}

export interface PsdSlice {
  id: string
  name: string
  bounds: { x: number; y: number; width: number; height: number }
  url?: string
  target?: string
  altText?: string
  message?: string
  groupId?: string
  origin?: number
  associateId?: number
}

/** PSD File Header constants */
const PSD_SIGNATURE = '8BPS'
const PSD_VERSION = 1
const PSB_VERSION = 2

/** Parse PSD/PSB file */
export async function parsePsd(buffer: ArrayBuffer): Promise<PsdDocument> {
  const view = new DataView(buffer)
  let offset = 0

  // File Header
  const signature = readString(view, offset, 4)
  if (signature !== PSD_SIGNATURE) throw new Error('Not a valid PSD file')
  offset += 4

  const version = view.getUint16(offset, false)
  offset += 2
  const isPSB = version === PSB_VERSION

  offset += 6 // reserved

  const channels = view.getUint16(offset, false)
  offset += 2

  const height = isPSB ? view.getUint32(offset, false) : view.getUint16(offset, false)
  offset += isPSB ? 4 : 2
  const width = isPSB ? view.getUint32(offset, false) : view.getUint16(offset, false)
  offset += isPSB ? 4 : 2

  const depth = view.getUint16(offset, false)
  offset += 2

  const colorMode = view.getUint16(offset, false)
  offset += 2

  // Color Mode Data Section
  const colorModeDataLength = view.getUint32(offset, false)
  offset += 4
  offset += colorModeDataLength // skip for now

  // Image Resources Section
  const imageResourcesLength = view.getUint32(offset, false)
  offset += 4
  const resourcesEnd = offset + imageResourcesLength
  const resources = parseImageResources(view, offset, imageResourcesLength)
  offset = resourcesEnd

  // Layer and Mask Information Section
  const layerInfoLength = isPSB ? view.getUint64(offset, false) : view.getUint32(offset, false)
  offset += isPSB ? 8 : 4

  const layers = parseLayers(view, offset, width, height, isPSB)

  // Skip to image data
  // ... would continue parsing

  return {
    width,
    height,
    depth,
    colorMode: getColorModeName(colorMode),
    channels,
    resolution: { x: 72, y: 72 },
    units: 'pixels',
    layers: layers.layers,
    colorProfile: undefined,
    metadata: {},
    guides: resources.guides,
    slices: resources.slices,
  }
}

/** Parse image resources (guides, slices, etc.) */
function parseImageResources(view: DataView, offset: number, length: number): { guides: any[]; slices: any[] } {
  const guides: any[] = []
  const slices: any[] = []
  const end = offset + length

  while (offset < end) {
    const signature = readString(view, offset, 4)
    if (signature !== '8BIM') break
    offset += 4

    const resourceId = view.getUint16(offset, false)
    offset += 2

    const nameLength = view.getUint8(offset)
    offset += 1 + nameLength
    if (nameLength % 2 !== 0) offset++ // padding

    const dataLength = view.getUint32(offset, false)
    offset += 4

    if (resourceId === 1031) { // Guides
      const guideCount = view.getUint16(offset, false)
      offset += 2
      for (let i = 0; i < guideCount; i++) {
        const orientation = view.getUint8(offset) // 0 = horizontal, 1 = vertical
        const position = view.getUint32(offset + 1, false)
        guides.push({ id: `guide-${i}`, orientation: orientation === 0 ? 'horizontal' : 'vertical', position })
        offset += 5
      }
    } else if (resourceId === 1044) { // Slices
      // Parse slices
    }

    offset += dataLength
    if (offset % 2 !== 0) offset++ // padding
  }

  return { guides, slices }
}

/** Parse layers */
function parseLayers(view: DataView, offset: number, width: number, height: number, isPSB: boolean): { layers: PsdLayer[] } {
  const layerCount = isPSB ? view.getInt32(offset, false) : view.getInt16(offset, false)
  offset += isPSB ? 4 : 2

  const layers: PsdLayer[] = []
  const count = Math.abs(layerCount)

  for (let i = 0; i < count; i++) {
    const layer = parseLayerRecord(view, offset, width, height, isPSB)
    layers.push(layer.layer)
    offset = layer.offset
  }

  return { layers }
}

function parseLayerRecord(view: DataView, offset: number, width: number, height: number, isPSB: boolean): { layer: PsdLayer; offset: number } {
  const top = isPSB ? view.getInt32(offset, false) : view.getInt16(offset, false)
  offset += isPSB ? 4 : 2
  const left = isPSB ? view.getInt32(offset, false) : view.getInt16(offset, false)
  offset += isPSB ? 4 : 2
  const bottom = isPSB ? view.getInt32(offset, false) : view.getInt16(offset, false)
  offset += isPSB ? 4 : 2
  const right = isPSB ? view.getInt32(offset, false) : view.getInt16(offset, false)
  offset += isPSB ? 4 : 2

  const channelCount = view.getUint16(offset, false)
  offset += 2

  const channels: PsdChannel[] = []
  for (let i = 0; i < channelCount; i++) {
    const channelId = view.getUint16(offset, false)
    offset += 2
    const dataLength = isPSB ? view.getUint64(offset, false) : view.getUint32(offset, false)
    offset += isPSB ? 8 : 4
    channels.push({ id: channelId, name: '', type: 'red', data: new Uint8Array(0), compression: 'raw' })
    offset += dataLength // skip data
  }

  const signature = readString(view, offset, 4)
  offset += 4
  const blendModeKey = readString(view, offset, 4)
  offset += 4

  const opacity = view.getUint8(offset++)
  const clipping = view.getUint8(offset++)
  const flags = view.getUint8(offset++)
  offset++ // padding

  const layer: PsdLayer = {
    id: 'layer-' + Date.now(),
    name: '',
    type: 'layer',
    visible: (flags & 1) === 0,
    opacity: opacity / 255 * 100,
    blendMode: getBlendModeName(blendModeKey),
    clipping: clipping === 1,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    channels,
    children: [],
  }

  // Layer extra data
  const extraLength = isPSB ? view.getUint64(offset, false) : view.getUint32(offset, false)
  offset += isPSB ? 8 : 4

  const extraEnd = offset + extraLength
  while (offset < extraEnd) {
    const sig = readString(view, offset, 4)
    offset += 4
    const key = readString(view, offset, 4)
    offset += 4
    const len = isPSB ? view.getUint64(offset, false) : view.getUint32(offset, false)
    offset += isPSB ? 8 : 4

    if (key === 'luni') {
      // Unicode name
      const nameLen = view.getUint32(offset, false)
      offset += 4
      layer.name = readString(view, offset, nameLen * 2)
      offset += nameLen * 2
    } else if (key === 'lsct') {
      // Section divider (layer group)
      layer.type = 'group'
    } else if (key === 'lfx2') {
      // Layer effects
      layer.effects = parseLayerEffects(view, offset)
    } else if (key === 'lspf') {
      // Layer mask
      layer.mask = parseLayerMask(view, offset)
    } else if (key === 'lrFX') {
      // Legacy effects
    } else if (key === 'TySh') {
      // Text layer
      layer.type = 'text'
      layer.text = parseTextLayer(view, offset)
    } else if (key === 'PlLd') {
      // Pattern layer
    } else if (key === 'SoLd') {
      // Solid color fill
      layer.type = 'adjustment'
      layer.adjustment = { type: 'solid-color', params: {} }
    } else if (key === 'GrFl') {
      // Gradient fill
      layer.type = 'adjustment'
      layer.adjustment = { type: 'gradient', params: {} }
    } else if (key === 'lyvr') {
      // Layer version
    }

    offset += len
    if (offset % 2 !== 0) offset++ // padding
  }

  return { layer, offset }
}

function parseLayerEffects(view: DataView, offset: number): PsdLayerEffects {
  // Simplified - would parse all effect types
  return {}
}

function parseLayerMask(view: DataView, offset: number): PsdMask {
  const size = view.getUint32(offset, false)
  offset += 4
  // Parse mask data
  return {
    enabled: true,
    canvas: document.createElement('canvas'),
    density: 100,
    feather: 0,
    invert: false,
    relativeToLayer: true,
  }
}

function parseTextLayer(view: DataView, offset: number): PsdText {
  // Parse text layer data
  return {
    text: '',
    font: { name: '', size: 12, style: 'normal', weight: 400, stretch: 'normal', family: '' },
    paragraph: { alignment: 'left', leading: 120, tracking: 0, baselineShift: 0, indent: 0, spaceBefore: 0, spaceAfter: 0, hyphenation: false, language: 'en' },
    color: { r: 0, g: 0, b: 0, a: 1 },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0 },
  }
}

function getBlendModeName(key: string): string {
  const modes: Record<string, string> = {
    'norm': 'normal', 'dark': 'darken', 'lite': 'lighten', 'mul ': 'multiply',
    'scrn': 'screen', 'over': 'overlay', 'sLit': 'soft-light', 'hLit': 'hard-light',
    'diff': 'difference', 'smud': 'exclusion', 'hue ': 'hue', 'sat ': 'saturation',
    'colr': 'color', 'lum ': 'luminosity', 'lbrn': 'color-burn', 'lddg': 'color-dodge',
    'div ': 'divide', 'dkCl': 'darken', 'lgCl': 'lighten', 'lgLt': 'linear-dodge',
    'lgBr': 'linear-burn', 'vivL': 'vivid-light', 'linL': 'linear-light', 'pinL': 'pin-light',
    'hrdM': 'hard-mix', 'over': 'overlay', 'sLit': 'soft-light', 'hLit': 'hard-light',
  }
  return modes[key] || 'normal'
}

function getColorModeName(mode: number): PsdDocument['colorMode'] {
  const modes: PsdDocument['colorMode'][] = ['bitmap', 'grayscale', 'indexed', 'rgb', 'cmyk', 'multichannel', 'duotone', 'lab']
  return modes[mode] || 'rgb'
}

function readString(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, length))
}

/** Export to PSD format */
export async function exportToPsd(
  layers: PsdLayer[],
  width: number,
  height: number,
  options: { colorMode?: PsdDocument['colorMode']; depth?: 8 | 16 | 32 } = {}
): Promise<ArrayBuffer> {
  const colorMode = options.colorMode || 'rgb'
  const depth = options.depth || 8

  // This is a simplified PSD writer
  // Real implementation would write all sections properly

  const header = new ArrayBuffer(26)
  const view = new DataView(header)

  // Signature
  writeString(view, 0, '8BPS')
  view.setUint16(4, 1, false) // version
  view.setUint16(10, 3, false) // channels (RGB + alpha)
  view.setUint16(12, height, false)
  view.setUint16(14, width, false)
  view.setUint16(16, 8, false) // depth
  view.setUint16(18, getColorModeNumber(colorMode), false)

  // Would continue writing all sections...

  return header
}

function getColorModeNumber(mode: PsdDocument['colorMode']): number {
  const modes = { bitmap: 0, grayscale: 1, indexed: 2, rgb: 3, cmyk: 4, multichannel: 5, duotone: 6, lab: 7 }
  return modes[mode]
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

/** Composite PSD layers to canvas */
export async function compositePsdLayers(doc: PsdDocument): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(doc.width, doc.height)
  const ctx = ctx2d(canvas)

  // Fill background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, doc.width, doc.height)

  // Render layers bottom to top
  for (const layer of doc.layers) {
    await renderLayer(ctx, layer, doc)
  }

  return canvas
}

async function renderLayer(ctx: CanvasRenderingContext2D, layer: PsdLayer, doc: PsdDocument): Promise<void> {
  if (!layer.visible) return

  ctx.save()
  ctx.globalAlpha = layer.opacity / 100
  ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation

  if (layer.type === 'group' && layer.children) {
    for (const child of layer.children) {
      await renderLayer(ctx, child, doc)
    }
  } else if (layer.channels.length > 0) {
    // Would render layer from channel data
    // For now, draw placeholder
    ctx.fillStyle = '#cccccc'
    ctx.fillRect(layer.x, layer.y, layer.width, layer.height)
  }

  // Apply layer mask
  if (layer.mask?.enabled && layer.mask.canvas) {
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(layer.mask.canvas, layer.x, layer.y)
    ctx.globalCompositeOperation = 'source-over'
  }

  // Apply layer effects
  if (layer.effects) {
    await applyLayerEffects(ctx, layer.effects, layer)
  }

  ctx.restore()
}

async function applyLayerEffects(ctx: CanvasRenderingContext2D, effects: PsdLayerEffects, layer: PsdLayer): Promise<void> {
  // Would apply drop shadow, inner shadow, etc.
  // Simplified
}

/** Convert editor layers to PSD format */
export function layersToPsd(layers: any[], width: number, height: number): PsdLayer[] {
  return layers.map(layer => ({
    id: layer.id,
    name: layer.name,
    type: layer.type || 'layer',
    visible: layer.visible,
    opacity: Math.round((layer.opacity || 1) * 255),
    blendMode: layer.blendMode || 'normal',
    clipping: layer.clipped || false,
    x: layer.x || 0,
    y: layer.y || 0,
    width: layer.width || 1,
    height: layer.height || 1,
    mask: layer.mask ? {
      enabled: true,
      canvas: layer.mask.canvas,
      density: layer.mask.density || 100,
      feather: layer.mask.feather || 0,
      invert: layer.mask.invert || false,
      relativeToLayer: true,
    } : undefined,
    effects: layer.effects,
    channels: [],
    children: layer.children ? layersToPsd(layer.children, width, height) : undefined,
  }))
}