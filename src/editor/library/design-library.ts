/** Local design template and brand-kit library.
 * Templates contain native .zproj project data (editable), NOT flattened thumbnails.
 * Data stays in IndexedDB; nothing is uploaded to an external service.
 */
export const DESIGN_DATABASE = 'chays-design-library'
export const MAX_TEMPLATE_BYTES = 32 * 1024 * 1024
export const MAX_TEMPLATES = 40
export const MAX_BRAND_KITS = 32
const MAX_LOGO_BYTES = 512 * 1024

export interface TemplateEntry {
  id: string
  name: string
  category: string
  createdAt: number
  updatedAt: number
  width: number
  height: number
  thumbnail: string
  projectJson: string
}

export interface BrandSwatch { id: string; name: string; color: string }
export interface BrandFont { id: string; name: string; family: string }
export interface BrandLogo { id: string; name: string; dataUrl: string }
export interface BrandKit {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  swatches: BrandSwatch[]
  fonts: BrandFont[]
  logos: BrandLogo[]
}
export interface TemplateFile { format: 'chays-design-template'; version: 1; entry: TemplateEntry }
export interface BrandKitFile { format: 'chays-brand-kit'; version: 1; kit: BrandKit }

const clean = (input: unknown, limit: number) =>
  typeof input === 'string' ? input.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : ''
