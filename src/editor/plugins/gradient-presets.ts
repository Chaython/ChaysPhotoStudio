'use client'
// ============================================================
// gradient-presets.ts — imported GIMP gradient library (Task 7-A).
//
// Persists parsed .ggr gradients to localStorage 'zphoto-gradients'
// (stops only — tiny payloads). Each gradient can be opened as a
// Gradient Map on the active layer via stopsToGradientMapParams()
// (the gradient-map adjustment trivially accepts custom stops:
// params.stops = [{ pos, color }] — verified in
// image-ops/adjustments.ts gradientMap).
// ============================================================
import { useEditorStore } from '../store'
import { parseGgrGradient, stopsToGradientMapParams } from './gimp-assets'
import type { GradientStop, ParsedGgrGradient } from './gimp-assets'

const STORAGE_KEY = 'zphoto-gradients'

export interface GradientPreset {
  id: string
  name: string
  stops: GradientStop[]
}

type ChangeListener = () => void

let stored: GradientPreset[] = []
let version = 0
const listeners = new Set<ChangeListener>()

if (typeof window !== 'undefined') {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as GradientPreset[]
      if (Array.isArray(parsed)) {
        stored = parsed.filter(g => g && typeof g.id === 'string' && Array.isArray(g.stops) && g.stops.length)
      }
    }
  } catch {
    stored = []
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // quota — in-memory only
  }
}

function notify(): void {
  version++
  for (const l of listeners) {
    try { l() } catch { /* never break the store */ }
  }
  try { useEditorStore.getState().bump() } catch { /* SSR */ }
}

// ============================================================
// public API
// ============================================================

export function getVersion(): number {
  return version
}

export function onChange(cb: ChangeListener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function list(): GradientPreset[] {
  return stored.map(g => ({ id: g.id, name: g.name, stops: g.stops }))
}

export function getById(id: string): GradientPreset | null {
  return stored.find(g => g.id === id) ?? null
}

/** register a parsed gradient; returns the stored preset */
export function addGradient(input: { name: string; stops: GradientStop[] }): GradientPreset {
  const preset: GradientPreset = {
    id: `grad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: input.name || 'Imported gradient',
    stops: input.stops.map(s => ({ ...s })),
  }
  stored.push(preset)
  persist()
  notify()
  return preset
}

export function removeGradient(id: string): void {
  const idx = stored.findIndex(g => g.id === id)
  if (idx < 0) return
  stored.splice(idx, 1)
  persist()
  notify()
}

/** gradient-map adjustment params for a stored gradient ({ pos, color hex } stops) */
export function gradientMapParams(id: string): { stops: { pos: number; color: string }[] } | null {
  const g = getById(id)
  return g ? stopsToGradientMapParams(g.stops) : null
}

// ============================================================
// import flow (file picker + parse + add) — shared by the dialog
// and the Plugins menu
// ============================================================

export function importGimpGradientFile(): Promise<GradientPreset | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.ggr'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) { resolve(null); return }
      try {
        const text = await file.text()
        const base = file.name.replace(/\.ggr$/i, '')
        const parsed: ParsedGgrGradient = parseGgrGradient(text, base)
        const preset = addGradient({ name: parsed.name, stops: parsed.stops })
        useEditorStore.getState().pushToast(
          `Imported GIMP gradient “${preset.name}” (${preset.stops.length} stops)`,
          'success',
        )
        resolve(preset)
      } catch (err) {
        useEditorStore.getState().pushToast(
          err instanceof Error ? err.message : 'GIMP gradient import failed',
          'error',
        )
        resolve(null)
      }
    }
    input.click()
  })
}
