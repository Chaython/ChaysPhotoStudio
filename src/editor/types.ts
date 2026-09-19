// ============================================================
// Chay's Photo Studio — Core Type System
// Single source of truth shared by engine, tools, panels, dialogs
// ============================================================

export type Vec = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }

// ---------- Blend modes ----------
export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'linear-dodge' | 'hard-light' | 'soft-light'
  | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'

// ---------- Tools ----------
export type ToolId =
  | 'move' | 'marquee-rect' | 'marquee-ellipse' | 'lasso' | 'polygon-lasso' | 'magnetic-lasso'
  | 'object-select' | 'quick-select' | 'magic-wand' | 'crop' | 'eyedropper' | 'measure'
  | 'brush' | 'pencil' | 'clone-stamp' | 'healing-brush' | 'spot-healing' | 'patch'
  | 'eraser' | 'background-eraser' | 'gradient' | 'paint-bucket' | 'blur' | 'sharpen' | 'smudge'
  | 'dodge' | 'burn' | 'sponge' | 'text' | 'shape' | 'pen' | 'hand' | 'zoom'

export type SelectionCombine = 'new' | 'add' | 'subtract' | 'intersect'

// ---------- Customizable toolbar layout (TASK 17) ----------
/** A section of the vertical tool rail: either one standalone (pinned,
 *  top-level) tool button, or a flyout group of tools in order. The full
 *  layout is an ordered array of these; every ToolId appears exactly once. */
export type ToolbarSection =
  | { kind: 'single'; tool: ToolId }
  | { kind: 'group'; tools: ToolId[] }

// ---------- Adjustments & filters ----------
export type AdjustmentType =
  | 'curves' | 'levels' | 'brightness-contrast' | 'exposure' | 'vibrance'
  | 'hue-saturation' | 'color-balance' | 'black-white' | 'photo-filter'
  | 'channel-mixer' | 'selective-color' | 'gradient-map' | 'posterize'
  | 'threshold' | 'invert' | 'camera-raw' | 'shadow-highlight'
  | 'color-lookup' | 'equalize'

export type FilterType =
  | 'gaussian-blur' | 'motion-blur' | 'radial-blur' | 'box-blur' | 'smart-sharpen'
  | 'add-noise' | 'median' | 'dust-scratches' | 'mosaic' | 'crystallize'
  | 'find-edges' | 'emboss' | 'wind' | 'oil-paint' | 'high-pass'
  | 'custom-kernel' | 'minimum' | 'maximum' | 'twirl' | 'wave' | 'spherize'
  | 'clouds' | 'lens-flare' | 'newsprint' | 'vignette' | 'bloom'
  | 'chromatic-aberration'
  | 'diffuse-glow' | 'glass' | 'ocean-ripple' | 'zigzag' | 'pinch'
  | 'displace' | 'fibers' | 'difference-clouds' | 'average' | 'lens-correction' | 'shear'

// Control schemas power the generic dialog renderer + properties panel
export type ControlType = 'slider' | 'number' | 'select' | 'toggle' | 'color' | 'angle' | 'point' | 'gradient' | 'custom'
export interface ControlDef {
  key: string
  label: string
  type: ControlType
  min?: number
  max?: number
  step?: number
  precision?: number
  unit?: string
  options?: { label: string; value: string | number }[]
  customId?: string
  hint?: string
}

export interface AdjustmentDef {
  type: AdjustmentType
  label: string
  controls: ControlDef[]
  defaults: Record<string, any>
  /** mutate ImageData in place */
  apply: (img: ImageData, params: Record<string, any>) => void
  icon?: string
}

export interface FilterDef {
  type: FilterType
  label: string
  group: 'blur' | 'sharpen' | 'noise' | 'pixelate' | 'stylize' | 'distort' | 'render' | 'other'
  controls: ControlDef[]
  defaults: Record<string, any>
  /** mutate ImageData in place */
  apply: (img: ImageData, params: Record<string, any>) => void
}

// ---------- Layers ----------
export type LayerKind = 'raster' | 'smart' | 'adjustment' | 'text' | 'shape'

export interface SmartFilter {
  id: string
  type: FilterType
  params: Record<string, any>
  enabled: boolean
}

