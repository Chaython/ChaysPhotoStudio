'use client'

import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Clipboard, Copy, Download,
  FileImage, Pencil, RotateCcw, Search, Tags, Trash2, Upload, X,
} from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { downloadBlob } from '../../utils/canvas'
import { editableMetadataFromFields, readImageMetadata } from '../../formats/metadata'
import { buildWritableXmp } from '../../formats/metadata-write'
import type { EditableImageMetadata, ImageMetadata, ImageMetadataField, PsDocument } from '../../types'

type Family = 'all' | 'exif' | 'xmp' | 'iptc' | 'icc' | 'gps' | 'file'

const FILTERS: { id: Family; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'exif', label: 'EXIF' },
  { id: 'xmp', label: 'XMP' },
  { id: 'iptc', label: 'IPTC' },
  { id: 'icc', label: 'ICC' },
  { id: 'gps', label: 'GPS' },
  { id: 'file', label: 'File' },
]

function fieldFamily(field: ImageMetadataField): Family {
  const group = field.group.toLowerCase()
  const label = field.label.toLowerCase()
  if (group.includes('gps') || label.startsWith('gps ') || field.tag === 'GPSDecimal') return 'gps'
  if (group.startsWith('xmp')) return 'xmp'
  if (group.includes('iptc')) return 'iptc'
  if (group.includes('icc')) return 'icc'
  if (group.includes('exif') || group.includes('tiff')) return 'exif'
  return 'file'
}

function displayBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return String(bytes) + ' B'
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2) + ' ' + units[i]
}

