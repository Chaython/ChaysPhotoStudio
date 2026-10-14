// Fireworks-inspired web regions. Not a native Fireworks PNG decoder.
export type WebRegionKind = 'slice' | 'hotspot'
export interface WebRegion {
  id: string
  kind: WebRegionKind
  name: string
  x: number
  y: number
  width: number
  height: number
  href?: string
  alt?: string
  target?: '_self' | '_blank'
}
export const MAX_WEB_REGIONS = 128

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
    x = Math.max(0, x); y = Math.max(0, y)
    w = Math.min(width - x, w); h = Math.min(height - y, h)
    if (w < 1 || h < 1) continue
    ids.add(r.id)
    out.push({
      id: r.id, kind: r.kind, name: typeof r.name === 'string' ? r.name.slice(0, 120) : r.kind,
      x, y, width: w, height: h,
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
    const coords = [r.x, r.y, r.x + r.width, r.y + r.height].join(',')
    return '    <area shape="rect" coords="' + coords + '" href="' + escapeWebHtml(href)
      + '" alt="' + escapeWebHtml(r.alt || r.name) + '" target="' + r.target
      + '"' + (r.target === '_blank' ? ' rel="noopener noreferrer"' : '') + '>'
  }).filter(Boolean)
  const hasMap = areas.length > 0
  const image = '  <img src="' + escapeWebHtml(imageName) + '" alt="Exported artwork" width="'
    + width + '" height="' + height + '" style="max-width:100%;height:auto"'
    + (hasMap ? ' usemap="#studio-web-map"' : '') + '>'
  return [
    '<!doctype html>', '<html lang="en">', '<head>', '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width,initial-scale=1">',
    '  <title>Exported web artwork</title>', '</head>', '<body>',
    image, ...(hasMap ? ['  <map name="studio-web-map">', ...areas, '  </map>'] : []),
    '</body>', '</html>', '',
  ].join('\n')
}
