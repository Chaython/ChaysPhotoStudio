'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { EmbeddedLanguage } from '../../plugins/embedded-interpreters'

interface RunningTask { result: Promise<{ text: string }>; cancel(): void }
interface Props { source: string; filename: string }

export function GimpEmbeddedRunner({ source, filename }: Props) {
  const [language, setLanguage] = useState<EmbeddedLanguage>(/\.scm$/i.test(filename) ? 'scheme' : 'python')
  const [allowDownload, setAllowDownload] = useState(false)
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const task = useRef<RunningTask | null>(null)
  useEffect(() => { setLanguage(/\.scm$/i.test(filename) ? 'scheme' : 'python') }, [filename])
  useEffect(() => () => { task.current?.cancel(); task.current = null }, [])
  const run = async () => {
    if (busy) return
    setBusy(true); setOutput('')
    try {
      // Neither interpreter nor worker module is requested until Run is clicked.
      const { runEmbeddedInterpreter } = await import('../../plugins/embedded-interpreters')
      const job = runEmbeddedInterpreter(language, source, { allowDownload })
      task.current = job
      const data = await job.result
      setOutput(data.text || '(Completed without output)')
    } catch (err) {
      setOutput(err instanceof Error ? err.message : 'Interpreter failed')
    } finally {
      task.current = null
      setBusy(false)
    }
  }
  return <div className="rounded border border-border p-2.5 space-y-2">
    <div className="text-[11px] font-medium">Embedded interpreter — manual execution</div>
    <div className="flex items-center flex-wrap gap-2">
      <label className="text-[10px]">Runtime <select className="rounded border border-border bg-background p-1"
        value={language} disabled={busy} onChange={e => setLanguage(e.target.value as EmbeddedLanguage)}>
        <option value="scheme">Scheme subset</option><option value="python">Python (Pyodide WASM)</option>
      </select></label>
      <Button size="sm" disabled={busy || !source.trim() || (language === 'python' && !allowDownload)}
        onClick={() => void run()}>{busy ? 'Running…' : 'Run embedded code'}</Button>
      {busy && <Button size="sm" variant="secondary" onClick={() => task.current?.cancel()}>Cancel</Button>}
    </div>
    {language === 'python' && <label className="flex items-start gap-2 text-[10px]">
      <input type="checkbox" checked={allowDownload} disabled={busy}
        onChange={e => setAllowDownload(e.target.checked)}/>
      <span>Allow downloading the pinned Pyodide WASM interpreter from jsDelivr when I press Run (network required, only on demand).</span>
    </label>}
    <p className="text-[10px] text-muted-foreground">
      Embedded runtimes execute code for calculations and text output only. GIMP imports, procedures, filters,
      GI bindings and image editing are not available here. Scheme supports a limited safe subset, not full TinyScheme.
      Workers are destroyed after each run, cancellation or timeout.
    </p>
    {output && <pre aria-label="Interpreter output" className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border p-2 text-[10px] font-mono">{output}</pre>}
  </div>
}
