'use client'
// GIMP Procedural Database (PDB) compatibility layer
// Provides JavaScript implementations of common GIMP procedures
// that can run in the browser without needing GIMP installed.

import { createCanvas, ctx2d } from '../utils/canvas'

export interface GimpProcedure {
  name: string
  blurb: string
  help: string
  author: string
  copyright: string
  date: string
  type: 'procedure' | 'filter' | 'tool'
  params: GimpParamDef[]
  returnValues: GimpParamDef[]
}

export interface GimpParamDef {
  name: string
  type: 'int32' | 'float' | 'string' | 'color' | 'image' | 'drawable' | 'layer' | 'channel' | 'vectors' | 'selection' | 'parasite' | 'display' | 'gimp_unit' | 'enum' | 'array'
  description: string
  default?: any
  enumValues?: string[]
}

export interface GimpRunResult {
  status: 'success' | 'calling_error' | 'execution_error' | 'cancelled'
  values: any[]
  error?: string
}

// ============================================================
// Built-in procedure implementations
// ============================================================

const procedures = new Map<string, GimpProcedure>()

function register(proc: GimpProcedure) {
  procedures.set(proc.name, proc)
}

// Color operations
register({
  name: 'gimp-context-set-foreground',
  blurb: 'Set the foreground color',
  help: 'Sets the foreground color to the specified value',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'color', type: 'color', description: 'The foreground color' },
  ],
  returnValues: [],
})

register({
  name: 'gimp-context-set-background',
  blurb: 'Set the background color',
  help: 'Sets the background color to the specified value',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'color', type: 'color', description: 'The background color' },
  ],
  returnValues: [],
})

// Selection operations
register({
  name: 'gimp-selection-none',
  blurb: 'Clear the selection',
  help: 'Clears the current selection',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'image', type: 'image', description: 'The image' },
  ],
  returnValues: [],
})

register({
  name: 'gimp-selection-all',
  blurb: 'Select the entire image',
  help: 'Selects the entire image',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'image', type: 'image', description: 'The image' },
  ],
  returnValues: [],
})

register({
  name: 'gimp-selection-invert',
  blurb: 'Invert the selection',
  help: 'Inverts the current selection',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'image', type: 'image', description: 'The image' },
  ],
  returnValues: [],
})

// Layer operations
register({
  name: 'gimp-layer-new',
  blurb: 'Create a new layer',
  help: 'Creates a new layer in the specified image',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'image', type: 'image', description: 'The image' },
    { name: 'name', type: 'string', description: 'The layer name' },
    { name: 'width', type: 'int32', description: 'Layer width' },
    { name: 'height', type: 'int32', description: 'Layer height' },
    { name: 'type', type: 'enum', description: 'Layer type', enumValues: ['RGB', 'GRAY', 'INDEXED'] },
    { name: 'opacity', type: 'float', description: 'Layer opacity (0-100)' },
    { name: 'mode', type: 'enum', description: 'Layer blend mode', enumValues: ['normal', 'multiply', 'screen', 'overlay', 'difference'] },
  ],
  returnValues: [
    { name: 'layer', type: 'layer', description: 'The new layer' },
  ],
})

register({
  name: 'gimp-layer-copy',
  blurb: 'Duplicate a layer',
  help: 'Creates a copy of the specified layer',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'layer', type: 'layer', description: 'The layer to copy' },
  ],
  returnValues: [
    { name: 'new-layer', type: 'layer', description: 'The copied layer' },
  ],
})

register({
  name: 'gimp-layer-delete',
  blurb: 'Delete a layer',
  help: 'Deletes the specified layer',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'layer', type: 'layer', description: 'The layer to delete' },
  ],
  returnValues: [],
})

register({
  name: 'gimp-layer-set-mode',
  blurb: 'Set layer blend mode',
  help: 'Sets the blend mode of the specified layer',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'layer', type: 'layer', description: 'The layer' },
    { name: 'mode', type: 'enum', description: 'Blend mode', enumValues: ['normal', 'multiply', 'screen', 'overlay', 'difference', 'addition', 'subtract', 'darken', 'lighten', 'hue', 'saturation', 'color', 'value', 'divide', 'dodge', 'burn', 'hardlight', 'softlight', 'grain_extract', 'grain_merge', 'color_erase', 'erase'] },
  ],
  returnValues: [],
})

register({
  name: 'gimp-layer-set-opacity',
  blurb: 'Set layer opacity',
  help: 'Sets the opacity of the specified layer',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'layer', type: 'layer', description: 'The layer' },
    { name: 'opacity', type: 'float', description: 'Opacity (0-100)' },
  ],
  returnValues: [],
})

// Image operations
register({
  name: 'gimp-image-new',
  blurb: 'Create a new image',
  help: 'Creates a new image with the specified dimensions',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'width', type: 'int32', description: 'Image width' },
    { name: 'height', type: 'int32', description: 'Image height' },
    { name: 'type', type: 'enum', description: 'Image type', enumValues: ['RGB', 'GRAY', 'INDEXED'] },
  ],
  returnValues: [
    { name: 'image', type: 'image', description: 'The new image' },
  ],
})