function cleanFileStem(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'metadata'
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

function metadataAsText(fields: ImageMetadataField[]): string {
  return fields.map(f => f.group + '\t' + f.label + '\t' + f.tag + '\t' + f.value).join('\n')
}

function documentMetadata(doc: PsDocument): ImageMetadata {
  return doc.metadata ?? {
    fileName: doc.name,
    mimeType: '',
    fileSize: 0,
    format: 'Studio document',
    fields: [],
    editable: {},
  }
}

function ensureDocumentMetadata(doc: PsDocument): ImageMetadata {
  if (!doc.metadata) doc.metadata = documentMetadata(doc)
  if (!doc.metadata.editable) doc.metadata.editable = {}
  return doc.metadata
}

function SmallButton(props: { title: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
      className="h-7 min-w-7 px-1.5 rounded border border-border bg-background/70 hover:bg-accent inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
    >
      {props.children}
    </button>
  )
}

function FieldInput(props: {
  label: string
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
}) {
  const cls = 'w-full rounded border border-border bg-background text-[10px] outline-none focus:ring-1 focus:ring-ring px-2'
  return (
    <label className="space-y-1 min-w-0">
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{props.label}</span>
      {props.multiline ? (
        <textarea
          value={props.value ?? ''}
          onChange={e => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          rows={3}
          className={cls + ' py-1.5 resize-y min-h-16'}
        />
      ) : (
        <input
          value={props.value ?? ''}
          onChange={e => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          className={cls + ' h-7'}
        />
      )}
    </label>
  )
}

function FileInfoEditor({ doc }: { doc: PsDocument }) {
  const [open, setOpen] = useState(true)
  const metadata = documentMetadata(doc)
  const edit = metadata.editable ?? {}

  const liveDocument = () => engine.docs.find(candidate => candidate.id === doc.id) ?? null

  const update = <K extends keyof EditableImageMetadata,>(key: K, value: EditableImageMetadata[K]) => {
    const target = liveDocument()
    if (!target) return
    const live = ensureDocumentMetadata(target)
    live.editable = { ...live.editable, [key]: value }
    live.edited = true
    target.dirty = true
    engine.emit()
  }

  const resetFromSource = () => {
    const target = liveDocument()
    if (!target) return
    const live = ensureDocumentMetadata(target)
    live.editable = editableMetadataFromFields(live.fields ?? [])
    live.edited = false
    target.dirty = true
    engine.emit()
  }

  const clearFileInfo = () => {
    const target = liveDocument()
    if (!target) return
    const live = ensureDocumentMetadata(target)
    live.editable = {}
    live.edited = true
    target.dirty = true
    engine.emit()
  }

  const exportXmp = () => {
    const target = liveDocument()
    if (!target) return
    const xmp = buildWritableXmp(ensureDocumentMetadata(target))
    if (!xmp) {
      useEditorStore.getState().pushToast('No editable File Info to export', 'info')
      return
    }
    downloadBlob(new Blob([xmp], { type: 'application/rdf+xml' }), cleanFileStem(target.name) + '.xmp')
  }

  const importXmp = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xmp,application/rdf+xml,application/xml,text/xml'
    input.onchange = async () => {
      const file = input.files?.[0]
      const target = liveDocument()
      if (!file || !target) return
      try {
        const parsed = await readImageMetadata(file)
        const imported = editableMetadataFromFields(parsed.fields)
        const live = ensureDocumentMetadata(target)
        live.editable = imported
        live.edited = true
        target.dirty = true
        engine.emit()
        useEditorStore.getState().pushToast('Imported File Info from ' + file.name, 'success')
      } catch (err) {
        const why = err instanceof Error && err.message ? ' — ' + err.message : ''
        useEditorStore.getState().pushToast('XMP import failed' + why, 'error')
      }
    }
    input.click()
  }

  return (
    <section className="border-b border-border">
      <button
        type="button"
        className="w-full px-2.5 py-1.5 flex items-center gap-2 text-left bg-muted/60 hover:bg-muted"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Pencil size={11} className="text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wide flex-1">File Info · editable</span>
        <span className="text-[9px] text-muted-foreground">{metadata.edited ? 'Edited' : metadata.fields.length ? 'From source' : 'New'}</span>
      </button>
      {open && (
        <div className="p-2.5 space-y-2.5 bg-background/30">
          <div className="grid grid-cols-2 gap-2">
            <FieldInput label="Title" value={edit.title} onChange={v => update('title', v)} />
            <FieldInput label="Author" value={edit.author} onChange={v => update('author', v)} />
          </div>
          <FieldInput label="Description / Caption" value={edit.description} onChange={v => update('description', v)} multiline />
          <FieldInput
            label="Keywords"
            value={(edit.keywords ?? []).join(', ')}
            onChange={v => update('keywords', v.split(',').map(x => x.trim()).filter(Boolean))}
            placeholder="portrait, landscape, client, project"
          />
          <div className="grid grid-cols-2 gap-2">
            <FieldInput label="Headline" value={edit.headline} onChange={v => update('headline', v)} />
            <FieldInput label="Author Title" value={edit.authorTitle} onChange={v => update('authorTitle', v)} />
            <FieldInput label="Credit" value={edit.credit} onChange={v => update('credit', v)} />
            <FieldInput label="Source" value={edit.source} onChange={v => update('source', v)} />
          </div>
          <FieldInput label="Instructions" value={edit.instructions} onChange={v => update('instructions', v)} multiline />
          <div className="grid grid-cols-2 gap-2">
            <FieldInput label="Copyright Notice" value={edit.copyright} onChange={v => update('copyright', v)} />
            <label className="space-y-1">
              <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Copyright Status</span>
              <select
                value={edit.copyrightStatus ?? 'unknown'}
                onChange={e => update('copyrightStatus', e.target.value as EditableImageMetadata['copyrightStatus'])}
                className="w-full h-7 rounded border border-border bg-background px-2 text-[10px] outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="unknown">Unknown</option>
                <option value="copyrighted">Copyrighted</option>
                <option value="public-domain">Public domain</option>
              </select>
            </label>
          </div>
          <FieldInput label="Copyright URL" value={edit.copyrightUrl} onChange={v => update('copyrightUrl', v)} placeholder="https://…" />
          <div className="grid grid-cols-2 gap-2">
            <FieldInput label="City" value={edit.city} onChange={v => update('city', v)} />
            <FieldInput label="Sublocation" value={edit.sublocation} onChange={v => update('sublocation', v)} />
            <FieldInput label="State / Province" value={edit.state} onChange={v => update('state', v)} />
            <FieldInput label="Country" value={edit.country} onChange={v => update('country', v)} />
            <FieldInput label="Country Code" value={edit.countryCode} onChange={v => update('countryCode', v.slice(0, 3).toUpperCase())} placeholder="CAN" />
            <FieldInput label="Job ID" value={edit.jobIdentifier} onChange={v => update('jobIdentifier', v)} />
            <label className="space-y-1">
              <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Rating</span>
              <select
                value={String(edit.rating ?? 0)}
                onChange={e => update('rating', Math.max(0, Math.min(5, Number(e.target.value) || 0)))}
                className="w-full h-7 rounded border border-border bg-background px-2 text-[10px] outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="0">Unrated</option>
                <option value="1">★</option>
                <option value="2">★★</option>
                <option value="3">★★★</option>
                <option value="4">★★★★</option>
                <option value="5">★★★★★</option>
              </select>
            </label>
          </div>
          <div className="pt-1 border-t border-border/60">
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-2">Creator Contact</div>
            <div className="grid grid-cols-2 gap-2">
              <FieldInput label="Address" value={edit.creatorAddress} onChange={v => update('creatorAddress', v)} />
              <FieldInput label="City" value={edit.creatorCity} onChange={v => update('creatorCity', v)} />
              <FieldInput label="State / Province" value={edit.creatorState} onChange={v => update('creatorState', v)} />
              <FieldInput label="Postal Code" value={edit.creatorPostalCode} onChange={v => update('creatorPostalCode', v)} />
              <FieldInput label="Country" value={edit.creatorCountry} onChange={v => update('creatorCountry', v)} />
              <FieldInput label="Phone" value={edit.creatorPhone} onChange={v => update('creatorPhone', v)} />
              <FieldInput label="Email" value={edit.creatorEmail} onChange={v => update('creatorEmail', v)} placeholder="name@example.com" />
              <FieldInput label="Website" value={edit.creatorWebsite} onChange={v => update('creatorWebsite', v)} placeholder="https://…" />
            </div>
          </div>

          <div className="pt-1 border-t border-border/60 space-y-2">
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">IPTC Rights & Extension</div>
            <FieldInput label="Rights Usage Terms" value={edit.rightsUsageTerms} onChange={v => update('rightsUsageTerms', v)} multiline />
            <div className="grid grid-cols-2 gap-2">
              <FieldInput label="Event" value={edit.event} onChange={v => update('event', v)} />
              <FieldInput label="Intellectual Genre" value={edit.intellectualGenre} onChange={v => update('intellectualGenre', v)} />
            </div>
            <FieldInput
              label="People Shown"
              value={(edit.peopleShown ?? []).join(', ')}
              onChange={v => update('peopleShown', v.split(',').map(x => x.trim()).filter(Boolean))}
              placeholder="Person One, Person Two"
            />
            <FieldInput
              label="Scene Codes"
              value={(edit.sceneCodes ?? []).join(', ')}
              onChange={v => update('sceneCodes', v.split(',').map(x => x.trim()).filter(Boolean))}
              placeholder="IPTC scene codes"
            />
            <FieldInput
              label="Subject Codes"
              value={(edit.subjectCodes ?? []).join(', ')}
              onChange={v => update('subjectCodes', v.split(',').map(x => x.trim()).filter(Boolean))}
              placeholder="IPTC subject codes"
            />
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              onClick={importXmp}
              className="h-7 px-2 rounded border border-border hover:bg-accent inline-flex items-center gap-1 text-[10px]"
            >
              <Upload size={11} /> Import XMP
            </button>
            <button
              type="button"
              onClick={exportXmp}
              className="h-7 px-2 rounded border border-border hover:bg-accent inline-flex items-center gap-1 text-[10px]"
            >
              <Download size={11} /> Export XMP
            </button>
            <button
              type="button"
              onClick={resetFromSource}
              className="h-7 px-2 rounded border border-border hover:bg-accent inline-flex items-center gap-1 text-[10px]"
            >
              <RotateCcw size={11} /> Reset from source
            </button>
            <button
              type="button"
              onClick={clearFileInfo}
              className="h-7 px-2 rounded border border-border hover:bg-accent inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <Trash2 size={11} /> Clear File Info
            </button>
          </div>
          <div className="text-[9px] text-muted-foreground">
            Export writes File Info as XMP plus compatible IPTC-IIM fields where a standards mapping exists. Creator Contact, modern rights, event and people data use IPTC Core/Extension XMP; source camera/GPS EXIF remains view-only so edited files do not silently retain capture/location metadata.
          </div>
        </div>
      )}
    </section>
  )
}

export function MetadataPanel() {
  const tick = useEditorStore(s => s.renderTick)
  const doc = engine.activeDoc
  const [query, setQuery] = useState('')
  const [family, setFamily] = useState<Family>('all')
  const [rawOpen, setRawOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  void tick

  const metadata = doc?.metadata
  const allFields = metadata?.fields ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allFields.filter(field => {
      if (family !== 'all' && fieldFamily(field) !== family) return false
      if (!q) return true
      return (field.group + '\n' + field.label + '\n' + field.tag + '\n' + field.value).toLowerCase().includes(q)
    })
  }, [allFields, family, query])

  const groups = useMemo(() => {
    const map = new Map<string, ImageMetadataField[]>()
    for (const field of filtered) {
      const list = map.get(field.group) ?? []
      list.push(field)
      map.set(field.group, list)
    }
    return Array.from(map.entries())
  }, [filtered])

  const familyCounts = useMemo(() => {
    const counts: Record<Family, number> = { all: allFields.length, exif: 0, xmp: 0, iptc: 0, icc: 0, gps: 0, file: 0 }
    for (const field of allFields) counts[fieldFamily(field)]++
    return counts
  }, [allFields])

  const flashCopied = (key: string) => {
    setCopied(key)
    window.setTimeout(() => setCopied(cur => cur === key ? null : cur), 1200)
  }

  const copyValue = async (key: string, value: string) => {
    if (await copyText(value)) flashCopied(key)
  }

  const copyAll = async () => {
    if (await copyText(metadataAsText(filtered))) flashCopied('all')
  }

  const exportJson = () => {
    if (!doc) return
    const payload = {
      document: {
        name: doc.name,
        width: doc.width,
        height: doc.height,
        resolutionPpi: doc.resolutionPpi ?? 72,
        workingBitDepth: doc.workingBitDepth ?? 8,
        sourceBitDepth: doc.sourceBitDepth ?? doc.workingBitDepth ?? 8,
        workingColorSpace: doc.workingColorSpace ?? 'srgb',
      },
      sourceMetadata: documentMetadata(doc),
    }
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      cleanFileStem(metadata?.fileName || doc.name) + '-metadata.json',
    )
  }

  if (!doc) {
    return (
      <div className="h-full p-4 text-[11px] text-muted-foreground flex items-center justify-center text-center">
        Open or create an image to inspect and edit File Info.
      </div>
    )
  }

  const display = documentMetadata(doc)

  return (
    <div className="h-full min-h-0 flex flex-col text-[11px]">
      <div className="shrink-0 border-b border-border p-2.5 space-y-2">
        <div className="flex items-start gap-2">
          <div className="w-9 h-9 shrink-0 rounded border border-border bg-muted/40 flex items-center justify-center">
            <FileImage size={18} className="text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate" title={display.fileName}>{display.fileName}</div>
            <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-2">
              <span>{display.format}</span>
              {display.fileSize > 0 && <span>{displayBytes(display.fileSize)}</span>}
              <span>{doc.width} × {doc.height}px</span>
            </div>
            <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-2">
              <span>{doc.sourceBitDepth ?? doc.workingBitDepth ?? 8}-bit source</span>
              <span>{doc.workingBitDepth ?? 8}-bit working</span>
              <span>{Math.round((doc.resolutionPpi ?? 72) * 100) / 100} PPI</span>
            </div>
          </div>
          <div className="flex gap-1">
            <SmallButton title="Copy visible source metadata" onClick={() => void copyAll()} disabled={!filtered.length}>
              {copied === 'all' ? <Check size={13} /> : <Clipboard size={13} />}
            </SmallButton>
            <SmallButton title="Export metadata as JSON" onClick={exportJson}>
              <Download size={13} />
            </SmallButton>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <FileInfoEditor doc={doc} />

        {allFields.length > 0 && (
          <div className="sticky top-0 z-[2] border-b border-border bg-background/95 backdrop-blur p-2.5 space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Tags size={11} /> Source metadata · read-only
            </div>
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search tags, values, groups…"
                aria-label="Search metadata"
                className="w-full h-7 pl-7 pr-7 rounded border border-border bg-background text-[11px] outline-none focus:ring-1 focus:ring-ring"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear metadata search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="flex gap-1 overflow-x-auto pb-0.5">
              {FILTERS.map(item => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setFamily(item.id)}
                  className={'shrink-0 h-6 px-2 rounded border text-[10px] ' + (
                    family === item.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:bg-accent'
                  )}
                >
                  {item.label} <span className={family === item.id ? 'opacity-80' : 'text-muted-foreground'}>{familyCounts[item.id]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {metadata?.warnings?.length ? (
          <div className="m-2 mb-0 rounded border border-amber-500/30 bg-amber-500/10 p-2 space-y-1 text-[10px]">
            {metadata.warnings.map((warning, i) => (
              <div key={i} className="flex gap-1.5">
                <AlertTriangle size={11} className="shrink-0 mt-0.5 text-amber-500" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : null}

        {allFields.length === 0 ? (
          <div className="p-5 text-center text-muted-foreground space-y-1">
            <div className="font-medium text-foreground">No source metadata</div>
            <div>Editable File Info above is still available for new/generated documents and will be written to supported exports.</div>
          </div>
        ) : groups.length === 0 ? (
          <div className="p-5 text-center text-muted-foreground">
            No source metadata matches the current filter.
          </div>
        ) : groups.map(([group, fields]) => (
          <section key={group} className="border-b border-border/70">
            <div className="sticky top-[118px] z-[1] px-2.5 py-1 bg-muted/95 backdrop-blur text-[10px] uppercase tracking-wide text-muted-foreground border-y border-border/50 first:border-t-0">
              {group} <span className="ml-1 normal-case tracking-normal opacity-70">({fields.length})</span>
            </div>
            <div>
              {fields.map((field, index) => {
                const key = group + ':' + field.tag + ':' + index
                return (
                  <div key={key} className="group grid grid-cols-[minmax(92px,38%)_1fr_22px] gap-1.5 px-2.5 py-1.5 border-t border-border/30 first:border-t-0 hover:bg-accent/40">
                    <div className="min-w-0">
                      <div className="truncate text-muted-foreground" title={field.label}>{field.label}</div>
                      <div className="truncate font-mono text-[9px] text-muted-foreground/60" title={field.tag}>{field.tag}</div>
                    </div>
                    <div className="min-w-0 break-words select-text" title={field.value}>{field.value}</div>
                    <button
                      type="button"
                      title="Copy value"
                      aria-label={'Copy ' + field.label}
                      onClick={() => void copyValue(key, field.value)}
                      className="h-5 w-5 mt-0.5 rounded flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-background hover:text-foreground"
                    >
                      {copied === key ? <Check size={11} /> : <Copy size={11} />}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        ))}

        {metadata?.rawXmp && (
          <section className="border-b border-border">
            <button
              type="button"
              className="w-full px-2.5 py-1.5 flex items-center gap-2 text-left bg-muted/50 hover:bg-muted"
              onClick={() => setRawOpen(v => !v)}
            >
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex-1">Raw source XMP packet</span>
              <span className="text-[10px] text-muted-foreground">{rawOpen ? 'Hide' : 'Show'}</span>
            </button>
            {rawOpen && (
              <div className="p-2 space-y-1.5">
                <div className="flex justify-end">
                  <SmallButton title="Copy raw XMP" onClick={() => void copyValue('raw-xmp', metadata.rawXmp!)}>
                    {copied === 'raw-xmp' ? <Check size={12} /> : <Copy size={12} />}
                  </SmallButton>
                </div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-background p-2 font-mono text-[9px] select-text">
                  {metadata.rawXmp}
                </pre>
              </div>
            )}
          </section>
        )}
      </div>

      <div className="shrink-0 px-2.5 py-1.5 border-t border-border text-[9px] text-muted-foreground flex justify-between gap-2">
        <span>{allFields.length ? filtered.length + ' of ' + allFields.length + ' source fields' : 'No source tags'}</span>
        <span className="truncate">{display.edited ? 'File Info edited' : 'File Info ready'}</span>
      </div>
    </div>
  )
}
