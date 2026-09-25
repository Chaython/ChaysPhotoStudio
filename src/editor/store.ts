'use client'
// Zustand store — UI state + lightweight mirrors of engine state
import { create } from 'zustand'
import type { DialogInstance, DialogType, ToolId, PsAction, ChannelView, ToolbarSection } from './types'
import { TOOL_DEFS, TOOL_MAP } from './constants/tools'
import { engine } from './engine/engine'

export interface LayerMeta {
  id: string
  name: string
  kind: string
  visible: boolean
  opacity: number
  blendMode: string
  locked: boolean
  clipped: boolean
  hasMask: boolean
  maskEnabled: boolean
  hasVectorMask: boolean
  vectorMaskEnabled: boolean
  smartFilterCount: number
  adjustmentType: string | null
  hasBlendIf: boolean
  hasFx: boolean
  /** 'detect' = lifted from an AI-detected object box */
  origin: string | null
  thumbV: number
}

export interface DocMeta { id: string; name: string; width: number; height: number; dirty: boolean }

export interface ToastMsg { id: number; msg: string; type: 'info' | 'success' | 'error'; time: number }

/** geometry of a floating panel window (viewport coords, px) */
export interface PanelRect {
  x: number
  y: number
  w: number
  h: number
  z: number
  collapsed: boolean
}

// ---- floating panel layout persistence ---------------------------------------
const PANEL_LAYOUT_KEY = 'zphoto-panel-layout'
export const DOCK_WIDTH_DEFAULT = 264
export const DOCK_WIDTH_MIN = 220
export const DOCK_WIDTH_MAX = 460
/** height of the horizontal top-dock strip (below the tool options bar) */
export const TOP_HEIGHT_DEFAULT = 232
export const TOP_HEIGHT_MIN = 120
export const TOP_HEIGHT_MAX = 480
export type DockSide = 'left' | 'right' | 'top'
export const NATIVE_PANEL_IDS = ['tools', 'tool-options', 'documents'] as const
export type NativePanelId = typeof NATIVE_PANEL_IDS[number]
export const isNativePanelId = (id: string): id is NativePanelId =>
  (NATIVE_PANEL_IDS as readonly string[]).includes(id)

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function loadPanelLayout(): {
  floating: Record<string, PanelRect>
  zTop: number
  dockWidth: number
  leftWidth: number
  leftOpen: boolean
  leftTab: string
  rightTab: string
  dockSide: Record<string, DockSide>
  topOrder: string[]
  topHeight: number
} | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PANEL_LAYOUT_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as {
      floating?: Record<string, Partial<PanelRect>>
      zTop?: number
      dockWidth?: number
      leftWidth?: number
      leftOpen?: boolean
      leftTab?: string
      rightTab?: string
      dockSide?: Record<string, string>
      topOrder?: unknown
      topHeight?: number
    }
    const vw = window.innerWidth
    const vh = window.innerHeight
    const floating: Record<string, PanelRect> = {}
    for (const [id, r] of Object.entries(data.floating ?? {})) {
      if (!r || typeof r.x !== 'number' || typeof r.y !== 'number') continue
      const w = clampNum(Math.round(r.w ?? 280), 180, Math.max(180, vw))
      const h = clampNum(Math.round(r.h ?? 360), 120, Math.max(120, vh))
      floating[id] = {
        x: clampNum(Math.round(r.x), -w + 80, Math.max(-w + 80, vw - 80)),
        y: clampNum(Math.round(r.y), 48, Math.max(48, vh - 60)),
        w,
        h,
        z: typeof r.z === 'number' ? r.z : 1,
        collapsed: !!r.collapsed,
      }
    }
    const dockSide: Record<string, DockSide> = {}
    for (const [id, side] of Object.entries(data.dockSide ?? {})) {
      if (side === 'left' || side === 'right' || side === 'top') dockSide[id] = side
    }
    const topOrder = Array.isArray(data.topOrder)
      ? data.topOrder.filter((id): id is string => typeof id === 'string').slice(0, 12)
      : []
    const rightTabRaw = typeof data.rightTab === 'string' ? data.rightTab : 'layers'
    return {
      rightTab: rightTabRaw,
      floating,
      zTop: typeof data.zTop === 'number' ? data.zTop : Object.values(floating).reduce((m, r) => Math.max(m, r.z), 0),
      dockWidth: clampNum(Math.round(data.dockWidth ?? DOCK_WIDTH_DEFAULT), DOCK_WIDTH_MIN, DOCK_WIDTH_MAX),
      leftWidth: clampNum(Math.round(data.leftWidth ?? DOCK_WIDTH_DEFAULT), DOCK_WIDTH_MIN, DOCK_WIDTH_MAX),
      leftOpen: !!data.leftOpen,
      leftTab: typeof data.leftTab === 'string' ? data.leftTab : '',
      dockSide,
      topOrder: topOrder.filter(id => dockSide[id] === 'top'),
      topHeight: clampNum(Math.round(data.topHeight ?? TOP_HEIGHT_DEFAULT), TOP_HEIGHT_MIN, TOP_HEIGHT_MAX),
    }
  } catch {
    return null
  }
}

