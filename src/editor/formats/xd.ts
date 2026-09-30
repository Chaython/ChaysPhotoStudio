import { readZipEntries, jsonEntry } from './archive'
import type { ParsedDocument, ParsedDocumentLayer } from './document-parser-types'
import { bytesToCanvas, finite, percentOpacity, rgbaCss, safeName } from './parser-utils'
import { createCanvas, ctx2d } from '../utils/canvas'

type J = Record<string, any>

function childrenOf(node: J): any[] {
  if (Array.isArray(node.children)) return node.children
  if (Array.isArray(node?.group?.children)) return node.group.children
  if (Array.isArray(node?.artboard?.children)) return node.artboard.children
  return []
}

function collectSymbols(node: any, map: Map<string, J>) {
  if (!node || typeof node !== 'object') return
  if (node.id) map.set(String(node.id), node)
  for (const child of childrenOf(node)) collectSymbols(child, map)
}

function simpleTransform(node: J): { sx: number; sy: number; tx: number; ty: number; rotated: boolean } {
  const t = node.transform
  if (!t) return { sx: 1, sy: 1, tx: 0, ty: 0, rotated: false }
  const a = finite(t.a, 1), b = finite(t.b, 0), c = finite(t.c, 0), d = finite(t.d, 1)
  return { sx: a, sy: d, tx: finite(t.tx, 0), ty: finite(t.ty, 0), rotated: Math.abs(b) > 1e-5 || Math.abs(c) > 1e-5 }
}

function xdStyle(node: J): { fill: string | null; stroke: string | null; strokeWidth: number; opacity: number } {
  const style = node.style ?? {}
  const fill = style?.fill?.type === 'none' ? null
    : style?.fill?.color ? rgbaCss(style.fill.color, '#000000') : null
  const stroke = style?.stroke?.type === 'none' ? null
    : style?.stroke?.color ? rgbaCss(style.stroke.color, '#000000') : null
  return {
    fill,
    stroke,
    strokeWidth: Math.max(0, finite(style?.stroke?.width, 0)),
    opacity: percentOpacity(style.opacity, 100),
  }
}

function textLayer(node: J, ox: number, oy: number, warnings: string[]): ParsedDocumentLayer {
  const t = simpleTransform(node)
  if (t.rotated) warnings.push(`XD text “${safeName(node.name, 'Text')}” has rotation/skew that is approximated on import`)
  const style = node.style ?? {}
  const font = style.font ?? {}
  const raw = String(node?.text?.rawText ?? '')
  let segmentStyle: any = null
  const paragraphs = node?.text?.paragraphs
  if (Array.isArray(paragraphs)) {
    outer: for (const p of paragraphs) for (const line of p?.lines ?? []) for (const seg of line ?? []) {
      if (seg?.style || seg?.font) { segmentStyle = seg; break outer }
    }
  }
  const fontStyle = segmentStyle?.style?.font ?? segmentStyle?.font ?? font
  const fontSize = Math.max(1, finite(fontStyle?.size, finite(font.size, 16)))
  const color = style?.fill?.color
    ? rgbaCss(style.fill.color, '#000000')
    : segmentStyle?.style?.fill?.color ? rgbaCss(segmentStyle.style.fill.color, '#000000') : '#000000'
  const meta = node?.meta?.ux ?? {}
  const boxW = Math.max(1, finite(meta.viewportWidth, finite(node?.text?.frame?.width, 1)))
  const boxH = Math.max(fontSize * 1.2, finite(meta.viewportHeight, finite(node?.text?.frame?.height, fontSize * 1.2)))
  return {
    kind: 'text',
    name: safeName(node.name ?? node.id, 'Text'),
    opacity: percentOpacity(style.opacity, 100),
    text: {
      content: raw,
      fontFamily: String(fontStyle?.family ?? fontStyle?.postscriptName ?? 'Arial'),
      fontSize: Math.abs(fontSize * (t.sy || 1)),
      color,
      bold: /bold|semibold|demi/i.test(String(fontStyle?.style ?? fontStyle?.postscriptName ?? '')),
      italic: /italic|oblique/i.test(String(fontStyle?.style ?? fontStyle?.postscriptName ?? '')),
      align: 'left',
      lineHeight: 1.2,
      tracking: 0,
      boxWidth: Math.abs(boxW * (t.sx || 1)),
      boxHeight: Math.abs(boxH * (t.sy || 1)),
      x: ox + t.tx,
      y: oy + t.ty + fontSize,
    },
    metadata: { sourceFormat: 'xd', sourceType: 'text', sourceId: node.id },
  }
}

