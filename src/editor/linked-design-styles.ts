/** Document-embedded linked brand styles.
 *
 * Resolved values live on the existing editable shape/text layer. Links are
 * metadata pointing to a stable ID in the document's own style table.
 * This ensures exports, old renderers, offline projects and external file
 * interchange have sensible values even when a local brand kit is deleted.
 */
import type { Layer, PsDocument } from './types'
import type { BrandKit } from './library/design-library'

export type LinkedStyleKind = 'color' | 'font'
export type LinkedStyleSlot = 'fill' | 'textColor' | 'fontFamily'
export interface LinkedDesignStyle {
  id: string
  kind: LinkedStyleKind
  name: string
  value: string
  sourceKitId: string
  sourceItemId: string
}
export type LayerStyleReferences = Partial<Record<LinkedStyleSlot, string>>
const MAX_STYLES = 256
const validId = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && s.length <= 300 && !/[\u0000-\u001f\u007f]/.test(s)
const validFont = (s: unknown): s is string =>
  typeof s === 'string' && s.trim().length > 0 && s.length <= 150 && !/[\u0000-\u001f\u007f]/.test(s)
const validColor = (s: unknown): s is string =>
  typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)

export function normalizeLinkedDesignStyles(input: unknown): LinkedDesignStyle[] {
  if (!Array.isArray(input)) return []
  const result: LinkedDesignStyle[] = [], seen = new Set<string>()
  for (const s of input.slice(0, MAX_STYLES)) {
    if (!s || typeof s !== 'object') continue
    const item = s as Record<string, unknown>
    if (!validId(item.id) || seen.has(item.id) || !validId(item.sourceKitId) ||
      !validId(item.sourceItemId) || typeof item.name !== 'string' || !item.name.trim() ||
      (item.kind !== 'color' && item.kind !== 'font')) continue
    if (item.kind === 'color' ? !validColor(item.value) : !validFont(item.value)) continue
    seen.add(item.id)
    result.push({
      id: item.id, kind: item.kind, name: item.name.trim().slice(0, 100),
      value: item.kind === 'color' ? (item.value as string).toUpperCase() : (item.value as string).trim(),
      sourceKitId: item.sourceKitId, sourceItemId: item.sourceItemId,
    })
  }
  return result
}

export function normalizeLayerStyleReferences(input: unknown): LayerStyleReferences | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const raw = input as Record<string, unknown>, result: LayerStyleReferences = {}
  for (const slot of ['fill', 'textColor', 'fontFamily'] as const) {
    if (validId(raw[slot])) result[slot] = raw[slot]
  }
  return Object.keys(result).length ? result : undefined
}
export function unlinkLayerStyle(layer: Layer, slot: LinkedStyleSlot): boolean {
  if (!layer.linkedDesignStyles?.[slot]) return false
  const next = { ...layer.linkedDesignStyles }
  delete next[slot]
  layer.linkedDesignStyles = normalizeLayerStyleReferences(next)
  layer._v++
  return true
}
function setLayerSlot(layer: Layer, slot: LinkedStyleSlot, value: string): boolean {
  if (slot === 'fill' && layer.kind === 'shape' && layer.shape) {
    if (layer.shape.fill === value) return false
    layer.shape = { ...layer.shape, fill: value }
  } else if (slot === 'textColor' && layer.kind === 'text' && layer.text) {
    if (layer.text.color === value) return false
    layer.text = { ...layer.text, color: value }
  } else if (slot === 'fontFamily' && layer.kind === 'text' && layer.text) {
    if (layer.text.fontFamily === value) return false
    layer.text = { ...layer.text, fontFamily: value }
  } else return false
  layer._v++
  return true
}
function itemValue(kit: BrandKit, kind: LinkedStyleKind, itemId: string):
  { name: string; value: string } | null {
  if (kind === 'color') {
    const swatch = kit.swatches.find(s => s.id === itemId)
    return swatch && validColor(swatch.color) ? { name: swatch.name, value: swatch.color.toUpperCase() } : null
  }
  const font = kit.fonts.find(f => f.id === itemId)
  return font && validFont(font.family) ? { name: font.name, value: font.family.trim() } : null
}
export function designStyleId(kit: BrandKit, kind: LinkedStyleKind, itemId: string): string {
  return 'kit:' + kit.id + ':' + kind + ':' + itemId
}
/** Link a single editable layer property. Creates an offline-embedded token,
 * so linked behavior continues across saves even when the source kit is absent.
 * Caller records one History snapshot and emits after true is returned.
 */
