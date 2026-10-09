'use client'
// On-demand GIMP 3 host: no process is started by importing this module.
export interface GimpToolStatus { available: boolean; version: string; executable: string }
export interface GimpProcedureArg { name: string; type: string }
export interface GimpProcedureList { ok: boolean; procedures: string[]; total: number }
export interface GimpProcedureInfo { ok: boolean; arguments: GimpProcedureArg[] }
interface NativeGimpApi {
  info(): Promise<GimpToolStatus>
  list(): Promise<GimpProcedureList>
  inspect(name: string): Promise<GimpProcedureInfo>
  run(payload: { image: string; name: string; parameters?: Record<string, string | number | boolean> }): Promise<{ image: string }>
  runScript(payload: { image: string; language: 'python' | 'scheme'; source: string }): Promise<{ image: string }>
}
function bridge(): NativeGimpApi {
  if (typeof window === 'undefined') throw new Error('GIMP runtime is available in Electron only')
  const api = (window as unknown as { chaysPhotoStudio?: { gimpRuntime?: NativeGimpApi } }).chaysPhotoStudio?.gimpRuntime
  if (!api) throw new Error('GIMP runtime requires the Electron desktop application')
  return api
}
export function gimpAvailable(): boolean {
  return typeof window !== 'undefined' &&
    !!(window as unknown as { chaysPhotoStudio?: { gimpRuntime?: NativeGimpApi } }).chaysPhotoStudio?.gimpRuntime
}
export async function gimpInfo(): Promise<GimpToolStatus> { return bridge().info() }
export async function gimpListProcedures(): Promise<GimpProcedureList> { return bridge().list() }
export async function gimpInspectProcedure(name: string): Promise<GimpProcedureInfo> { return bridge().inspect(name) }
export async function gimpRunProcedure(image: string, name: string, parameters: Record<string, string | number | boolean>): Promise<string> {
  return (await bridge().run({ image, name, parameters })).image
}

/** Run selected source in a NEW GIMP process. Trust third-party scripts first. */
export async function gimpRunSource(image: string, language: 'python' | 'scheme', source: string): Promise<string> {
  return (await bridge().runScript({ image, language, source })).image
}
