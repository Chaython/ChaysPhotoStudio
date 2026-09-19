// ============================================================
// Chay's Photo Studio — customizable shortcut system (TASK 17)
//
// Central command registry + combo-string utilities shared by:
//  · keyboard-shortcuts.ts (the global dispatcher)
//  · shortcuts-dialog.tsx  (the visual shortcut editor)
//  · toolbar.tsx / menus.ts (live shortcut labels)
//
// Combo strings are the canonical serialization of a keystroke:
//    'ctrl'   ← Ctrl OR Cmd (meta)
//    'alt'    ← Alt / Option
//    'shift'  ← Shift
//    key      ← lower-cased key ('a', ';', 'backspace', 'arrowleft'…)
//    order    ← always ctrl+alt+shift+key
// Shifted punctuation is canonicalized to its unshifted key, so
// Ctrl+Shift+0 (e.key ')') == 'ctrl+shift+0' and Ctrl+Plus
// (e.key '+') == 'ctrl+shift+='.
//
// User overrides live in the editor store (`shortcutOverrides`,
// persisted to localStorage 'zphoto-shortcuts'):
//    Record<CommandId | `tool:${ToolId}`, combo>
// Missing entries fall back to the defaults below, so a binding is
// never empty — editing replaces, resetting restores.
// ============================================================
import type { ToolId } from './types'
import { TOOL_DEFS, TOOL_MAP } from './constants/tools'
import { engine } from './engine/engine'
import { openFiles, saveProject } from './engine/io'
import { useEditorStore } from './store'

// ---------- command ids ----------
export type CommandId =
  // File
  | 'newDoc' | 'open' | 'save' | 'saveAs' | 'export'
  // Edit
  | 'undo' | 'redo' | 'copy' | 'copyMerged' | 'cut' | 'paste'
  | 'fillFg' | 'fillBg' | 'clearSelection' | 'invert'
  | 'duplicateLayer' | 'newLayer' | 'transform' | 'mergeDown' | 'mergeVisible'
  // Image
  | 'imageSize' | 'canvasSize' | 'aiUpscale' | 'liquify'
  | 'autoTone' | 'autoContrast' | 'autoColor'
  // Layer
  | 'toggleClipping'
  // Select
  | 'selectAll' | 'deselect' | 'invertSelection' | 'selectMask'
  // View
  | 'toggleRulers' | 'toggleGuides' | 'toggleGrid' | 'toggleSnapGrid'
  | 'zoomIn' | 'zoomOut' | 'zoomFit' | 'zoomFitContent' | 'zoom100'

export interface CommandDef {
  id: CommandId
  label: string
  section: 'File' | 'Edit' | 'Image' | 'Layer' | 'Select' | 'View'
  defaultCombo: string
  /** extra accepted combos (not shown as editable — e.g. shifted variants) */
  aliases?: string[]
  run: () => void
}

const store = () => useEditorStore.getState()
const openDlg = (type: any, props?: any) => store().openDialog(type, props)
const viewport = () => (window as any).__zphotoViewport

/** hidden file picker (matches File > Open) */
function pickImages() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*,.zproj.json'
  input.multiple = true
  input.onchange = () => { if (input.files?.length) void openFiles(Array.from(input.files)) }
  input.click()
}

