import { analyzeGimpScript } from './gimp-script-analyzer'
import type { PluginCompatibilityReport, PluginManifest, PluginSourceFormat, StoredPlugin } from './plugin-types'

const SUPPORTED_UXP = [
  'entrypoints.setup', 'photoshop.action.batchPlay', 'photoshop.core.executeAsModal',
  'photoshop.app.activeDocument', 'photoshop.imaging', 'photoshop.imaging.getPixels',
  'photoshop.imaging.putPixels', 'photoshop.imaging.getSelection', 'photoshop.imaging.putSelection',
  'uxp.storage.localFileSystem',
]
const UNSUPPORTED_UXP = [
  'photoshop.app.batch', 'uxp.shell.openExternal',
  'entrypoints.panels', 'entrypoints.createPanel', 'require("fs")', "require('fs')",
]

function findMatches(code: string, needles: string[]): string[] {
  const lower = code.toLowerCase()
  return needles.filter(n => lower.includes(n.toLowerCase()))
}

export function detectPluginSourceFormat(
  text: string,
  fallbackName = 'plugin.js',
  manifest?: { id?: unknown; entrypoints?: unknown; manifestVersion?: unknown },
): PluginSourceFormat {
  const fileName = String(fallbackName || 'plugin.js').toLowerCase()
  const isJson = /^\s*\{/.test(text)
  if (isJson) {
    try {
      const direct = JSON.parse(text)
      if (direct && direct.manifest && typeof direct.code === 'string') return 'zphoto'
      if (direct && Array.isArray(direct.entrypoints)) return 'uxp'
    } catch { /* not a JSON plugin body */ }
  }
  if (/\/\*\s*@zphoto\s+\{/.test(text) || /\bzphoto\.registerCommand\b/.test(text)) return 'zphoto'
  if (manifest && (Array.isArray(manifest.entrypoints) || manifest.manifestVersion)) return 'uxp'
  if (/\bentrypoints\b.*\bsetup\b|photoshop\.action|photoshop\.imaging|"manifestVersion"/i.test(text)) return 'uxp'
  if (/\bscript-fu-register\b|\(\s*gimp-[a-z0-9_-]+\b|\.scm$/i.test(fileName) || /\b\(gimp-[a-z0-9_-]+\b/i.test(text)) return 'gimp'
  if (/from\s+gi\.repository\s+import\s+Gimp|\bGimp\.|gimp_[a-z_]+\s*\(|\.py$/i.test(fileName)) return 'python'
  if (/\.gmic$/i.test(fileName) || /(?:^|\s)-(?:fx_[a-z][\w]*|blur|sharpen|bilateral|denoise|normalize|equalize|local_contrast)\b/i.test(text)) return 'gmic'
  if (/gegl:|GEGL\b|\.gegl$/i.test(fileName) || /gegl:[a-z0-9_.-]+/i.test(text)) return 'gegl'
  if (/\.js$/i.test(fileName) || /\.mjs$/i.test(fileName)) return 'zphoto'
  return 'legacy'
}

export function analyzeUxpCompatibility(manifest: any, code = ''): PluginCompatibilityReport {
  const supported = findMatches(code, SUPPORTED_UXP)
  const unsupported = findMatches(code, UNSUPPORTED_UXP)
  const warnings: string[] = []
  const entrypoints = Array.isArray(manifest?.entrypoints) ? manifest.entrypoints : []
  const panelCount = entrypoints.filter((e: any) => e?.type === 'panel').length
  const commandCount = entrypoints.filter((e: any) => e?.type === 'command').length
  if (panelCount) warnings.push(`${panelCount} UXP panel entrypoint${panelCount === 1 ? '' : 's'} detected; panels are analyzed but not rendered yet.`)
  if (/photoshop\s*\.\s*imaging|(?:^|[^a-z])imaging\s*\.\s*(?:getPixels|putPixels|getSelection|putSelection)/i.test(code)) {
    warnings.push('Photoshop Imaging shim supports 8-bit RGBA get/put pixels, source/target bounds, resizing and selection masks. Advanced color-profile conversion and 16/32-bit component data are not emulated yet.')
  }
  if (!commandCount && !/entrypoints\s*\.\s*setup/i.test(code)) warnings.push('No command entrypoint was detected. The plugin may only provide panels or background behavior.')
  const host = manifest?.host?.app || manifest?.host?.application || manifest?.host?.name
  if (host && !/photoshop|ps/i.test(String(host))) warnings.push(`Manifest host is ${String(host)}, not Photoshop.`)
  if (manifest?.manifestVersion && Number(manifest.manifestVersion) > 5) warnings.push(`Manifest version ${manifest.manifestVersion} is newer than the compatibility shim was tested against.`)

  // This is a feature coverage estimate, not a claim that the plugin will run.
  const evidence = supported.length + unsupported.length + panelCount + commandCount
  const covered = supported.length + commandCount
  const coverage = evidence ? Math.round((covered / Math.max(1, evidence)) * 100) : 35
  return {
    ecosystem: 'photoshop-uxp',
    coverage,
    supported: [...new Set(supported)],
    unsupported: [...new Set(unsupported)],
    warnings,
  }
}

export function uxpManifestToPlugin(manifest: any, code: string, fallbackName: string): StoredPlugin {
  const rawId = String(manifest?.id || manifest?.name || fallbackName || `uxp-${Date.now()}`)
  const id = `uxp-${rawId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`
  const pm: PluginManifest = {
    id,
    name: String(manifest?.name || fallbackName || rawId),
    version: String(manifest?.version || '0.0.0'),
    description: String(manifest?.description || 'Imported Photoshop UXP plugin'),
    apiVersion: 2,
    permissions: ['document.read', 'layer.read', 'layer.write', 'selection.read', 'selection.write', 'editor.commands', 'ui.toast', 'storage'],
  }
  return {
    manifest: pm,
    code,
    enabled: true,
    commands: [],
    sourceFormat: 'uxp',
    compatibility: analyzeUxpCompatibility(manifest, code),
  }
}

export function analyzeGimpPluginSource(text: string, name: string): PluginCompatibilityReport {
  const analysis = analyzeGimpScript(text, name)
  const supported = analysis.operations.filter(o => o.status !== 'requires-gimp')
    .map(o => o.name + ' — ' + o.explanation)
  const unsupported = analysis.operations.filter(o => o.status === 'requires-gimp')
    .map(o => o.name + ' — ' + o.explanation)
  // A heuristic ratio of references, not a promise of executable compatibility.
  const coverage = analysis.operations.length
    ? Math.round(supported.length / analysis.operations.length * 100)
    : 0
  return { ecosystem: 'gimp', coverage, supported, unsupported, warnings: analysis.warnings }
}

export function analyzePluginCompatibility(text: string, fallbackName = 'plugin.js', manifest?: any): PluginCompatibilityReport | undefined {
  const format = detectPluginSourceFormat(text, fallbackName, manifest)
  switch (format) {
    case 'uxp':
    case 'photoshop':
    case 'photoshop-uxp':
      return analyzeUxpCompatibility(manifest ?? {}, text)
    case 'gimp':
    case 'script-fu':
    case 'python':
      return analyzeGimpPluginSource(text, fallbackName)
    case 'gmic':
      return {
        ecosystem: 'gmic',
        coverage: 36,
        supported: ['G’MIC-style operations identified for desktop bridge review'],
        unsupported: ['Direct in-browser execution without a native G’MIC bridge'],
        warnings: ['The script is compatibility-only and must be run through the desktop G’MIC bridge or manually ported.'],
      }
    case 'gegl':
      return {
        ecosystem: 'gegl',
        coverage: 40,
        supported: ['GEGL operation name detected'],
        unsupported: ['No direct browser GEGL runtime is embedded'],
        warnings: ['GEGL pipeline code is a compatibility candidate for the native desktop bridge only.'],
      }
    case 'zphoto':
      return {
        ecosystem: 'native',
        coverage: 100,
        supported: ['zphoto API commands'],
        unsupported: [],
        warnings: ['Native Chay plugin; it executes in the sandbox worker.'],
      }
    default:
      return undefined
  }
}
