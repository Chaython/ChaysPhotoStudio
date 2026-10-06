export type MeasurementUnit = 'px' | 'mm' | 'cm' | 'in'

export interface MeasurementScalePreset {
  id: string
  name: string
  unit: MeasurementUnit
  useDocResolution: boolean
  pixelsPerUnit: number
  builtin?: boolean
}

const KEY = 'zphoto-measure-scale-presets'

export const BUILTIN_MEASUREMENT_SCALE_PRESETS: readonly MeasurementScalePreset[] = [
  { id: 'builtin-pixels', name: 'Pixels · 1:1', unit: 'px', useDocResolution: false, pixelsPerUnit: 1, builtin: true },
  { id: 'builtin-doc-mm', name: 'Document PPI · millimeters', unit: 'mm', useDocResolution: true, pixelsPerUnit: 1, builtin: true },
  { id: 'builtin-doc-cm', name: 'Document PPI · centimeters', unit: 'cm', useDocResolution: true, pixelsPerUnit: 1, builtin: true },
  { id: 'builtin-doc-in', name: 'Document PPI · inches', unit: 'in', useDocResolution: true, pixelsPerUnit: 1, builtin: true },
]

function unitOf(value: unknown): MeasurementUnit {
  return value === 'mm' || value === 'cm' || value === 'in' ? value : 'px'
}

function normalizePreset(value: any): MeasurementScalePreset | null {
  if (!value || typeof value !== 'object') return null
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 80) : ''
  const id = typeof value.id === 'string' ? value.id.trim().slice(0, 120) : ''
  if (!name || !id || id.startsWith('builtin-')) return null
  const pixelsPerUnit = Number(value.pixelsPerUnit)
  return {
    id,
    name,
    unit: unitOf(value.unit),
    useDocResolution: value.useDocResolution !== false,
    pixelsPerUnit: Number.isFinite(pixelsPerUnit) && pixelsPerUnit > 0 ? Math.max(.001, Math.min(100000, pixelsPerUnit)) : 1,
  }
}

export function loadMeasurementScalePresets(): MeasurementScalePreset[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.map(normalizePreset).filter((v): v is MeasurementScalePreset => !!v).slice(0, 64)
  } catch {
    return []
  }
}

function persist(presets: MeasurementScalePreset[]) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(presets.slice(0, 64)))
  } catch {
    /* localStorage may be unavailable in private/restricted contexts */
  }
}

export function saveMeasurementScalePreset(
  name: string,
  values: Pick<MeasurementScalePreset, 'unit' | 'useDocResolution' | 'pixelsPerUnit'>,
): MeasurementScalePreset[] {
  const cleanName = name.trim().slice(0, 80)
  if (!cleanName) return loadMeasurementScalePresets()
  const current = loadMeasurementScalePresets()
  const existing = current.find(p => p.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())
  const pixelsPerUnit = Number(values.pixelsPerUnit)
  const next: MeasurementScalePreset = {
    id: existing?.id ?? ('measure-scale-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)),
    name: cleanName,
    unit: unitOf(values.unit),
    useDocResolution: values.useDocResolution !== false,
    pixelsPerUnit: Number.isFinite(pixelsPerUnit) && pixelsPerUnit > 0 ? Math.max(.001, Math.min(100000, pixelsPerUnit)) : 1,
  }
  const updated = existing
    ? current.map(p => p.id === existing.id ? next : p)
    : [next, ...current]
  persist(updated)
  return updated
}

export function deleteMeasurementScalePreset(id: string): MeasurementScalePreset[] {
  const updated = loadMeasurementScalePresets().filter(p => p.id !== id)
  persist(updated)
  return updated
}

export function allMeasurementScalePresets(custom = loadMeasurementScalePresets()): MeasurementScalePreset[] {
  return [...BUILTIN_MEASUREMENT_SCALE_PRESETS, ...custom]
}

export function matchingMeasurementScalePreset(
  presets: readonly MeasurementScalePreset[],
  values: Pick<MeasurementScalePreset, 'unit' | 'useDocResolution' | 'pixelsPerUnit'>,
): MeasurementScalePreset | null {
  const unit = unitOf(values.unit)
  const useDocResolution = values.useDocResolution !== false
  const ppu = Number(values.pixelsPerUnit)
  return presets.find(p =>
    p.unit === unit &&
    p.useDocResolution === useDocResolution &&
    (unit === 'px' || useDocResolution || Math.abs(p.pixelsPerUnit - ppu) < 0.0005)
  ) ?? null
}
