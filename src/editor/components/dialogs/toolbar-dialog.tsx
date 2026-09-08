'use client'
// ============================================================
// Chay's Photo Studio — Customize Toolbar (TASK 17/18)
//
// Rearrange the tool rail:
//  · PREVIEW STRIP (top, ALWAYS VISIBLE): a live miniature of
//    the toolbar and THE pin target. Drop a tool anywhere on it
//    to give the tool its own always-visible button — onto a
//    pinned chip to land right there, onto a flyout chip to
//    join that flyout, on the strip itself to append at the
//    end. Pinned chips are draggable back into the list below.
//    (Replaces the old below-the-fold bottom zone that required
//    scrolling mid-drag, which made drops land on rows.)
//  · drag & drop rows (onto a row = insert before · onto a
//    flyout box = join it)
//  · ▲▼ buttons reorder (within a flyout, or the section itself)
//  · the ⤴ "move to" menu on every row: top level / new flyout /
//    any existing flyout
// The real toolbar re-renders live behind this dialog; the layout
// persists to localStorage ('zphoto-toolbar') and survives reloads.
// ============================================================
import { useMemo, useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Pin, ChevronUp, ChevronDown, GripVertical, FolderInput, Plus, RotateCcw,
  LayoutGrid, Info, ChevronRight,
} from 'lucide-react'
import * as Icons from 'lucide-react'
import { TOOL_MAP } from '../../constants/tools'
import { useEditorStore, defaultToolbarLayout } from '../../store'
import { formatCombo } from '../../shortcuts'
import type { ToolId, ToolbarSection } from '../../types'
import {
  findTool, pinToTop, moveToGroup, newFlyout, nudgeTool, nudgeSectionAt,
  insertBefore, appendPinned,
} from '../toolbar/layout-ops'
import type { DialogProps } from './generic-dialogs'
import { cn } from '@/lib/utils'

type Sections = ToolbarSection[]

// ---------- component ----------

function ToolIcon({ icon, size = 14 }: { icon: string; size?: number }) {
  const Cmp = (Icons as any)[icon] ?? Icons.MousePointer2
  return <Cmp size={size} strokeWidth={1.75} />
}

