'use client'
import { useMemo, useRef, useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { engine } from '../../engine/engine'
import { compositeDocument } from '../../engine/document'
import { createCanvas, ctx2d, downloadBlob } from '../../utils/canvas'
import { encodeCanvas } from '../../formats'
import { useEditorStore } from '../../store'
import { safeDesignFilename } from '../../library/design-library'
import {
  MAX_MERGE_CSV_BYTES, MAX_MERGE_ROWS, mergeEditableLayers,
  mergeFieldNames, parseDesignCsv, type MergeTable,
} from '../../library/design-merge'
import type { DialogProps } from './generic-dialogs'

type ExportFormat = 'png' | 'jpeg' | 'webp'

export function BulkDesignDialog({ onClose }: DialogProps) {
  const documentId = useRef(engine.activeDoc?.id ?? null).current
  const doc = engine.docs.find(d => d.id === documentId) ?? null
  const fileRef = useRef<HTMLInputElement>(null)
  const stop = useRef(false)
  const [csvName, setCsvName] = useState('')
  const [table, setTable] = useState<MergeTable | null>(null)
  const [filenameColumn, setFilenameColumn] = useState('')
  const [format, setFormat] = useState<ExportFormat>('png')
  const [quality, setQuality] = useState(90)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const store = useEditorStore.getState()

  const placeholders = useMemo(() => mergeFieldNames(
    (doc?.layers ?? []).filter(l => l.kind === 'text' && l.text)
      .map(l => l.text?.content ?? ''),
  ), [doc])
  const unknown = placeholders.filter(n => !table?.columns.includes(n))
  const exportAll = async () => {
    if (!doc || !table || exporting || engine.activeDoc?.id !== documentId || unknown.length) return
    setExporting(true); stop.current = false; setError('')
    let directory: any = null
    let count = 0
    try {
      const picker = (window as any).showDirectoryPicker as undefined | ((opts?: any) => Promise<any>)
      if (picker) {
        try { directory = await picker({ mode:'readwrite' }) }
        catch (err: any) {
          if (err?.name === 'AbortError') return
          if (table.rows.length > 20) throw Error('Folder permission unavailable; export 20 rows or fewer in browser-download mode')
        }
      } else if (table.rows.length > 20) throw Error('Exporting more than 20 designs requires a browser with folder picker support')
      if (engine.activeDoc?.id !== documentId) throw Error('Active document changed')
      const ext = format === 'jpeg' ? 'jpg' : format
      const baseName = safeDesignFilename(doc.name)
      for (const [index, row] of table.rows.entries()) {
        if (stop.current) break
        setProgress('Rendering ' + (index + 1) + ' / ' + table.rows.length)
        store.setProgress({ active: true, label: 'Bulk design ' + (index + 1) + '/' + table.rows.length,
          value: index / table.rows.length })
        // Detached composite: never mutate source text layers, history or cached pixels.
        const layers = mergeEditableLayers(doc.layers, row)
        const temp = {
          ...doc, id: doc.id + '-bulk-' + index, layers, _epoch: doc._epoch + index + 1,
          _liveDrag: null, _stroke: null, _strokeLayerId: null, previewFilter: null,
          previewAdjustment: null, channelView: 'rgb' as const,
        }
        const composite = compositeDocument(temp)
        const flat = createCanvas(doc.width, doc.height)
        ctx2d(flat).drawImage(composite, 0, 0)
        const blob = await encodeCanvas(flat, format, {
          quality, background: '#ffffff', includeMetadata: false,
          resolutionPpi: doc.resolutionPpi ?? 72,
        })
        const identifier = filenameColumn ? row[filenameColumn] : ''
        const filename = baseName + '-' + String(index + 1).padStart(3, '0')
          + (identifier ? '-' + safeDesignFilename(identifier).slice(0, 50) : '') + '.' + ext
        if (directory) {
          const handle = await directory.getFileHandle(filename, {create:true})
          const writer = await handle.createWritable()
          try { await writer.write(blob) } finally { await writer.close() }
        } else {
          downloadBlob(blob, filename)
          await new Promise(resolve => setTimeout(resolve, 160))
        }
        count++
        // Permit cancellation/UI paints on each iteration.
        if (directory) await new Promise(resolve => setTimeout(resolve, 0))
      }
      store.pushToast((stop.current ? 'Stopped after ' : 'Exported ') + count + ' designs', 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      store.pushToast('Bulk export: ' + msg, 'error')
    } finally {
      setExporting(false)
      store.setProgress(null)
      setProgress('')
      stop.current = false
    }
  }
  const loadCsv = async (file: File) => {
    setError('')
    if (file.size > MAX_MERGE_CSV_BYTES) { setError('CSV exceeds 1 MiB'); return }
    try {
      const parsed = parseDesignCsv(await file.text())
      setCsvName(file.name)
      setFilenameColumn(parsed.columns[0])
      setTable(parsed)
    } catch (err) {
      setTable(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return <>
    <DialogHeader><DialogTitle>Bulk Create from CSV</DialogTitle></DialogHeader>
    <div className="text-xs space-y-3">
      <p className="text-muted-foreground">Put exact <code>{'{{Column Name}}'}</code> placeholders inside editable text layers, then choose a CSV with matching column headers. One flattened image is generated per data row; the original design stays editable and unchanged.</p>
      <div className="flex flex-wrap gap-2 items-center">
        <Button size="sm" variant="secondary" disabled={exporting} onClick={() => fileRef.current?.click()}>Load CSV…</Button>
        <input ref={fileRef} type="file" className="hidden" accept=".csv,text/csv" onChange={e => {
          const f = e.target.files?.[0]
          if (f) void loadCsv(f)
          e.currentTarget.value = ''
        }} />
        <span className="text-muted-foreground">{csvName || 'No CSV loaded'}</span>
      </div>
      {doc && <div>Source document: <strong>{doc.name}</strong> ({doc.width}×{doc.height})</div>}
      {!doc && <p>Open a document with editable text layers first.</p>}
      <div className="rounded border border-border p-2">
        <Label className="text-[11px]">Text placeholders found</Label>
        <div className="flex flex-wrap gap-1 mt-1">
          {placeholders.map(name => <span key={name} className={'rounded border px-2 py-1 ' + (unknown.includes(name) ? 'border-destructive' : 'border-border')}>{'{{' + name + '}}'}</span>)}
          {!placeholders.length && <span className="text-muted-foreground">None. Add a text layer containing {'{{Name}}'} or another CSV column first.</span>}
        </div>
      </div>
      {table && <>
        <div className="flex justify-between gap-2"><strong>{table.rows.length} rows · {table.columns.length} columns</strong><span>Limit {MAX_MERGE_ROWS} designs</span></div>
        <div className="overflow-x-auto rounded border border-border max-h-36">
          <table className="w-full text-left text-[10px]">
            <thead><tr>{table.columns.map(c => <th key={c} className="p-1 border-b border-border">{c}</th>)}</tr></thead>
            <tbody>{table.rows.slice(0, 4).map((row, i) => <tr key={i}>{table.columns.map(col => <td key={col} className="p-1 border-b border-border max-w-36 truncate">{row[col]}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {unknown.length > 0 && <div className="text-destructive">Missing CSV columns: {unknown.join(', ')}</div>}
        <div className="flex flex-wrap gap-2 items-center">
          <Label>Output names</Label>
          <select className="rounded border border-border bg-background p-1" aria-label="Filename column"
            value={filenameColumn} onChange={e => setFilenameColumn(e.target.value)}>
            <option value="">Number only</option>
            {table.columns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <Label>Image format</Label>
          <select className="rounded border border-border bg-background p-1" value={format} onChange={e => setFormat(e.target.value as ExportFormat)}>
            <option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option>
          </select>
          {format !== 'png' && <label>Quality {quality} <input aria-label="Output quality" type="range" min={1} max={100} value={quality} onChange={e => setQuality(Number(e.target.value))}/></label>}
        </div>
      </>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {progress && <p role="status">{progress}</p>}
      <p className="text-[10px] text-muted-foreground">Local-only CSV processing. CSV cells are inserted as literal text, not HTML or code. The first release supports text placeholders, not image or color-field mapping. A directory picker is preferred; without one, browser downloads are limited to 20 rows.</p>
    </div>
    <DialogFooter>
      {exporting && <Button size="sm" variant="destructive" onClick={() => { stop.current = true }}>Stop after current design</Button>}
      <Button size="sm" variant="secondary" disabled={exporting} onClick={onClose}>Close</Button>
      <Button size="sm" disabled={!doc || !table || !placeholders.length || unknown.length > 0 || exporting}
        onClick={() => void exportAll()}>{exporting ? 'Exporting…' : 'Export designs'}</Button>
    </DialogFooter>
  </>
}