function persistPanelLayout(panels: EditorStore['panels']) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify({
      floating: panels.floating,
      zTop: panels.zTop,
      dockWidth: panels.dockWidth,
      leftWidth: panels.leftWidth,
      leftOpen: panels.leftOpen,
      leftTab: panels.leftTab,
      rightTab: panels.rightTab,
      dockSide: panels.dockSide,
      topOrder: panels.topOrder,
      topHeight: panels.topHeight,
    }))
  } catch {
    /* noop */
  }
}

const defaultOptions = () => {
  const out: Record<string, Record<string, any>> = {}
  for (const t of TOOL_DEFS) out[t.id] = { ...t.defaults }
  return out
}

// ---- customizable shortcuts + toolbar layout persistence (TASK 17) ------------
const SHORTCUTS_KEY = 'zphoto-shortcuts'
const TOOLBAR_KEY = 'zphoto-toolbar'

function loadShortcutOverrides(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = JSON.parse(localStorage.getItem(SHORTCUTS_KEY) || '{}')
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function persistShortcutOverrides(overrides: Record<string, string>) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(overrides)) } catch { /* noop */ }
}

/** default toolbar: ToolDef groups → sections, preserving TOOL_DEFS order */
export function defaultToolbarLayout(): ToolbarSection[] {
  const map = new Map<number, ToolId[]>()
  for (const def of TOOL_DEFS) {
    if (!map.has(def.group)) map.set(def.group, [])
    map.get(def.group)!.push(def.id)
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, ids]): ToolbarSection[] =>
      ids.length === 1
        ? [{ kind: 'single', tool: ids[0] }]
        : [{ kind: 'group', tools: ids }]
    )
}

/** sanitize a persisted/edited layout: unknown ids dropped, every tool
 *  exactly once (missing ones appended in a trailing group so new tools
 *  always surface after an app update), empty groups dropped. A flyout
 *  reduced to one tool KEEPS its group shape (it renders as a plain
 *  button — but other tools can still be moved into it). */
export function sanitizeToolbarLayout(sections: ToolbarSection[]): ToolbarSection[] {
  const seen = new Set<ToolId>()
  const out: ToolbarSection[] = []
  for (const sec of sections) {
    if (sec.kind === 'single') {
      if (seen.has(sec.tool) || !TOOL_MAP[sec.tool]) continue
      seen.add(sec.tool)
      out.push({ kind: 'single', tool: sec.tool })
    } else {
      const tools = sec.tools.filter(t => !seen.has(t) && TOOL_MAP[t])
      tools.forEach(t => seen.add(t))
      if (tools.length) out.push({ kind: 'group', tools })
    }
  }
  const missing = TOOL_DEFS.filter(t => !seen.has(t.id)).map(t => t.id)
  if (missing.length) out.push({ kind: 'group', tools: missing })
  return out
}

function loadToolbarLayout(): ToolbarSection[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(TOOLBAR_KEY)
    if (!raw) return null
    const sections = JSON.parse(raw)
    if (!Array.isArray(sections) || !sections.length) return null
    const clean = sanitizeToolbarLayout(sections)
    // an all-default layout stores as null — treat “everything fell back”
    // the same way so equality checks in the UI are simple
    return clean.length ? clean : null
  } catch {
    return null
  }
}

function persistToolbarLayout(sections: ToolbarSection[] | null) {
  if (typeof localStorage === 'undefined') return
  try {
    if (!sections) localStorage.removeItem(TOOLBAR_KEY)
    else localStorage.setItem(TOOLBAR_KEY, JSON.stringify(sections))
  } catch { /* noop */ }
}