function shapeLayer(node: J, ox: number, oy: number, warnings: string[]): ParsedDocumentLayer | null {
  const shape = node.shape
  if (!shape || typeof shape !== 'object') return null
  const tr = simpleTransform(node)
  if (tr.rotated) warnings.push(`XD shape “${safeName(node.name, shape.type)}” has rotation/skew that is approximated on import`)
  const st = xdStyle(node)
  const sx = tr.sx || 1, sy = tr.sy || 1
  let kind: 'rect' | 'rounded-rect' | 'ellipse' | 'polygon' | 'line'
  let x = 0, y = 0, w = 1, h = 1, radius = 0, sides = 5
  switch (shape.type) {
    case 'rect':
      kind = Array.isArray(shape.r) && shape.r.some((v: number) => finite(v) > 0) ? 'rounded-rect' : 'rect'
      x = finite(shape.x); y = finite(shape.y); w = finite(shape.width, 1); h = finite(shape.height, 1)
      radius = Array.isArray(shape.r) ? Math.max(...shape.r.map((v: any) => finite(v))) : finite(shape.r)
      break
    case 'circle':
      kind = 'ellipse'
      x = finite(shape.cx) - finite(shape.r); y = finite(shape.cy) - finite(shape.r)
      w = h = finite(shape.r, 1) * 2
      break
    case 'polygon': {
      kind = 'polygon'
      const pts = Array.isArray(shape.points) ? shape.points : []
      if (!pts.length) return null
      const xs = pts.map((p: any) => finite(p.x)), ys = pts.map((p: any) => finite(p.y))
      x = Math.min(...xs); y = Math.min(...ys); w = Math.max(1, Math.max(...xs) - x); h = Math.max(1, Math.max(...ys) - y)
      sides = Math.max(3, pts.length)
      break
    }
    case 'line':
      kind = 'line'
      x = finite(shape.x1); y = finite(shape.y1)
      w = Math.max(1, finite(shape.x2) - x); h = finite(shape.y2) - y
      break
    case 'path':
      warnings.push(`XD path “${safeName(node.name, 'Path')}” is retained in the visual fallback, but Bézier AGC paths are not yet mapped to editable anchors`)
      return null
    default:
      warnings.push(`XD shape type “${String(shape.type)}” is not yet mapped to an editable shape`)
      return null
  }
  return {
    kind: 'shape',
    name: safeName(node.name ?? node.id, String(shape.type ?? 'Shape')),
    opacity: st.opacity,
    shape: {
      shape: kind,
      x: ox + tr.tx + x * sx,
      y: oy + tr.ty + y * sy,
      w: Math.max(1, Math.abs(w * sx)),
      h: Math.max(1, Math.abs(h * sy)),
      radius: Math.max(0, Math.abs(radius * Math.min(sx, sy))),
      fill: st.fill,
      fillOpacity: 100,
      stroke: st.stroke,
      strokeWidth: st.strokeWidth,
      strokeOpacity: 100,
      sides,
      starInset: 50,
    },
    metadata: { sourceFormat: 'xd', sourceType: 'shape', sourceId: node.id },
  }
}

async function imagePatternLayer(node: J, entries: Map<string, any>, ox: number, oy: number): Promise<ParsedDocumentLayer | null> {
  const pattern = node?.style?.fill?.pattern
  const uid = String(pattern?.meta?.ux?.uid ?? '')
  if (!uid) return null
  const entry = entries.get(`resources/${uid}`)
  if (!entry) return null
  const source = await bytesToCanvas(entry.data)
  const width = Math.max(1, Math.round(finite(pattern.width, source.width)))
  const height = Math.max(1, Math.round(finite(pattern.height, source.height)))
  const canvas = createCanvas(width, height)
  const c = ctx2d(canvas)
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'
  c.drawImage(source, 0, 0, width, height)
  const tr = simpleTransform(node)
  return {
    kind: 'raster',
    name: safeName(node.name ?? node.id, 'Image'),
    opacity: percentOpacity(node?.style?.opacity, 100),
    left: ox + tr.tx,
    top: oy + tr.ty,
    canvas,
    metadata: { sourceFormat: 'xd', sourceType: 'pattern', sourceId: node.id, asset: entry.name },
  }
}

