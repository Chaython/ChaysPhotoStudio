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
    if (w < 1 || h < 1 || x >= width || y >= height || x + w <= 0 || y + h <= 0) continue
    // Preserve the original rectangle's far edge when clipping negative origins.
    const right = Math.min(width, x + w), bottom = Math.min(height, y + h)
    x = Math.max(0, x); y = Math.max(0, y)
    w = right - x; h = bottom - y
    if (w < 1 || h < 1) continue
    seen.add(a.id)
    const visibleLayerIds = normalizeArtboardLayerIds(a.visibleLayerIds)
    out.push({ id: a.id, name: a.name.trim().slice(0, 120), x, y, width: w, height: h,
      ...(visibleLayerIds === undefined ? {} : { visibleLayerIds }) })
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

/** Clamped document rectangle with no hidden off-canvas source requirements. */
export function artboardCrop(
  artboard: Artboard, documentWidth: number, documentHeight: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const valid = normalizeArtboards([artboard], documentWidth, documentHeight)[0]
  return valid ? { sx: valid.x, sy: valid.y, sw: valid.width, sh: valid.height } : null
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
export function layersForArtboard<T extends { id: string }>(
  layers: readonly T[], artboard: Artboard,
): T[] {
  if (artboard.visibleLayerIds === undefined) return Array.from(layers)
  const include = new Set(artboard.visibleLayerIds)
  return layers.filter(layer => include.has(layer.id))
}