interface EditorStore {
  activeTool: ToolId
  toolOptions: Record<string, Record<string, any>>
  fgColor: string
  bgColor: string
  activeColorTarget: 'fg' | 'bg'
  dialogs: DialogInstance[]
  toasts: ToastMsg[]
  renderTick: number
  progress: { active: boolean; label: string; value: number } | null
  // mirrors
  docs: DocMeta[]
  activeDocId: string | null
  layers: LayerMeta[]
  activeLayerId: string | null
  selectedLayerIds: string[]
  historyIndex: number
  historyLabels: string[]
  channelView: ChannelView
  savedChannels: { id: string; name: string }[]
  hasSelection: boolean
  recording: boolean
  actions: PsAction[]
  zoom: number
  cursor: { x: number; y: number } | null
  // ---- timeline (Task 9-c) — NOT persisted ----
  /** animation playback running (setTimeout chain in scheduleTimelineStep) */
  timelinePlaying: boolean
  /** active frame index (mirrors engine.activeFrameIndex) */
  timelineActiveFrame: number
  /** loop playback at the last frame (default true) */
  timelineLoop: boolean
  timelineFrames: { id: string; name: string; delayMs: number }[]
  panels: {
    rightTab: string
    /** active tab in the left dock ('' = none yet) */
    leftTab: string
    /** left dock expanded (false = slim rail) */
    leftOpen: boolean
    /** left dock width in px (desktop) */
    leftWidth: number
    colorPanelOpen: boolean
    /** floating panel windows by panel id — presence = floating */
    floating: Record<string, PanelRect>
    /** last dock side per panel id — where a floating window docks back to */
    dockSide: Record<string, DockSide>
    /** panels docked into the horizontal top strip, in order */
    topOrder: string[]
    /** top strip height in px (desktop) */
    topHeight: number
    /** monotonically increasing z counter for focus stacking */
    zTop: number
    /** right dock width in px (desktop) */
    dockWidth: number
  }
  /** view preferences (rulers/guides/snap/grid) — persisted to localStorage.
   *  gridSize is in DOC pixels; 0 = adaptive (auto step by zoom).
   *  rulerUnits: the rulers' measurement scale (doc stays in px; CSS
   *  reference 96 px/inch). showPixelGrid: 1-doc-px cell grid at high zoom. */
  view: {
    showRulers: boolean; showGuides: boolean; snapGuides: boolean
    showGrid: boolean; snapGrid: boolean; gridSize: number
    showGridLabels: boolean
    rulerUnits: 'px' | 'in' | 'cm' | 'mm'
    showPixelGrid: boolean
  }
  // actions
  setTool(t: ToolId): void
  setToolOption(tool: ToolId, key: string, value: any): void
  setFgColor(c: string): void
  setBgColor(c: string): void
  swapColors(): void
  setActiveColorTarget(t: 'fg' | 'bg'): void
  openDialog(type: DialogType, props?: Record<string, any>): void
  closeDialog(id?: string): void
  pushToast(msg: string, type?: 'info' | 'success' | 'error'): void
  dismissToast(id: number): void
  bump(): void
  setProgress(p: { active: boolean; label: string; value: number } | null): void
  setRightPanelTab(tab: string): void
  setLeftPanelTab(tab: string): void
  setLeftDockOpen(open: boolean): void
  toggleColorPanel(): void
  /** pop a panel out into a floating window (rect optional — defaults cascade) */
  floatPanel(id: string, rect?: Partial<PanelRect>): void
  /** dock a panel into `side` (default: the side it came from) — works on
   *  floating windows AND docked tabs (moves them between docks) */
  dockPanel(id: string, side?: DockSide): void
  /** reveal a panel wherever it lives (focus window / activate its dock tab) */
  revealPanel(id: string): void
  /** return movable workspace chrome to its built-in location */
  homePanel(id: string): void
  movePanel(id: string, x: number, y: number): void
  resizePanel(id: string, w: number, h: number): void
  /** atomically commit floating geometry (used by north/west/corner resizes) */
  setPanelRect(id: string, rect: Pick<PanelRect, 'x' | 'y' | 'w' | 'h'>): void
  /** bring a floating window to front (z bump) */
  focusPanel(id: string): void
  collapsePanel(id: string, collapsed: boolean): void
  setDockWidth(px: number): void
  setLeftDockWidth(px: number): void
  setTopHeight(px: number): void
  resetPanelLayout(): void
  setViewPref(key: 'showRulers' | 'showGuides' | 'snapGuides' | 'showGrid' | 'snapGrid' | 'showGridLabels' | 'showPixelGrid', value: boolean): void
  setViewPref(key: 'rulerUnits', value: 'px' | 'in' | 'cm' | 'mm'): void
  setGridSize(px: number): void
  // ---- customizable shortcuts + toolbar (TASK 17) ----
  /** effective shortcut overrides — keys are CommandId or `tool:${ToolId}` */
  shortcutOverrides: Record<string, string>
  /** set (or clear with null → default) one shortcut binding */
  setShortcutOverride(id: string, combo: string | null): void
  resetShortcutOverrides(): void
  /** custom toolbar section order — null = factory default layout */
  toolbarLayout: ToolbarSection[] | null
  setToolbarLayout(sections: ToolbarSection[] | null): void
  resetToolbarLayout(): void
  // ---- timeline actions (Task 9-c) ----
  /** apply frame i to the real layers + set the active-frame mirror */
  setTimelineFrame(i: number): void
  toggleTimelinePlay(): void
  timelineNext(): void
  timelinePrev(): void
  toggleTimelineLoop(): void
  /** hard-stop playback (doc switch / close / unmount) — clears the timer */
  stopTimeline(): void
  syncFromEngine(): void
}