async function walk(
  nodes: any[],
  entries: Map<string, any>,
  symbols: Map<string, J>,
  layers: ParsedDocumentLayer[],
  ox: number,
  oy: number,
  warnings: string[],
  depth = 0,
): Promise<void> {
  if (!Array.isArray(nodes) || depth > 128) return
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    if (node.visible === false || node?.style?.visible === false) {
      // Visibility is represented on nodes inconsistently; preserve content but
      // mark hidden when a direct flag exists.
    }
    if (node.type === 'syncRef') {
      const ref = symbols.get(String(node.syncSourceGuid ?? ''))
      if (ref) {
        const t = simpleTransform(node)
        await walk([ref], entries, symbols, layers, ox + t.tx, oy + t.ty, warnings, depth + 1)
      } else warnings.push(`XD component reference ${String(node.syncSourceGuid ?? '')} is missing`)
      continue
    }
    if (node.type === 'text') {
      const l = textLayer(node, ox, oy, warnings)
      l.visible = node.visible !== false
      layers.push(l)
      continue
    }
    if (node.type === 'shape') {
      const image = await imagePatternLayer(node, entries, ox, oy)
      if (image) { image.visible = node.visible !== false; layers.push(image); continue }
      const l = shapeLayer(node, ox, oy, warnings)
      if (l) { l.visible = node.visible !== false; layers.push(l) }
      continue
    }
    const childNodes = childrenOf(node)
    if (childNodes.length) {
      const t = simpleTransform(node)
      await walk(childNodes, entries, symbols, layers, ox + t.tx, oy + t.ty, warnings, depth + 1)
    } else if (node.type && node.type !== 'artboard') {
      warnings.push(`XD object type “${String(node.type)}” is not yet editable`)
    }
  }
}

function artworkContainer(manifest: J): any[] {
  const children = Array.isArray(manifest?.children) ? manifest.children : []
  const artwork = children.find((c: any) => c?.name === 'artwork')
  return Array.isArray(artwork?.children) ? artwork.children : []
}

export async function parseXd(bytes: Uint8Array, fileName = 'Adobe XD document'): Promise<ParsedDocument> {
  const entries = await readZipEntries(bytes)
  const manifest = jsonEntry<J>(entries, 'manifest')
  if (!manifest) throw new Error('XD manifest is missing')
  const artboards = artworkContainer(manifest).filter((c: any) => c?.['uxdesign#bounds'])
  if (!artboards.length) throw new Error('XD document contains no artboards')
  const art = artboards[0]
  const bounds = art['uxdesign#bounds']
  const width = Math.max(1, Math.ceil(finite(bounds.width, 1)))
  const height = Math.max(1, Math.ceil(finite(bounds.height, 1)))
  const path = String(art.path ?? '')
  const scene = jsonEntry<J>(entries, `artwork/${path}/graphics/graphicContent.agc`)
  if (!scene) throw new Error('XD artboard graphicContent.agc is missing')

  const symbols = new Map<string, J>()
  const shared = jsonEntry<J>(entries, 'resources/graphics/graphicContent.agc')
  for (const symbol of shared?.resources?.meta?.ux?.symbols ?? []) collectSymbols(symbol, symbols)

  const layers: ParsedDocumentLayer[] = []
  const warnings: string[] = []
  await walk(scene.children ?? [], entries, symbols, layers, -finite(bounds.x), -finite(bounds.y), warnings)
  if (!layers.length) throw new Error('XD parser found no supported editable objects')
  return {
    width, height,
    name: safeName(art.name, fileName),
    sourceBitDepth: 8,
    layers,
    warnings,
  }
}
