// Fireworks-inspired web regions. Not a native Fireworks PNG decoder.
// Exported image maps must stay at intrinsic pixel size: scaling the <img>
// without recalculating <area> coords makes the clickable hotspots misalign.
export type WebRegionKind = 'slice' | 'hotspot'
// Slices stay rectangular; circle/polygon shapes apply to hotspots only.
export type WebRegionShape = 'rect' | 'circle' | 'poly'
export interface WebRegion {
  id: string
  kind: WebRegionKind
  name: string
  x: number
  y: number
  width: number
  height: number
  shape?: WebRegionShape
  /** Flat integer [x0,y0,x1,y1,...] polygon vertices; polygon hotspots only. */
  points?: number[]
  href?: string
  alt?: string
  target?: '_self' | '_blank'
}
export const MAX_WEB_REGIONS = 128
/** Polygon hotspots accept at most 60 vertices (120 coordinate entries). */
export const MAX_WEB_REGION_POINTS = 60

export function regionShape(r: Pick<WebRegion, 'kind' | 'shape'>): WebRegionShape {
  return r.kind === 'hotspot' && r.shape ? r.shape : 'rect'
}

/** Circle hotspots are stored as their square bounding box; derive center/radius. */
export function circleMetrics(r: Pick<WebRegion, 'x' | 'y' | 'width' | 'height'>): { cx: number; cy: number; radius: number } {
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, radius: Math.min(r.width, r.height) / 2 }
}

export function fileStem(value: string): string {
  return value.replace(/\.zproj\.json$/i, '').replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/\s+/g, '-')
    .replace(/^\.+/, '').slice(0, 90) || 'Artwork'
}

export function webSafeHref(value: string): string {
  const text = value.trim()
  if (!text || /[\x00-\x20\x7f"'<>\\]/.test(text) || text.startsWith('//')) return ''
  if (/^(?:https?:\/\/|mailto:)/i.test(text)) return text
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.includes(':')) return ''
  return text
}

export function normalizeWebRegions(input: unknown, width: number, height: number): WebRegion[] {
  if (!Array.isArray(input) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return []
  const out: WebRegion[] = []
  const ids = new Set<string>()
  for (const candidate of input.slice(0, MAX_WEB_REGIONS)) {
    if (!candidate || typeof candidate !== 'object') continue
    const r = candidate as Record<string, unknown>
    if (r.kind !== 'slice' && r.kind !== 'hotspot') continue
    if (typeof r.id !== 'string' || !r.id || ids.has(r.id) || r.id.length > 100) continue
    const coords = [r.x, r.y, r.width, r.height].map(Number)
    if (coords.some(n => !Number.isSafeInteger(n))) continue
    let [x, y, w, h] = coords
    if (w < 1 || h < 1 || x >= width || y >= height || x + w <= 0 || y + h <= 0) continue
    const kind = r.kind
    const shape: WebRegionShape = kind === 'hotspot' && r.shape === 'circle' ? 'circle'
      : kind === 'hotspot' && r.shape === 'poly' ? 'poly' : 'rect'
    let points: number[] | undefined
    if (shape === 'poly') {
      // Polygon vertices: flat integer pairs clamped to the document, with a
      // recomputed bounding box so legacy rect code paths keep working.
      if (!Array.isArray(r.points)) continue
      const raw = r.points.slice(0, MAX_WEB_REGION_POINTS * 2)
      if (raw.length < 6 || raw.length % 2 !== 0) continue
      if (raw.some(n => !Number.isSafeInteger(n))) continue
      points = []
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      const distinct = new Set<string>()
      for (let i = 0; i < raw.length; i += 2) {
        const px = Math.max(0, Math.min(width - 1, raw[i]))
        const py = Math.max(0, Math.min(height - 1, raw[i + 1]))
        points.push(px, py)
        distinct.add(px + ',' + py)
        minX = Math.min(minX, px); maxX = Math.max(maxX, px)
        minY = Math.min(minY, py); maxY = Math.max(maxY, py)
      }
      // Degenerate polygons (a single point or a two-point line) have no clickable area.
      if (distinct.size < 3) continue
      x = minX; y = minY; w = maxX - minX + 1; h = maxY - minY + 1
      if (w < 1 || h < 1) continue
    } else if (shape === 'circle') {
      // Keep circles square so the derived radius matches the drawn bounds.
      const side = Math.min(w, h)
      w = side; h = side
    }
    const right = Math.min(width, x + w), bottom = Math.min(height, y + h)
    x = Math.max(0, x); y = Math.max(0, y)
    w = right - x; h = bottom - y
    if (w < 1 || h < 1) continue
    ids.add(r.id)
    out.push({
      id: r.id, kind, name: typeof r.name === 'string' ? r.name.slice(0, 120) : kind,
      x, y, width: w, height: h,
      ...(shape === 'circle' ? { shape: 'circle' as const }
        : shape === 'poly' && points ? { shape: 'poly' as const, points } : {}),
      href: typeof r.href === 'string' ? r.href.slice(0, 2048) : '',
      alt: typeof r.alt === 'string' ? r.alt.slice(0, 280) : '',
      target: r.target === '_blank' ? '_blank' : '_self',
    })
  }
  return out
}
export function escapeWebHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
export function buildImageMapHtml(imageName: string, width: number, height: number, rawRegions: unknown): string {
  const regions = normalizeWebRegions(rawRegions, width, height)
  const areas = regions.filter(r => r.kind === 'hotspot').map(r => {
    const href = webSafeHref(r.href || '')
    if (!href) return ''
    let shapeAttr = 'rect', coords: string
    if (regionShape(r) === 'circle') {
      const c = circleMetrics(r)
      shapeAttr = 'circle'
      coords = [Math.round(c.cx), Math.round(c.cy), Math.max(1, Math.round(c.radius))].join(',')
    } else if (regionShape(r) === 'poly' && r.points && r.points.length >= 6) {
      shapeAttr = 'poly'
      coords = r.points.join(',')
    } else {
      coords = [r.x, r.y, r.x + r.width, r.y + r.height].join(',')
    }
    return '    <area shape="' + shapeAttr + '" coords="' + coords + '" href="' + escapeWebHtml(href)
      + '" alt="' + escapeWebHtml(r.alt || r.name) + '" target="' + r.target
      + '"' + (r.target === '_blank' ? ' rel="noopener noreferrer"' : '') + '>'
  }).filter(Boolean)
  const hasMap = areas.length > 0
  const image = '  <img src="' + escapeWebHtml(imageName) + '" alt="Exported artwork" width="'
    + width + '" height="' + height + '"'
    + (hasMap ? ' usemap="#studio-web-map"' : '') + '>'
  return [
    '<!doctype html>', '<html lang="en">', '<head>', '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width,initial-scale=1">',
    '  <title>Exported web artwork</title>', '</head>', '<body>',
    image, ...(hasMap ? ['  <map name="studio-web-map">', ...areas, '  </map>'] : []),
    '</body>', '</html>', '',
  ].join('\n')
}