let toastSeq = 1

export const useEditorStore = create<EditorStore>((set, get) => ({
  activeTool: 'move',
  toolOptions: defaultOptions(),
  fgColor: '#ffffff',
  bgColor: '#000000',
  activeColorTarget: 'fg',
  dialogs: [],
  toasts: [],
  renderTick: 0,
  progress: null,
  docs: [],
  activeDocId: null,
  layers: [],
  activeLayerId: null,
  selectedLayerIds: [],
  historyIndex: -1,
  historyLabels: [],
  channelView: 'rgb',
  savedChannels: [],
  hasSelection: false,
  recording: false,
  actions: [],
  zoom: 1,
  cursor: null,
  timelinePlaying: false,
  timelineActiveFrame: 0,
  timelineLoop: true,
  timelineFrames: [],
  panels: {
    rightTab: 'layers',
    leftTab: '',
    leftOpen: false,
    leftWidth: DOCK_WIDTH_DEFAULT,
    colorPanelOpen: true,
    floating: {},
    dockSide: {},
    topOrder: [],
    topHeight: TOP_HEIGHT_DEFAULT,
    zTop: 0,
    dockWidth: DOCK_WIDTH_DEFAULT,
    ...(loadPanelLayout() ?? {}),
  },
  view: {
    // rulers ON by default for fresh users; anyone with persisted prefs
    // keeps their saved choice (the loader merges over these defaults)
    showRulers: true,
    showGuides: true,
    snapGuides: true,
    showGrid: false,
    snapGrid: false,
    gridSize: 0,
    showGridLabels: true,
    rulerUnits: 'px',
    showPixelGrid: true,
    ...(typeof localStorage !== 'undefined'
      ? (() => {
        try { return JSON.parse(localStorage.getItem('zphoto-view-prefs') || '{}') } catch { return {} }
      })()
      : {}),
  },
  shortcutOverrides: loadShortcutOverrides(),
  toolbarLayout: loadToolbarLayout(),

  setTool: (t) => { set({ activeTool: t }) },
  setToolOption: (tool, key, value) => set(s => {
    const current = { ...(s.toolOptions[tool] ?? {}) }

    if (tool === 'clone-stamp') {
      const fallback = { rotate: 0, scale: 100, mirrored: false, showOverlay: true, overlayOpacity: 50, overlayAutoHide: true, overlayInvert: false }
      const transforms = { ...(current.sourceTransforms ?? {}) }

      if (key === 'rotate' || key === 'scale' || key === 'mirrored' || key === 'showOverlay' || key === 'overlayOpacity' || key === 'overlayAutoHide' || key === 'overlayInvert') {
        const slot = String(Math.max(1, Math.min(5, Math.round(Number(current.sourceSlot) || 1))))
        transforms[slot] = { ...(transforms[slot] ?? fallback), [key]: value }
        return {
          toolOptions: {
            ...s.toolOptions,
            [tool]: { ...current, [key]: value, sourceTransforms: transforms },
          },
        }
      }

      if (key === 'sourceSlot') {
        const next = Math.max(1, Math.min(5, Math.round(Number(value) || 1)))
        const tr = transforms[String(next)] ?? fallback
        return {
          toolOptions: {
            ...s.toolOptions,
            [tool]: {
              ...current,
              sourceSlot: next,
              rotate: tr.rotate ?? 0,
              scale: tr.scale ?? 100,
              mirrored: tr.mirrored === true,
              showOverlay: tr.showOverlay !== false,
              overlayOpacity: Number.isFinite(tr.overlayOpacity) ? tr.overlayOpacity : 50,
              overlayAutoHide: tr.overlayAutoHide !== false,
              overlayInvert: tr.overlayInvert === true,
              sourceTransforms: transforms,
            },
          },
        }
      }
    }

    return {
      toolOptions: { ...s.toolOptions, [tool]: { ...current, [key]: value } },
    }
  }),
  setFgColor: (c) => set({ fgColor: c }),
  setBgColor: (c) => set({ bgColor: c }),
  swapColors: () => set(s => ({ fgColor: s.bgColor, bgColor: s.fgColor })),
  setActiveColorTarget: (t) => set({ activeColorTarget: t }),

  openDialog: (type, props) => set(s => ({
    dialogs: [...s.dialogs, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type, props }],
  })),
  closeDialog: (id) => set(s => ({
    dialogs: id ? s.dialogs.filter(d => d.id !== id) : s.dialogs.slice(0, -1),
  })),
  pushToast: (msg, type = 'info') => {
    const id = toastSeq++
    set(s => ({ toasts: [...s.toasts, { id, msg, type, time: Date.now() }] }))
    setTimeout(() => get().dismissToast(id), 3600)
  },
  dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
  bump: () => set(s => ({ renderTick: s.renderTick + 1 })),
  setProgress: (p) => set({ progress: p }),
  setRightPanelTab: (tab) => set(s => ({ panels: { ...s.panels, rightTab: tab } })),
  setLeftPanelTab: (tab) => set(s => ({ panels: { ...s.panels, leftTab: tab } })),
  setLeftDockOpen: (open) => set(s => {
    if (s.panels.leftOpen === open) return {}
    const panels = { ...s.panels, leftOpen: open }
    persistPanelLayout(panels)
    return { panels }
  }),
  toggleColorPanel: () => set(s => ({ panels: { ...s.panels, colorPanelOpen: !s.panels.colorPanelOpen } })),

  floatPanel: (id, rect) => set(s => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const prev = s.panels.floating[id]
    const w = clampNum(rect?.w ?? prev?.w ?? 280, 180, Math.max(180, vw))
    const h = clampNum(rect?.h ?? prev?.h ?? 360, 120, Math.max(120, vh))
    const z = s.panels.zTop + 1
    const x = clampNum(rect?.x ?? prev?.x ?? (vw - w - 40), -w + 80, Math.max(-w + 80, vw - 80))
    const y = clampNum(rect?.y ?? prev?.y ?? 96, 48, Math.max(48, vh - 60))
    const panels = {
      ...s.panels,
      floating: {
        ...s.panels.floating,
        [id]: { x, y, w, h, z, collapsed: rect?.collapsed ?? prev?.collapsed ?? false },
      },
      topOrder: s.panels.topOrder.filter(tid => tid !== id),
      zTop: z,
    }
    persistPanelLayout(panels)
    return { panels }
  }),

  dockPanel: (id, side) => set(s => {
    // Every registered panel is treated identically. Explicit side wins;
    // otherwise a floating panel returns to its last dock, defaulting right.
    const eff: DockSide = side ?? s.panels.dockSide[id] ?? 'right'
    if (eff === (s.panels.dockSide[id] ?? 'right') && !s.panels.floating[id]) {
      const panels = {
        ...s.panels,
        rightTab: eff === 'right' ? id : s.panels.rightTab,
        leftTab: eff === 'left' ? id : s.panels.leftTab,
        leftOpen: eff === 'left' ? true : s.panels.leftOpen,
        topOrder: eff === 'top' && !s.panels.topOrder.includes(id)
          ? [...s.panels.topOrder, id]
          : s.panels.topOrder,
      }
      persistPanelLayout(panels)
      return { panels }
    }
    const floating = { ...s.panels.floating }
    delete floating[id]
    const panels = {
      ...s.panels,
      floating,
      dockSide: { ...s.panels.dockSide, [id]: eff },
      rightTab: eff === 'right' ? id : s.panels.rightTab,
      leftTab: eff === 'left' ? id : s.panels.leftTab,
      leftOpen: eff === 'left' ? true : s.panels.leftOpen,
      topOrder: eff === 'top'
        ? (s.panels.topOrder.includes(id) ? s.panels.topOrder : [...s.panels.topOrder, id])
        : s.panels.topOrder.filter(tid => tid !== id),
    }
    persistPanelLayout(panels)
    return { panels }
  }),

  homePanel: (id) => set(s => {
    const floating = { ...s.panels.floating }
    delete floating[id]
    const dockSide = { ...s.panels.dockSide }
    delete dockSide[id]
    const panels = {
      ...s.panels,
      floating,
      dockSide,
      topOrder: s.panels.topOrder.filter(tid => tid !== id),
    }
    persistPanelLayout(panels)
    return { panels }
  }),

  revealPanel: (id) => set(s => {
    if (s.panels.floating[id]) {
      const r = s.panels.floating[id]
      if (r.z === s.panels.zTop) return {}
      const z = s.panels.zTop + 1
      const panels = { ...s.panels, floating: { ...s.panels.floating, [id]: { ...r, z } }, zTop: z }
      persistPanelLayout(panels)
      return { panels }
    }
    // Native workspace modules are already visible at home until the user
    // explicitly docks/floats them; revealing one should not move it right.
    if (isNativePanelId(id) && !s.panels.dockSide[id]) return {}
    const side: DockSide = s.panels.dockSide[id] ?? 'right'
    if (side === 'top') return {} // always visible in the top strip
    const panels = {
      ...s.panels,
      rightTab: side === 'right' ? id : s.panels.rightTab,
      leftTab: side === 'left' ? id : s.panels.leftTab,
      leftOpen: side === 'left' ? true : s.panels.leftOpen,
    }
    persistPanelLayout(panels)
    return { panels }
  }),

  movePanel: (id, x, y) => set(s => {
    const r = s.panels.floating[id]
    if (!r) return {}
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const panels = {
      ...s.panels,
      floating: {
        ...s.panels.floating,
        [id]: { ...r, x: clampNum(x, -r.w + 80, Math.max(-r.w + 80, vw - 80)), y: clampNum(y, 48, Math.max(48, vh - 60)) },
      },
    }
    persistPanelLayout(panels)
    return { panels }
  }),

  resizePanel: (id, w, h) => set(s => {
    const r = s.panels.floating[id]
    if (!r) return {}
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const panels = {
      ...s.panels,
      floating: {
        ...s.panels.floating,
        [id]: { ...r, w: clampNum(w, 180, Math.max(180, vw)), h: clampNum(h, 100, Math.max(100, vh)) },
      },
    }
    persistPanelLayout(panels)
    return { panels }
  }),

  setPanelRect: (id, next) => set(s => {
    const r = s.panels.floating[id]
    if (!r) return {}
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const w = clampNum(next.w, 180, Math.max(180, vw))
    const h = clampNum(next.h, 100, Math.max(100, vh))
    const x = clampNum(next.x, -w + 80, Math.max(-w + 80, vw - 80))
    const y = clampNum(next.y, 48, Math.max(48, vh - 60))
    const panels = {
      ...s.panels,
      floating: { ...s.panels.floating, [id]: { ...r, x, y, w, h } },
    }
    persistPanelLayout(panels)
    return { panels }
  }),

  focusPanel: (id) => set(s => {
    const r = s.panels.floating[id]
    if (!r || r.z === s.panels.zTop) return {}
    const z = s.panels.zTop + 1
    const panels = { ...s.panels, floating: { ...s.panels.floating, [id]: { ...r, z } }, zTop: z }
    persistPanelLayout(panels)
    return { panels }
  }),

  collapsePanel: (id, collapsed) => set(s => {
    const r = s.panels.floating[id]
    if (!r) return {}
    const panels = { ...s.panels, floating: { ...s.panels.floating, [id]: { ...r, collapsed } } }
    persistPanelLayout(panels)
    return { panels }
  }),

  setDockWidth: (px) => set(s => {
    const dockWidth = clampNum(Math.round(px), DOCK_WIDTH_MIN, DOCK_WIDTH_MAX)
    if (dockWidth === s.panels.dockWidth) return {}
    const panels = { ...s.panels, dockWidth }
    persistPanelLayout(panels)
    return { panels }
  }),

  setLeftDockWidth: (px) => set(s => {
    const leftWidth = clampNum(Math.round(px), DOCK_WIDTH_MIN, DOCK_WIDTH_MAX)
    if (leftWidth === s.panels.leftWidth) return {}
    const panels = { ...s.panels, leftWidth }
    persistPanelLayout(panels)
    return { panels }
  }),

  setTopHeight: (px) => set(s => {
    const topHeight = clampNum(Math.round(px), TOP_HEIGHT_MIN, TOP_HEIGHT_MAX)
    if (topHeight === s.panels.topHeight) return {}
    const panels = { ...s.panels, topHeight }
    persistPanelLayout(panels)
    return { panels }
  }),

  resetPanelLayout: () => set(() => {
    try { localStorage.removeItem(PANEL_LAYOUT_KEY) } catch { /* noop */ }
    return {
      panels: {
        rightTab: 'layers', leftTab: '', leftOpen: false, leftWidth: DOCK_WIDTH_DEFAULT,
        colorPanelOpen: true, floating: {}, dockSide: {}, topOrder: [], topHeight: TOP_HEIGHT_DEFAULT,
        zTop: 0, dockWidth: DOCK_WIDTH_DEFAULT,
      },
    }
  }),
  setViewPref: (key: 'showRulers' | 'showGuides' | 'snapGuides' | 'showGrid' | 'snapGrid' | 'showGridLabels' | 'showPixelGrid' | 'rulerUnits', value: boolean | 'px' | 'in' | 'cm' | 'mm') => set(s => {
    const view = { ...s.view, [key]: value }
    try { localStorage.setItem('zphoto-view-prefs', JSON.stringify(view)) } catch { /* noop */ }
    return { view }
  }),

  setGridSize: (px) => set(s => {
    const view = { ...s.view, gridSize: Math.max(0, Math.round(px)) }
    try { localStorage.setItem('zphoto-view-prefs', JSON.stringify(view)) } catch { /* noop */ }
    return { view }
  }),

  // ---- customizable shortcuts + toolbar (TASK 17) ----
  setShortcutOverride: (id, combo) => set(s => {
    const overrides = { ...s.shortcutOverrides }
    if (combo === null) delete overrides[id]
    else overrides[id] = combo
    persistShortcutOverrides(overrides)
    return { shortcutOverrides: overrides }
  }),

  resetShortcutOverrides: () => set(() => {
    try { localStorage.removeItem(SHORTCUTS_KEY) } catch { /* noop */ }
    return { shortcutOverrides: {} }
  }),

  setToolbarLayout: (sections) => set(() => {
    const clean = sections ? sanitizeToolbarLayout(sections) : null
    persistToolbarLayout(clean && clean.length ? clean : null)
    return { toolbarLayout: clean && clean.length ? clean : null }
  }),

  resetToolbarLayout: () => set(() => {
    try { localStorage.removeItem(TOOLBAR_KEY) } catch { /* noop */ }
    return { toolbarLayout: null }
  }),

  // ---- timeline actions (Task 9-c) ----
  setTimelineFrame: (i) => {
    const doc = engine.activeDoc
    const n = doc?.frames?.length ?? 0
    if (!n) return
    const idx = clampNum(Math.round(i), 0, n - 1)
    engine.applyFrameToLayers(idx)
    set({ timelineActiveFrame: idx })
  },

  toggleTimelinePlay: () => {
    const s = get()
    const n = engine.activeDoc?.frames?.length ?? 0
    if (!n) { if (s.timelinePlaying) s.stopTimeline(); return }
    if (s.timelinePlaying) {
      s.stopTimeline()
    } else {
      set({ timelinePlaying: true })
      scheduleTimelineStep()
    }
  },

  timelineNext: () => {
    const s = get()
    const n = engine.activeDoc?.frames?.length ?? 0
    if (!n) return
    s.setTimelineFrame((s.timelineActiveFrame + 1) % n)
    if (s.timelinePlaying) scheduleTimelineStep()
  },

  timelinePrev: () => {
    const s = get()
    const n = engine.activeDoc?.frames?.length ?? 0
    if (!n) return
    s.setTimelineFrame((s.timelineActiveFrame - 1 + n) % n)
    if (s.timelinePlaying) scheduleTimelineStep()
  },

  toggleTimelineLoop: () => set(s => ({ timelineLoop: !s.timelineLoop })),

  stopTimeline: () => {
    clearTimelineTimer()
    set({ timelinePlaying: false })
  },

  syncFromEngine: () => {
    const doc = engine.activeDoc
    const frameCount = doc?.frames?.length ?? 0
    if (!frameCount && get().timelinePlaying) clearTimelineTimer()
    set(s => ({
      docs: engine.docs.map(d => ({ id: d.id, name: d.name, width: d.width, height: d.height, dirty: d.dirty })),
      activeDocId: engine.activeDoc?.id ?? null,
      layers: doc ? doc.layers.slice().reverse().map(l => ({
        id: l.id, name: l.name, kind: l.kind, visible: l.visible, opacity: l.opacity,
        blendMode: l.blendMode, locked: l.locked, clipped: l.clipped,
        hasMask: !!l.mask, maskEnabled: l.maskEnabled,
        hasVectorMask: !!l.vectorMask, vectorMaskEnabled: l.vectorMask?.enabled !== false,
        smartFilterCount: l.smartFilters?.length ?? 0,
        adjustmentType: l.adjustment?.type ?? null, hasBlendIf: !!l.blendIf, hasFx: !!l.fx,
        origin: l.origin ?? null,
        thumbV: l._v + l._mv,
      })) : [],
      activeLayerId: doc?.activeLayerId ?? null,
      selectedLayerIds: doc
        ? ((doc.selectedLayerIds?.filter(id => doc.layers.some(l => l.id === id)).length
            ? doc.selectedLayerIds!.filter(id => doc.layers.some(l => l.id === id))
            : (doc.activeLayerId ? [doc.activeLayerId] : [])))
        : [],
      historyIndex: doc?.history.index ?? -1,
      historyLabels: doc?.history.states.map(h => h.label) ?? [],
      channelView: doc?.channelView ?? 'rgb',
      savedChannels: doc?.savedChannels.map(c => ({ id: c.id, name: c.name })) ?? [],
      hasSelection: !!doc?.selection,
      recording: engine.isRecording,
      actions: engine.actions,
      zoom: doc?.view.zoom ?? 1,
      timelineActiveFrame: frameCount ? clampNum(engine.activeFrameIndex, 0, frameCount - 1) : 0,
      timelineFrames: doc?.frames?.map(f => ({ id: f.id, name: f.name, delayMs: f.delayMs })) ?? [],
      timelinePlaying: frameCount ? s.timelinePlaying : false,
      renderTick: s.renderTick + 1,
    }))
  },
}))

