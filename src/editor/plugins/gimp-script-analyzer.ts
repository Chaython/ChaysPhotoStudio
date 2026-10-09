/**
 * Read-only source scanner for GIMP Python/Script-Fu/GEGL/G'MIC snippets.
 * This does not execute, evaluate, import, or translate arbitrary code.
 * Results are hints for human review, not portability certification.
 */
export type GimpOperationStatus = 'native-editor' | 'gegl-bridge' | 'gmic-bridge' | 'requires-gimp'
export interface GimpOperationMatch {
  name: string
  line: number
  status: GimpOperationStatus
  explanation: string
}
export interface GimpScriptAnalysis {
  language: 'python' | 'script-fu' | 'gmic' | 'unknown'
  operations: GimpOperationMatch[]
  warnings: string[]
  summary: string
}

const EDITOR_EQUIVALENTS: Record<string, string> = {
  'gimp-drawable-brightness-contrast': 'Image → Adjustments → Brightness/Contrast (manual parameter mapping)',
  'gimp-drawable-hue-saturation': 'Image → Adjustments → Hue/Saturation (manual parameter mapping)',
  'gimp-drawable-levels': 'Image → Adjustments → Levels (manual parameter mapping)',
  'gimp-drawable-curves-spline': 'Image → Adjustments → Curves (manual parameter mapping)',
  'gimp-image-undo-group-start': 'Editor history groups must be rewritten using the plugin API',
  'gimp-image-undo-group-end': 'Editor history groups must be rewritten using the plugin API',
}
const MAX_LENGTH = 2_000_000
const MAX_MATCHES = 250
const namePattern = /\b(?:gimp[-_](?:image|drawable|layer|selection|context|edit|file|display|item|pdb|procedure)[-_a-z0-9]+|gegl:[a-z0-9_.-]+)\b/gi
const gmicPattern = /(?:^|[\s"'(])(-(?:fx_[a-z][\w]*|blur|sharpen|bilateral|denoise|normalize|equalize|local_contrast))(?=\s|["')]|$)/gi
const pythonGiPattern = /\b(?:Gimp\.(?:Image|Drawable|Layer|Selection|Procedure|PDB)|Gimp\.get_pdb\s*\()/g

export function analyzeGimpScript(text: string, filename = 'plugin.txt'): GimpScriptAnalysis {
  if (text.length > MAX_LENGTH) throw new Error('GIMP script exceeds the 2 MB analysis limit')
  const language: GimpScriptAnalysis['language'] =
    /\.scm$/i.test(filename) || /\(\s*script-fu-register\b/i.test(text) ? 'script-fu' :
    /\.py$/i.test(filename) || /\b(?:gi\.repository|from\s+gi\s+import|Gimp\.)/.test(text) ? 'python' :
    /\.gmic$/i.test(filename) ? 'gmic' : 'unknown'
  const operations: GimpOperationMatch[] = []
  const seen = new Set<string>()
  const warnings: string[] = []
  const lines = text.split(/\r?\n/)
  const add = (name: string, line: number, status: GimpOperationStatus, explanation: string) => {
    const key = name.toLowerCase()
    if (seen.has(key) || operations.length >= MAX_MATCHES) return
    seen.add(key)
    operations.push({ name, line, status, explanation })
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const result of line.matchAll(namePattern)) {
      const name = result[0].toLowerCase().replace(/_/g, '-')
      if (name.startsWith('gegl:')) {
        add(name, i + 1, 'gegl-bridge', 'May run through optional desktop GEGL if installed and operation accepts a single image.')
      } else if (EDITOR_EQUIVALENTS[name]) {
        add(name, i + 1, 'native-editor', EDITOR_EQUIVALENTS[name])
      } else {
        add(name, i + 1, 'requires-gimp', 'Requires GIMP PDB/libgimp or a manual rewrite. No API-call conversion is provided.')
      }
    }
    for (const result of line.matchAll(gmicPattern)) {
      const name = result[1].slice(1)
      add(name, i + 1, 'gmic-bridge', 'Potential G’MIC CLI command; check availability and arguments in the desktop filter browser.')
    }
    for (const result of line.matchAll(pythonGiPattern)) {
      const name = result[0].replace(/\s*\($/, '')
      add(name, i + 1, 'requires-gimp', 'GIMP Python GI objects are not available in the editor runtime.')
    }
  }
  if (language === 'script-fu') warnings.push('Script-Fu needs GIMP/TinyScheme; discovered operations are hints only.')
  if (language === 'python') warnings.push('GIMP Python GI code cannot run inside the JavaScript plugin worker.')
  if (/\b(?:subprocess|os\.system|exec\s*\(|eval\s*\(|open\s*\()/i.test(text)) warnings.push('Script may access the host filesystem or run code. The analyzer never executes it.')
  if (operations.length === MAX_MATCHES) warnings.push('Only the first 250 distinct operations are shown.')
  if (!operations.length) warnings.push('No recognized GIMP/GEGL/G’MIC calls were found; this does not mean it is compatible.')
  warnings.push('Mappings require manual review; no GIMP source is automatically installed or executed.')
  const mapped = operations.filter(op => op.status !== 'requires-gimp').length
  return {
    language,
    operations,
    warnings,
    summary: 'Detected ' + operations.length + ' distinct reference(s); ' + mapped + ' could be manually adapted or tried in an optional desktop filter bridge. No script execution performed.',
  }
}
