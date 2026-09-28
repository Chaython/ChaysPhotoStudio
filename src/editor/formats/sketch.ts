import { readZipEntries, jsonEntry, findEntry } from './archive'
import type { ParsedDocument, ParsedDocumentLayer } from './document-parser-types'
import { bytesToCanvas, finite, percentOpacity, rgbaCss, safeName } from './parser-utils'
import { createCanvas, ctx2d } from '../utils/canvas'

type J = Record<string, any>

function enabled(items: any): any[] {
  return Array.isArray(items) ? items.filter(v => v && v.isEnabled !== false) : []
}

function sketchFill(style: J | undefined): string | null {
  const fill = enabled(style?.fills).find(f => f.fillType === 0 || f.fillType == null)
  return fill?.color ? rgbaCss(fill.color, '#000000') : null
}
function sketchStroke(style: J | undefined): { color: string | null; width: number } {
  const border = enabled(style?.borders)[0]
  return {
    color: border?.color ? rgbaCss(border.color, '#000000') : null,
    width: Math.max(0, finite(border?.thickness, 0)),
  }
}

function textSpec(node: J, x: number, y: number): ParsedDocumentLayer {
  const attrs = node?.attributedString?.attributes?.[0]?.attributes
    ?? node?.style?.textStyle?.encodedAttributes
    ?? {}
  const font = attrs?.MSAttributedStringFontAttribute?.attributes ?? {}
  const paragraph = attrs?.paragraphStyle ?? attrs?.NSParagraphStyle ?? {}
  const size = Math.max(1, finite(font.size, finite(node?.style?.textStyle?.encodedAttributes?.MSAttributedStringFontAttribute?.attributes?.size, 16)))
  const alignCode = finite(paragraph.alignment, 0)
  const align = alignCode === 2 ? 'center' : alignCode === 1 ? 'right' : 'left'
  const frame = node.frame ?? {}
  return {
    kind: 'text',
    name: safeName(node.name, 'Text'),
    visible: node.isVisible !== false,
    opacity: percentOpacity(node?.style?.contextSettings?.opacity, 100),
    text: {
      content: String(node?.attributedString?.string ?? node?.name ?? ''),
      fontFamily: String(font.name ?? font.family ?? 'Arial'),
      fontSize: size,
      color: rgbaCss(attrs?.MSAttributedStringColorAttribute, '#000000'),
      bold: /bold|semibold|demi/i.test(String(font.name ?? '')),
      italic: /italic|oblique/i.test(String(font.name ?? '')),
      align,
      lineHeight: Math.max(0.5, finite(attrs?.paragraphStyle?.maximumLineHeight ?? attrs?.paragraphStyle?.minimumLineHeight, size * 1.2) / size),
      tracking: finite(attrs?.kerning, 0),
      boxWidth: Math.max(1, finite(frame.width, 1)),
      boxHeight: Math.max(1, finite(frame.height, size * 1.2)),
      x,
      y: y + size,
    },
    metadata: { sourceFormat: 'sketch', sourceClass: 'text', sourceId: node.do_objectID },
  }
}

function shapeLayer(node: J, x: number, y: number): ParsedDocumentLayer | null {
  const frame = node.frame ?? {}
  const w = Math.max(1, finite(frame.width, 1))
  const h = Math.max(1, finite(frame.height, 1))
  const stroke = sketchStroke(node.style)
  let shape: 'rect' | 'rounded-rect' | 'ellipse' | 'triangle' | 'polygon' | 'star' | 'line' = 'rect'
  switch (node._class) {
    case 'oval': shape = 'ellipse'; break
    case 'triangle': shape = 'triangle'; break
    case 'polygon': shape = 'polygon'; break
    case 'star': shape = 'star'; break
    case 'line': shape = 'line'; break
    case 'rectangle': shape = Array.isArray(node.fixedRadius) && node.fixedRadius.some((v: number) => v > 0) ? 'rounded-rect' : 'rect'; break
    default: return null
  }
  const radius = Math.max(0,
    finite(node.fixedRadius, 0)
    || finite(Array.isArray(node.points) ? node.points[0]?.cornerRadius : 0, 0),
  )
  return {
    kind: 'shape',
    name: safeName(node.name, node._class),
    visible: node.isVisible !== false,
    opacity: percentOpacity(node?.style?.contextSettings?.opacity, 100),
    shape: {
      shape,
      x, y, w, h,
      radius,
      fill: sketchFill(node.style),
      fillOpacity: 100,
      stroke: stroke.color,
      strokeWidth: stroke.width,
      strokeOpacity: 100,
      sides: Math.max(3, Math.round(finite(node.numberOfPoints, shape === 'triangle' ? 3 : 5))),
      starInset: Math.max(1, Math.min(99, finite(node.radius, 0.5) * 100)),
    },
    metadata: { sourceFormat: 'sketch', sourceClass: node._class, sourceId: node.do_objectID },
  }
}

