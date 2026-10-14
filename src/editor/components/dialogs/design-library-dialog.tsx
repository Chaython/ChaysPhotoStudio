'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { engine } from '../../engine/engine'
import { getFlatComposite } from '../../engine/document'
import { openSerializedProject, placeImageAsSmartLayer, serializeProject } from '../../engine/io'
import { useEditorStore } from '../../store'
import { createCanvas, ctx2d, downloadBlob, uid } from '../../utils/canvas'
import {
  MAX_TEMPLATE_BYTES, type BrandKit, type TemplateEntry,
  listTemplates, listBrandKits, putTemplate, putBrandKit, deleteBrandKit, deleteTemplate,
  parseTemplateFile, parseBrandKitFile, normalizeHex, safeDesignFilename,
} from '../../library/design-library'
import type { DialogProps } from './generic-dialogs'

const makeId = () => uid()
const emptyKit = (): BrandKit => ({
  id: makeId(), name: 'New brand', createdAt: Date.now(), updatedAt: Date.now(),
  swatches: [], fonts: [], logos: [],
})
function templateThumbnail(doc: import('../../types').PsDocument): string {
  const out = createCanvas(240, Math.max(1, Math.round(240 * doc.height / doc.width)))
  const ctx = ctx2d(out)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'medium'
  ctx.drawImage(getFlatComposite(doc), 0, 0, out.width, out.height)
  const url = out.toDataURL('image/jpeg', .6)
  return url.length <= 190_000 ? url : ''
}
const downloadJson = (value: unknown, name: string) =>
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), name)

