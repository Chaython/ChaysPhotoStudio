'use client'
// ============================================================
// Chay's Photo Studio — Keyboard Shortcuts editor (TASK 17)
//
// Every tool activation key and every command combo is editable:
// click a row's pencil, press the new keystroke, done.
//  · recording happens in a window CAPTURE listener that also
//    stopPropagation()s — the global dispatcher never sees it
//  · conflicting command bindings SWAP (Photoshop behaviour)
//  · tools sharing a letter cycle (a feature, not a conflict)
//  · tool keys are single letters; X/D/digits/brackets/arrows are
//    reserved for the fixed helpers shown at the bottom
//  · overrides persist (localStorage) and apply live — menus,
//    tooltips and the dispatcher all read them on the fly
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Keyboard, RotateCcw, Search, AlertTriangle, Info, MousePointerClick,
  FileText, Scissors, Image as ImageIcon, Layers, Crosshair, Eye,
} from 'lucide-react'
import * as Icons from 'lucide-react'
import { TOOL_DEFS, TOOL_MAP } from '../../constants/tools'
import { useEditorStore } from '../../store'
import {
  COMMANDS, COMMAND_MAP, eventCombo, formatCombo, commandCombo,
  commandOverrideKey, toolOverrideKey, toolKey, findComboConflicts, isValidToolBinding,
  RESERVED_TOOL_KEYS, type CommandId,
} from '../../shortcuts'
import type { ToolId } from '../../types'
import type { DialogProps } from './generic-dialogs'
import { cn } from '@/lib/utils'

type Listening = { kind: 'command'; id: CommandId } | { kind: 'tool'; id: ToolId } | null
type RowNote = { key: string; msg: string; kind: 'error' | 'warn' } | null

const SECTION_ICONS: Record<string, typeof FileText> = {
  File: FileText, Edit: Scissors, Image: ImageIcon, Layer: Layers, Select: Crosshair, View: Eye,
}

const Kbd = ({ children, hot }: { children: React.ReactNode; hot?: boolean }) => (
  <span className={cn(
    'px-1.5 py-0.5 rounded border font-mono text-[10px] whitespace-nowrap',
    hot
      ? 'bg-primary/15 border-primary/50 text-primary animate-pulse'
      : 'bg-muted/70 border-border/60 text-foreground/85'
  )}>{children}</span>
)

function ToolIcon({ icon, size = 14 }: { icon: string; size?: number }) {
  const Cmp = (Icons as any)[icon] ?? Icons.MousePointer2
  return <Cmp size={size} strokeWidth={1.75} />
}

const FIXED_HELPERS: [string, string][] = [
  ['0 – 9', 'Active layer opacity (0 = 100%, 1 = 10% … 9 = 90%)'],
  ['[ / ]', 'Decrease / increase brush size'],
  ['X', 'Swap foreground & background colors'],
  ['D', 'Default colors (black / white)'],
  ['← ↑ → ↓', 'Nudge layer (Shift = 10 px)'],
  ['Space + drag', 'Temporary Hand (pan)'],
  ['Ctrl + Wheel', 'Zoom at cursor'],
  ['Shift + drag', 'Constrain (square / circle / line)'],
  ['Esc / Enter', 'Cancel / commit pen path'],
]

