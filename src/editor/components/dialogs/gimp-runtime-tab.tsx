'use client'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { engine } from '../../engine/engine'
import { getFlatComposite } from '../../engine/document'
import { dataUrlToCanvas } from '../../image-ops'
import { useEditorStore } from '../../store'
import {
  gimpAvailable, gimpInfo, gimpListProcedures, gimpInspectProcedure, gimpRunProcedure,
  type GimpToolStatus, type GimpProcedureArg,
} from '../../plugins/gimp-host'

function isNumeric(type: string) { return /(?:int|float|double|long|uint|uchar)/i.test(type) }
function isBoolean(type: string) { return /bool/i.test(type) }
function isText(type: string) { return /(?:string|gchararray)/i.test(type) }
function isAuto(name: string) { return ['run-mode', 'image', 'drawable', 'drawables'].includes(name) }
type ArgumentValues = Record<string, string | boolean>

export function GimpRuntimeTab() {
  const toast = useEditorStore(s => s.pushToast)
  const [status, setStatus] = useState<GimpToolStatus | null>(null)
  const [list, setList] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [argumentsList, setArgumentsList] = useState<GimpProcedureArg[]>([])
  const [values, setValues] = useState<ArgumentValues>({})
  const [busy, setBusy] = useState(false)
  const [trust, setTrust] = useState(false)
  const [error, setError] = useState('')
  const available = gimpAvailable()
  // This effect only occurs when the user opens this tab (Radix lazy panel).
  useEffect(() => {
    if (!available) return
    let alive = true
    void gimpInfo().then(v => { if (alive) setStatus(v) })
      .catch(e => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [available])
  const discovered = useMemo(() => list.filter(x => x.includes(query.toLowerCase())), [list, query])

  const discover = async () => {
    setBusy(true); setError('')
    try { const r = await gimpListProcedures(); setList(r.procedures); if (!r.procedures.length) setError('GIMP returned no installed plug-in procedures') }
    catch (e) { setError(e instanceof Error ? e.message : 'GIMP procedure discovery failed') }
    finally { setBusy(false) }
  }
  const select = async (procedure: string) => {
    setName(procedure); setArgumentsList([]); setValues({}); setError(''); setBusy(true)
    try { const r = await gimpInspectProcedure(procedure); setArgumentsList(r.arguments) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not inspect procedure') }
    finally { setBusy(false) }
  }
  const run = async () => {
    if (!trust || !name) return
    const doc = engine.activeDoc
    if (!doc) { setError('Open a document first'); return }
    const parameters: Record<string, string | number | boolean> = {}
    try {
      for (const arg of argumentsList) {
        if (isAuto(arg.name) || !(arg.name in values)) continue
        const value = values[arg.name]
        if (isBoolean(arg.type)) parameters[arg.name] = Boolean(value)
        else if (isNumeric(arg.type)) {
          const numeric = Number(value)
          if (!Number.isFinite(numeric) || String(value).trim() === '') throw new Error('Invalid numeric value: ' + arg.name)
          parameters[arg.name] = numeric
        } else if (isText(arg.type)) parameters[arg.name] = String(value)
        else throw new Error('Unsupported argument type ' + arg.type + ': ' + arg.name)
      }
      setBusy(true); setError('')
      const source = getFlatComposite(doc).toDataURL('image/png')
      const result = await gimpRunProcedure(source, name, parameters)
      if (engine.activeDoc !== doc) throw new Error('Document changed before the GIMP result returned')
      const canvas = await dataUrlToCanvas(result)
      engine.addLayerFromCanvas(canvas, 'GIMP: ' + name)
      toast('GIMP result imported as a new layer', 'success')
    } catch (e) { setError(e instanceof Error ? e.message : 'GIMP execution failed') }
    finally { setBusy(false) }
  }
  return <div className="space-y-3 text-[11px]">
    <p className="text-muted-foreground">
      Run installed GIMP 3 Python, Script-Fu, or compiled plug-in procedures using GIMP itself.
      The desktop bridge launches GIMP only for explicit actions; no interpreter is kept in memory.
    </p>
    {!available && <p className="rounded border border-border p-2">This bridge is available in Electron only. The browser and Tauri builds do not execute native GIMP binaries.</p>}
    {available && <p className="rounded border border-border p-2">
      {status?.available ? 'GIMP detected: ' + status.version : status ? 'GIMP 3 not found. Install GIMP or set CHAYS_GIMP_PATH before launch.' : 'Checking GIMP 3 on request…'}
    </p>}
    <div className="flex flex-wrap gap-2 items-center">
      <Button size="sm" disabled={!available || !status?.available || busy} onClick={() => void discover()}>
        {busy ? 'Working…' : 'Discover installed procedures'}
      </Button>
      <span className="text-[10px] text-muted-foreground">{list.length ? list.length + ' procedures listed' : 'No discovery performed'}</span>
    </div>
    {list.length > 0 && <div className="space-y-1">
      <input aria-label="Search GIMP procedures" placeholder="Search GIMP plug-ins…" value={query}
        onChange={e => setQuery(e.target.value)} className="w-full h-8 rounded border border-border bg-background px-2"/>
      <div className="max-h-40 overflow-y-auto space-y-1">
        {discovered.slice(0, 150).map(proc => <button key={proc} onClick={() => void select(proc)}
          className={'block w-full text-left rounded border px-2 py-1 font-mono text-[10px] ' + (name === proc ? 'border-primary' : 'border-border hover:bg-accent')}>{proc}</button>)}
      </div>
    </div>}
    {name && <div className="rounded border border-border p-2 space-y-2">
      <p className="font-medium">Selected procedure: <span className="font-mono">{name}</span></p>
      <p className="text-[10px] text-muted-foreground">Image/drawable and noninteractive mode are supplied automatically. Empty fields retain GIMP defaults. Not every plugin supports headless operation.</p>
      {argumentsList.filter(arg => !isAuto(arg.name)).map(arg => <label key={arg.name} className="flex items-center gap-2">
        <span className="w-36 shrink-0 truncate" title={arg.name}>{arg.name} <span className="text-muted-foreground">({arg.type})</span></span>
        {isBoolean(arg.type) ? <input type="checkbox" checked={values[arg.name] === true} onChange={e => setValues(v => ({ ...v, [arg.name]: e.target.checked }))}/> :
          <input className="min-w-0 w-full rounded border border-border bg-background px-2 py-1" type={isNumeric(arg.type) ? 'number' : 'text'}
            disabled={!isNumeric(arg.type) && !isText(arg.type)} placeholder={isNumeric(arg.type) || isText(arg.type) ? 'Use default' : 'Unsupported parameter type'}
            value={String(values[arg.name] ?? '')} onChange={e => setValues(v => ({ ...v, [arg.name]: e.target.value }))}/>}
      </label>)}
      <label className="flex gap-2 items-start">
        <input type="checkbox" checked={trust} onChange={e => setTrust(e.target.checked)}/>
        <span>I trust this installed GIMP plugin. It executes as an external process with my user permissions, not in the browser sandbox.</span>
      </label>
      <Button size="sm" disabled={!trust || busy || !argumentsList.length || !engine.activeDoc} onClick={() => void run()}>Execute in GIMP → New layer</Button>
    </div>}
    {error && <p role="alert" className="text-destructive whitespace-pre-wrap">{error}</p>}
    <p className="text-[10px] text-muted-foreground">PNG interchange currently uses 8-bit RGBA pixels; 16/32-bit values and editable GIMP layers are not round-tripped. Plugin side effects outside the document cannot be undone.</p>
  </div>
}
