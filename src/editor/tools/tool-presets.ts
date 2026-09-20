import type { ToolId } from '../types'

export interface ToolPreset {
  id: string
  name: string
  toolId: ToolId
  options: Record<string, unknown>
  createdAt: number
}

const KEY = 'chays-photo-tool-presets-v1'

function readAll(): ToolPreset[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.toolId === 'string' && p.options && typeof p.options === 'object')
      .slice(0, 200)
      .map(p => ({
        id: p.id,
        name: p.name,
        toolId: p.toolId as ToolId,
        options: { ...p.options },
        createdAt: Number.isFinite(p.createdAt) ? Number(p.createdAt) : Date.now(),
      }))
  } catch { return [] }
}

function writeAll(items: ToolPreset[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, 200)))
  window.dispatchEvent(new CustomEvent('zphoto:tool-presets'))
}

export function listToolPresets(toolId?: ToolId): ToolPreset[] {
  const all = readAll()
  return toolId ? all.filter(p => p.toolId === toolId) : all
}

export function saveToolPreset(toolId: ToolId, name: string, options: Record<string, unknown>): ToolPreset {
  const item: ToolPreset = {
    id: `preset:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || 'Preset',
    toolId,
    options: structuredClone(options ?? {}),
    createdAt: Date.now(),
  }
  writeAll([item, ...readAll()])
  return item
}

export function deleteToolPreset(id: string) {
  writeAll(readAll().filter(p => p.id !== id))
}

export function renameToolPreset(id: string, name: string) {
  const clean = name.trim()
  if (!clean) return
  writeAll(readAll().map(p => p.id === id ? { ...p, name: clean } : p))
}

export function exportToolPresets(): string {
  return JSON.stringify({ format: 'chays-photo-tool-presets', version: 1, presets: readAll() }, null, 2)
}

export function importToolPresets(json: string): number {
  const parsed = JSON.parse(json)
  const incoming = Array.isArray(parsed?.presets) ? parsed.presets : []
  const valid: ToolPreset[] = incoming
    .filter((p: any) => p && typeof p.name === 'string' && typeof p.toolId === 'string' && p.options && typeof p.options === 'object')
    .map((p: any) => ({
      id: `preset:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: p.name,
      toolId: p.toolId as ToolId,
      options: { ...p.options },
      createdAt: Date.now(),
    }))
  if (!valid.length) return 0
  writeAll([...valid, ...readAll()])
  return valid.length
}