export interface TransformSpec {
  x: number       // doc-space anchor (center of placed source)
  y: number
  scale: number
  rotation: number // radians, cw
}

export interface TextSpec {
  content: string
  fontFamily: string
  fontSize: number
  color: string
  bold: boolean
  italic: boolean
  underline?: boolean
  strikethrough?: boolean
  align: 'left' | 'center' | 'right'
  lineHeight: number
  tracking: number
  /** Paragraph text uses an editable bounding box; point text leaves these unset. */
  boxWidth?: number
  boxHeight?: number
  x: number
  y: number
}

export interface ShapeSpec {
  shape: 'rect' | 'rounded-rect' | 'ellipse' | 'triangle' | 'polygon' | 'star' | 'line'
  x: number
  y: number
  w: number
  h: number
  radius: number
  fill: string | null
  fillOpacity?: number
  stroke: string | null
  strokeWidth: number
  strokeOpacity?: number
  lineCap?: CanvasLineCap
  /** Vector stroke pattern retained as editable shape metadata. */
  dash?: 'solid' | 'dashed' | 'dotted'
  /** Photoshop-style line endpoint decorations. */
  arrowStart?: boolean
  arrowEnd?: boolean
  /** polygon/star point count (3–32); ignored by other shapes */
  sides: number
  /** star inner radius as a percentage of the outer radius */
  starInset: number
}

export interface BlendIfSlider { lo: number; loSoft: number; hi: number; hiSoft: number }
export interface BlendIfSettings {
  channel: 'gray' | 'r' | 'g' | 'b'
  thisLayer: BlendIfSlider
  underLayer: BlendIfSlider
}

// ---------- Layer styles (fx) ----------
/** Drop-shadow style (also reused for inner shadow). angle in degrees,
 *  0 = pointing right, grows clockwise (Photoshop convention). */
export interface ShadowFX {
  enabled: boolean
  color: string
  opacity: number       // 0..100
  angle: number         // degrees
  distance: number      // px
  blur: number          // px
}
export interface GlowFX {
  enabled: boolean
  color: string
  opacity: number       // 0..100
  blur: number          // px
}
export interface StrokeFX {
  enabled: boolean
  color: string
  opacity: number       // 0..100
  size: number          // px
  position: 'outside' | 'inside'
}
export interface ColorOverlayFX {
  enabled: boolean
  color: string
  opacity: number       // 0..100
}
/** Non-destructive layer styles — rendered by prepareLayer after the layer
 *  mask (the masked silhouette is the fx shape, Photoshop semantics). */
export interface LayerFX {
  dropShadow?: ShadowFX
  outerGlow?: GlowFX
  innerShadow?: ShadowFX
  stroke?: StrokeFX
  colorOverlay?: ColorOverlayFX
}

export interface Layer {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  opacity: number          // 0..100
  blendMode: BlendMode
  locked: boolean
  clipped: boolean         // clipped to layer(s) below
  /** raster pixels (raster/text/shape cache), canvas-space — top-left sits at
   *  (offsetX, offsetY) in doc space. 0/undefined = canvas IS doc space.
   *  Moving a raster layer only shifts these (non-destructive: pixels that
   *  hang off the canvas are kept, like Photoshop). */
  canvas: HTMLCanvasElement | null
  offsetX?: number
  offsetY?: number
  /** native resolution source for smart layers */
  source: HTMLCanvasElement | null
  transform: TransformSpec | null
  smartFilters: SmartFilter[]
  /** layer mask — white keeps, black hides; mask value stored in alpha channel */
  mask: HTMLCanvasElement | null
  maskEnabled: boolean
  adjustment: { type: AdjustmentType; params: Record<string, any> } | null
  text: TextSpec | null
  shape: ShapeSpec | null
  blendIf: BlendIfSettings | null
  /** non-destructive layer styles (drop shadow / glow / stroke / overlay) */
  fx: LayerFX | null
  /** provenance marker — 'detect' = lifted from an AI-detected object box
   *  (Detect Objects dialog → "Layer"); lets the Layers panel badge it */
  origin?: 'detect'
  /** content version — bump whenever pixels/props affecting render change */
  _v: number
  /** mask version */
  _mv: number
}

