/** Document-space artboards. They share one underlying compositor/layer stack.
 * This is a first step toward independent Illustrator/Fireworks artboard groups,
 * NOT separate layer trees or editable Illustrator page interchange.
 */
export interface Artboard {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  /** Optional per-artboard layer visibility. Undefined = all layers (legacy/default);
   * [] = empty artboard; an ID list = only those layers. This does not clone
   * editable layers or alter the document's global visibility flags. */
  visibleLayerIds?: string[]
  /** Optional Photoshop Layer Comp snapshots used as page rollover states.
   * Absent or stale ids gracefully fall back to the live document appearance. */
  rollover?: {
    normalCompId?: string
    hoverCompId?: string
    pressedCompId?: string
  }
}
export const MAX_ARTBOARDS = 64

export function normalizeArtboards(input: unknown, width: number, height: number): Artboard[] {
  if (!Array.isArray(input) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return []
  const out: Artboard[] = []
  const seen = new Set<string>()
  for (const candidate of input.slice(0, MAX_ARTBOARDS)) {
    if (!candidate || typeof candidate !== 'object') continue
    const a = candidate as Record<string, unknown>
    if (typeof a.id !== 'string' || a.id.length < 1 || a.id.length > 100 || seen.has(a.id)) continue
    if (typeof a.name !== 'string' || !a.name.trim()) continue
    const numbers = [a.x, a.y, a.width, a.height]
    if (!numbers.every(n => typeof n === 'number' && Number.isSafeInteger(n))) continue
    let [x, y, w, h] = numbers as number[]
    // Artboards may sit partly or fully outside the document canvas; those
    // regions export as transparent. Only positive dimensions are required.
    if (w < 1 || h < 1) continue
    seen.add(a.id)
    const visibleLayerIds = normalizeArtboardLayerIds(a.visibleLayerIds)
    const rollover = normalizeArtboardRollover(a.rollover)
    out.push({ id: a.id, name: a.name.trim().slice(0, 120), x, y, width: w, height: h,
      ...(visibleLayerIds === undefined ? {} : { visibleLayerIds }),
      ...(rollover === undefined ? {} : { rollover }),
    })
  }
  return out
}

/** Create evenly partitioned, non-overlapping artboards covering every source pixel. */
export function gridArtboards(
  width: number, height: number, columns: number, rows: number,
  idFactory: () => string,
): Artboard[] {
  if (![width, height, columns, rows].every(Number.isSafeInteger)
      || width < 1 || height < 1 || columns < 1 || rows < 1
      || columns > width || rows > height || columns * rows > MAX_ARTBOARDS) return []
  const result: Artboard[] = []
  for (let row = 0; row < rows; row++) {
    const y = Math.floor(row * height / rows)
    const bottom = Math.floor((row + 1) * height / rows)
    for (let col = 0; col < columns; col++) {
      const x = Math.floor(col * width / columns)
      const right = Math.floor((col + 1) * width / columns)
      result.push({
        id: idFactory(), name: 'Artboard ' + (result.length + 1),
        x, y, width: right - x, height: bottom - y,
      })
    }
  }
  return result
}

/** Crop an artboard against the document canvas. Returns the source region
 *  (clamped to canvas bounds), the destination offset within the artboard
 *  canvas, and the artboard canvas dimensions. Off-canvas artboards export
 *  with transparent padding. */
export interface ArtboardCrop {
  /** Source rectangle within the document canvas (clamped). */
  sx: number
  sy: number
  sw: number
  sh: number
  /** Destination offset in the artboard canvas where the source is painted. */
  dx: number
  dy: number
  /** Artboard canvas dimensions. */
  aw: number
  ah: number
}

/** Clamped document rectangle with no hidden off-canvas source requirements. */
export function artboardCrop(
  artboard: Artboard, documentWidth: number, documentHeight: number,
): ArtboardCrop | null {
  const valid = normalizeArtboards([artboard], documentWidth, documentHeight)[0]
  if (!valid) return null
  // Source region within the document canvas (clamped to canvas bounds).
  const sx = Math.min(documentWidth, Math.max(0, valid.x))
  const sy = Math.min(documentHeight, Math.max(0, valid.y))
  const sw = Math.max(0, Math.min(documentWidth, valid.x + valid.width) - sx)
  const sh = Math.max(0, Math.min(documentHeight, valid.y + valid.height) - sy)
  // Destination offset in the artboard canvas (negative origin → positive offset).
  const dx = Math.max(0, -valid.x)
  const dy = Math.max(0, -valid.y)
  return { sx, sy, sw, sh, dx, dy, aw: valid.width, ah: valid.height }
}


/** Move all artboards as Canvas Size / Crop change the document origin. */
export function translateArtboards(
  input: unknown, oldWidth: number, oldHeight: number,
  dx: number, dy: number, newWidth: number, newHeight: number,
): Artboard[] {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return []
  const original = normalizeArtboards(input, oldWidth, oldHeight)
  return normalizeArtboards(original.map(a => ({
    ...a, x: Math.round(a.x + dx), y: Math.round(a.y + dy),
  })), newWidth, newHeight)
}

/** Scale rectangle edges, not width independently: adjacent tiled boards retain matching borders. */
export function scaleArtboards(
  input: unknown, oldWidth: number, oldHeight: number,
  newWidth: number, newHeight: number,
): Artboard[] {
  if (![oldWidth, oldHeight, newWidth, newHeight].every(n => Number.isSafeInteger(n) && n > 0)) return []
  const sx = newWidth / oldWidth, sy = newHeight / oldHeight
  const original = normalizeArtboards(input, oldWidth, oldHeight)
  return normalizeArtboards(original.map(a => {
    const left = Math.round(a.x * sx), top = Math.round(a.y * sy)
    const right = Math.round((a.x + a.width) * sx)
    const bottom = Math.round((a.y + a.height) * sy)
    return { ...a, x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
  }), newWidth, newHeight)
}


/** Null/invalid input means default/all; a deliberately empty array means none.
 * IDs do not have to reference an existing layer: this enables safe import of
 * documents with stale references without ever rendering an unrelated layer. */
export function normalizeArtboardLayerIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) return undefined
  const ids: string[] = []
  const seen = new Set<string>()
  for (const id of value.slice(0, 4096)) {
    if (typeof id !== 'string' || !id || id.length > 100 || seen.has(id)) continue
    ids.push(id); seen.add(id)
  }
  return ids
}