export const COMMANDS: CommandDef[] = [
  // ---- File ----
  { id: 'newDoc', label: 'New Document…', section: 'File', defaultCombo: 'ctrl+n', run: () => openDlg('new-doc') },
  { id: 'open', label: 'Open…', section: 'File', defaultCombo: 'ctrl+o', run: () => pickImages() },
  { id: 'save', label: 'Save Project', section: 'File', defaultCombo: 'ctrl+s', run: () => void saveProject() },
  { id: 'saveAs', label: 'Save Project As…', section: 'File', defaultCombo: 'ctrl+shift+s', run: () => void saveProject({ saveAs: true }) },
  { id: 'export', label: 'Export As…', section: 'File', defaultCombo: 'ctrl+shift+alt+e', run: () => openDlg('export') },
  // ---- Edit ----
  { id: 'undo', label: 'Undo', section: 'Edit', defaultCombo: 'ctrl+z', run: () => engine.undo() },
  { id: 'redo', label: 'Redo', section: 'Edit', defaultCombo: 'ctrl+shift+z', aliases: ['ctrl+y'], run: () => engine.redo() },
  { id: 'copy', label: 'Copy Layer', section: 'Edit', defaultCombo: 'ctrl+c', run: () => engine.copyLayer(false) },
  { id: 'copyMerged', label: 'Copy Merged', section: 'Edit', defaultCombo: 'ctrl+shift+c', run: () => engine.copyLayer(true) },
  { id: 'cut', label: 'Cut', section: 'Edit', defaultCombo: 'ctrl+x', run: () => engine.cutLayer() },
  { id: 'paste', label: 'Paste', section: 'Edit', defaultCombo: 'ctrl+v', run: () => engine.pasteLayer() },
  { id: 'fillFg', label: 'Fill with Foreground', section: 'Edit', defaultCombo: 'alt+backspace', run: () => engine.fillSelection(store().fgColor) },
  { id: 'fillBg', label: 'Fill with Background', section: 'Edit', defaultCombo: 'ctrl+backspace', run: () => engine.fillSelection(store().bgColor) },
  { id: 'clearSelection', label: 'Clear Selection Pixels', section: 'Edit', defaultCombo: 'delete', aliases: ['backspace'], run: () => { if (engine.activeDoc) engine.deleteSelectionPixels() } },
  { id: 'invert', label: 'Invert (Adjustment)', section: 'Edit', defaultCombo: 'ctrl+i', run: () => { const l = engine.activeLayer; if (l) engine.applyAdjustmentToLayer(l.id, 'invert', {}) } },
  { id: 'duplicateLayer', label: 'Duplicate Layer', section: 'Edit', defaultCombo: 'ctrl+j', run: () => { const l = engine.activeLayer; if (l) engine.duplicateLayer(l.id) } },
  { id: 'newLayer', label: 'New Layer', section: 'Edit', defaultCombo: 'ctrl+shift+n', run: () => engine.addRasterLayer() },
  { id: 'transform', label: 'Free Transform…', section: 'Edit', defaultCombo: 'ctrl+t', run: () => openDlg('transform', { layerId: engine.activeLayer?.id }) },
  { id: 'mergeDown', label: 'Merge Down', section: 'Edit', defaultCombo: 'ctrl+e', run: () => engine.mergeDown() },
  { id: 'mergeVisible', label: 'Merge Visible', section: 'Edit', defaultCombo: 'ctrl+shift+e', run: () => engine.mergeVisible() },
  // ---- Image ----
  { id: 'imageSize', label: 'Image Size…', section: 'Image', defaultCombo: 'ctrl+alt+i', run: () => openDlg('image-size') },
  { id: 'canvasSize', label: 'Canvas Size…', section: 'Image', defaultCombo: 'ctrl+alt+c', run: () => openDlg('canvas-size') },
  { id: 'aiUpscale', label: 'AI Upscale…', section: 'Image', defaultCombo: 'ctrl+alt+u', run: () => openDlg('ai-upscale') },
  { id: 'liquify', label: 'Liquify…', section: 'Image', defaultCombo: 'ctrl+shift+x', run: () => openDlg('liquify') },
  { id: 'autoTone', label: 'Auto Tone', section: 'Image', defaultCombo: 'ctrl+shift+l', run: () => void engine.autoCorrectAsync('tone') },
  { id: 'autoContrast', label: 'Auto Contrast', section: 'Image', defaultCombo: 'ctrl+alt+shift+l', run: () => void engine.autoCorrectAsync('contrast') },
  { id: 'autoColor', label: 'Auto Color', section: 'Image', defaultCombo: 'ctrl+shift+b', run: () => void engine.autoCorrectAsync('color') },
  // ---- Layer ----
  { id: 'toggleClipping', label: 'Create / Release Clipping Mask', section: 'Layer', defaultCombo: 'ctrl+alt+g', run: () => { const l = engine.activeLayer; if (l) engine.toggleClipping(l.id) } },
  // ---- Select ----
  { id: 'selectAll', label: 'Select All', section: 'Select', defaultCombo: 'ctrl+a', run: () => engine.selectAll() },
  { id: 'deselect', label: 'Deselect', section: 'Select', defaultCombo: 'ctrl+d', run: () => engine.deselect() },
  { id: 'invertSelection', label: 'Invert Selection', section: 'Select', defaultCombo: 'ctrl+shift+i', run: () => engine.invertSelection() },
  { id: 'selectMask', label: 'Select and Mask…', section: 'Select', defaultCombo: 'ctrl+alt+r', run: () => openDlg('select-mask') },
  // ---- View ----
  { id: 'toggleRulers', label: 'Toggle Rulers', section: 'View', defaultCombo: 'ctrl+r', run: () => store().setViewPref('showRulers', !store().view.showRulers) },
  { id: 'toggleGuides', label: 'Toggle Guides', section: 'View', defaultCombo: 'ctrl+;', run: () => store().setViewPref('showGuides', !store().view.showGuides) },
  { id: 'toggleGrid', label: 'Toggle Grid', section: 'View', defaultCombo: "ctrl+'", run: () => store().setViewPref('showGrid', !store().view.showGrid) },
  { id: 'toggleSnapGrid', label: 'Snap to Grid', section: 'View', defaultCombo: "ctrl+shift+'", run: () => store().setViewPref('snapGrid', !store().view.snapGrid) },
  { id: 'zoomIn', label: 'Zoom In', section: 'View', defaultCombo: 'ctrl+=', aliases: ['ctrl+shift+='], run: () => engine.zoomBy(1.25) },
  { id: 'zoomOut', label: 'Zoom Out', section: 'View', defaultCombo: 'ctrl+-', run: () => engine.zoomBy(1 / 1.25) },
  { id: 'zoomFit', label: 'Fit on Screen', section: 'View', defaultCombo: 'ctrl+0', run: () => viewport()?.fit() },
  { id: 'zoomFitContent', label: 'Fit Content (blank space)', section: 'View', defaultCombo: 'ctrl+shift+0', run: () => viewport()?.fitContent() },
  { id: 'zoom100', label: 'Zoom 100%', section: 'View', defaultCombo: 'ctrl+1', run: () => engine.setZoom(1) },
]

