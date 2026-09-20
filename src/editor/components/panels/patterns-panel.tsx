'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, PaintBucket, Stamp, Trash2 } from 'lucide-react'
import { useEditorStore } from '../../store'
import {
  builtinPatternTile, hydrateUserPatterns, importPatternFile, listUserPatterns, removeUserPattern,
  type UserPattern,
} from '../../tools/patterns'

interface PatternCard {
  id: string
  name: string
  preview: string
  imported: boolean
}

function builtins(): PatternCard[] {
  if (typeof document === 'undefined') return []
  return [
    ['checker', 'Checker'],
    ['diagonal', 'Diagonal Stripes'],
    ['dots', 'Dots'],
    ['grid', 'Grid'],
  ].map(([id, name]) => ({
    id,
    name,
    preview: builtinPatternTile(id, 2, '#f0f0f0', '#292929').toDataURL('image/png'),
    imported: false,
  }))
}

export function PatternsPanel() {
  const setOpt = useEditorStore(s => s.setToolOption)
  const setTool = useEditorStore(s => s.setTool)
  const pushToast = useEditorStore(s => s.pushToast)
  const fileRef = useRef<HTMLInputElement>(null)
  const [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState('checker')

  useEffect(() => {
    void hydrateUserPatterns()
    const changed = () => setRefresh(v => v + 1)
    window.addEventListener('zphoto:patterns', changed)
    return () => window.removeEventListener('zphoto:patterns', changed)
  }, [])

  const cards = useMemo<PatternCard[]>(() => {
    void refresh
    const custom: PatternCard[] = listUserPatterns().map((p: UserPattern) => ({
      id: p.id,
      name: p.name,
      preview: p.dataUrl,
      imported: true,
    }))
    return [...builtins(), ...custom]
  }, [refresh])

  const apply = (target: 'pattern-stamp' | 'healing-brush' | 'paint-bucket') => {
    setOpt(target, 'pattern', selected)
    if (target === 'healing-brush') setOpt(target, 'sample', 'pattern')
    if (target === 'paint-bucket') setOpt(target, 'fill', 'pattern')
    setTool(target)
  }

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return
    let last: UserPattern | null = null
    for (const file of Array.from(files)) {
      try {
        last = await importPatternFile(file)
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Could not import pattern', 'error')
      }
    }
    if (last) {
      setSelected(last.id)
      pushToast(`Imported pattern “${last.name}”`, 'success')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="p-2 flex min-h-0 flex-col gap-2 text-xs" aria-label="Patterns panel">
      <div className="flex items-center gap-2">
        <Stamp size={13} />
        <span className="font-medium">Patterns</span>
        <span className="flex-1" />
        <button
          className="rounded border border-border px-2 py-1 hover:bg-accent flex items-center gap-1"
          onClick={() => fileRef.current?.click()}
          title="Import PNG, JPEG or WebP as a repeating pattern"
        >
          <ImagePlus size={12} /> Import
        </button>
        <input
          ref={fileRef}
          className="hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={e => void importFiles(e.target.files)}
        />
      </div>

      <div className="grid grid-cols-3 gap-1.5 min-h-0 overflow-y-auto">
        {cards.map(card => (
          <button
            key={card.id}
            className={[
              'group relative aspect-square overflow-hidden rounded border bg-muted/30',
              selected === card.id ? 'border-primary ring-1 ring-primary/50' : 'border-border hover:border-muted-foreground',
            ].join(' ')}
            onClick={() => setSelected(card.id)}
            title={card.name}
          >
            <img src={card.preview} alt="" className="h-full w-full object-cover [image-rendering:auto]" draggable={false} />
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1 py-0.5 text-[9px] text-white">{card.name}</span>
            {card.imported && (
              <span
                role="button"
                tabIndex={0}
                className="absolute right-1 top-1 hidden rounded bg-black/70 p-1 text-white group-hover:block"
                title="Remove imported pattern"
                onClick={e => {
                  e.stopPropagation()
                  removeUserPattern(card.id)
                  if (selected === card.id) setSelected('checker')
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    removeUserPattern(card.id)
                    if (selected === card.id) setSelected('checker')
                  }
                }}
              >
                <Trash2 size={11} />
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5 border-t border-border pt-2">
        <button
          className="rounded border border-border px-1.5 py-1.5 hover:bg-accent flex items-center justify-center gap-1"
          onClick={() => apply('pattern-stamp')}
        >
          <Stamp size={11} /> Stamp
        </button>
        <button
          className="rounded border border-border px-1.5 py-1.5 hover:bg-accent flex items-center justify-center gap-1"
          onClick={() => apply('healing-brush')}
        >
          <span className="text-[11px]">✚</span> Heal
        </button>
        <button
          className="rounded border border-border px-1.5 py-1.5 hover:bg-accent flex items-center justify-center gap-1"
          onClick={() => apply('paint-bucket')}
        >
          <PaintBucket size={11} /> Fill
        </button>
      </div>

      <div className="text-[9px] leading-relaxed text-muted-foreground">
        Imported tiles are resized to a maximum of 256 px and stored locally in your browser profile. Scale and offset remain controlled by the active tool.
      </div>
    </div>
  )
}
