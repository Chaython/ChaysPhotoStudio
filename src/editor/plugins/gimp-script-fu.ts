'use client'
// Script-Fu (TinyScheme) interpreter for GIMP scripts
// Allows running .scm scripts in the browser via embedded Scheme interpreter

import { evaluateScheme } from './embedded-scheme'

export interface ScriptFuScript {
  name: string
  blurb: string
  help: string
  author: string
  copyright: string
  date: string
  menuPath: string
  type: 'script-fu'
  params: ScriptFuParam[]
}

export interface ScriptFuParam {
  type: 'INT32' | 'FLOAT' | 'STRING' | 'COLOR' | 'TOGGLE' | 'IMAGE' | 'LAYER' | 'CHANNEL' | 'DRAWABLE' | 'FONT' | 'BRUSH' | 'PATTERN' | 'GRADIENT' | 'PALETTE' | 'FILE' | 'DIRNAME'
  name: string
  label: string
  default?: any
  description?: string
}

const scriptRegistry = new Map<string, ScriptFuScript>()

export function registerScriptFu(script: ScriptFuScript) {
  scriptRegistry.set(script.name, script)
}

export function getScriptFu(name: string): ScriptFuScript | undefined {
  return scriptRegistry.get(name)
}

export function listScriptFu(): ScriptFuScript[] {
  return Array.from(scriptRegistry.values()).sort((a, b) => a.name.localeCompare(b.name))
}

// Built-in Script-Fu compatible procedures (Scheme-callable)
const scriptFuProcedures = new Map<string, Function>()

export function registerScriptFuProcedure(name: string, fn: Function) {
  scriptFuProcedures.set(name, fn)
}

export function callScriptFuProcedure(name: string, ...args: any[]): any {
  const fn = scriptFuProcedures.get(name)
  if (!fn) throw new Error(`Script-Fu procedure ${name} not found`)
  return fn(...args)
}

// ============================================================
// Core Script-Fu procedures available to scripts
// ============================================================

// Image procedures
registerScriptFuProcedure('gimp-image-new', (width: number, height: number, type: number) => {
  // Returns image ID
  return { id: Date.now(), width, height, type }
})

registerScriptFuProcedure('gimp-image-width', (image: any) => image?.width ?? 0)
registerScriptFuProcedure('gimp-image-height', (image: any) => image?.height ?? 0)
registerScriptFuProcedure('gimp-image-get-layers', (image: any) => ({ layers: [] }))
registerScriptFuProcedure('gimp-image-get-active-layer', (image: any) => ({ id: 1 }))
registerScriptFuProcedure('gimp-image-undo-group-start', (image: any) => {})
registerScriptFuProcedure('gimp-image-undo-group-end', (image: any) => {})
registerScriptFuProcedure('gimp-image-clean-all', (image: any) => {})

// Layer procedures
registerScriptFuProcedure('gimp-layer-new', (image: any, width: number, height: number, type: number, name: string, opacity: number, mode: number) => {
  return { id: Date.now(), width, height, type, name, opacity, mode }
})

registerScriptFuProcedure('gimp-layer-copy', (layer: any, preserveTransparency: boolean) => {
  return { ...layer, id: Date.now() }
})

registerScriptFuProcedure('gimp-layer-add-alpha', (layer: any) => {})
registerScriptFuProcedure('gimp-layer-set-mode', (layer: any, mode: number) => {})
registerScriptFuProcedure('gimp-layer-set-opacity', (layer: any, opacity: number) => {})
registerScriptFuProcedure('gimp-layer-translate', (layer: any, dx: number, dy: number) => {})
registerScriptFuProcedure('gimp-layer-resize', (layer: any, width: number, height: number, x: number, y: number) => {})
registerScriptFuProcedure('gimp-layer-resize-to-image-size', (layer: any) => {})

// Selection procedures
registerScriptFuProcedure('gimp-selection-none', (image: any) => {})
registerScriptFuProcedure('gimp-selection-all', (image: any) => {})
registerScriptFuProcedure('gimp-selection-invert', (image: any) => {})
registerScriptFuProcedure('gimp-selection-feather', (image: any, radius: number) => {})
registerScriptFuProcedure('gimp-selection-sharpen', (image: any) => {})
registerScriptFuProcedure('gimp-selection-grow', (image: any, amount: number) => {})
registerScriptFuProcedure('gimp-selection-shrink', (image: any, amount: number) => {})
registerScriptFuProcedure('gimp-selection-border', (image: any, width: number) => {})
registerScriptFuProcedure('gimp-selection-load', (channel: any) => {})
registerScriptFuProcedure('gimp-selection-save', (image: any) => ({ id: Date.now() }))

