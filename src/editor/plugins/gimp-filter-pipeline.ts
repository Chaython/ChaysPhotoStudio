'use client'
// GIMP Filter Pipeline / Macro System
// Allows recording, editing, and replaying sequences of filters
// Similar to GIMP's "Filters > Repeat" and "Filters > Re-Show" but more powerful

export interface FilterStep {
  id: string
  operation: string // GEGL operation name or PDB procedure name
  label: string
  params: Record<string, any>
  enabled: boolean
  input?: string // Reference to previous step output
}

export interface FilterPipeline {
  id: string
  name: string
  description: string
  steps: FilterStep[]
  version: number
  created: number
  modified: number
  author?: string
  tags: string[]
}

export interface PipelineExecutionResult {
  success: boolean
  output?: HTMLCanvasElement
  error?: string
  stepResults: Array<{ stepId: string; success: boolean; output?: HTMLCanvasElement; error?: string }>
}

// Built-in filter pipelines (GIMP-style macro presets)
export const BUILT_IN_PIPELINES: FilterPipeline[] = [
  {
    id: 'pipeline-vintage-photo',
    name: 'Vintage Photo',
    description: 'Creates a vintage/aged photo look with sepia, vignette, and grain',
    version: 1,
    created: Date.now(),
    modified: Date.now(),
    tags: ['artistic', 'vintage', 'photo'],
    steps: [
      { id: '1', operation: 'gegl:colorize', label: 'Sepia Tone', params: { hue: 30, saturation: 40, lightness: -10 }, enabled: true },
      { id: '2', operation: 'gegl:vignette', label: 'Vignette', params: { radius: 0.6, softness: 0.4, amount: -0.4 }, enabled: true },
      { id: '3', operation: 'gegl:noise', label: 'Film Grain', params: { amount: 0.08, type: 'gaussian', monochrome: true }, enabled: true },
      { id: '4', operation: 'gegl:levels', label: 'Fade Contrast', params: { 'input-low': 15, 'input-high': 240, gamma: 1.1 }, enabled: true },
    ],
  },
  {
    id: 'pipeline-high-contrast-bw',
    name: 'High Contrast B&W',
    description: 'Dramatic black and white with crushed blacks and blown highlights',
    version: 1,
    created: Date.now(),
    modified: Date.now(),
    tags: ['artistic', 'bw', 'contrast'],
    steps: [
      { id: '1', operation: 'gegl:desaturate', label: 'Desaturate', params: { mode: 'luminosity' }, enabled: true },
      { id: '2', operation: 'gegl:curves', label: 'S-Curve Contrast', params: { curve: [[0, 0], [64, 40], [128, 128], [192, 216], [255, 255]] }, enabled: true },
      { id: '3', operation: 'gegl:levels', label: 'Crush Blacks', params: { 'input-low': 20, 'output-low': 0 }, enabled: true },
      { id: '4', operation: 'gegl:unsharp-mask', label: 'Sharpen', params: { radius: 2, amount: 1.5, threshold: 2 }, enabled: true },
    ],
  },
  {
    id: 'pipeline-dreamy-portrait',
    name: 'Dreamy Portrait',
    description: 'Soft focus glow for portrait photography',
    version: 1,
    created: Date.now(),
    modified: Date.now(),
    tags: ['portrait', 'soft', 'glow'],
    steps: [
      { id: '1', operation: 'gegl:gaussian-blur', label: 'Soft Blur', params: { 'std-dev-x': 8, 'std-dev-y': 8 }, enabled: true },
      { id: '2', operation: 'gegl:exposure', label: 'Brighten', params: { exposure: 0.3, gamma: 0.9 }, enabled: true },
      { id: '3', operation: 'gegl:vibrance', label: 'Subtle Vibrance', params: { vibrance: 20, saturation: 5 }, enabled: true },
      { id: '4', operation: 'gegl:bloom', label: 'Glow', params: { threshold: 0.7, radius: 30, intensity: 0.5 }, enabled: true },
    ],
  },
  {
    id: 'pipeline-cinematic-teal-orange',
    name: 'Cinematic Teal & Orange',
    description: 'Movie-style color grading with teal shadows and orange highlights',
    version: 1,
    created: Date.now(),
    modified: Date.now(),
    tags: ['cinematic', 'color-grading', 'teal-orange'],
    steps: [
      { id: '1', operation: 'gegl:color-balance', label: 'Shadow Teal', params: { 'shadows-cyan-red': -30, 'shadows-magenta-green': -10, 'shadows-yellow-blue': 40 }, enabled: true },
      { id: '2', operation: 'gegl:color-balance', label: 'Highlight Orange', params: { 'highlights-cyan-red': 40, 'highlights-magenta-green': 20, 'highlights-yellow-blue': -20 }, enabled: true },
      { id: '3', operation: 'gegl:color-balance', label: 'Midtone Balance', params: { 'midtones-cyan-red': 10, 'midtones-yellow-blue': -10 }, enabled: true },
      { id: '4', operation: 'gegl:curves', label: 'Lift Shadows', params: { curve: [[0, 15], [128, 128], [255, 240]] }, enabled: true },
      { id: '5', operation: 'gegl:vibrance', label: 'Color Pop', params: { vibrance: 15, saturation: 10 }, enabled: true },
    ],
  },
  {
    id: 'pipeline-texture-overlay',
    name: 'Paper Texture Overlay',
    description: 'Adds paper/fabric texture using overlay blending',
    version: 1,
    created: Date.now(),
    modified: Date.now(),
    tags: ['texture', 'overlay', 'paper'],
    steps: [
      { id: '1', operation: 'gegl:perlin-noise', label: 'Generate Texture', params: { detail: 0.3, 'x-size': 2, 'y-size': 2, octaves: 4 }, enabled: true },
      { id: '2', operation: 'gegl:desaturate', label: 'Grayscale Texture', params: { mode: 'luminosity' }, enabled: true },
      { id: '3', operation: 'gegl:levels', label: 'Adjust Texture Contrast', params: { 'input-low': 80, 'input-high': 180 }, enabled: true },
    ],
  },
  {
    id: 'pipeline-hdr-tonemap',
    name: 'HDR Tone Mapping (Local)',
    description: 'Local contrast enhancement for HDR-like look',
    version: 1,
    created: Date.now(),
    modified: Date.now(),
    tags: ['hdr', 'tone-mapping', 'local-contrast'],
    steps: [
      { id: '1', operation: 'gegl:bilateral-filter', label: 'Base Layer', params: { 'spatial-radius': 15, 'color-radius': 0.1 }, enabled: true },
      { id: '2', operation: 'gegl:unsharp-mask', label: 'Detail Enhancement', params: { radius: 30, amount: 1.2, threshold: 0 }, enabled: true },
      { id: '3', operation: 'gegl:shadows-highlights', label: 'Recover Details', params: { 'shadows-strength': 40, 'highlights-strength': 30, midtones: 0 }, enabled: true },
      { id: '4', operation: 'gegl:vibrance', label: 'Color Boost', params: { vibrance: 20, saturation: 10 }, enabled: true },
    ],
  },
  {
    id: 'pipeline-ink-sketch',
    name: 'Ink Sketch Effect',
    description: 'Converts photo to ink line drawing',
    version: 1,
    created: Date.now(),
    modified: Date.now(),
    tags: ['artistic', 'sketch', 'ink'],
    steps: [
      { id: '1', operation: 'gegl:desaturate', label: 'Grayscale', params: { mode: 'luminosity' }, enabled: true },
      { id: '2', operation: 'gegl:edge-detect', label: 'Edge Detection', params: { algorithm: 'sobel', amount: 1.0 }, enabled: true },
      { id: '3', operation: 'gegl:invert', label: 'Invert Lines', params: {}, enabled: true },
      { id: '4', operation: 'gegl:levels', label: 'Crush to Pure B&W', params: { 'input-low': 100, 'input-high': 180 }, enabled: true },
      { id: '5', operation: 'gegl:blur', label: 'Soften Lines', params: { 'std-dev-x': 0.5, 'std-dev-y': 0.5 }, enabled: true },
    ],
  },
  {
    id: 'pipeline-watercolor',
    name: 'Watercolor Painting',
    description: 'Simulates watercolor painting with wet edges and granulation',
    version: 1,
    created: Date.now(),
    modified: Date.now(),
    tags: ['artistic', 'watercolor', 'painting'],
    steps: [
      { id: '1', operation: 'gegl:bilateral-filter', label: 'Simplify', params: { 'spatial-radius': 10, 'color-radius': 0.05 }, enabled: true },
      { id: '2', operation: 'gegl:oilify', label: 'Brush Strokes', params: { 'mask-size': 4 }, enabled: true },
      { id: '2', operation: 'gegl:gimpressionist', label: 'Watercolor Texture', params: { brush: 'watercolor', orientation: 'random', 'grid-size': 6, coverage: 1.3 }, enabled: true },
      { id: '3', operation: 'gegl:colorize', label: 'Tint', params: { hue: 220, saturation: 15, lightness: 5 }, enabled: true },
      { id: '4', operation: 'gegl:vignette', label: 'Paper Edge', params: { radius: 0.4, softness: 0.6, amount: -0.2 }, enabled: true },
    ],
  },
]

