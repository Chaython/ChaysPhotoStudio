'use client'
import { useMemo, useState } from 'react'
import * as Icons from 'lucide-react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TOOL_DEFS } from '../../constants/tools'
import { toolKey } from '../../shortcuts'
import { useEditorStore } from '../../store'
import { setActiveTool } from '../../tools/registry'
import type { DialogProps } from './generic-dialogs'

const GROUPS: Record<number, string> = {
  0: 'Move', 1: 'Selection', 2: 'Sampling', 3: 'Crop & Measure',
  4: 'Painting', 5: 'Retouching', 6: 'Drawing & Type', 7: 'Navigation',
}

export function AllToolsDialog({ onClose }: DialogProps) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<number | null>(null)
  const activeTool = useEditorStore(s => s.activeTool)
  const shortcuts = useEditorStore(s => s.shortcutOverrides)
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return TOOL_DEFS.filter(t => (group == null || t.group === group) &&
      (!q || `${t.label} ${t.id} ${GROUPS[t.group] || ''} ${(shortcuts[`tool:${t.id}`] || t.shortcut)}`.toLowerCase().includes(q)))
  }, [query, group, shortcuts])
  const select = (id: typeof TOOL_DEFS[number]['id']) => {
    setActiveTool(id)
    useEditorStore.getState().setTool(id)
    onClose()
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>All Tools</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Input autoFocus value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && rows.length === 1) select(rows[0].id) }}
          placeholder="Search tools by name, category, or shortcut…" aria-label="Search all tools" />
        <div className="flex gap-1 flex-wrap">
          <Button size="sm" variant={group === null ? 'default' : 'outline'} onClick={() => setGroup(null)}>All ({TOOL_DEFS.length})</Button>
          {Object.entries(GROUPS).map(([id, label]) => (
            <Button key={id} size="sm" variant={group === Number(id) ? 'default' : 'outline'} onClick={() => setGroup(Number(id))}>{label}</Button>
          ))}
        </div>
        <div className="max-h-[56vh] overflow-y-auto zphoto-scroll grid grid-cols-1 sm:grid-cols-2 gap-1" role="list" aria-label="Available tools">
          {rows.map(t => {
            const Icon = (Icons as unknown as Record<string, React.ComponentType<{ size?: number }>>)[t.icon] || Icons.MousePointer2
            return (
              <button type="button" role="listitem" key={t.id} onClick={() => select(t.id)}
                aria-current={activeTool === t.id ? 'true' : undefined}
                className="min-w-0 flex items-center gap-2 rounded border border-border p-2 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary">
                <Icon size={16} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.label}</span>
                  <span className="block text-[10px] text-muted-foreground">{GROUPS[t.group] || 'Other'}</span>
                </span>
                <kbd className="rounded border px-1.5 py-0.5 font-mono text-[10px]" title="Repeated presses cycle tools sharing this key">{toolKey(t.id).toUpperCase()}</kbd>
                {activeTool === t.id && <Icons.Check size={13} className="text-primary" />}
              </button>
            )
          })}
          {rows.length === 0 && <p className="p-4 text-muted-foreground text-xs">No matching tools.</p>}
        </div>
        <p className="text-[11px] text-muted-foreground">Every tool has an editable key. Tools sharing a letter cycle when that letter is pressed repeatedly.</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => { onClose(); useEditorStore.getState().openDialog('shortcuts') }}>Edit keyboard shortcuts</Button>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  )
}