export function linkBrandStyle(
  doc: PsDocument, layer: Layer, kit: BrandKit, kind: LinkedStyleKind, itemId: string,
): boolean {
  const slot: LinkedStyleSlot = kind === 'font' ? 'fontFamily' : layer.kind === 'shape' && layer.shape ? 'fill' :
    layer.kind === 'text' && layer.text ? 'textColor' : 'fill'
  if (kind === 'font' && (layer.kind !== 'text' || !layer.text)) return false
  if (kind === 'color' && !(layer.kind === 'text' && layer.text) && !(layer.kind === 'shape' && layer.shape)) return false
  const match = itemValue(kit, kind, itemId)
  if (!match) return false
  const id = designStyleId(kit, kind, itemId)
  const current = normalizeLinkedDesignStyles(doc.linkedDesignStyles)
  const exists = current.some(token => token.id === id)
  if (!exists && current.length >= MAX_STYLES) throw Error('Document has reached the 256 linked-style limit')
  const token: LinkedDesignStyle = {
    id, kind, name: match.name, value: match.value,
    sourceKitId: kit.id, sourceItemId: itemId,
  }
  const oldToken = current.find(t => t.id === id)
  const tokenChanged = !oldToken || oldToken.value !== token.value || oldToken.name !== token.name
  doc.linkedDesignStyles = exists ? current.map(t => t.id === id ? token : t) : [...current, token]
  const oldRef = layer.linkedDesignStyles?.[slot]
  layer.linkedDesignStyles = { ...layer.linkedDesignStyles, [slot]: id }
  const updated = setLayerSlot(layer, slot, match.value)
  if (!updated && oldRef !== id) layer._v++
  // Linking to a revised saved-kit value must update other already-linked
  // layers too, rather than changing the shared token but leaving stale pixels.
  if (oldToken && oldToken.value !== token.value) {
    for (const other of doc.layers) {
      if (other === layer) continue
      for (const target of ['fill', 'textColor', 'fontFamily'] as const) {
        if (other.linkedDesignStyles?.[target] === id) setLayerSlot(other, target, token.value)
      }
    }
  }
  doc._epoch++
  return tokenChanged || updated || oldRef !== id
}
/** Rebind every open document referring to the saved kit, without changing
 * unlinked layers. Deleted kit entries keep their last embedded value. */
export function synchronizeLinkedBrandKit(doc: PsDocument, kit: BrandKit): number {
  const old = normalizeLinkedDesignStyles(doc.linkedDesignStyles)
  if (!old.length) return 0
  let changed = 0
  const tokens = old.map(t => {
    if (t.sourceKitId !== kit.id) return t
    const current = itemValue(kit, t.kind, t.sourceItemId)
    if (!current || (current.value === t.value && current.name === t.name)) return t
    changed++
    return { ...t, name: current.name, value: current.value }
  })
  if (!changed) return 0
  doc.linkedDesignStyles = tokens
  const values = new Map(tokens.map(t => [t.id, t]))
  for (const layer of doc.layers) {
    const refs = normalizeLayerStyleReferences(layer.linkedDesignStyles)
    if (!refs) continue
    for (const slot of ['fill', 'textColor', 'fontFamily'] as const) {
      const ref = refs[slot], token = ref ? values.get(ref) : undefined
      if (!token || token.sourceKitId !== kit.id) continue
      if (slot === 'fontFamily' && token.kind === 'font' ||
        (slot === 'fill' || slot === 'textColor') && token.kind === 'color') {
        setLayerSlot(layer, slot, token.value)
      }
    }
  }
  doc._epoch++
  return changed
}
