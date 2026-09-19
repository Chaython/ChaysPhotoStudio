// Plugin system types — native Chay plugins + compatibility metadata for
// Photoshop UXP / GIMP bridges. Plugins execute in the sandbox worker; native
// desktop capabilities are separately permission-gated and proxied via IPC.
export type PluginPermission =
  | 'document.read'
  | 'document.write'
  | 'layer.read'
  | 'layer.write'
  | 'selection.read'
  | 'selection.write'
  | 'editor.commands'
  | 'ui.toast'
  | 'storage'
  | 'network'
  | 'native.process'

export type PluginSourceFormat = 'zphoto' | 'uxp' | 'gimp' | 'legacy'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  apiVersion: number
  permissions?: PluginPermission[]
}

export interface PluginCommand {
  id: string
  label: string
}

export interface PluginCompatibilityReport {
  ecosystem: 'native' | 'photoshop-uxp' | 'gimp' | 'gegl' | 'gmic'
  /** API feature coverage estimate. This is diagnostic, not a promise that the plugin runs. */
  coverage: number
  supported: string[]
  unsupported: string[]
  warnings: string[]
}

export interface StoredPlugin {
  manifest: PluginManifest
  /** plugin JS source — receives `zphoto`, calls zphoto.registerCommand() */
  code: string
  enabled: boolean
  commands: PluginCommand[]
  sourceFormat?: PluginSourceFormat
  compatibility?: PluginCompatibilityReport
  /** permissions the user has granted. Legacy plugins are migrated to safe defaults. */
  grantedPermissions?: PluginPermission[]
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
