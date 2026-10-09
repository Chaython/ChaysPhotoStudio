'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { engine } from '../../engine/engine'
import { getFlatComposite } from '../../engine/document'
import { dataUrlToCanvas } from '../../image-ops'
import { gimpAvailable, gimpRunSource } from '../../plugins/gimp-host'
import { useEditorStore } from '../../store'

interface Props { source: string; filename: string }
export function GimpExternalScriptRunner({ source, filename }: Props) {
  const [language, setLanguage] = useState<'python' | 'scheme'>(/\.scm$/i.test(filename) ? 'scheme' : 'python')
  const [trusted, setTrusted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toast = useEditorStore(s => s.pushToast)
  useEffect(() => { setLanguage(/\.scm$/i.test(filename) ? 'scheme' : 'python') }, [filename])
  const run = async () => {
    const doc = engine.activeDoc
    if (!trusted || !doc || busy) return
    setBusy(true); setError('')
    try {
      const image = getFlatComposite(doc).toDataURL('image/png')
      const png = await gimpRunSource(image, language, source)
      if (engine.activeDoc !== doc) throw new Error('Active document changed during GIMP processing')
      const canvas = await dataUrlToCanvas(png)
      engine.addLayerFromCanvas(canvas, 'GIMP Script: ' + filename)
      toast('GIMP script output added as a new layer', 'success')
    } catch (e) { setError(e instanceof Error ? e.message : 'GIMP script failed') }
    finally { setBusy(false) }
  }
  return <div className="rounded border border-border p-2.5 space-y-2">
    <p className="text-[11px] font-medium">Full GIMP interpreter (desktop only)</p>
    <p className="text-[10px] text-muted-foreground">
      The script runs inside a fresh installed GIMP 3 process with the current image exposed as
      Python variables image/drawable, or loaded using GIMP Script-Fu. Scripts that only register
      menu commands may not alter the image. This process has your OS account permissions.
    </p>
    <div className="flex items-center flex-wrap gap-2">
      <label className="text-[10px]">Source language <select value={language} disabled={busy}
        onChange={e => setLanguage(e.target.value as 'python' | 'scheme')} className="rounded border border-border bg-background p-1">
        <option value="python">GIMP 3 Python</option><option value="scheme">GIMP 3 Script-Fu</option>
      </select></label>
      <Button size="sm" disabled={busy || !trusted || !source.trim() || !gimpAvailable() || !engine.activeDoc}
        onClick={() => void run()}>{busy ? 'GIMP processing…' : 'Run source in GIMP → New layer'}</Button>
    </div>
    <label className="flex items-start gap-2 text-[10px]">
      <input type="checkbox" checked={trusted} onChange={e => setTrusted(e.target.checked)} disabled={busy}/>
      <span>I trust this script and authorize running it under my OS account using GIMP 3.</span>
    </label>
    {!gimpAvailable() && <p className="text-[10px] text-muted-foreground">Requires the Electron desktop build; no GIMP process is started in a browser.</p>}
    {error && <p role="alert" className="whitespace-pre-wrap text-[10px] text-destructive">{error}</p>}
  </div>
}