export function ShortcutsDialog({ onClose }: DialogProps) {
  const overrides = useEditorStore(s => s.shortcutOverrides)
  const setShortcutOverride = useEditorStore(s => s.setShortcutOverride)
  const resetShortcutOverrides = useEditorStore(s => s.resetShortcutOverrides)
  const pushToast = useEditorStore(s => s.pushToast)

  const [listening, setListening] = useState<Listening>(null)
  const [note, setNote] = useState<RowNote>(null)
  const [filter, setFilter] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const overriddenCount = useMemo(
    () => Object.keys(overrides).length,
    [overrides]
  )

  const cmdRows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return COMMANDS.filter(c => !q || c.label.toLowerCase().includes(q))
  }, [filter])

  const toolRows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return TOOL_DEFS.filter(t => !q || t.label.toLowerCase().includes(q))
  }, [filter])

  const toolKeys = useMemo(() => {
    const out: Record<ToolId, string> = {} as Record<ToolId, string>
    for (const t of TOOL_DEFS) out[t.id] = toolKey(t.id)
    return out
  }, [overrides])

  /** tools currently sharing each letter → cycle groups */
  const cyclePartners = useMemo(() => {
    const map: Record<string, ToolId[]> = {}
    for (const t of TOOL_DEFS) {
      const k = toolKeys[t.id]
      ;(map[k] ??= []).push(t.id)
    }
    return map
  }, [toolKeys])

  // ---------- assignment ----------
  const assign = useCallback((target: Listening, combo: string): boolean => {
    if (!target) return false
    if (target.kind === 'tool') {
      if (!isValidToolBinding(combo)) {
        const parts = combo.split('+')
        const key = parts[parts.length - 1]
        const reason = parts.length > 1
          ? 'Tool keys are a single letter (no Ctrl / Alt / Shift)'
          : RESERVED_TOOL_KEYS.has(key)
            ? `"${key.toUpperCase()}" is reserved for a fixed helper`
            : 'Not a letter A–Z'
        setNote({ key: `tool:${target.id}`, msg: reason, kind: 'error' })
        return false
      }
      const conflicts = findComboConflicts(combo, { tool: target.id })
      setShortcutOverride(toolOverrideKey(target.id), combo)
      const msgs: string[] = []
      if (conflicts.tools.length) {
        msgs.push(`Cycles with ${conflicts.tools.map(t => TOOL_MAP[t].label).join(' · ')}`)
      }
      if (conflicts.command) {
        msgs.push(`${COMMAND_MAP[conflicts.command].label} also uses this key — the command takes priority`)
      }
      setNote(msgs.length ? { key: `tool:${target.id}`, msg: msgs.join(' — '), kind: 'warn' } : null)
      return true
    }
    // command
    const old = commandCombo(target.id)
    const conflicts = findComboConflicts(combo, { command: target.id })
    setShortcutOverride(commandOverrideKey(target.id), combo)
    const msgs: string[] = []
    if (conflicts.command) {
      // swap with the previous owner (Photoshop behaviour)
      setShortcutOverride(commandOverrideKey(conflicts.command), old)
      msgs.push(`Swapped with ${COMMAND_MAP[conflicts.command].label}`)
    }
    if (conflicts.tools.length) {
      msgs.push(`Shared with ${conflicts.tools.map(t => TOOL_MAP[t].label).join(' · ')} — the command takes priority`)
    }
    setNote(msgs.length ? { key: target.id, msg: msgs.join(' — '), kind: 'warn' } : null)
    return true
  }, [setShortcutOverride])

  // ---------- recording listener (capture, swallows the key) ----------
  useEffect(() => {
    if (!listening) return
    const target = listening // stable narrowing for the closures below
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setListening(null); setNote(null); return }
      const combo = eventCombo(e)
      if (assign(target, combo)) setListening(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening, assign])

  // blur / close cancels recording
  useEffect(() => {
    if (!listening) return
    const onCancel = () => { setListening(null) }
    window.addEventListener('blur', onCancel)
    return () => window.removeEventListener('blur', onCancel)
  }, [listening])

  const startListen = (target: NonNullable<Listening>) => {
    setNote(null)
    setListening(prev => (prev && prev.kind === target.kind && prev.id === target.id ? null : target))
    searchRef.current?.blur()
  }

  const resetRow = (kind: 'command' | 'tool', id: string) => {
    setNote(null)
    setShortcutOverride(id, null)
  }

  const isOverridden = (key: string, fallback: string) =>
    overrides[key] !== undefined && overrides[key] !== fallback

  const rowNoteFor = (key: string) => note?.key === key ? note : null

  const q = filter.trim().toLowerCase()

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Keyboard size={15} className="text-primary" />
          Keyboard Shortcuts
          {overriddenCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/15 border border-primary/40 text-primary text-[10px] font-mono">
              {overriddenCount} customized
            </span>
          )}
        </DialogTitle>
      </DialogHeader>

      <div className="flex items-center gap-2 py-1">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={filter}
            onChange={e => { setFilter(e.target.value); setListening(null) }}
            placeholder="Search commands or tools…"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs gap-1.5"
          disabled={!overriddenCount}
          onClick={() => { resetShortcutOverrides(); setNote(null); setListening(null); pushToast('Shortcuts reset to defaults', 'success') }}
        >
          <RotateCcw size={12} />
          Reset all
        </Button>
      </div>

      {listening && (
        <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] text-primary">
          <MousePointerClick size={13} className="shrink-0" />
          <span>
            Press the new keystroke for{' '}
            <b>{listening.kind === 'tool' ? TOOL_MAP[listening.id].label : COMMAND_MAP[listening.id].label}</b>
            {' '}— <Kbd hot>Esc</Kbd> to cancel
          </span>
        </div>
      )}

      <div className="grid gap-3 py-1 sm:grid-cols-2 max-h-[62vh] overflow-y-auto zphoto-scroll pr-1">
        {/* ---------- Tools ---------- */}
        <section className="rounded-md border border-border/70 bg-muted/10 p-2 space-y-0.5 sm:col-span-2">
          <div className="flex items-center gap-1.5 pb-1.5 mb-1 border-b border-border/50">
            <MousePointerClick size={12} className="text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Tools</span>
            <span className="ml-auto text-[10px] text-muted-foreground">single letter · shared letters cycle</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-3">
            {toolRows.map(t => {
              const key = toolKeys[t.id]
              const isHot = listening?.kind === 'tool' && listening.id === t.id
              const overridden = isOverridden(toolOverrideKey(t.id), t.shortcut.toLowerCase())
              const rn = rowNoteFor(`tool:${t.id}`)
              const partners = (cyclePartners[key] ?? []).filter(p => p !== t.id)
              return (
                <div key={t.id} className={cn('py-0.5 rounded-sm px-1 -mx-1', isHot && 'bg-primary/10 ring-1 ring-primary/40')}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ToolIcon icon={t.icon} />
                      <span className="text-[11px] text-foreground/90 truncate">{t.label}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startListen({ kind: 'tool', id: t.id })}
                        title="Change key"
                        aria-label={`Change shortcut for ${t.label}`}
                        className={cn(
                          'px-1.5 py-0.5 rounded border font-mono text-[10px] transition-colors',
                          isHot
                            ? 'bg-primary/15 border-primary/50 text-primary animate-pulse'
                            : overridden
                              ? 'bg-primary/10 border-primary/35 text-primary/90 hover:border-primary/60'
                              : 'bg-muted/70 border-border/60 text-foreground/85 hover:border-primary/40'
                        )}
                      >
                        {isHot ? 'press…' : key.toUpperCase()}
                      </button>
                      {overridden && (
                        <button
                          onClick={() => resetRow('tool', toolOverrideKey(t.id))}
                          title="Restore default"
                          aria-label={`Restore default key for ${t.label}`}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                  {(rn || partners.length > 0) && (
                    <div className={cn(
                      'flex items-center gap-1 text-[10px] pb-0.5 pl-6',
                      rn?.kind === 'error' ? 'text-red-400' : rn?.kind === 'warn' ? 'text-primary' : 'text-muted-foreground'
                    )}>
                      {rn
                        ? <>{rn.kind === 'error' ? <AlertTriangle size={10} /> : <Info size={10} />}{rn.msg}</>
                        : <><Info size={10} />cycles with {partners.map(p => TOOL_MAP[p].label).join(' · ')}</>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* ---------- Commands by section ---------- */}
        {(['File', 'Edit', 'Image', 'Layer', 'Select', 'View'] as const).map(section => {
          const rows = cmdRows.filter(c => c.section === section)
          if (!rows.length) return null
          const Icon = SECTION_ICONS[section] ?? FileText
          return (
            <section key={section} className="rounded-md border border-border/70 bg-muted/10 p-2 space-y-0.5">
              <div className="flex items-center gap-1.5 pb-1.5 mb-1 border-b border-border/50">
                <Icon size={12} className="text-primary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">{section}</span>
              </div>
              {rows.map(c => {
                const combo = commandCombo(c.id)
                const isHot = listening?.kind === 'command' && listening.id === c.id
                const overridden = isOverridden(commandOverrideKey(c.id), c.defaultCombo)
                const rn = rowNoteFor(c.id)
                return (
                  <div key={c.id} className={cn('py-0.5 rounded-sm px-1 -mx-1', isHot && 'bg-primary/10 ring-1 ring-primary/40')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-foreground/90 truncate">{c.label}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => startListen({ kind: 'command', id: c.id })}
                          title="Change shortcut"
                          aria-label={`Change shortcut for ${c.label}`}
                          className={cn(
                            'px-1.5 py-0.5 rounded border font-mono text-[10px] transition-colors',
                            isHot
                              ? 'bg-primary/15 border-primary/50 text-primary animate-pulse'
                              : overridden
                                ? 'bg-primary/10 border-primary/35 text-primary/90 hover:border-primary/60'
                                : 'bg-muted/70 border-border/60 text-foreground/85 hover:border-primary/40'
                          )}
                        >
                          {isHot ? 'press…' : formatCombo(combo)}
                        </button>
                        {overridden && (
                          <button
                            onClick={() => resetRow('command', commandOverrideKey(c.id))}
                            title="Restore default"
                            aria-label={`Restore default shortcut for ${c.label}`}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <RotateCcw size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                    {rn && (
                      <div className={cn(
                        'flex items-center gap-1 text-[10px] pb-0.5',
                        rn.kind === 'error' ? 'text-red-400' : 'text-primary'
                      )}>
                        {rn.kind === 'error' ? <AlertTriangle size={10} /> : <Info size={10} />}{rn.msg}
                      </div>
                    )}
                  </div>
                )
              })}
            </section>
          )
        })}

        {/* ---------- fixed helpers (read-only) ---------- */}
        {!q && (
          <section className="rounded-md border border-border/70 bg-muted/10 p-2 space-y-0.5 sm:col-span-2">
            <div className="flex items-center gap-1.5 pb-1.5 mb-1 border-b border-border/50">
              <Info size={12} className="text-primary" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Fixed helpers</span>
              <span className="ml-auto text-[10px] text-muted-foreground">not rebindable</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-3">
              {FIXED_HELPERS.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-2 py-0.5">
                  <Kbd>{k}</Kbd>
                  <span className="text-[11px] text-muted-foreground text-right leading-snug">{v}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <DialogFooter className="gap-2">
        <span className="mr-auto text-[10px] text-muted-foreground">
          Click a key chip, then press the new keystroke · changes apply immediately and persist
        </span>
        <Button size="sm" onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  )
}