// Drawable procedures
registerScriptFuProcedure('gimp-drawable-width', (drawable: any) => drawable?.width ?? 0)
registerScriptFuProcedure('gimp-drawable-height', (drawable: any) => drawable?.height ?? 0)
registerScriptFuProcedure('gimp-drawable-type', (drawable: any) => drawable?.type ?? 0)
registerScriptFuProcedure('gimp-drawable-is-layer', (drawable: any) => !!drawable?.name)
registerScriptFuProcedure('gimp-drawable-has-alpha', (drawable: any) => true)
registerScriptFuProcedure('gimp-drawable-set-visible', (drawable: any, visible: boolean) => {})
registerScriptFuProcedure('gimp-drawable-set-name', (drawable: any, name: string) => {})
registerScriptFuProcedure('gimp-drawable-fill', (drawable: any, fillType: number) => {})

// Edit procedures
registerScriptFuProcedure('gimp-edit-fill', (drawable: any, fillType: number) => {})
registerScriptFuProcedure('gimp-edit-bucket-fill', (drawable: any, fillType: number, opacity: number, threshold: number, sampleMerged: boolean, x: number, y: number) => {})
registerScriptFuProcedure('gimp-edit-blend', (drawable: any, blendMode: number, paintMode: number, gradientType: number, opacity: number, offset: number, repeat: boolean, reverse: boolean, supersample: boolean, maxDepth: number, threshold: number, dither: boolean, x1: number, y1: number, x2: number, y2: number) => {})

// Filter procedures (PDB)
registerScriptFuProcedure('plug-in-gauss', (image: any, drawable: any, radiusX: number, radiusY: number, method: number) => {})
registerScriptFuProcedure('plug-in-sharpen', (image: any, drawable: any, sharpness: number) => {})
registerScriptFuProcedure('plug-in-noise-hsv', (image: any, drawable: any, hue: number, saturation: number, value: number, holdness: number) => {})
registerScriptFuProcedure('plug-in-oilify', (image: any, drawable: any, maskSize: number) => {})
registerScriptFuProcedure('plug-in-cartoon', (image: any, drawable: any, maskRadius: number, pctBlack: number) => {})

// Color procedures
registerScriptFuProcedure('gimp-brightness-contrast', (drawable: any, brightness: number, contrast: number) => {})
registerScriptFuProcedure('gimp-levels', (drawable: any, channel: number, lowInput: number, highInput: number, gamma: number, lowOutput: number, highOutput: number) => {})
registerScriptFuProcedure('gimp-hue-saturation', (drawable: any, channel: number, hue: number, lightness: number, saturation: number, overlap: number) => {})
registerScriptFuProcedure('gimp-color-balance', (drawable: any, channel: number, preserveLum: boolean, cyanRed: number, magentaGreen: number, yellowBlue: number) => {})
registerScriptFuProcedure('gimp-curves-spline', (drawable: any, channel: number, nPoints: number, points: number[]) => {})
registerScriptFuProcedure('gimp-desaturate', (drawable: any) => {})
registerScriptFuProcedure('gimp-invert', (drawable: any) => {})
registerScriptFuProcedure('gimp-posterize', (drawable: any, levels: number) => {})
registerScriptFuProcedure('gimp-threshold', (drawable: any, low: number, high: number) => {})