export function ToolbarCustomizeDialog({ onClose }: DialogProps) {
  const layout = useEditorStore(s => s.toolbarLayout)
  const setToolbarLayout = useEditorStore(s => s.setToolbarLayout)
  const resetToolbarLayout = useEditorStore(s => s.resetToolbarLayout)
  const pushToast = useEditorStore(s => s.pushToast)
  const overrides = useEditorStore(s => s.shortcutOverrides)

  const sections = useMemo(() => layout ?? defaultToolbarLayout(), [layout])

  const [drag, setDrag] = useState<ToolId | null>(null)
  const [dropHint, setDropHint] = useState<string | null>(null)

  const apply = (next: Sections) => { if (next !== sections) setToolbarLayout(next) }
  const keyOf = (id: ToolId) => (overrides?.[`tool:${id}`] || TOOL_MAP[id].shortcut || '?').toLowerCase()

  const groups = sections
    .map((s, i) => ({ sec: s, i }))
    .filter((x): x is { sec: { kind: 'group'; tools: ToolId[] }; i: number } => x.sec.kind === 'group')

  // ---------- shared drag plumbing (rows + preview chips) ----------

  const dragStart = (id: ToolId) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    setDrag(id)
  }
  const dragEnd = () => { setDrag(null); setDropHint(null) }
  const readId = (e: React.DragEvent): ToolId | null => {
    const id = (e.dataTransfer.getData('text/plain') || drag) as ToolId
    return id && TOOL_MAP[id] ? id : null
  }
  const finish = () => { setDrag(null); setDropHint(null) }
  const overTarget = (key: string) => (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropHint(key)
  }
  const leaveTarget = (key: string) => (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropHint(h => (h === key ? null : h))
  }

  // ---------- drop handlers ----------

  const onDropRow = (target: ToolId) => (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const id = readId(e)
    finish()
    if (!id) return
    apply(insertBefore(sections, id, target))
  }

  const onDropGroup = (member: ToolId) => (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const id = readId(e)
    finish()
    if (!id) return
    apply(moveToGroup(sections, id, member))
  }

  // preview strip: drop on the strip itself (background / label row /
  // ghost slot — chips stop propagation) → pin at the end
  const onDropStrip = (e: React.DragEvent) => {
    e.preventDefault()
    const id = readId(e)
    finish()
    if (!id) return
    apply(appendPinned(sections, id))
  }

  const MoveToMenu = ({ id, inGroup, groupMember }: { id: ToolId; inGroup: boolean; groupMember?: ToolId }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-sm p-1 transition-colors"
          title="Move to…"
          aria-label={`Move ${TOOL_MAP[id].label} elsewhere`}
        >
          <FolderInput size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="z-50">
        <DropdownMenuItem
          disabled={inGroup === false}
          onClick={() => apply(pinToTop(sections, id))}
          className="gap-2 text-xs"
        >
          <Pin size={13} />
          <span className="flex-1">Pin to toolbar</span>
          <span className="text-muted-foreground text-[10px]">own button</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={inGroup && sections[findTool(sections, id)!.sec].kind === 'group' && (sections[findTool(sections, id)!.sec] as { tools: ToolId[] }).tools.length === 1}
          onClick={() => apply(newFlyout(sections, id))}
          className="gap-2 text-xs"
        >
          <Plus size={13} />
          <span className="flex-1">New flyout here</span>
          <span className="text-muted-foreground text-[10px]">start a group</span>
        </DropdownMenuItem>
        {groups.length > 0 && <DropdownMenuSeparator />}
        {groups.map(g => {
          const first = g.sec.tools[0]
          const isCurrent = inGroup && groupMember === first && g.sec.tools.includes(id)
          return (
            <DropdownMenuItem
              key={`g-${first}`}
              disabled={isCurrent}
              onClick={() => apply(moveToGroup(sections, id, first))}
              className="gap-2 text-xs"
            >
              <ToolIcon icon={TOOL_MAP[first].icon} size={13} />
              <span className="flex-1 truncate">{TOOL_MAP[first].label} flyout</span>
              <span className="text-muted-foreground text-[10px]">{g.sec.tools.length}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const Nudges = ({ onUp, onDown, upDisabled, downDisabled }: {
    onUp(): void; onDown(): void; upDisabled: boolean; downDisabled: boolean
  }) => (
    <div className="flex flex-col">
      <button
        onClick={onUp} disabled={upDisabled}
        className="text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-25 rounded-sm h-4 w-5 flex items-center justify-center transition-colors"
        title="Move up" aria-label="Move up"
      >
        <ChevronUp size={11} />
      </button>
      <button
        onClick={onDown} disabled={downDisabled}
        className="text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-25 rounded-sm h-4 w-5 flex items-center justify-center transition-colors"
        title="Move down" aria-label="Move down"
      >
        <ChevronDown size={11} />
      </button>
    </div>
  )

  const toolRow = (id: ToolId, opts: { inGroup: boolean; groupMember?: ToolId; idxInGroup?: number; groupLen?: number }) => {
    const def = TOOL_MAP[id]
    if (!def) return null
    const isDragging = drag === id
    const hinted = dropHint === id && drag && drag !== id
    return (
      <div
        draggable
        onDragStart={dragStart(id)}
        onDragEnd={dragEnd}
        onDragOver={overTarget(id)}
        onDragLeave={leaveTarget(id)}
        onDrop={onDropRow(id)}
        className={cn(
          'flex items-center gap-1.5 rounded-sm px-1.5 py-1 border transition-all',
          opts.inGroup
            ? 'border-transparent bg-background/40'
            : 'border-primary/30 bg-primary/5',
          isDragging && 'opacity-40',
          hinted && 'ring-1 ring-primary/60 border-primary/50'
        )}
      >
        <GripVertical size={11} className="text-muted-foreground/60 cursor-grab active:cursor-grabbing shrink-0" aria-hidden />
        <ToolIcon icon={def.icon} />
        <span className="text-[11px] text-foreground/90 truncate flex-1">{def.label}</span>
        {!opts.inGroup && <Pin size={10} className="text-primary shrink-0" aria-label="pinned to top level" />}
        <span className="font-mono text-[10px] text-muted-foreground shrink-0">{formatCombo(keyOf(id))}</span>
        <MoveToMenu id={id} inGroup={opts.inGroup} groupMember={opts.groupMember} />
        {opts.inGroup ? (
          <Nudges
            onUp={() => apply(nudgeTool(sections, id, -1))}
            onDown={() => apply(nudgeTool(sections, id, 1))}
            upDisabled={opts.idxInGroup === 0}
            downDisabled={opts.idxInGroup === (opts.groupLen ?? 1) - 1}
          />
        ) : (
          (() => {
            const loc = findTool(sections, id)
            const i = loc?.sec ?? 0
            return (
              <Nudges
                onUp={() => apply(nudgeSectionAt(sections, i, -1))}
                onDown={() => apply(nudgeSectionAt(sections, i, 1))}
                upDisabled={i === 0}
                downDisabled={i >= sections.length - 1}
              />
            )
          })()
        )}
      </div>
    )
  }

  // ---------- preview strip chips ----------

  const singleChip = (tool: ToolId, i: number) => {
    const def = TOOL_MAP[tool]
    if (!def) return null
    const hinted = dropHint === tool && drag && drag !== tool
    return (
      <div
        key={`c-${tool}-${i}`}
        draggable
        onDragStart={dragStart(tool)}
        onDragEnd={dragEnd}
        onDragOver={overTarget(tool)}
        onDragLeave={leaveTarget(tool)}
        onDrop={onDropRow(tool)}
        title={`${def.label} — pinned button (drag into a flyout below to unpin)`}
        className={cn(
          'w-8 h-8 rounded-sm border border-border/60 bg-background flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing transition-all',
          drag === tool && 'opacity-40',
          hinted && 'ring-1 ring-primary/60 border-primary/60 -translate-y-px'
        )}
      >
        <ToolIcon icon={def.icon} size={15} />
      </div>
    )
  }

  const groupChip = (tools: ToolId[], i: number) => {
    const first = tools[0]
    const hinted = dropHint === first && drag && drag !== first && !tools.includes(drag)
    return (
      <div
        key={`cg-${first}-${i}`}
        onDragOver={overTarget(first)}
        onDragLeave={leaveTarget(first)}
        onDrop={onDropGroup(first)}
        title={`Flyout: ${tools.map(t => TOOL_MAP[t]?.label).filter(Boolean).join(', ')}`}
        className={cn(
          'h-8 pl-1 pr-1.5 rounded-sm border border-border/60 bg-background/80 flex items-center gap-0.5 shrink-0 transition-all',
          hinted && 'ring-1 ring-primary/60 border-primary/60 -translate-y-px'
        )}
      >
        <ToolIcon icon={TOOL_MAP[first].icon} size={14} />
        <span className="text-[9px] text-muted-foreground leading-none">{tools.length}</span>
        <ChevronRight size={9} className="text-muted-foreground/70" />
      </div>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <LayoutGrid size={15} className="text-primary" />
          Customize Toolbar
        </DialogTitle>
      </DialogHeader>

      <div className="flex items-start gap-2 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-2 text-[11px] text-primary/90 leading-snug">
        <Info size={13} className="shrink-0 mt-0.5" />
        <span>
          Drop a tool on the <strong>preview strip</strong> below to pin it as its own toolbar button — onto a
          flyout chip to join that flyout. In the list: drop on a row to insert before it, or on a flyout box
          to join it. The toolbar updates live and persists.
        </span>
      </div>

      {/* toolbar preview — the pin target (always visible, no scrolling needed) */}
      <div
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={onDropStrip}
        data-testid="toolbar-preview"
        aria-label="Toolbar preview — drop a tool here to pin it"
        className={cn(
          'rounded-md border p-1.5 transition-all',
          drag ? 'border-primary/50 bg-primary/5' : 'border-border/70 bg-muted/10'
        )}
      >
        <div className="flex items-center gap-1.5 px-0.5 pb-1.5" data-testid="toolbar-preview-label">
          <LayoutGrid size={11} className="text-primary shrink-0" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/80 shrink-0">Toolbar preview</span>
          <span className="text-[10px] text-muted-foreground/80 truncate flex-1">
            {drag ? 'release to pin here' : 'drop tools here to pin them'}
          </span>
          <span className="text-[10px] text-muted-foreground/70 shrink-0">{sections.length} sections</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {sections.map((sec, i) =>
            sec.kind === 'single' ? singleChip(sec.tool, i) : groupChip(sec.tools, i)
          )}
          {drag && (
            <div
              className="w-8 h-8 rounded-sm border border-dashed border-primary/60 bg-primary/10 flex items-center justify-center text-primary shrink-0"
              title="Drop here to pin at the end"
              aria-label="Pin drop slot"
            >
              <Pin size={12} />
            </div>
          )}
        </div>
      </div>

      <div className="max-h-[45vh] overflow-y-auto zphoto-scroll space-y-2 py-1 pr-1"
        onDragOver={e => e.preventDefault()}
      >
        {sections.map((sec, i) => {
          if (sec.kind === 'single') {
            return <div key={`s-${sec.tool}-${i}`}>{toolRow(sec.tool, { inGroup: false })}</div>
          }
          const first = sec.tools[0]
          const hinted = dropHint === first && drag && drag !== first && !sec.tools.includes(drag)
          return (
            <div
              key={`g-${first}-${i}`}
              onDragOver={overTarget(first)}
              onDragLeave={leaveTarget(first)}
              onDrop={onDropGroup(first)}
              className={cn(
                'rounded-md border border-border/70 bg-muted/10 p-1.5 space-y-1 transition-all',
                hinted && 'ring-1 ring-primary/60 border-primary/50'
              )}
            >
              <div className="flex items-center gap-1.5 px-1 pb-1 border-b border-border/50">
                <ToolIcon icon={TOOL_MAP[first].icon} />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/80 truncate flex-1">
                  {TOOL_MAP[first].label} flyout
                </span>
                <span className="text-[10px] text-muted-foreground">{sec.tools.length} tool{sec.tools.length > 1 ? 's' : ''}</span>
                <Nudges
                  onUp={() => apply(nudgeSectionAt(sections, i, -1))}
                  onDown={() => apply(nudgeSectionAt(sections, i, 1))}
                  upDisabled={i === 0}
                  downDisabled={i >= sections.length - 1}
                />
              </div>
              {sec.tools.map((t, idx) => (
                <div key={t}>{toolRow(t, { inGroup: true, groupMember: first, idxInGroup: idx, groupLen: sec.tools.length })}</div>
              ))}
            </div>
          )
        })}
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        <Button
          size="sm"
          variant="ghost"
          className="text-xs gap-1.5"
          onClick={() => { resetToolbarLayout(); pushToast('Toolbar layout reset to default', 'success') }}
        >
          <RotateCcw size={12} />
          Reset layout
        </Button>
        <Button size="sm" onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  )
}