export const HEX_COLOR = /^#[0-9a-f]{6}$/i
export function normalizeHex(input: unknown): string | null {
  const s = clean(input, 32)
  return HEX_COLOR.test(s) ? s.toUpperCase() : /^#[0-9a-f]{3}$/i.test(s)
    ? ('#' + [...s.slice(1)].map(x => x + x).join('')).toUpperCase() : null
}
function id(value: unknown): string {
  const s = clean(value, 100)
  if (!s || !/^[a-z0-9][\w-]{0,99}$/i.test(s)) throw Error('Invalid design library item ID')
  return s
}
function date(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : Date.now()
}
function projectDetails(text: unknown): { width: number; height: number } {
  if (typeof text !== 'string' || text.length < 1 || new TextEncoder().encode(text).byteLength > MAX_TEMPLATE_BYTES)
    throw Error('Template project exceeds its 32 MiB size limit')
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object') throw Error('Invalid native project')
  const project = value as Record<string, any>
  if (project.format !== 'z-photo-project' || !Array.isArray(project.layers) || !project.doc)
    throw Error('Expected an editable Chay Photo Studio project')
  const { width, height } = project.doc
  if (![width, height].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 8192) || project.layers.length > 500)
    throw Error('Template dimensions or layer count are outside safe bounds')
  return { width, height }
}
export function normalizeTemplate(input: unknown): TemplateEntry {
  if (!input || typeof input !== 'object') throw Error('Invalid template')
  const t = input as Record<string, unknown>
  const details = projectDetails(t.projectJson)
  const name = clean(t.name, 100)
  if (!name) throw Error('Template needs a name')
  const thumbnail = typeof t.thumbnail === 'string' && t.thumbnail.length <= 190_000
    && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(t.thumbnail) ? t.thumbnail : ''
  return {
    id: id(t.id), name, category: clean(t.category, 40) || 'General',
    createdAt: date(t.createdAt), updatedAt: date(t.updatedAt),
    width: details.width, height: details.height,
    thumbnail, projectJson: t.projectJson as string,
  }
}
export function normalizeBrandKit(input: unknown): BrandKit {
  if (!input || typeof input !== 'object') throw Error('Invalid brand kit')
  const k = input as Record<string, unknown>
  const name = clean(k.name, 100)
  if (!name) throw Error('Brand kit needs a name')
  const swatches: BrandSwatch[] = []
  const fonts: BrandFont[] = []
  const logos: BrandLogo[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(k.swatches) ? k.swatches.slice(0, 32) : []) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as Record<string, unknown>
    const color = normalizeHex(s.color), key = clean(s.id, 100)
    if (!color || !key || seen.has('s'+key)) continue
    seen.add('s'+key)
    swatches.push({ id: id(key), name: clean(s.name, 60) || color, color })
  }
  for (const raw of Array.isArray(k.fonts) ? k.fonts.slice(0, 16) : []) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as Record<string, unknown>
    const key = clean(s.id, 100), family = clean(s.family, 150)
    if (!key || !family || seen.has('f'+key)) continue
    seen.add('f'+key)
    fonts.push({ id: id(key), name: clean(s.name, 60) || family, family })
  }
  for (const raw of Array.isArray(k.logos) ? k.logos.slice(0, 8) : []) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as Record<string, unknown>
    const key = clean(s.id, 100), dataUrl = s.dataUrl
    if (!key || seen.has('l'+key) || typeof dataUrl !== 'string' || dataUrl.length > MAX_LOGO_BYTES * 1.4 ||
      !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(dataUrl)) continue
    seen.add('l'+key)
    logos.push({ id: id(key), name: clean(s.name, 70) || 'Logo', dataUrl })
  }
  return { id: id(k.id), name, createdAt: date(k.createdAt), updatedAt: date(k.updatedAt), swatches, fonts, logos }
}
export function parseTemplateFile(raw: unknown): TemplateEntry {
  if (!raw || typeof raw !== 'object' || (raw as TemplateFile).format !== 'chays-design-template' ||
    (raw as TemplateFile).version !== 1) throw Error('Unsupported template file')
  return normalizeTemplate((raw as TemplateFile).entry)
}
export function parseBrandKitFile(raw: unknown): BrandKit {
  if (!raw || typeof raw !== 'object' || (raw as BrandKitFile).format !== 'chays-brand-kit' ||
    (raw as BrandKitFile).version !== 1) throw Error('Unsupported brand kit file')
  return normalizeBrandKit((raw as BrandKitFile).kit)
}
export function safeDesignFilename(value: string): string {
  return clean(value, 90).replace(/[\\/:*?"<>|]/g, '-').replace(/^[.-]+/, '').replace(/\s+/g, '-') || 'Design'
}

type StoreName = 'templates' | 'brand-kits'
function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(Error('IndexedDB is not available in this environment'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DESIGN_DATABASE, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('brand-kits')) db.createObjectStore('brand-kits', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? Error('Unable to open design library'))
    request.onblocked = () => reject(Error('Another tab is blocking a design library upgrade'))
  })
}
async function transact<T>(storeName: StoreName, mode: IDBTransactionMode, makeRequest: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode)
      let result: T
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(tx.error ?? Error('Design library transaction aborted'))
      tx.onerror = () => reject(tx.error ?? Error('Design library storage failed'))
      try {
        const req = makeRequest(tx.objectStore(storeName))
        req.onsuccess = () => { result = req.result }
        req.onerror = () => { try { tx.abort() } catch { /* already aborted */ } }
      } catch (e) { try { tx.abort() } catch { /* already aborted */ }; reject(e) }
    })
  } finally { db.close() }
}
export const listTemplates = () => transact<TemplateEntry[]>('templates', 'readonly', store => store.getAll())
export const listBrandKits = () => transact<BrandKit[]>('brand-kits', 'readonly', store => store.getAll())
export const deleteTemplate = (itemId: string) => transact<undefined>('templates', 'readwrite', store => store.delete(itemId))
export const deleteBrandKit = (itemId: string) => transact<undefined>('brand-kits', 'readwrite', store => store.delete(itemId))
export async function putTemplate(entry: TemplateEntry): Promise<void> {
  const safe = normalizeTemplate(entry)
  const existing = await listTemplates()
  if (!existing.some(x => x.id === safe.id) && existing.length >= MAX_TEMPLATES) throw Error('Template library is full (40 designs)')
  await transact('templates', 'readwrite', store => store.put(safe))
}
export async function putBrandKit(kit: BrandKit): Promise<void> {
  const safe = normalizeBrandKit(kit)
  const existing = await listBrandKits()
  if (!existing.some(x => x.id === safe.id) && existing.length >= MAX_BRAND_KITS) throw Error('Brand kit library is full (32 kits)')
  await transact('brand-kits', 'readwrite', store => store.put(safe))
}
