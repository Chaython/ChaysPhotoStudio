'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Save, SlidersHorizontal, Trash2, Upload } from 'lucide-react'
import { TOOL_MAP } from '../../constants/tools'
import { useEditorStore } from '../../store'
import {
  deleteToolPreset, exportToolPresets, importToolPresets, listToolPresets, renameToolPreset, saveToolPreset,
} from '../../tools/tool-presets'

export function ToolPresetsPanel() {
  const activeTool = useEditorStore(s => s.activeTool)
  const toolOptions = useEditorStore(s => s.toolOptions)
  const setTool = useEditorStore(s => s.setTool)
  const setOpt = useEditorStore(s => s.setToolOption)
  const pushToast = useEditorStore(s => s.pushToast)
  const [refresh, setRefresh] = useState(0)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const fn = () => setRefresh(v => v + 1)
    window.addEventListener('zphoto:tool-presets', fn)
    return () => window.removeEventListener('zphoto:tool-presets', fn)
  }, [])

  const presets = useMemo(() => {
    void refresh
    return listToolPresets(activeTool)
  }, [activeTool, refresh])

  const toolLabel = TOOL_MAP[activeTool]?.label ?? activeTool

  const apply = (options: Record<string, unknown>) => {
    setTool(activeTool)
    for (const [key, value] of Object.entries(options)) setOpt(activeTool, key, structuredClone(value))
    pushToast(`Applied ${toolLabel} preset`, 'success')
  }

  const download = () => {
    const blob = new Blob([exportToolPresets()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'chays-photo-tool-presets.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const doImport = async (file: File | null) => {
    if (!file) return
    try {
      const count = importToolPresets(await file.text())
      pushToast(count ? `Imported ${count} tool preset${count === 1 ? '' : 's'}` : 'No valid presets found', count ? 'success' : 'info')
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not import tool presets', 'error')
    }
    if (importRef.current) importRef.current.value = ''
  }

  return (
    <div className="p-2 flex min-h-0 flex-col gap-2 text-xs" aria-label="Tool Presets panel">
      <div className="flex items-center gap-2">
        <SlidersHorizontal size={13} />
        <div className="min-w-0">
          <div className="font-medium">Tool Presets</div>
          <div className="truncate text-[10px] text-muted-foreground">{toolLabel}</div>
        </div>
        <span className="flex-1" />
        <button
          className="rounded border border-border px-2 py-1 hover:bg-accent flex items-center gap-1"
          onClick={() => {
            const name = prompt('Preset name:', `${toolLabel} preset`)?.trim()
            if (!name) return
            saveToolPreset(activeTool, name, toolOptions[activeTool] ?? {})
            pushToast(`Saved “${name}”`, 'success')
          }}
        >
          <Save size={12} /> Save
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border">
        {!presets.length ? (
          <div className="p-4 text-center text-[10px] leading-relaxed text-muted-foreground">
            No saved presets for {toolLabel}. Configure the tool, then click Save.
          </div>
        ) : presets.map(p => (
          <div key={p.id} className="flex items-center gap-1.5 border-b border-border/60 p-1.5 last:border-b-0">
            <button
              className="min-w-0 flex-1 text-left rounded px-1 py-1 hover:bg-accent"
              onClick={() => apply(p.options)}
              onDoubleClick={() => {
                const next = prompt('Preset name:', p.name)?.trim()
                if (next) renameToolPreset(p.id, next)
              }}
              title="Click to apply · double-click to rename"
            >
              <div className="truncate font-medium">{p.name}</div>
              <div className="truncate text-[9px] text-muted-foreground">
                {Object.keys(p.options).length} setting{Object.keys(p.options).length === 1 ? '' : 's'}
              </div>
            </button>
            <button
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => deleteToolPreset(p.id)}
              title="Delete preset"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          className="rounded border border-border px-2 py-1.5 hover:bg-accent flex items-center justify-center gap-1"
          onClick={download}
        >
          <Download size={12} /> Export all
        </button>
        <button
          className="rounded border border-border px-2 py-1.5 hover:bg-accent flex items-center justify-center gap-1"
          onClick={() => importRef.current?.click()}
        >
          <Upload size={12} /> Import
        </button>
        <input
          ref={importRef}
          className="hidden"
          type="file"
          accept="application/json,.json"
          onChange={e => void doImport(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="text-[9px] leading-relaxed text-muted-foreground">
        Presets are local to this browser profile. Export/import JSON to move them between machines or share them.
      </div>
    </div>
  )
}