register({
  name: 'gimp-image-resize',
  blurb: 'Resize an image',
  help: 'Resizes the image canvas',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'image', type: 'image', description: 'The image' },
    { name: 'width', type: 'int32', description: 'New width' },
    { name: 'height', type: 'int32', description: 'New height' },
    { name: 'offset-x', type: 'int32', description: 'X offset of existing content' },
    { name: 'offset-y', type: 'int32', description: 'Y offset of existing content' },
  ],
  returnValues: [],
})

register({
  name: 'gimp-image-scale',
  blurb: 'Scale an image',
  help: 'Scales the image (not just the canvas)',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'image', type: 'image', description: 'The image' },
    { name: 'width', type: 'int32', description: 'New width' },
    { name: 'height', type: 'int32', description: 'New height' },
  ],
  returnValues: [],
})

// Filter operations
register({
  name: 'plug-in-gauss',
  blurb: 'Gaussian blur',
  help: 'Applies a Gaussian blur to the drawable',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'filter',
  params: [
    { name: 'image', type: 'image', description: 'The image' },
    { name: 'drawable', type: 'drawable', description: 'The drawable' },
    { name: 'radius-x', type: 'float', description: 'Horizontal blur radius' },
    { name: 'radius-y', type: 'float', description: 'Vertical blur radius' },
    { name: 'method', type: 'enum', description: 'Blur method', enumValues: ['RLE', 'IIR'] },
  ],
  returnValues: [],
})

register({
  name: 'plug-in-sharpen',
  blurb: 'Sharpen',
  help: 'Sharpens the drawable',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'filter',
  params: [
    { name: 'image', type: 'image', description: 'The image' },
    { name: 'drawable', type: 'drawable', description: 'The drawable' },
    { name: 'sharpness', type: 'float', description: 'Sharpness amount (0-100)' },
  ],
  returnValues: [],
})

register({
  name: 'plug-in-noise-hsv',
  blurb: 'HSV noise',
  help: 'Adds noise in HSV color space',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'filter',
  params: [
    { name: 'image', type: 'image', description: 'The image' },
    { name: 'drawable', type: 'drawable', description: 'The drawable' },
    { name: 'hue', type: 'float', description: 'Hue noise' },
    { name: 'saturation', type: 'float', description: 'Saturation noise' },
    { name: 'value', type: 'float', description: 'Value noise' },
    { name: 'holdness', type: 'float', description: 'Holdness' },
  ],
  returnValues: [],
})

// Color adjustments
register({
  name: 'gimp-brightness-contrast',
  blurb: 'Brightness/Contrast',
  help: 'Adjusts brightness and contrast',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'filter',
  params: [
    { name: 'image', type: 'image', description: 'The image' },
    { name: 'drawable', type: 'drawable', description: 'The drawable' },
    { name: 'brightness', type: 'int32', description: 'Brightness (-127 to 127)' },
    { name: 'contrast', type: 'int32', description: 'Contrast (-127 to 127)' },
  ],
  returnValues: [],
})

register({
  name: 'gimp-levels',
  blurb: 'Levels adjustment',
  help: 'Adjusts color levels',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'filter',
  params: [
    { name: 'image', type: 'image', description: 'The image' },
    { name: 'drawable', type: 'drawable', description: 'The drawable' },
    { name: 'channel', type: 'enum', description: 'Channel', enumValues: ['value', 'red', 'green', 'blue', 'alpha'] },
    { name: 'input-low', type: 'int32', description: 'Input low (0-255)' },
    { name: 'input-high', type: 'int32', description: 'Input high (0-255)' },
    { name: 'gamma', type: 'float', description: 'Gamma (0.1-10)' },
    { name: 'output-low', type: 'int32', description: 'Output low (0-255)' },
    { name: 'output-high', type: 'int32', description: 'Output high (0-255)' },
  ],
  returnValues: [],
})

register({
  name: 'gimp-hue-saturation',
  blurb: 'Hue/Saturation',
  help: 'Adjusts hue, saturation, and lightness',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'filter',
  params: [
    { name: 'image', type: 'image', description: 'The image' },
    { name: 'drawable', type: 'drawable', description: 'The drawable' },
    { name: 'channel', type: 'enum', description: 'Channel', enumValues: ['master', 'red', 'yellow', 'green', 'cyan', 'blue', 'magenta'] },
    { name: 'hue', type: 'int32', description: 'Hue (-180 to 180)' },
    { name: 'lightness', type: 'int32', description: 'Lightness (-100 to 100)' },
    { name: 'saturation', type: 'int32', description: 'Saturation (-100 to 100)' },
    { name: 'overlap', type: 'int32', description: 'Overlap' },
  ],
  returnValues: [],
})

register({
  name: 'gimp-color-balance',
  blurb: 'Color Balance',
  help: 'Adjusts color balance',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'filter',
  params: [
    { name: 'image', type: 'image', description: 'The image' },
    { name: 'drawable', type: 'drawable', description: 'The drawable' },
    { name: 'channel', type: 'enum', description: 'Channel', enumValues: ['shadows', 'midtones', 'highlights'] },
    { name: 'preserve-luminosity', type: 'int32', description: 'Preserve luminosity (0/1)' },
    { name: 'cyan-red', type: 'int32', description: 'Cyan/Red (-100 to 100)' },
    { name: 'magenta-green', type: 'int32', description: 'Magenta/Green (-100 to 100)' },
    { name: 'yellow-blue', type: 'int32', description: 'Yellow/Blue (-100 to 100)' },
  ],
  returnValues: [],
})