export const COMMAND_MAP: Record<CommandId, CommandDef> = Object.fromEntries(
  COMMANDS.map(c => [c.id, c])
) as Record<CommandId, CommandDef>

// ============================================================
// Combo-string utilities
// ============================================================

/** shifted punctuation → unshifted base key (shift is tracked separately) */
const SHIFTED_CHARS: Record<string, string> = {
  ')': '0', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
  '^': '6', '&': '7', '*': '8', '(': '9',
  '_': '-', '+': '=', '{': '[', '}': ']', ':': ';', '"': "'",
  '<': ',', '>': '.', '~': '`', '?': '/', '|': '\\',
}

/** human-readable key names for display */
const KEY_LABELS: Record<string, string> = {
  backspace: 'Backspace', delete: 'Delete', enter: 'Enter', escape: 'Esc',
  tab: 'Tab', space: 'Space',
  arrowleft: '←', arrowup: '↑', arrowright: '→', arrowdown: '↓',
}

/** Build the canonical combo string from a KeyboardEvent. */
export function eventCombo(e: KeyboardEvent): string {
  const code = e.code ?? ''
  let key: string
  if (e.altKey && code.startsWith('Key')) {
    // macOS Option mutates e.key into punctuation — read the physical key
    key = code.slice(3).toLowerCase()
  } else {
    const k = e.key ?? ''
    if (k.length === 1) key = SHIFTED_CHARS[k] ?? k.toLowerCase()
    else if (code.startsWith('Key')) key = code.slice(3).toLowerCase()
    else if (code.startsWith('Digit')) key = code.slice(5)
    else key = k.toLowerCase()
  }
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

/** Pretty-print a combo for menus / tooltips / the editor rows. */
export function formatCombo(combo: string): string {
  if (!combo) return '—'
  return combo
    .split('+')
    .map(p => {
      if (p === 'ctrl') return 'Ctrl'
      if (p === 'alt') return 'Alt'
      if (p === 'shift') return 'Shift'
      if (KEY_LABELS[p]) return KEY_LABELS[p]
      if (p.length === 1) return p.toUpperCase()
      return p.charAt(0).toUpperCase() + p.slice(1)
    })
    .join('+')
}

/** Sorted modifier parts for display (Ctrl+Alt+Shift order). */
export function comboKeyPart(combo: string): string {
  const parts = combo.split('+')
  return parts[parts.length - 1] ?? ''
}

// ============================================================
// Resolution (reads live store overrides — safe to call anywhere)
// ============================================================

/** The stored override key for a command. */
export const commandOverrideKey = (id: CommandId) => id as string
/** The stored override key for a tool binding. */
export const toolOverrideKey = (id: ToolId) => `tool:${id}`

/** Effective combo for a command (override ?? default). */
export function commandCombo(id: CommandId): string {
  const ov = useEditorStore.getState().shortcutOverrides
  return ov?.[commandOverrideKey(id)] ?? COMMAND_MAP[id]?.defaultCombo ?? ''
}

/** All accepted combos (override/default + aliases). */
export function commandCombos(id: CommandId): string[] {
  const def = COMMAND_MAP[id]
  if (!def) return []
  return [commandCombo(id), ...(def.aliases ?? [])]
}

/** Effective activation key for a tool (override ?? ToolDef.shortcut). */
export function toolKey(toolId: ToolId): string {
  const ov = useEditorStore.getState().shortcutOverrides
  return (ov?.[toolOverrideKey(toolId)] || TOOL_MAP[toolId]?.shortcut || '?').toLowerCase()
}

/**
 * Resolved tool keymap: key → tools (in TOOL_DEFS order). Tools sharing
 * a key cycle on repeated presses — the cycle groups are derived from
 * the *current* bindings, so customizations create/break cycles live.
 */
export function resolvedToolKeyMap(): Record<string, ToolId[]> {
  const map: Record<string, ToolId[]> = {}
  for (const def of TOOL_DEFS) {
    const k = toolKey(def.id)
    ;(map[k] ??= []).push(def.id)
  }
  return map
}

/** Command whose primary combo or aliases match — null when none. */
export function findCommandByCombo(combo: string): CommandId | null {
  for (const def of COMMANDS) {
    const combos = commandCombos(def.id)
    if (combos.includes(combo)) return def.id
  }
  return null
}

export function runCommand(id: CommandId): void {
  COMMAND_MAP[id]?.run()
}

// ============================================================
// Conflict detection (used by the shortcut editor)
// ============================================================

export interface ComboConflict {
  command?: CommandId
  tools: ToolId[]
}

/** Who currently responds to `combo` (excluding a queried binding). */
export function findComboConflicts(combo: string, exclude: { command?: CommandId; tool?: ToolId }): ComboConflict {
  const out: ComboConflict = { tools: [] }
  for (const def of COMMANDS) {
    if (def.id === exclude.command) continue
    if (commandCombos(def.id).includes(combo)) { out.command = out.command ?? def.id }
  }
  const toolMap = resolvedToolKeyMap()
  if (toolMap[combo]) {
    out.tools = toolMap[combo].filter(t => t !== exclude.tool)
  }
  return out
}

/**
 * Plain keys that tool bindings may never take (structural helpers):
 * digits = layer opacity, [ ] = brush size, X / D = colors,
 * arrows = nudge, Backspace/Delete = clear, Esc/Enter/Tab/Space = UI.
 */
export const RESERVED_TOOL_KEYS = new Set([
  'x', 'd', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  '[', ']', 'arrowleft', 'arrowup', 'arrowright', 'arrowdown',
  'backspace', 'delete', 'enter', 'escape', 'tab', 'space', '/',
])

/** Tools are bound to a single plain letter (no modifiers). */
export function isValidToolBinding(combo: string): boolean {
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  const hasMods = parts.length > 1
  if (hasMods) return false
  return key.length === 1 && key >= 'a' && key <= 'z' && !RESERVED_TOOL_KEYS.has(key)
}