async function bitmapLayer(node: J, entries: Map<string, any>, x: number, y: number): Promise<ParsedDocumentLayer | null> {
  const ref = String(node?.image?._ref ?? node?.image?.ref ?? '').replace(/^\/+/, '')
  if (!ref) return null
  const candidates = [
    ref,
    ref.startsWith('images/') ? ref : `images/${ref}`,
  ]
  let entry = candidates.map(n => entries.get(n)).find(Boolean)
  if (!entry) entry = findEntry(entries, n => n.endsWith('/' + ref) || n === ref)
  if (!entry) return null
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : ext === 'gif' ? 'image/gif' : 'image/png'
  const source = await bytesToCanvas(entry.data, mime)
  const frame = node.frame ?? {}
  const w = Math.max(1, Math.round(finite(frame.width, source.width)))
  const h = Math.max(1, Math.round(finite(frame.height, source.height)))
  let canvas = source
  if (source.width !== w || source.height !== h) {
    canvas = createCanvas(w, h)
    const c = ctx2d(canvas)
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    c.drawImage(source, 0, 0, w, h)
  }
  return {
    kind: 'raster',
    name: safeName(node.name, 'Bitmap'),
    visible: node.isVisible !== false,
    opacity: percentOpacity(node?.style?.contextSettings?.opacity, 100),
    left: x,
    top: y,
    canvas,
    metadata: { sourceFormat: 'sketch', sourceClass: 'bitmap', sourceId: node.do_objectID, asset: entry.name },
  }
}

async function walk(
  nodes: any[],
  entries: Map<string, any>,
  out: ParsedDocumentLayer[],
  baseX: number,
  baseY: number,
  warnings: string[],
): Promise<void> {
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || node.isVisible === false) {
      if (node?.isVisible === false) {
        // Still import hidden layers semantically.
      } else continue
    }
    const frame = node.frame ?? {}
    const x = baseX + finite(frame.x, 0)
    const y = baseY + finite(frame.y, 0)
    if (node._class === 'text') {
      out.push(textSpec(node, x, y))
      continue
    }
    if (node._class === 'bitmap') {
      const layer = await bitmapLayer(node, entries, x, y)
      if (layer) out.push(layer)
      else warnings.push(`Sketch bitmap “${safeName(node.name)}” references a missing asset`)
      continue
    }
    const shape = shapeLayer(node, x, y)
    if (shape) { out.push(shape); continue }

    const children = node.layers
      ?? node?.group?.children
      ?? node?.artboard?.children
      ?? node?.shapeGroup?.children
    if (Array.isArray(children)) {
      await walk(children, entries, out, x, y, warnings)
      continue
    }
    if (!['_class', 'page'].includes(node._class)) {
      warnings.push(`Sketch ${safeName(node.name, node._class || 'object')} uses unsupported editable object type “${String(node._class ?? 'unknown')}”`)
    }
  }
}

function unionBounds(nodes: any[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const visit = (list: any[], bx = 0, by = 0) => {
    for (const n of list ?? []) {
      const f = n?.frame ?? {}
      const x = bx + finite(f.x, 0), y = by + finite(f.y, 0)
      const w = Math.max(0, finite(f.width, 0)), h = Math.max(0, finite(f.height, 0))
      if (w > 0 && h > 0) {
        minX = Math.min(minX, x); minY = Math.min(minY, y)
        maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h)
      }
      if (Array.isArray(n?.layers)) visit(n.layers, x, y)
    }
  }
  visit(nodes)
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1024, h: 768 }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
}

export async function parseSketch(bytes: Uint8Array, fileName = 'Sketch document'): Promise<ParsedDocument> {
  const entries = await readZipEntries(bytes)
  const document = jsonEntry<J>(entries, 'document.json')
  if (!document) throw new Error('Sketch document.json is missing')

  const pageRefs: string[] = Array.isArray(document.pages)
    ? document.pages.map((p: any) => String(p?._ref ?? '')).filter(Boolean)
    : []
  const pages: J[] = []
  for (const ref of pageRefs) {
    const candidates = [ref, ref + '.json', ref.startsWith('pages/') ? ref : `pages/${ref}.json`]
    const page = candidates.map(p => jsonEntry<J>(entries, p)).find(Boolean)
    if (page) pages.push(page)
  }
  if (!pages.length) {
    for (const [name] of entries) {
      if (/^pages\/[^/]+\.json$/i.test(name)) {
        const page = jsonEntry<J>(entries, name)
        if (page) pages.push(page)
      }
    }
  }
  if (!pages.length) throw new Error('Sketch document contains no page JSON')

  const page = pages[0]
  const top = Array.isArray(page.layers) ? page.layers : []
  const firstArtboard = top.find((n: any) => n?._class === 'artboard' && n?.frame)
  const bounds = firstArtboard
    ? {
        x: finite(firstArtboard.frame.x, 0),
        y: finite(firstArtboard.frame.y, 0),
        w: Math.max(1, finite(firstArtboard.frame.width, 1)),
        h: Math.max(1, finite(firstArtboard.frame.height, 1)),
      }
    : unionBounds(top)
  const selected = firstArtboard && Array.isArray(firstArtboard.layers) ? firstArtboard.layers : top
  const layers: ParsedDocumentLayer[] = []
  const warnings: string[] = []
  await walk(selected, entries, layers, -bounds.x, -bounds.y, warnings)

  if (!layers.length) throw new Error('Sketch parser found no supported editable layers')
  return {
    width: Math.max(1, Math.ceil(bounds.w)),
    height: Math.max(1, Math.ceil(bounds.h)),
    name: fileName,
    sourceBitDepth: 8,
    layers,
    warnings,
  }
}