// Pipeline storage
const PIPELINE_STORAGE_KEY = 'gimp-filter-pipelines'

export function getStoredPipelines(): FilterPipeline[] {
  if (typeof window === 'undefined') return []
  try {
    const data = localStorage.getItem(PIPELINE_STORAGE_KEY)
    if (!data) return []
    const stored = JSON.parse(data)
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

export function savePipeline(pipeline: FilterPipeline): void {
  if (typeof window === 'undefined') return
  try {
    const stored = getStoredPipelines()
    const idx = stored.findIndex(p => p.id === pipeline.id)
    const toSave = { ...pipeline, modified: Date.now() }
    if (idx >= 0) stored[idx] = toSave
    else stored.push(toSave)
    localStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(stored))
  } catch { /* ignore storage errors */ }
}

export function deletePipeline(id: string): void {
  if (typeof window === 'undefined') return
  try {
    const stored = getStoredPipelines().filter(p => p.id !== id)
    localStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(stored))
  } catch { /* ignore storage errors */ }
}

export function getAllPipelines(): FilterPipeline[] {
  return [...BUILT_IN_PIPELINES, ...getStoredPipelines()]
}

export function getPipeline(id: string): FilterPipeline | undefined {
  return getAllPipelines().find(p => p.id === id)
}

