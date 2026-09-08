'use client'
// ============================================================
// Chay's Photo Studio — global keyboard dispatcher (TASK 17)
//
// All Ctrl/Cmd/Alt combos and plain-key commands route through the
// customizable command registry in shortcuts.ts — editing a binding
// there changes this dispatcher live. Fixed structural helpers
// (opacity digits, brush-size brackets, color X/D, arrow nudging)
// stay hard-wired; tool activation keys come from resolvedToolKeyMap()
// so tools that share a key cycle on repeated presses.
//
// Never fires while typing in INPUT / TEXTAREA / contentEditable
// (checks both e.target and document.activeElement, so dialogs
// with a focused text field swallow their own keystrokes).
// ============================================================
import { useEffect } from 'react'
import type { ToolId } from './types'
import { TOOL_MAP } from './constants/tools'
import { engine } from './engine/engine'
import { useEditorStore } from './store'
import { setActiveTool } from './tools/registry'
import { clamp } from './utils/canvas'
import {
  eventCombo, findCommandByCombo, runCommand, resolvedToolKeyMap,
} from './shortcuts'

/** Activate a tool the same way the toolbar does (store + registry + engine). */
function activateTool(id: ToolId) {
  const s = useEditorStore.getState()
  s.setTool(id)
  setActiveTool(id)
  ;(engine as any)._activeToolId = id
}

/** Pressing a tool key repeatedly cycles within its (dynamic) group. */
function handleToolKey(key: string): boolean {
  const list = resolvedToolKeyMap()[key]
  if (!list?.length) return false
  const current = useEditorStore.getState().activeTool
  const idx = list.indexOf(current)
  activateTool(idx >= 0 ? list[(idx + 1) % list.length] : list[0])
  return true
}

/** [ / ] — nudge the active tool's brush size (only if it has a `size` option). */
function handleBrushSize(dir: -1 | 1): boolean {
  const s = useEditorStore.getState()
  const def = TOOL_MAP[s.activeTool]
  if (!def) return false
  const ctl = def.options.find(o => o.key === 'size')
  if (!ctl) return false
  const current = Number(s.toolOptions[s.activeTool]?.size ?? def.defaults.size) || ctl.min || 1
  // PS-style increments — finer steps for small brushes
  const step = current >= 200 ? 25 : current >= 100 ? 10 : current >= 50 ? 5 : current >= 10 ? 2 : 1
  const min = ctl.min ?? 1
  const max = clamp(ctl.max ?? 500, 1, 500)
  s.setToolOption(s.activeTool, 'size', clamp(current + dir * step, min, max))
  return true
}

/** 0–9 → active layer opacity (0 = 100%, 1 = 10% … 9 = 90%). */
function handleOpacityDigit(digit: number): boolean {
  const layer = engine.activeLayer
  if (!layer) return false
  const opacity = digit === 0 ? 100 : digit * 10
  engine.setLayerProps(layer.id, { opacity }, { label: `Opacity ${opacity}%` })
  return true
}

/** True when the keystroke belongs to a text field (or a dialog with one focused). */
function isTypingContext(e: KeyboardEvent): boolean {
  const targets: (Element | null)[] = [e.target as Element | null, document.activeElement]
  for (const el of targets) {
    if (!el) continue
    const t = el as HTMLElement
    if (t.isContentEditable) return true
    const tag = t.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  }
  return false
}

/**
 * Fixed structural helpers (not user-bindable): layer nudging, brush size,
 * color swap/default, opacity digits. Delete/Backspace are handled as the
 * `clearSelection` command in the registry.
 */
function handlePlainKey(e: KeyboardEvent, k: string): boolean {
  if (e.key === 'Delete' || e.key === 'Backspace') return false // command territory
  // arrow keys nudge the active layer (Shift = 10px, Photoshop behaviour)
  if (k.startsWith('arrow')) {
    if (!engine.activeDoc || !engine.activeLayer) return false
    const step = e.shiftKey ? 10 : 1
    switch (k) {
      case 'arrowleft': engine.nudgeActiveLayer(-step, 0); return true
      case 'arrowright': engine.nudgeActiveLayer(step, 0); return true
      case 'arrowup': engine.nudgeActiveLayer(0, -step); return true
      case 'arrowdown': engine.nudgeActiveLayer(0, step); return true
    }
    return false
  }
  if (k === '[') return handleBrushSize(-1)
  if (k === ']') return handleBrushSize(1)
  if (k === 'x') { useEditorStore.getState().swapColors(); return true }
  if (k === 'd') {
    const s = useEditorStore.getState()
    s.setFgColor('#000000'); s.setBgColor('#ffffff')
    return true
  }
  if (k >= '0' && k <= '9') {
    if (e.repeat) return false // avoid opacity history spam while held
    return handleOpacityDigit(Number(k))
  }
  if (k >= 'a' && k <= 'z') {
    if (e.repeat) return false // holding a tool key shouldn't spin the cycle
    return handleToolKey(k)
  }
  return false
}

/**
 * Register the global keydown listener. Mount once in <EditorApp/>.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (isTypingContext(e)) return

      // ---- customized command registry (Ctrl/Cmd, Alt and plain combos) ----
      // NOTE: this replaces the old hardcoded switch — including the old
      // dead `case 'x'` (Ctrl+Shift+X now really opens Liquify) and makes
      // Ctrl+Alt+I open Image Size instead of shadow-inverting the layer.
      const combo = eventCombo(e)
      const cmd = findCommandByCombo(combo)
      if (cmd) {
        runCommand(cmd)
        e.preventDefault()
        return
      }

      // modifier combos that matched no command never fall through
      if (e.ctrlKey || e.metaKey || e.altKey) return

      // ---- plain keys: fixed helpers, then tool activation ----
      const parts = combo.split('+')
      const k = parts[parts.length - 1]
      if (handlePlainKey(e, k)) e.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