// Transform procedures
registerScriptFuProcedure('gimp-item-transform-rotate', (item: any, angle: number, cx: number, cy: number) => {})
registerScriptFuProcedure('gimp-item-transform-scale', (item: any, sx: number, sy: number, cx: number, cy: number) => {})
registerScriptFuProcedure('gimp-item-transform-shear', (item: any, shearX: number, shearY: number, cx: number, cy: number) => {})
registerScriptFuProcedure('gimp-item-transform-perspective', (item: any, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {})
registerScriptFuProcedure('gimp-item-transform-flip', (item: any, direction: number, cx: number, cy: number) => {})
registerScriptFuProcedure('gimp-item-transform-2d', (item: any, matrix: number[]) => {})

// Context procedures
registerScriptFuProcedure('gimp-context-set-foreground', (color: any) => {})
registerScriptFuProcedure('gimp-context-set-background', (color: any) => {})
registerScriptFuProcedure('gimp-context-get-foreground', () => ({ r: 0, g: 0, b: 0 }))
registerScriptFuProcedure('gimp-context-get-background', () => ({ r: 255, g: 255, b: 255 }))
registerScriptFuProcedure('gimp-context-set-brush', (brush: string) => {})
registerScriptFuProcedure('gimp-context-set-pattern', (pattern: string) => {})
registerScriptFuProcedure('gimp-context-set-gradient', (gradient: string) => {})
registerScriptFuProcedure('gimp-context-set-opacity', (opacity: number) => {})
registerScriptFuProcedure('gimp-context-set-paint-mode', (mode: number) => {})

// File procedures
registerScriptFuProcedure('gimp-file-save', (image: any, drawable: any, filename: string, rawFilename: string) => {})
registerScriptFuProcedure('gimp-file-load', (filename: string, rawFilename: string) => ({ id: Date.now() }))

// Display procedures
registerScriptFuProcedure('gimp-display-new', (image: any) => ({ id: Date.now() }))
registerScriptFuProcedure('gimp-displays-flush', () => {})

// ============================================================
// Script runner
// ============================================================

export interface ScriptFuRunResult {
  success: boolean
  result?: any
  error?: string
  output: string
}

export async function runScriptFu(scriptSource: string, params: Record<string, any> = {}): Promise<ScriptFuRunResult> {
  const output: string[] = []
  const originalLog = console.log
  console.log = (...args) => { output.push(args.join(' ')) }

  try {
    // Inject parameters as global variables
    const paramCode = Object.entries(params).map(([k, v]) => `(define ${k} ${JSON.stringify(v)})`).join('\n')
    const fullSource = paramCode + '\n' + scriptSource

    // Evaluate using embedded Scheme interpreter
    const result = evaluateScheme(fullSource)
    console.log = originalLog
    return { success: true, result, output: output.join('\n') }
  } catch (error) {
    console.log = originalLog
    return { success: false, error: String(error), output: output.join('\n') }
  }
}

// ============================================================
// Built-in useful scripts
// ============================================================

// Script-Fu compatible versions of common scripts
const builtInScripts: Record<string, string> = {
  'script-fu-drop-shadow': `
(define (script-fu-drop-shadow image drawable offset-x offset-y blur-radius color opacity)
  (gimp-image-undo-group-start image)
  (let* (
    (shadow (car (gimp-layer-copy drawable TRUE)))
    (width (car (gimp-drawable-width shadow)))
    (height (car (gimp-drawable-height shadow)))
  )
    (gimp-image-add-layer image shadow -1)
    (gimp-layer-translate shadow offset-x offset-y)
    (gimp-layer-set-opacity shadow opacity)
    (plug-in-gauss image shadow blur-radius blur-radius 1)
    (gimp-drawable-set-name shadow "Drop Shadow")
  )
  (gimp-image-undo-group-end image)
  (gimp-displays-flush)
)
(script-fu-register "script-fu-drop-shadow"
  "Drop Shadow"
  "Adds a drop shadow to the selected layer"
  "GIMP"
  "GIMP"
  "2024"
  "<Image>/Filters/Light and Shadow/Drop Shadow"
  SF-IMAGE "Image" 0
  SF-DRAWABLE "Drawable" 0
  SF-ADJUSTMENT "Offset X" '(7 0 1000 1 10 0 0)
  SF-ADJUSTMENT "Offset Y" '(7 0 1000 1 10 0 0)
  SF-ADJUSTMENT "Blur Radius" '(5 0 100 1 10 0 0)
  SF-COLOR "Color" '(0 0 0)
  SF-ADJUSTMENT "Opacity" '(80 0 100 1 10 0 0)
)
`,

  'script-fu-inner-glow': `
(define (script-fu-inner-glow image drawable size color opacity)
  (gimp-image-undo-group-start image)
  (let* (
    (glow (car (gimp-layer-copy drawable TRUE)))
    (width (car (gimp-drawable-width glow)))
    (height (car (gimp-drawable-height glow)))
  )
    (gimp-image-add-layer image glow -1)
    (gimp-layer-set-mode glow 16) ; Dodge
    (gimp-layer-set-opacity glow opacity)
    (plug-in-gauss image glow size size 1)
    (gimp-drawable-set-name glow "Inner Glow")
  )
  (gimp-image-undo-group-end image)
  (gimp-displays-flush)
)
(script-fu-register "script-fu-inner-glow"
  "Inner Glow"
  "Adds an inner glow to the selected layer"
  "GIMP"
  "GIMP"
  "2024"
  "<Image>/Filters/Light and Shadow/Inner Glow"
  SF-IMAGE "Image" 0
  SF-DRAWABLE "Drawable" 0
  SF-ADJUSTMENT "Size" '(5 0 100 1 10 0 0)
  SF-COLOR "Color" '(255 255 255)
  SF-ADJUSTMENT "Opacity" '(75 0 100 1 10 0 0)
)
`,

  'script-fu-bevel-emboss': `
(define (script-fu-bevel-emboss image drawable depth direction size soften highlight-opacity shadow-opacity)
  (gimp-image-undo-group-start image)
  (let* (
    (bevel (car (gimp-layer-copy drawable TRUE)))
    (emboss (car (gimp-layer-copy drawable TRUE)))
  )
    (gimp-image-add-layer image bevel -1)
    (gimp-image-add-layer image emboss -1)
    (gimp-layer-set-mode bevel 16) ; Dodge for highlight
    (gimp-layer-set-mode emboss 17) ; Burn for shadow
    (gimp-layer-set-opacity bevel highlight-opacity)
    (gimp-layer-set-opacity emboss shadow-opacity)
    (plug-in-gauss image bevel soften soften 1)
    (plug-in-gauss image emboss soften soften 1)
    (gimp-layer-translate bevel (- size) (- size))
    (gimp-layer-translate emboss size size)
    (gimp-drawable-set-name bevel "Bevel Highlight")
    (gimp-drawable-set-name emboss "Bevel Shadow")
  )
  (gimp-image-undo-group-end image)
  (gimp-displays-flush)
)
(script-fu-register "script-fu-bevel-emboss"
  "Bevel and Emboss"
  "Adds a bevel and emboss effect"
  "GIMP"
  "GIMP"
  "2024"
  "<Image>/Filters/Decor/Bevel and Emboss"
  SF-IMAGE "Image" 0
  SF-DRAWABLE "Drawable" 0
  SF-ADJUSTMENT "Depth" '(5 0 100 1 10 0 0)
  SF-OPTION "Direction" '("Up" "Down")
  SF-ADJUSTMENT "Size" '(5 0 100 1 10 0 0)
  SF-ADJUSTMENT "Soften" '(0 0 16 1 10 0 0)
  SF-ADJUSTMENT "Highlight Opacity" '(75 0 100 1 10 0 0)
  SF-ADJUSTMENT "Shadow Opacity" '(75 0 100 1 10 0 0)
)
`,

  'script-fu-chrome': `
(define (script-fu-chrome image drawable saturation lightness)
  (gimp-image-undo-group-start image)
  (let* (
    (chrome (car (gimp-layer-copy drawable TRUE)))
  )
    (gimp-image-add-layer image chrome -1)
    (gimp-hue-saturation chrome 0 saturation lightness 0)
    (plug-in-gauss image chrome 2 2 1)
    (gimp-layer-set-mode chrome 16)
    (gimp-drawable-set-name chrome "Chrome")
  )
  (gimp-image-undo-group-end image)
  (gimp-displays-flush)
)
(script-fu-register "script-fu-chrome"
  "Chrome"
  "Adds a chrome effect to the selected layer"
  "GIMP"
  "GIMP"
  "2024"
  "<Image>/Filters/Decor/Chrome"
  SF-IMAGE "Image" 0
  SF-DRAWABLE "Drawable" 0
  SF-ADJUSTMENT "Saturation" '(0 -100 100 1 10 0 0)
  SF-ADJUSTMENT "Lightness" '(0 -100 100 1 10 0 0)
)
`,
}

export function getBuiltInScript(name: string): string | undefined {
  return builtInScripts[name]
}

export function listBuiltInScripts(): string[] {
  return Object.keys(builtInScripts)
}

export async function runBuiltInScript(name: string, params: Record<string, any>): Promise<ScriptFuRunResult> {
  const source = builtInScripts[name]
  if (!source) return { success: false, error: `Built-in script ${name} not found`, output: '' }
  return runScriptFu(source, params)
}

// ============================================================
// Scheme library for common operations
// ============================================================

export const SCHEME_LIBRARY = `
; Common Script-Fu utilities
(define (script-fu-util-layer-copy layer)
  (car (gimp-layer-copy layer TRUE)))

(define (script-fu-util-layer-move layer dx dy)
  (gimp-layer-translate layer dx dy))

(define (script-fu-util-gaussian-blur layer radius)
  (let* ((image (car (gimp-drawable-get-image layer))))
    (plug-in-gauss image layer radius radius 1)))

(define (script-fu-util-set-layer-mode layer mode opacity)
  (gimp-layer-set-mode layer mode)
  (gimp-layer-set-opacity layer opacity))

(define (script-fu-util-create-layer image name type opacity mode)
  (let* ((width (car (gimp-image-width image)))
         (height (car (gimp-image-height image))))
    (car (gimp-layer-new image width height type name opacity mode))))

(define (script-fu-util-selection-bounds image)
  (let* ((bounds (gimp-selection-bounds image)))
    (list (cadr bounds) (caddr bounds) (cadddr bounds) (car (cddddr bounds)))))

(define (script-fu-util-round-rect selection x1 y1 x2 y2 radius)
  (gimp-rect-select selection x1 y1 (- x2 x1) (- y2 y2) 0 0)
  (plug-in-sel2path selection 0)
  (plug-in-path2sel selection 0))
`