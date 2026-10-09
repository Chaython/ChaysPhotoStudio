'use client'

import { useRef, useState } from 'react'
import { analyzeGimpScript, type GimpScriptAnalysis } from '../../plugins/gimp-script-analyzer'
import { Button } from '@/components/ui/button'
import { FileCode2, Upload } from 'lucide-react'
import { GimpEmbeddedRunner } from './gimp-embedded-runner'

const MAX_SOURCE_BYTES = 2_000_000

export function GimpAnalysisTab() {
  const picker = useRef<HTMLInputElement>(null)
  const [filename, setFilename] = useState('plugin.py')
  const [source, setSource] = useState('')
  const [result, setResult] = useState<GimpScriptAnalysis | null>(null)
  const [error, setError] = useState('')
  const analyze = (code = source, name = filename) => {
    try { setResult(analyzeGimpScript(code, name)); setError('') }
    catch (e) { setResult(null); setError(e instanceof Error ? e.message : 'Analysis failed') }
  }
  const open = async (file?: File) => {
    if (!file) return
    if (file.size > MAX_SOURCE_BYTES) { setError('GIMP script exceeds the 2 MB analysis limit'); return }
    try {
      const code = await file.text()
      setFilename(file.name); setSource(code); analyze(code, file.name)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read GIMP script') }
  }
  return (
    <div className="space-y-3 text-xs">
      <p className="text-[11px] text-muted-foreground">
        Inspect Script-Fu (.scm), GIMP Python (.py) and G’MIC (.gmic) source. This is static analysis only:
        the script is never run or installed. Matches are suggestions, not automated conversions.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => picker.current?.click()}><Upload size={12} className="mr-1"/>Open GIMP script…</Button>
        <input ref={picker} type="file" accept=".scm,.py,.gmic,.txt" className="hidden"
          onChange={e => { void open(e.target.files?.[0]); e.target.value = '' }}/>
        <span className="truncate text-[10px] text-muted-foreground">{filename}</span>
        <Button size="sm" disabled={!source.trim()} onClick={() => analyze()}><FileCode2 size={12} className="mr-1"/>Analyze source</Button>
      </div>
      <textarea aria-label="GIMP script source" value={source} onChange={e => { setSource(e.target.value); setResult(null) }}
        placeholder="Paste a GIMP script, or open a .py/.scm file…" rows={6} spellCheck={false}
        className="w-full rounded border border-border bg-background p-2 font-mono text-[10px]"/>
      <GimpEmbeddedRunner source={source} filename={filename}/>
      {error && <p role="alert" className="text-destructive text-[10px]">{error}</p>}
      {result && (
        <>
          <div className="rounded border border-border bg-panel/40 p-2.5">
            <p className="font-medium">{result.language} · {result.summary}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Only known editor equivalents are classified as manually adaptable. Native-runtime calls remain unsupported.</p>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {result.operations.map(op => (
              <div className="rounded border border-border p-2" key={op.name}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 break-all font-mono text-[10px]">{op.name}</span>
                  <span className="shrink-0 text-[9px] text-muted-foreground">line {op.line} · {op.status}</span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{op.explanation}</p>
              </div>
            ))}
          </div>
          {result.warnings.map((warning, index) =>
            <p key={index} className="text-[10px] text-muted-foreground">• {warning}</p>
          )}
        </>
      )}
    </div>
  )
}