// ---- timeline playback driver (Task 9-c) ---------------------------------
// A setTimeout chain (not setInterval) so each step honors the CURRENT
// frame's delayMs — delay edits take effect mid-play. All timers are module
// level and cleared on stop / doc switch, so nothing leaks.
let _timelineTimer: ReturnType<typeof setTimeout> | null = null

function clearTimelineTimer() {
  if (_timelineTimer !== null) {
    clearTimeout(_timelineTimer)
    _timelineTimer = null
  }
}

function scheduleTimelineStep() {
  clearTimelineTimer()
  const st = useEditorStore.getState()
  if (!st.timelinePlaying) return
  const frames = engine.activeDoc?.frames
  const n = frames?.length ?? 0
  if (!n) { st.stopTimeline(); return }
  const i = clampNum(st.timelineActiveFrame, 0, n - 1)
  const delay = Math.max(20, frames![i]?.delayMs ?? 100)
  _timelineTimer = setTimeout(() => {
    const s2 = useEditorStore.getState()
    const fr = engine.activeDoc?.frames
    const n2 = fr?.length ?? 0
    if (!n2) { s2.stopTimeline(); return }
    if (!s2.timelinePlaying) return
    let next = s2.timelineActiveFrame + 1
    if (next >= n2) {
      if (!s2.timelineLoop) { s2.stopTimeline(); return }
      next = 0
    }
    s2.setTimelineFrame(next)
    scheduleTimelineStep()
  }, delay)
}

/** convenience hook: get tool options for the active tool */
export function useToolOptions(tool: ToolId): Record<string, any> {
  return useEditorStore(s => s.toolOptions[tool]) ?? TOOL_MAP[tool].defaults
}
