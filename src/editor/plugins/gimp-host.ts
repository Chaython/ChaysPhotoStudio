'use client'
// On-demand GIMP 3 host: no process is started by importing this module.
// Provides both native (Electron + GIMP) and browser (JS fallback) implementations.

export interface GimpToolStatus { available: boolean; version: string; executable: string }
export interface GimpProcedureArg { name: string; type: string }
export interface GimpProcedureList { ok: boolean; procedures: string[]; total: number }
export interface GimpProcedureInfo { ok: boolean; arguments: GimpProcedureArg[] }
export interface GimpRunResult { status: 'success' | 'calling_error' | 'execution_error' | 'cancelled'; values: any[]; error?: string }

interface NativeGimpApi {
  info(): Promise<GimpToolStatus>
  list(): Promise<GimpProcedureList>
  inspect(name: string): Promise<GimpProcedureInfo>
  run(payload: { image: string; name: string; parameters?: Record<string, string | number | boolean> }): Promise<{ image: string }>
  runScript(payload: { image: string; language: 'python' | 'scheme'; source: string }): Promise<{ image: string }>
}

function nativeBridge(): NativeGimpApi {
  if (typeof window === 'undefined') throw new Error('GIMP runtime is available in Electron only')
  const api = (window as unknown as { chaysPhotoStudio?: { gimpRuntime?: NativeGimpApi } }).chaysPhotoStudio?.gimpRuntime
  if (!api) throw new Error('GIMP runtime requires the Electron desktop application')
  return api
}

export function gimpAvailable(): boolean {
  return typeof window !== 'undefined' &&
    !!(window as unknown as { chaysPhotoStudio?: { gimpRuntime?: NativeGimpApi } }).chaysPhotoStudio?.gimpRuntime
}

// Native (GIMP) implementations
export async function gimpInfo(): Promise<GimpToolStatus> { return nativeBridge().info() }
export async function gimpListProcedures(): Promise<GimpProcedureList> { return nativeBridge().list() }
export async function gimpInspectProcedure(name: string): Promise<GimpProcedureInfo> { return nativeBridge().inspect(name) }
export async function gimpRunProcedure(image: string, name: string, parameters: Record<string, string | number | boolean>): Promise<string> {
  return (await nativeBridge().run({ image, name, parameters })).image
}
export async function gimpRunSource(image: string, language: 'python' | 'scheme', source: string): Promise<string> {
  return (await nativeBridge().runScript({ image, language, source })).image
}

// Browser-side fallback implementations using GEGL ops and procedural equivalents
import { runProcedure as runGeglProcedure, getGeglOperation } from './gegl-ops'
import { listProcedures, getProcedure, runProcedure as runProcProcedure } from './gimp-procedural'

// Check if we should use native GIMP or browser fallback
function useNativeGimp(): boolean {
  return gimpAvailable()
}

// Unified procedure runner - tries native GIMP first, falls back to browser implementation
export async function runGimpProcedure(name: string, params: Record<string, any>): Promise<GimpRunResult> {
  if (useNativeGimp()) {
    try {
      // Convert params to native format
      const nativeParams: Record<string, string | number | boolean> = {}
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          nativeParams[key] = value
        }
      }
      const result = await gimpRunProcedure('', name, nativeParams)
      return { status: 'success', values: [result] }
    } catch (error) {
      console.warn(`Native GIMP procedure ${name} failed, falling back to browser:`, error)
      // Fall through to browser implementation
    }
  }

  // Browser fallback: try GEGL ops first
  const geglOp = getGeglOperation(name)
  if (geglOp) {
    // GEGL operations work on canvas, not direct params
    // This is a simplified bridge - in reality would need canvas input
    return { status: 'calling_error', values: [], error: `GEGL operation ${name} requires canvas input` }
  }

  // Try procedural implementations
  const proc = getProcedure(name)
  if (proc) {
    return runProcProcedure(name, Object.values(params))
  }

  return { status: 'calling_error', values: [], error: `Procedure ${name} not available in browser fallback` }
}

// List all available procedures (native + browser)
export async function listAllProcedures(): Promise<string[]> {
  const native = useNativeGimp() ? (await gimpListProcedures()).procedures : []
  const browser = listProcedures().map(p => p.name)
  return [...new Set([...native, ...browser])].sort()
}

// Get procedure info (native + browser)
export async function getProcedureInfo(name: string): Promise<GimpProcedureInfo | undefined> {
  if (useNativeGimp()) {
    try {
      return await gimpInspectProcedure(name)
    } catch { /* fall through */ }
  }
  const proc = getProcedure(name)
  if (proc) {
    return { ok: true, arguments: proc.params.map(p => ({ name: p.name, type: p.type })) }
  }
  return undefined
}

// Batch run multiple procedures
export async function runGimpPipeline(steps: Array<{ name: string; params: Record<string, any> }>): Promise<GimpRunResult[]> {
  const results: GimpRunResult[] = []
  for (const step of steps) {
    const result = await runGimpProcedure(step.name, step.params)
    results.push(result)
    if (result.status !== 'success') break
  }
  return results
}
