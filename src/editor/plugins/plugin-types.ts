// Plugin system types — UXP-inspired, sandboxed to a Web Worker
export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  apiVersion: number
}

export interface PluginCommand {
  id: string
  label: string
}

export interface StoredPlugin {
  manifest: PluginManifest
  /** plugin JS source — receives `zphoto`, calls zphoto.registerCommand() */
  code: string
  enabled: boolean
  commands: PluginCommand[]
}

/** parsed GIMP gradient (.ggr) */
export interface GradientStop { pos: number; r: number; g: number; b: number; a: number }
export interface ParsedGradient { name: string; stops: GradientStop[] }

/** parsed GIMP brush (.gbr) */
export interface ParsedBrush {
  name: string
  spacing: number
  width: number
  height: number
  canvas: HTMLCanvasElement
}

/** brush preset (procedural presets come from tool options; image presets from .gbr) */
export interface BrushPreset {
  id: string
  name: string
  kind: 'procedural' | 'image'
  spacing: number
  /** lazily decoded canvas (image presets only) */
  canvas?: HTMLCanvasElement
  dataURL?: string
}