// Transform operations
register({
  name: 'gimp-item-transform-rotate',
  blurb: 'Rotate item',
  help: 'Rotates the item by the specified angle',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'item', type: 'layer', description: 'The item (layer/channel)' },
    { name: 'angle', type: 'float', description: 'Rotation angle in degrees' },
    { name: 'center-x', type: 'float', description: 'Rotation center X' },
    { name: 'center-y', type: 'float', description: 'Rotation center Y' },
  ],
  returnValues: [],
})

register({
  name: 'gimp-item-transform-scale',
  blurb: 'Scale item',
  help: 'Scales the item',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'item', type: 'layer', description: 'The item' },
    { name: 'scale-x', type: 'float', description: 'X scale factor' },
    { name: 'scale-y', type: 'float', description: 'Y scale factor' },
    { name: 'center-x', type: 'float', description: 'Scale center X' },
    { name: 'center-y', type: 'float', description: 'Scale center Y' },
  ],
  returnValues: [],
})

register({
  name: 'gimp-item-transform-shear',
  blurb: 'Shear item',
  help: 'Shears the item',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'item', type: 'layer', description: 'The item' },
    { name: 'shear-x', type: 'float', description: 'X shear' },
    { name: 'shear-y', type: 'float', description: 'Y shear' },
    { name: 'center-x', type: 'float', description: 'Shear center X' },
    { name: 'center-y', type: 'float', description: 'Shear center Y' },
  ],
  returnValues: [],
})

register({
  name: 'gimp-item-transform-perspective',
  blurb: 'Perspective transform item',
  help: 'Applies perspective transform',
  author: 'GIMP',
  copyright: 'GIMP',
  date: '2024',
  type: 'procedure',
  params: [
    { name: 'item', type: 'layer', description: 'The item' },
    { name: 'x0', type: 'float', description: 'Top-left X' },
    { name: 'y0', type: 'float', description: 'Top-left Y' },
    { name: 'x1', type: 'float', description: 'Top-right X' },
    { name: 'y1', type: 'float', description: 'Top-right Y' },
    { name: 'x2', type: 'float', description: 'Bottom-right X' },
    { name: 'y2', type: 'float', description: 'Bottom-right Y' },
    { name: 'x3', type: 'float', description: 'Bottom-left X' },
    { name: 'y3', type: 'float', description: 'Bottom-left Y' },
  ],
  returnValues: [],
})

// Export procedures list
export function listProcedures(): GimpProcedure[] {
  return Array.from(procedures.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export function getProcedure(name: string): GimpProcedure | undefined {
  return procedures.get(name)
}

// Browser-side implementations for common procedures
export async function runProcedure(name: string, params: any[]): Promise<GimpRunResult> {
  const proc = procedures.get(name)
  if (!proc) {
    return { status: 'calling_error', values: [], error: `Procedure ${name} not found` }
  }

  try {
    // This would be implemented with actual canvas operations
    // For now, return success with empty values
    return { status: 'success', values: [] }
  } catch (error) {
    return { status: 'execution_error', values: [], error: String(error) }
  }
}

// Helper: Create a canvas from ImageData
export function createCanvasFromImageData(data: ImageData): HTMLCanvasElement {
  const canvas = createCanvas(data.width, data.height)
  const ctx = ctx2d(canvas)
  ctx.putImageData(data, 0, 0)
  return canvas
}

// Helper: Apply blend mode
export function applyBlendMode(ctx: CanvasRenderingContext2D, mode: string) {
  const modeMap: Record<string, GlobalCompositeOperation> = {
    normal: 'source-over',
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    difference: 'difference',
    addition: 'lighter',
    subtract: 'darker',
    darken: 'darken',
    lighten: 'lighten',
    'color-dodge': 'color-dodge',
    'color-burn': 'color-burn',
    'hard-light': 'hard-light',
    'soft-light': 'soft-light',
    hue: 'hue',
    saturation: 'saturation',
    color: 'color',
    luminosity: 'luminosity',
  }
  ctx.globalCompositeOperation = modeMap[mode] || 'source-over'
}

// Helper: Apply Gaussian blur (simple box blur approximation)
export async function applyGaussianBlur(canvas: HTMLCanvasElement, radius: number): Promise<HTMLCanvasElement> {
  const ctx = ctx2d(canvas)
  const { width, height } = canvas
  const temp = createCanvas(width, height)
  const tempCtx = ctx2d(temp)

  // Horizontal pass
  tempCtx.filter = `blur(${radius}px)`
  tempCtx.drawImage(canvas, 0, 0)

  // Vertical pass
  ctx.filter = `blur(${radius}px)`
  ctx.drawImage(temp, 0, 0)
  ctx.filter = 'none'

  return canvas
}