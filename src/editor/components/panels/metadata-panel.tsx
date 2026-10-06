'use client'

import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, Check, Clipboard, Copy, Download, FileImage, Search, Tags, X,
} from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { downloadBlob } from '../../utils/canvas'
import type { ImageMetadataField } from '../../types'

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

function SmallButton(props: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      onClick={props.onClick}
      className="h-7 min-w-7 px-1.5 rounded border border-border bg-background/70 hover:bg-accent inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
    >
      {props.children}
    </button>
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
    if (!doc || !metadata) return
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
      sourceMetadata: metadata,
    }
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      cleanFileStem(metadata.fileName || doc.name) + '-metadata.json',
    )
  }

  if (!doc) {
    return (
      <div className="h-full p-4 text-[11px] text-muted-foreground flex items-center justify-center text-center">
        Open an image to inspect its file metadata.
      </div>
    )
  }

  if (!metadata) {
    return (
      <div className="h-full p-4 text-[11px] text-muted-foreground flex flex-col items-center justify-center text-center gap-2">
        <Tags size={24} className="opacity-50" />
        <div className="font-medium text-foreground">No source metadata captured</div>
        <div>
          New/generated documents do not have original-file metadata. Reopen an image file to populate EXIF, XMP, IPTC and ICC details.
        </div>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 flex flex-col text-[11px]">
      <div className="shrink-0 border-b border-border p-2.5 space-y-2">
        <div className="flex items-start gap-2">
          <div className="w-9 h-9 shrink-0 rounded border border-border bg-muted/40 flex items-center justify-center">
            <FileImage size={18} className="text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate" title={metadata.fileName}>{metadata.fileName}</div>
            <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-2">
              <span>{metadata.format}</span>
              <span>{displayBytes(metadata.fileSize)}</span>
              <span>{doc.width} × {doc.height}px</span>
            </div>
            <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-2">
              <span>{doc.sourceBitDepth ?? doc.workingBitDepth ?? 8}-bit source</span>
              <span>{doc.workingBitDepth ?? 8}-bit working</span>
              <span>{Math.round((doc.resolutionPpi ?? 72) * 100) / 100} PPI</span>
            </div>
          </div>
          <div className="flex gap-1">
            <SmallButton title="Copy visible metadata" onClick={() => void copyAll()}>
              {copied === 'all' ? <Check size={13} /> : <Clipboard size={13} />}
            </SmallButton>
            <SmallButton title="Export metadata as JSON" onClick={exportJson}>
              <Download size={13} />
            </SmallButton>
          </div>
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

      <div className="flex-1 min-h-0 overflow-auto">
        {metadata.warnings?.length ? (
          <div className="m-2 mb-0 rounded border border-amber-500/30 bg-amber-500/10 p-2 space-y-1 text-[10px]">
            {metadata.warnings.map((warning, i) => (
              <div key={i} className="flex gap-1.5">
                <AlertTriangle size={11} className="shrink-0 mt-0.5 text-amber-500" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : null}

        {groups.length === 0 ? (
          <div className="p-5 text-center text-muted-foreground">
            No metadata matches the current filter.
          </div>
        ) : groups.map(([group, fields]) => (
          <section key={group} className="border-b border-border/70">
            <div className="sticky top-0 z-[1] px-2.5 py-1 bg-muted/95 backdrop-blur text-[10px] uppercase tracking-wide text-muted-foreground border-y border-border/50 first:border-t-0">
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

        {metadata.rawXmp && (
          <section className="border-b border-border">
            <button
              type="button"
              className="w-full px-2.5 py-1.5 flex items-center gap-2 text-left bg-muted/50 hover:bg-muted"
              onClick={() => setRawOpen(v => !v)}
            >
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex-1">Raw XMP packet</span>
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
        <span>{filtered.length} of {allFields.length} fields</span>
        <span className="truncate">Source metadata · read-only</span>
      </div>
    </div>
  )
}