export function DesignLibraryDialog({ onClose }: DialogProps) {
  const [tab, setTab] = useState<'templates' | 'brands'>('templates')
  const [templates, setTemplates] = useState<TemplateEntry[]>([])
  const [kits, setKits] = useState<BrandKit[]>([])
  const [chosenKit, setChosenKit] = useState<string | null>(null)
  const [editingKit, setEditingKit] = useState<BrandKit>(() => emptyKit())
  const [designName, setDesignName] = useState('')
  const [category, setCategory] = useState('General')
  const [search, setSearch] = useState('')
  const [swatchName, setSwatchName] = useState('')
  const [swatchColor, setSwatchColor] = useState('#E8A33D')
  const [fontLabel, setFontLabel] = useState('')
  const [fontFamily, setFontFamily] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const logoRef = useRef<HTMLInputElement>(null)
  const store = useEditorStore.getState()

  const refresh = useCallback(async () => {
    const [t, b] = await Promise.all([listTemplates(), listBrandKits()])
    setTemplates(t.sort((a, b) => b.updatedAt - a.updatedAt))
    setKits(b.sort((a, b) => a.name.localeCompare(b.name)))
  }, [])
  useEffect(() => { void refresh().catch(e => store.pushToast(String(e), 'error')) }, [refresh])

  const execute = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await fn() }
    catch (err) { store.pushToast(err instanceof Error ? err.message : String(err), 'error') }
    finally { setBusy(false) }
  }

  const saveDesign = () => void execute(async () => {
    const doc = engine.activeDoc
    if (!doc) throw Error('Open a document to save a design template')
    const data = JSON.stringify(serializeProject(doc))
    if (new TextEncoder().encode(data).length > MAX_TEMPLATE_BYTES) throw Error('Project is too large for the 32 MiB template limit')
    const entry: TemplateEntry = {
      id: makeId(), name: (designName || doc.name).trim(), category: category || 'General',
      createdAt: Date.now(), updatedAt: Date.now(), width: doc.width, height: doc.height,
      thumbnail: templateThumbnail(doc), projectJson: data,
    }
    await putTemplate(entry)
    setDesignName('')
    await refresh()
    store.pushToast('Editable design template saved locally', 'success')
  })

  const useTemplate = (entry: TemplateEntry) => void execute(async () => {
    // The project remains the template; a fresh editable document is created.
    const payload = parseTemplateFile({ format: 'chays-design-template', version: 1, entry })
    const project = JSON.parse(payload.projectJson)
    project.doc.name = payload.name + ' copy'
    // Do not copy source recovery snapshots into every new design.
    project.historySnapshots = []
    await openSerializedProject(project, 'New from Template')
    store.pushToast('Opened editable design from template', 'success')
    onClose()
  })

  const importFile = async (file: File) => {
    if (file.size > MAX_TEMPLATE_BYTES * 1.45) throw Error('Design library import is too large')
    const value = JSON.parse(await file.text())
    if (value?.format === 'chays-design-template') {
      const imported = parseTemplateFile(value)
      await putTemplate({ ...imported, id: makeId(), createdAt: Date.now(), updatedAt: Date.now() })
      setTab('templates')
    } else if (value?.format === 'chays-brand-kit') {
      const imported = parseBrandKitFile(value)
      const next = { ...imported, id: makeId(), createdAt: Date.now(), updatedAt: Date.now() }
      await putBrandKit(next); setTab('brands'); setEditingKit(next); setChosenKit(next.id)
    } else throw Error('Unrecognized design template or brand kit file')
    await refresh()
    store.pushToast('Design library file imported', 'success')
  }

  const edit = (update: Partial<BrandKit>) =>
    setEditingKit(current => ({ ...current, ...update, updatedAt: Date.now() }))
  const saveKit = () => void execute(async () => {
    await putBrandKit(editingKit)
    setChosenKit(editingKit.id)
    await refresh()
    store.pushToast('Brand kit saved on this device', 'success')
  })
  const selectKit = (kit: BrandKit) => { setChosenKit(kit.id); setEditingKit(structuredClone(kit)) }

  const applySwatch = (color: string) => {
    store.setFgColor(color)
    const doc = engine.activeDoc, layer = engine.activeLayer
    if (!doc || !layer) { store.pushToast('Foreground color updated', 'info'); return }
    if (layer.kind === 'shape' && layer.shape) {
      layer.shape = { ...layer.shape, fill: color }
    } else if (layer.kind === 'text' && layer.text) {
      layer.text = { ...layer.text, color }
    } else {
      store.pushToast('Foreground color updated; select a shape/text layer to recolor it', 'info')
      return
    }
    layer._v++
    engine.pushHistory('Apply Brand Color', doc)
    engine.emit()
    store.pushToast('Applied brand color to editable layer', 'success')
  }

  const applyFont = (family: string) => {
    const doc = engine.activeDoc, layer = engine.activeLayer
    if (!doc || !layer?.text) { store.pushToast('Select an editable text layer first', 'info'); return }
    layer.text = { ...layer.text, fontFamily: family }
    layer._v++
    engine.pushHistory('Apply Brand Font', doc)
    engine.emit()
    store.pushToast('Applied brand font (system font must be installed)', 'success')
  }

  const addLogo = async (file: File) => {
    if (file.size > 512 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
      throw Error('Logo must be PNG/JPEG/WebP and at most 512 KiB')
    if (editingKit.logos.length >= 8) throw Error('A brand kit supports up to 8 logos')
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error ?? Error('Unable to read logo'))
      reader.readAsDataURL(file)
    })
    edit({ logos: [...editingKit.logos, { id: makeId(), name: file.name.slice(0, 70), dataUrl: url }] })
  }
  const placeLogo = (logo: BrandKit['logos'][number]) => void execute(async () => {
    if (!engine.activeDoc) throw Error('Open a document before placing a logo')
    const blob = await (await fetch(logo.dataUrl)).blob()
    const file = new File([blob], logo.name + '.png', { type: blob.type })
    await placeImageAsSmartLayer(file)
    store.pushToast('Placed logo as a Smart Object', 'success')
  })

  const filtered = templates.filter(t => [t.name, t.category].join(' ').toLowerCase().includes(search.toLowerCase()))
  return <>
    <DialogHeader><DialogTitle>Design Templates & Brand Kits</DialogTitle></DialogHeader>
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap gap-2 items-center">
        <Button size="sm" variant={tab === 'templates' ? 'default' : 'secondary'} onClick={() => setTab('templates')}>Templates ({templates.length})</Button>
        <Button size="sm" variant={tab === 'brands' ? 'default' : 'secondary'} onClick={() => setTab('brands')}>Brand kits ({kits.length})</Button>
        <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => fileRef.current?.click()}>Import…</Button>
        <input ref={fileRef} type="file" className="hidden" accept=".json,.ztemplate.json,.zbrand.json"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) void execute(() => importFile(file))
            e.currentTarget.value = ''
          }} />
      </div>
      {tab === 'templates' ? <>
        <p className="text-muted-foreground">Save the entire active document—including editable layers and artboards—as a reusable local template. Opening a template creates a separate document, never overwriting its source.</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Template name</Label><Input className="h-7 text-xs" value={designName} onChange={e => setDesignName(e.target.value)} placeholder={engine.activeDoc?.name || 'Template name'} /></div>
          <div><Label>Category</Label><Input className="h-7 text-xs" value={category} onChange={e => setCategory(e.target.value)} placeholder="Social / Poster / Print" /></div>
        </div>
        <Button size="sm" disabled={busy || !engine.activeDoc} onClick={saveDesign}>Save active document as template</Button>
        <Input className="h-7 text-xs" aria-label="Search design templates" placeholder="Find templates by name or category…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="grid sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
          {filtered.map(t => <div key={t.id} className="rounded border border-border p-2 space-y-1 min-w-0">
            {t.thumbnail ? <img src={t.thumbnail} alt={'Preview of '+t.name} className="h-24 max-w-full object-contain mx-auto" /> : <div className="h-12 bg-muted rounded" />}
            <div className="font-medium truncate">{t.name}</div>
            <div className="text-muted-foreground">{t.category} · {t.width} × {t.height}</div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" disabled={busy} onClick={() => useTemplate(t)}>Use template</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => downloadJson({
                format: 'chays-design-template', version: 1, entry: t,
              }, safeDesignFilename(t.name)+'.ztemplate.json')}>Export</Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => {
                if (!window.confirm('Permanently remove template '+t.name+' from this device?')) return
                void execute(async () => { await deleteTemplate(t.id); await refresh() })
              }}>Delete</Button>
            </div>
          </div>)}
          {!filtered.length && <div className="text-muted-foreground">No matching saved design templates yet.</div>}
        </div>
      </> : <>
        <p className="text-muted-foreground">Keep brand colors, preferred fonts and logos in a local kit. Save changes to persist them. Fonts need to be installed locally; importing a kit does not download font files.</p>
        <div className="flex items-center gap-2 flex-wrap">
          <select aria-label="Choose brand kit" className="flex-1 min-w-0 rounded border bg-background p-1"
            value={chosenKit ?? ''} onChange={e => {
              const kit = kits.find(k => k.id === e.target.value)
              if (kit) selectKit(kit)
            }}>
            <option value="">Unsaved new kit</option>
            {kits.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <Button size="sm" variant="secondary" onClick={() => { setChosenKit(null); setEditingKit(emptyKit()) }}>New</Button>
          <Button size="sm" variant="secondary" disabled={!chosenKit} onClick={() => { setChosenKit(null); setEditingKit({ ...structuredClone(editingKit), id: makeId(), name: editingKit.name + ' copy' }) }}>Duplicate</Button>
          <Button size="sm" variant="destructive" disabled={!chosenKit || busy} onClick={() => {
            if (!window.confirm('Delete this saved brand kit?')) return
            void execute(async () => { await deleteBrandKit(chosenKit!); setChosenKit(null); setEditingKit(emptyKit()); await refresh() })
          }}>Delete</Button>
        </div>
        <div><Label>Brand name</Label><Input className="h-7 text-xs" value={editingKit.name} onChange={e => edit({ name: e.target.value })}/></div>
        <div className="space-y-1">
          <Label>Color palette ({editingKit.swatches.length}/32)</Label>
          <div className="flex flex-wrap gap-2">
            {editingKit.swatches.map(s => <div key={s.id} className="flex items-center gap-1 border rounded p-1">
              <button title={'Apply '+s.name} aria-label={'Apply '+s.name} type="button" onClick={() => applySwatch(s.color)} className="w-6 h-6 border rounded" style={{background:s.color}}/>
              <span title={s.color}>{s.name}</span>
              <button title="Remove swatch" type="button" className="text-destructive px-1" onClick={() => edit({ swatches: editingKit.swatches.filter(x => x.id !== s.id) })}>×</button>
            </div>)}
          </div>
          <div className="flex gap-1">
            <Input aria-label="Color name" placeholder="Primary" className="h-7 flex-1 text-xs" value={swatchName} onChange={e => setSwatchName(e.target.value)} />
            <Input aria-label="Hex color" placeholder="#112233" className="h-7 w-24 text-xs" value={swatchColor} onChange={e => setSwatchColor(e.target.value)} />
            <Button size="sm" variant="secondary" disabled={editingKit.swatches.length >= 32 || !normalizeHex(swatchColor)}
              onClick={() => { const c = normalizeHex(swatchColor); if (c) edit({ swatches: [...editingKit.swatches, {id:makeId(), name:swatchName || 'Color', color:c}] }); setSwatchName('') }}>Add</Button>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Fonts ({editingKit.fonts.length}/16)</Label>
          <div className="flex gap-1 flex-wrap">
            {editingKit.fonts.map(f => <div key={f.id} className="flex items-center gap-1 border rounded p-1">
              <button type="button" title={f.family} onClick={() => applyFont(f.family)}>{f.name}</button>
              <button type="button" title="Remove font" className="text-destructive px-1" onClick={() => edit({ fonts: editingKit.fonts.filter(x => x.id !== f.id) })}>×</button>
            </div>)}
          </div>
          <div className="flex gap-1">
            <Input className="h-7 flex-1 text-xs" aria-label="Font label" placeholder="Heading" value={fontLabel} onChange={e => setFontLabel(e.target.value)}/>
            <Input className="h-7 flex-1 text-xs" aria-label="Font family" placeholder="Arial" value={fontFamily} onChange={e => setFontFamily(e.target.value)}/>
            <Button size="sm" variant="secondary" disabled={editingKit.fonts.length >= 16 || !fontFamily.trim()}
              onClick={() => { edit({fonts:[...editingKit.fonts,{id:makeId(),name:fontLabel || 'Font',family:fontFamily.trim()}]}); setFontLabel(''); setFontFamily('') }}>Add</Button>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Logos ({editingKit.logos.length}/8)</Label>
          <div className="flex gap-2 flex-wrap">
            {editingKit.logos.map(l => <div className="rounded border p-1 space-y-1" key={l.id}>
              <img src={l.dataUrl} alt={l.name} className="h-12 w-20 object-contain" />
              <div className="text-[10px] truncate max-w-24">{l.name}</div>
              <Button size="sm" variant="secondary" disabled={!engine.activeDoc || busy} onClick={() => placeLogo(l)}>Place</Button>
              <button type="button" aria-label={'Remove '+l.name} onClick={() => edit({logos:editingKit.logos.filter(x=>x.id!==l.id)})} className="text-destructive ml-2">×</button>
            </div>)}
          </div>
          <Button size="sm" variant="secondary" disabled={editingKit.logos.length >= 8} onClick={() => logoRef.current?.click()}>Add logo image…</Button>
          <input type="file" ref={logoRef} className="hidden" accept="image/png,image/jpeg,image/webp" onChange={e => {
            const f = e.target.files?.[0]; if (f) void execute(() => addLogo(f)); e.currentTarget.value = ''
          }}/>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !editingKit.name.trim()} onClick={saveKit}>Save brand kit</Button>
          <Button size="sm" variant="outline" onClick={() => downloadJson({
            format:'chays-brand-kit',version:1,kit:editingKit,
          },safeDesignFilename(editingKit.name)+'.zbrand.json')}>Export kit</Button>
        </div>
      </>}
      <p className="text-[10px] text-muted-foreground">Offline browser/device storage only; clearing site data also clears this library. Export important templates/kits for backups. Templates are limited to 32 MiB (40 entries), brand kits to 32. Opening an imported template creates a new local document, not an automatic network download.</p>
    </div>
    <DialogFooter><Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>Close</Button></DialogFooter>
  </>
}