/** Preserve the document's z-order and layer metadata while selecting only
 * page-specific content. This function must not mutate source layer objects. */
export function layersForArtboard<T extends { id: string; artboardId?: string }>(
  layers: readonly T[], artboard: Artboard,
): T[] {
  let result = layers.filter(layer =>
    layer.artboardId === undefined || layer.artboardId === artboard.id
  )
  if (artboard.visibleLayerIds === undefined) return result
  const include = new Set(artboard.visibleLayerIds)
  return result.filter(layer => include.has(layer.id))
}


export type RolloverSlot = 'normal' | 'hover' | 'pressed'
export type ArtboardRollover = NonNullable<Artboard['rollover']>

export function normalizeArtboardRollover(input: unknown): ArtboardRollover | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const r = input as Record<string, unknown>
  const id = (value: unknown) =>
    typeof value === 'string' && value.length > 0 && value.length <= 100 ? value : undefined
  const normalCompId = id(r.normalCompId), hoverCompId = id(r.hoverCompId), pressedCompId = id(r.pressedCompId)
  return normalCompId || hoverCompId || pressedCompId ? {
    ...(normalCompId ? { normalCompId } : {}),
    ...(hoverCompId ? { hoverCompId } : {}),
    ...(pressedCompId ? { pressedCompId } : {}),
  } : undefined
}

/** Safe standalone CSS rollover preview. Each state file is a flattened page
 * snapshot, not a Fireworks project or a runnable external JavaScript payload.
 */
export function buildArtboardRolloverHtml(
  title: string, width: number, height: number,
  images: { normal: string; hover?: string; pressed?: string },
): string {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw Error('Invalid artboard dimensions')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const url = (s: string) => encodeURIComponent(s).replace(/'/g, '%27')
  const lines = [
    '<!doctype html>', '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + esc(title) + ' rollover preview</title>', '<style>',
    '.rollover { display:block; width:' + width + 'px; height:' + height
      + 'px; border:0; padding:0; cursor:pointer; background-position:center; background-repeat:no-repeat;'
      + ' background-size:100% 100%; background-image:url("' + url(images.normal) + '"); }',
    ...(images.hover ? ['.rollover:hover, .rollover:focus-visible { background-image:url("' + url(images.hover) + '"); }'] : []),
    ...(images.pressed ? ['.rollover:active { background-image:url("' + url(images.pressed) + '"); }'] : []),
    '</style></head><body>',
    '<button class="rollover" type="button" aria-label="' + esc(title) + ' interactive states"></button>',
    '</body></html>', '',
  ]
  return lines.join('\n')
}