// Pipeline execution engine
import { createCanvas, ctx2d } from '../utils/canvas'
import { getGeglOperation, type GeglOperation } from './gegl-ops'
import { runGimpProcedure } from './gimp-host'

export async function executePipeline(
  pipeline: FilterPipeline,
  input: HTMLCanvasElement,
  onProgress?: (step: FilterStep, progress: number) => void
): Promise<PipelineExecutionResult> {
  const stepResults: PipelineExecutionResult['stepResults'] = []
  let currentCanvas = input

  for (let i = 0; i < pipeline.steps.length; i++) {
    const step = pipeline.steps[i]
    if (!step.enabled) {
      stepResults.push({ stepId: step.id, success: true, output: currentCanvas })
      onProgress?.(step, (i + 1) / pipeline.steps.length)
      continue
    }

    try {
      let output: HTMLCanvasElement

      // Try GEGL operation first
      const geglOp = getGeglOperation(step.operation)
      if (geglOp) {
        // Create a GEGL graph with this single operation
        const { GeglGraph } = await import('./gegl-ops')
        const graph = new GeglGraph()
        graph.addNode(step.operation, step.params)
        output = await graph.process(currentCanvas)
      } else {
        // Try GIMP procedural
        const dataUrl = currentCanvas.toDataURL('image/png')
        const result = await runGimpProcedure(step.operation, { image: dataUrl, ...step.params })
        if (result.status === 'success' && result.values[0]?.startsWith('data:image/')) {
          const img = new Image()
          img.src = result.values[0]
          await new Promise(r => img.onload = r)
          output = createCanvas(img.width, img.height)
          ctx2d(output).drawImage(img, 0, 0)
        } else {
          throw new Error(result.error || 'Procedure failed')
        }
      }

      stepResults.push({ stepId: step.id, success: true, output })
      currentCanvas = output
    } catch (error) {
      stepResults.push({ stepId: step.id, success: false, error: String(error) })
      // Continue with original canvas on error
    }

    onProgress?.(step, (i + 1) / pipeline.steps.length)
  }

  return {
    success: stepResults.every(r => r.success),
    output: currentCanvas,
    stepResults,
  }
}

// Pipeline builder UI helpers
export function createPipelineFromSteps(name: string, steps: Omit<FilterStep, 'id'>[]): FilterPipeline {
  return {
    id: 'pipeline-' + Date.now(),
    name,
    description: '',
    steps: steps.map((s, i) => ({ ...s, id: `step-${i + 1}` })),
    version: 1,
    created: Date.now(),
    modified: Date.now(),
    tags: ['custom'],
  }
}

export function clonePipeline(pipeline: FilterPipeline, newName: string): FilterPipeline {
  return {
    ...pipeline,
    id: 'pipeline-' + Date.now(),
    name: newName,
    steps: pipeline.steps.map((s, i) => ({ ...s, id: `step-${i + 1}` })),
    created: Date.now(),
    modified: Date.now(),
  }
}

// Export/Import
export function exportPipeline(pipeline: FilterPipeline): string {
  return JSON.stringify(pipeline, null, 2)
}

export function importPipeline(json: string): FilterPipeline {
  const pipeline = JSON.parse(json)
  // Validate
  if (!pipeline.id || !pipeline.name || !Array.isArray(pipeline.steps)) {
    throw new Error('Invalid pipeline format')
  }
  // Generate new ID to avoid conflicts
  return { ...pipeline, id: 'pipeline-' + Date.now(), created: Date.now(), modified: Date.now() }
}

// Pipeline categories for UI
export const PIPELINE_CATEGORIES = [
  { id: 'artistic', name: 'Artistic', icon: '🎨' },
  { id: 'photo', name: 'Photo Enhancement', icon: '📸' },
  { id: 'portrait', name: 'Portrait', icon: '👤' },
  { id: 'cinematic', name: 'Cinematic', icon: '🎬' },
  { id: 'texture', name: 'Textures', icon: '📐' },
  { id: 'artistic', name: 'Artistic Styles', icon: '🖌️' },
  { id: 'custom', name: 'Custom', icon: '⚙️' },
] as const