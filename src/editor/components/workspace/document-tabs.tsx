'use client'
import { useRef } from 'react'
import { FileImage, Plus, X } from 'lucide-react'
import { useEditorStore } from '../../store'
import { engine } from '../../engine/engine'
import { openFiles } from '../../engine/io'
import { IMPORT_ACCEPT } from '../../formats'
import { cn } from '@/lib/utils'

export function DocumentTabs({ embedded = false }: { embedded?: boolean }) {
  const activeDocId = useEditorStore(s => s.activeDocId)
  const docs = useEditorStore(s => s.docs)
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      className={cn(
        'h-8 flex items-stretch bg-panel overflow-x-auto flex-shrink-0 min-w-0',
        !embedded && 'border-b',
      )}
      role="tablist"
      aria-label="Open documents"
    >
      {docs.length === 0 && (
        <div className="flex items-center gap-1.5 px-3 text-[10px] text-muted-foreground whitespace-nowrap">
          <FileImage size={12} />
          No open files
        </div>
      )}
      {docs.map(d => (
        <button
          key={d.id}
          role="tab"
          aria-selected={d.id === activeDocId}
          className={cn(
            'flex items-center gap-2 px-3 text-[11px] whitespace-nowrap border-r group max-w-48',
            d.id === activeDocId
              ? 'bg-workspace text-foreground border-t-2 border-t-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => engine.setActiveDocument(d.id)}
        >
          <span className="truncate">{d.name}{d.dirty ? ' •' : ''}</span>
          <span className="text-[9px] text-muted-foreground">{d.width}×{d.height}</span>
          <span
            className="opacity-0 group-hover:opacity-100 hover:text-destructive"
            onClick={e => { e.stopPropagation(); engine.closeDocument(d.id) }}
            role="button"
            aria-label={`Close ${d.name}`}
          >
            <X size={11} />
          </span>
        </button>
      ))}
      <button
        className="px-3 text-muted-foreground hover:text-foreground flex items-center flex-shrink-0"
        onClick={() => fileInputRef.current?.click()}
        aria-label="Open image"
        title="Open image"
      >
        <Plus size={13} />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={`${IMPORT_ACCEPT},.zproj.json`}
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files?.length) void openFiles(Array.from(e.target.files))
          e.target.value = ''
        }}
      />
    </div>
  )
}
