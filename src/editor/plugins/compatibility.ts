import type { PluginCompatibilityReport, PluginManifest, StoredPlugin } from './plugin-types'

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
  const lower = text.toLowerCase()
  const supported: string[] = []
  const unsupported: string[] = []
  const warnings: string[] = []
  if (lower.includes('gegl:')) supported.push('GEGL operation references')
  if (lower.includes('gimp_image') || lower.includes('gimp-image')) supported.push('image/document concepts')
  if (lower.includes('gimp_drawable') || lower.includes('gimp-drawable')) supported.push('drawable/layer concepts')
  if (lower.includes('pdb') || lower.includes('gimp_procedure')) unsupported.push('full GIMP PDB/libgimp runtime')
  if (/\.scm$/i.test(name) || lower.includes('script-fu')) unsupported.push('Script-Fu/TinyScheme runtime')
  if (/\.py$/i.test(name) || lower.includes('gi.repository')) unsupported.push('GIMP Python GI runtime')
  warnings.push('GIMP source compatibility is experimental. Use GEGL/G’MIC bridging where possible; full libgimp/PDB emulation is not yet available.')
  const evidence = supported.length + unsupported.length
  return { ecosystem: 'gimp', coverage: evidence ? Math.round(supported.length / evidence * 100) : 20, supported, unsupported, warnings }
}