// ---------- Selection ----------
export interface SelectionState {
  /** grayscale mask; mask value lives in the alpha channel (255 = selected) */
  mask: HTMLCanvasElement
  bounds: Rect
  _v: number
  _pathsV: number
  _paths: Path2D[] | null
}

// ---------- History ----------
export interface HistoryState {
  label: string
  time: number
  layers: Layer[]
  activeLayerId: string | null
  selection: SelectionState | null
  width: number
  height: number
  channelView: ChannelView
  savedChannels: SavedChannel[]
}

export type ChannelView = 'rgb' | 'r' | 'g' | 'b'

export interface SavedChannel {
  id: string
  name: string
  mask: HTMLCanvasElement
  _v: number
}

// ---------- Guides & rulers ----------
export interface Guide {
  id: string
  orientation: 'h' | 'v'  // 'h' = horizontal line at y = pos; 'v' = vertical line at x = pos
  pos: number             // doc-space position in px
}

// ---------- Document ----------
export interface ViewportState {
  zoom: number; panX: number; panY: number
  /** true/undefined = never explicitly viewed (auto fit on first display);
   *  false = user zoomed/panned/fitted → view is sticky per-document */
  autoFit?: boolean
}

// ---------- Frame Animation ----------
/** One frame of a frame-animation timeline. Each frame stores per-layer
 *  overrides (visibility / opacity / position) that get applied to the real
 *  layers when the frame becomes active. */
export interface AnimFrame {
  id: string
  name: string
  /** frame duration in milliseconds */
  delayMs: number
  /** per-layer overrides for this frame */
  layers: Record<string, { visible?: boolean; opacity?: number; x?: number; y?: number }>
}

export interface PsDocument {
  id: string
  name: string
  width: number
  height: number
  layers: Layer[]            // index 0 = bottom
  activeLayerId: string | null
  selection: SelectionState | null
  channelView: ChannelView
  savedChannels: SavedChannel[]
  view: ViewportState
  history: { states: HistoryState[]; index: number }
  dirty: boolean
  // live preview (dialog driven)
  previewFilter: { layerId: string; type: FilterType; params: Record<string, any> } | null
  previewAdjustment: { type: AdjustmentType; params: Record<string, any> } | null
  /** document guides (rulers) — view-state, not undo-tracked */
  guides: Guide[]
  /** frame animation — absent/empty = static document */
  frames?: AnimFrame[]
  _epoch: number
  _stroke: HTMLCanvasElement | null
  _strokeLayerId: string | null
  _strokeErase: boolean
  _strokeOpacity: number
  /** Photoshop-style painting blend mode applied when the live stroke is
   * previewed and committed. Erasers still force destination-out. */
  _strokeBlendMode: BlendMode
  _strokeBbox: Rect | null
  /** stroke content version — bumped per dab so live preview cache keys stay fresh */
  _strokeV: number
  /** LIVE layer-drag state (move tool): while set, compositeDocument renders a
   *  cached below/stack/above split instead of the full pipeline — the drag
   *  stays 60fps smooth. Built by buildLiveDrag() in engine/document.ts. */
  _liveDrag: LiveLayerDrag | null
}

/** cached split used for interactive layer dragging:
 *  below   = exact composite of layers beneath the dragged layer (static)
 *  stack   = prepared pixels of the dragged layer (mask/smart-filters baked, static)
 *  above   = composite of layers above rendered over transparent (static)
 *  clipMask = for a dragged CLIPPED child: the clip-base's prepared canvas —
 *            a doc-space alpha mask that stays FIXED while the content
 *            translates (the mask is applied at draw time in the live path,
 *            matching what the full pipeline renders on commit) */
export interface LiveLayerDrag {
  layerId: string
  dx: number
  dy: number
  below: HTMLCanvasElement
  stack: HTMLCanvasElement
  /** Document-space origin of stack's local (0,0). Normally 0/0 for a
   *  prepared document-sized stack; raster move drags can point directly at
   *  the full un-clipped layer canvas so off-frame pixels survive re-entry. */
  stackX?: number
  stackY?: number
  above: HTMLCanvasElement
  blendMode: string
  opacity: number
  clipMask?: HTMLCanvasElement | null
  /** live SCALE/ROTATE preview (on-canvas free-transform drag): when set,
   *  `stack` is drawn transformed about the doc-space anchor (ax, ay) —
   *  p → a + R·S·(p − a) — instead of translated by dx/dy (dx/dy stay 0). */
  liveTransform?: { sx: number; sy: number; rotation: number; ax: number; ay: number } | null
}

