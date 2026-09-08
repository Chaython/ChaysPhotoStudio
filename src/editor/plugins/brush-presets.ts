'use client'
// Brush preset registry — imported GIMP brushes (.gbr) become image stamps
// selectable in the Brush tool. Persisted as PNG dataURLs in localStorage;
// stamp canvases decode lazily and cache.
//
// API (consumed by tools/brush.ts, the Plugin Manager dialog and the menus):
//   getActiveId / getById / getCachedStampCanvas / warmPreset  — stamp resolution
//   list / onChange / setActive / removePreset / getStampCanvas — registry + UI
//   importGimpBrushFile — file picker → parseGbr → preset (+ toast)
import { createCanvas, ctx2d } from '../utils/canvas'
import { parseGbr } from './gimp-assets'
import { useEditorStore } from '../store'
import type { ParsedBrush } from './gimp-assets'

const LS_KEY = 'zphoto-brush-presets'

export interface BrushPreset {
  id: string
  name: string
  kind: 'procedural' | 'image'
  /** GIMP spacing — percent of stamp size */
  spacing: number
  width?: number
  height?: number
  /** lazily decoded stamp canvas (cached in memory) */
  canvas?: HTMLCanvasElement
  dataURL?: string
}

interface PersistEntry { id: string; name: string; spacing: number; width: number; height: number; dataURL: string }

let presets: BrushPreset[] = []
let activeId: string | null = null
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]') as PersistEntry[]
    presets = raw
      .filter(e => e && typeof e.id === 'string' && typeof e.dataURL === 'string')
      .map(e => ({ id: e.id, name: e.name ?? e.id, kind: 'image' as const, spacing: e.spacing ?? 12, width: e.width, height: e.height, dataURL: e.dataURL }))
  } catch { presets = [] }
}

function save() {
  try {
    const raw: PersistEntry[] = presets.map(p => ({
      id: p.id, name: p.name, spacing: p.spacing,
      width: p.width ?? p.canvas?.width ?? 0, height: p.height ?? p.canvas?.height ?? 0,
      dataURL: p.dataURL ?? '',
    }))
    localStorage.setItem(LS_KEY, JSON.stringify(raw))
  } catch { /* quota — in-memory only */ }
}

function notify() {
  for (const fn of listeners) { try { fn() } catch { /* never break callers */ } }
  try { useEditorStore.getState().bump() } catch { /* SSR */ }
}

// ============================================================
// public API
// ============================================================

export function onChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function list(): BrushPreset[] { return presets.map(p => ({ ...p, canvas: p.canvas })) }

export function getById(id: string): BrushPreset | null { return presets.find(p => p.id === id) ?? null }

export function getActiveId(): string | null { return activeId }

export function setActive(id: string | null): void {
  activeId = id && presets.some(p => p.id === id) ? id : null
  notify()
}

export function removePreset(id: string): void {
  presets = presets.filter(p => p.id !== id)
  if (activeId === id) activeId = null
  save()
  notify()
}

/** sync cached stamp canvas (decoded) — null when not yet decoded */
export function getCachedStampCanvas(id: string): HTMLCanvasElement | null {
  return presets.find(p => p.id === id)?.canvas ?? null
}

/** async stamp decode (cached on the preset) */
export function getStampCanvas(id: string): Promise<HTMLCanvasElement | null> {
  const preset = presets.find(p => p.id === id)
  if (!preset) return Promise.resolve(null)
  if (preset.canvas) return Promise.resolve(preset.canvas)
  if (!preset.dataURL) return Promise.resolve(null)
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const c = createCanvas(img.naturalWidth, img.naturalHeight)
      ctx2d(c).drawImage(img, 0, 0)
      preset.canvas = c
      resolve(c)
    }
    img.onerror = () => resolve(null)
    if (!preset.dataURL) { resolve(null); return }
    img.src = preset.dataURL
  })
}

/** pre-decode a stamp so the first stroke paints with it (fire-and-forget) */
export async function warmPreset(id: string): Promise<void> {
  await getStampCanvas(id)
}

/** register an imported brush; makes it the active stamp */
export function addBrushPreset(parsed: ParsedBrush): BrushPreset {
  const preset: BrushPreset = {
    id: 'gbr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    name: parsed.name || 'GIMP Brush',
    kind: 'image',
    spacing: parsed.spacing || 12,
    width: parsed.width,
    height: parsed.height,
    canvas: parsed.canvas,
    dataURL: parsed.canvas.toDataURL('image/png'),
  }
  presets.push(preset)
  activeId = preset.id
  save()
  notify()
  return preset
}

// ============================================================
// import flow (file picker + parse + add) — shared by the dialog
// and the Plugins menu
// ============================================================

export function importGimpBrushFile(): Promise<BrushPreset | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.gbr'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) { resolve(null); return }
      try {
        const buf = await file.arrayBuffer()
        const parsed = parseGbr(buf)
        const preset = addBrushPreset(parsed)
        useEditorStore.getState().pushToast(
          `Imported GIMP brush “${preset.name}” (${parsed.width}×${parsed.height} px) — now the active stamp`,
          'success',
        )
        resolve(preset)
      } catch (err) {
        useEditorStore.getState().pushToast(
          err instanceof Error ? err.message : 'GIMP brush import failed',
          'error',
        )
        resolve(null)
      }
    }
    input.click()
  })
}
