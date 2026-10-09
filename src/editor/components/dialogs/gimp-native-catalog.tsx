'use client'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { inspectNativeOperation, listNativeGeglOperations } from '../../plugins/native-host'
import { Search, RefreshCw } from 'lucide-react'

/** Handpicked G'MIC CLI commands, not G'MIC-Qt's much larger UI catalog. */
export const GMIC_PRESETS = [
  { name: 'Gaussian Blur', category: 'Blur', command: 'blur', args: '-blur 2' },
  { name: 'Sharpen', category: 'Detail', command: 'sharpen', args: '-sharpen 100' },
  { name: 'Unsharp Mask', category: 'Detail', command: 'fx_sharpen', args: '-fx_sharpen 1' },
  { name: 'Bilateral Smoothing', category: 'Denoise', command: 'bilateral', args: '-bilateral 4,12' },
  { name: 'Normalize', category: 'Color', command: 'normalize', args: '-normalize 0,255' },
  { name: 'Local Contrast', category: 'Detail', command: 'local_contrast', args: '-local_contrast 4' },
  { name: 'Equalize Histogram', category: 'Color', command: 'equalize', args: '-equalize 256' },
  { name: 'Denoise', category: 'Denoise', command: 'denoise', args: '-denoise 10,10,1' },
] as const

interface Props {
  kind: 'gmic' | 'gegl'
  available: boolean
  onSelect(value: string): void
}
export function GimpNativeCatalog({ kind, available, onSelect }: Props) {
  const [search, setSearch] = useState('')
  const [gegl, setGegl] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [help, setHelp] = useState('')
  const [selected, setSelected] = useState('')
  const refresh = async () => {
    if (kind !== 'gegl' || !available) return
    setLoading(true); setError('')
    try { setGegl(await listNativeGeglOperations()) }
    catch (e) { setError(e instanceof Error ? e.message : 'GEGL discovery failed') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [kind, available])
  const entries = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (kind === 'gmic') return GMIC_PRESETS
      .filter(x => !q || (x.name + ' ' + x.category + ' ' + x.command).toLowerCase().includes(q))
      .map(x => ({ name: x.name, command: x.command, args: x.args, category: x.category }))
    return gegl.filter(name => !q || name.toLowerCase().includes(q))
      .map(name => ({ name: name.replace(/^gegl:/, '').replace(/-/g, ' '), command: name, args: '', category: 'Installed GEGL' }))
  }, [kind, gegl, search])
  const inspect = async (command: string) => {
    if (!available) return
    setSelected(command)
    setHelp('Loading installed command help…')
    try { setHelp(await inspectNativeOperation(kind, command)) }
    catch (e) { setHelp(e instanceof Error ? e.message : 'No help available for this command') }
  }
  return (
    <div className="space-y-2 border-t border-border pt-2 mt-2">
      <div className="flex gap-2 items-center">
        <span className="text-[10px] font-medium flex-1">{kind === 'gegl' ? 'Installed GEGL operations' : 'G’MIC CLI filter presets'}</span>
        {kind === 'gegl' && <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={!available || loading} title="Refresh installed GEGL operation list"><RefreshCw size={11}/></Button>}
      </div>
      <label className="flex gap-1 items-center rounded border border-border px-2"><Search size={11}/><input aria-label={'Search '+kind+' filters'} className="h-7 min-w-0 w-full bg-transparent text-[10px] outline-none" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a filter…"/></label>
      {!available && <p className="text-[9px] text-muted-foreground">Install the {kind === 'gegl' ? 'GEGL' : 'G’MIC'} CLI to inspect and apply filters.</p>}
      {error && <p role="alert" className="text-destructive text-[10px]">{error}</p>}
      {kind === 'gegl' && available && !loading && !gegl.length && <p className="text-[9px] text-muted-foreground">No operations returned by GEGL --list-all.</p>}
      <div className="max-h-36 overflow-y-auto space-y-1">
        {entries.slice(0, 200).map(item => (
          <div className="flex items-center gap-1 rounded border border-border/70 p-1" key={item.command}>
            <button title="Inspect command" className="min-w-0 flex-1 text-left text-[10px] hover:text-primary"
              onClick={() => void inspect(item.command)} disabled={!available}>
              <span className="block truncate">{item.name}</span><span className="block truncate text-[9px] text-muted-foreground">{item.command}</span>
            </button>
            <Button size="sm" variant="outline" disabled={!available} onClick={() => onSelect(kind === 'gegl' ? item.command : item.args)}>Use</Button>
          </div>
        ))}
        {entries.length > 200 && <p className="text-[9px] text-muted-foreground">Showing 200 of {entries.length}; refine your search.</p>}
      </div>
      {help && <div className="rounded border border-border p-2">
        <p className="text-[10px] font-medium mb-1">{selected} — installed CLI help</p>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px] text-muted-foreground">{help}</pre>
      </div>}
      {kind === 'gmic' && <p className="text-[9px] text-muted-foreground">Curated CLI commands, not the G’MIC-Qt catalog; your installation may support additional commands and some presets may need adjusted arguments.</p>}
    </div>
  )
}