// ---------- Tool architecture ----------
export interface PointerInfo {
  docX: number
  docY: number
  rawX: number
  rawY: number
  shift: boolean
  alt: boolean
  ctrl: boolean
  meta: boolean
  pressure: number
  /** Stylus tilt in degrees (-90..90); zero for mouse/touch. */
  tiltX: number
  tiltY: number
  /** Barrel rotation in degrees when the device/browser reports it. */
  twist: number
  button: number
  pointerType: string
  isStart: boolean
  isEnd: boolean
}

export interface Tool {
  id: ToolId
  onActivate?(): void
  onDeactivate?(): void
  onPointerDown?(p: PointerInfo): void
  onPointerMove?(p: PointerInfo): void
  onPointerUp?(p: PointerInfo): void
  onDoubleClick?(p: PointerInfo): void
  onKeyDown?(e: KeyboardEvent): boolean | void
  /** called every overlay frame; draw in screen space. mouse = last screen pos or null */
  renderOverlay?(ctx: CanvasRenderingContext2D, view: ViewportState, w: number, h: number, mouse: { x: number; y: number } | null): void
  /** drawn on the always-on-top cursor layer at input rate (brush rings, precise crosshairs) */
  renderCursor?(ctx: CanvasRenderingContext2D, view: ViewportState, w: number, h: number, mouse: { x: number; y: number } | null): void
  /** cursor css */
  cursor?: string
  /** needs an active raster-capable layer */
  requiresLayer?: boolean
}

export interface ToolDef {
  id: ToolId
  label: string
  group: number
  shortcut: string
  icon: string  // lucide icon key
  options: ControlDef[]
  defaults: Record<string, any>
  cursor?: string
  requiresLayer?: boolean
}

// ---------- Dialogs ----------
export type DialogType =
  | 'new-doc' | 'image-size' | 'canvas-size' | 'export' | 'transform'
  | 'curves' | 'levels' | 'brightness-contrast' | 'exposure' | 'vibrance'
  | 'hue-saturation' | 'color-balance' | 'black-white' | 'photo-filter'
  | 'channel-mixer' | 'selective-color' | 'gradient-map' | 'posterize'
  | 'threshold' | 'camera-raw' | 'invert' | 'shadow-highlight'
  | 'gaussian-blur' | 'motion-blur' | 'radial-blur' | 'box-blur' | 'smart-sharpen'
  | 'add-noise' | 'median' | 'dust-scratches' | 'mosaic' | 'crystallize'
  | 'find-edges' | 'emboss' | 'wind' | 'oil-paint' | 'high-pass'
  | 'custom-kernel' | 'minimum' | 'maximum' | 'twirl' | 'wave' | 'spherize'
  | 'clouds' | 'lens-flare' | 'newsprint' | 'vignette' | 'bloom'
  | 'chromatic-aberration'
  | 'color-range' | 'select-mask' | 'content-aware-fill' | 'batch' | 'script-console'
  | 'shortcuts' | 'about' | 'vanishing-point' | 'ai-upscale'
  | 'liquify' | 'content-aware-scale' | 'match-color'
  | 'plugin-manager' | 'ai-generate' | 'ai-tools'
  | 'layer-styles'
  | 'detect-objects'
  | 'customize-toolbar' | 'recovery'

export interface DialogInstance {
  id: string
  type: DialogType
  props?: Record<string, any>
}

// ---------- Actions (automation) ----------
export interface ActionStep {
  op: string
  args: Record<string, any>
  label: string
}
export interface PsAction {
  id: string
  name: string
  steps: ActionStep[]
  created: number
}

// ---------- misc ----------
export interface BrushSettings {
  size: number
  hardness: number      // 0..100
  opacity: number       // 0..100 per stroke
  flow: number          // 0..100 per dab
  spacing: number       // % of size
  color?: string
}

export interface ExportOptions {
  format: 'png' | 'jpeg' | 'webp'
  quality: number       // 0..100
  scale: number
  fileName: string
}
