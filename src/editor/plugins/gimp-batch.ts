'use client'
// GIMP Batch Processing
// Automated processing of multiple files with filter pipelines

import { executePipeline, getAllPipelines, type FilterPipeline } from './gimp-filter-pipeline'
import { extractMetadataFromImage, type ImageMetadata } from './gimp-metadata'
import { convertCanvasColorSpace, listColorSpaces, type ColorSpace } from './gimp-color-management'
import { applyLayerEffects, type LayerEffects } from './gimp-layer-effects'
import { parseBrush, type PatternPreset } from './gimp-brush-import'
import { parsePattern, type GradientPreset } from './gimp-patterns'
import { parsePalette, type PalettePreset } from './gimp-patterns'

export interface BatchJob {
  id: string
  name: string
  files: File[]
  pipeline?: FilterPipeline
  operations: BatchOperation[]
  outputFormat: 'png' | 'jpg' | 'webp' | 'tiff' | 'avif'
  outputQuality: number // 0-100
  outputFolder?: string
  namingPattern: string // e.g. "{name}_{index}.{ext}"
  overwriteExisting: boolean
  createBackup: boolean
}

export interface BatchOperation {
  type: 'pipeline' | 'resize' | 'crop' | 'rotate' | 'color-space' | 'metadata' | 'layer-effects' | 'rename' | 'watermark'
  params: Record<string, any>
  enabled: boolean
}

export interface BatchResult {
  jobId: string
  processed: number
  failed: number
  errors: Array<{ file: string; error: string }>
  outputs: Array<{ original: string; output: string; metadata?: ImageMetadata }>
  startTime: number
  endTime: number
}

export interface BatchProgress {
  jobId: string
  currentFile: string
  currentIndex: number
  totalFiles: number
  percentComplete: number
  currentOperation: string
}

// Default batch operations
export const BUILT_IN_OPERATIONS: BatchOperation[] = [
  {
    type: 'pipeline',
    params: { pipelineId: 'pipeline-vintage-photo' },
    enabled: true,
  },
  {
    type: 'resize',
    params: { width: 1920, height: 1080, maintainAspect: true, method: 'lanczos' },
    enabled: false,
  },
  {
    type: 'crop',
    params: { x: 0, y: 0, width: 1920, height: 1080, anchor: 'center' },
    enabled: false,
  },
  {
    type: 'rotate',
    params: { angle: 0, expand: true },
    enabled: false,
  },
  {
    type: 'color-space',
    params: { sourceSpace: 'sRGB', destSpace: 'AdobeRGB', intent: 'relative' },
    enabled: false,
  },
  {
    type: 'metadata',
    params: { stripExif: true, stripXmp: false, stripIcc: false, addCopyright: 'Chay\'s Photo Studio' },
    enabled: false,
  },
  {
    type: 'layer-effects',
    params: { preset: 'drop-shadow' },
    enabled: false,
  },
  {
    type: 'rename',
    params: { pattern: '{name}_edited_{index}', startIndex: 1 },
    enabled: false,
  },
  {
    type: 'watermark',
    params: { text: '© Chay\'s Photo Studio', position: 'bottom-right', opacity: 50, fontSize: 24 },
    enabled: false,
  },
]

// Batch processor
export class BatchProcessor {
  private jobs: Map<string, BatchJob> = new Map()
  private listeners: Map<string, Set<(progress: BatchProgress) => void>> = new Map()
  private abortControllers: Map<string, AbortController> = new Map()

  addJob(job: BatchJob): void {
    this.jobs.set(job.id, job)
  }

  removeJob(id: string): void {
    this.jobs.delete(id)
  }

  getJob(id: string): BatchJob | undefined {
    return this.jobs.get(id)
  }

  getAllJobs(): BatchJob[] {
    return Array.from(this.jobs.values())
  }

  subscribe(jobId: string, listener: (progress: BatchProgress) => void): () => void {
    if (!this.listeners.has(jobId)) this.listeners.set(jobId, new Set())
    this.listeners.get(jobId)!.add(listener)
    return () => this.listeners.get(jobId)?.delete(listener)
  }

  private notify(jobId: string, progress: BatchProgress): void {
    this.listeners.get(jobId)?.forEach(l => l(progress))
  }

  async processJob(jobId: string): Promise<BatchResult> {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('Job not found')

    const abortController = new AbortController()
    this.abortControllers.set(jobId, abortController)

    const result: BatchResult = {
      jobId,
      processed: 0,
      failed: 0,
      errors: [],
      outputs: [],
      startTime: Date.now(),
      endTime: 0,
    }

    const pipeline = job.pipeline ? getAllPipelines().find(p => p.id === job.pipeline!.id) : undefined

    for (let i = 0; i < job.files.length; i++) {
      if (abortController.signal.aborted) break

      const file = job.files[i]
      this.notify(jobId, {
        jobId,
        currentFile: file.name,
        currentIndex: i + 1,
        totalFiles: job.files.length,
        percentComplete: ((i + 1) / job.files.length) * 100,
        currentOperation: 'Processing',
      })

      try {
        const output = await this.processFile(file, job, pipeline)
        result.outputs.push({ original: file.name, output: output.name, metadata: output.metadata })
        result.processed++
      } catch (error) {
        result.errors.push({ file: file.name, error: String(error) })
        result.failed++
      }
    }

    result.endTime = Date.now()
    this.abortControllers.delete(jobId)
    return result
  }

  private async processFile(
    file: File,
    job: BatchJob,
    pipeline?: FilterPipeline
  ): Promise<{ name: string; blob: Blob; metadata?: any }> {
    const img = await this.loadImage(file)
    let canvas = img.canvas
    let metadata = img.metadata

    // Apply operations in order
    for (const op of job.operations) {
      if (!op.enabled) continue

      switch (op.type) {
        case 'pipeline':
          if (pipeline) {
            const result = await import('./gimp-filter-pipeline').then(m => m.executePipeline(pipeline, canvas))
            if (result.success && result.output) canvas = result.output
            break
          }
          break
        case 'resize':
          canvas = await this.resizeCanvas(canvas, op.params)
          break
        case 'crop':
          canvas = await this.cropCanvas(canvas, op.params)
          break
        case 'rotate':
          canvas = await this.rotateCanvas(canvas, op.params)
          break
        case 'color-space':
          canvas = await convertCanvasColorSpace(
            canvas,
            op.params.sourceSpace as any,
            op.params.destSpace as any,
            op.params.intent as any
          )
          break
        case 'metadata':
          metadata = await this.applyMetadata(canvas, file, op.params)
          break
        case 'layer-effects':
          canvas = await applyLayerEffects(canvas, { ...import('./gimp-layer-effects').then(m => m.LAYER_STYLE_PRESETS[op.params.preset]) })
          break
      }
    }

    // Generate output name
    const outputName = this.generateOutputName(file, job, job.operations.find(o => o.type === 'rename')?.params?.pattern)

    // Export
    const blob = await this.exportCanvas(canvas, job.outputFormat, job.outputQuality)

    return { name: outputName, blob, metadata }
  }

  private async loadImage(file: File): Promise<{ canvas: HTMLCanvasElement; metadata: any }> {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const metadata = await import('./gimp-metadata').then(m => m.extractMetadataFromImage(file))
    return { canvas, metadata }
  }

  private async resizeCanvas(canvas: HTMLCanvasElement, params: any): Promise<HTMLCanvasElement> {
    const { width, height, maintainAspect, method } = params
    const output = document.createElement('canvas')
    output.width = width
    output.height = height
    const ctx = output.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    if (maintainAspect) {
      const scale = Math.min(width / canvas.width, height / canvas.height)
      const newW = canvas.width * scale
      const newH = canvas.height * scale
      ctx.drawImage(canvas, (width - newW) / 2, (height - newH) / 2, newW, newH)
    } else {
      ctx.drawImage(canvas, 0, 0, width, height)
    }
    return output
  }

  private async cropCanvas(canvas: HTMLCanvasElement, params: any): Promise<HTMLCanvasElement> {
    const { x, y, width, height, anchor } = params
    let cropX = x, cropY = y
    if (anchor === 'center') {
      cropX = (canvas.width - width) / 2
      cropY = (canvas.height - height) / 2
    }
    const output = document.createElement('canvas')
    output.width = width
    output.height = height
    const ctx = output.getContext('2d')!
    ctx.drawImage(canvas, cropX, cropY, width, height, 0, 0, width, height)
    return output
  }

  private async rotateCanvas(canvas: HTMLCanvasElement, params: any): Promise<HTMLCanvasElement> {
    const { angle, expand } = params
    const rad = angle * Math.PI / 180
    const output = document.createElement('canvas')
    if (expand) {
      const w = Math.abs(canvas.width * Math.cos(rad)) + Math.abs(canvas.height * Math.sin(rad))
      const h = Math.abs(canvas.width * Math.sin(rad)) + Math.abs(canvas.height * Math.cos(rad))
      output.width = w
      output.height = h
    } else {
      output.width = canvas.width
      output.height = canvas.height
    }
    const ctx = output.getContext('2d')!
    ctx.translate(output.width / 2, output.height / 2)
    ctx.rotate(rad)
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
    return output
  }

  private async applyMetadata(canvas: HTMLCanvasElement, file: File, params: any): Promise<any> {
    // Would add metadata to exported file
    return {}
  }

  private generateOutputName(file: File, job: BatchJob, pattern?: string): string {
    const baseName = file.name.replace(/\.[^.]+$/, '')
    const ext = `.${job.outputFormat}`
    const index = job.outputs?.length || 0
    const patternStr = pattern || '{name}_edited_{index}'
    return patternStr
      .replace('{name}', baseName)
      .replace('{index}', String(index + 1).padStart(3, '0'))
      .replace('{ext}', ext)
      .replace('{date}', new Date().toISOString().slice(0, 10))
      .replace('{time}', new Date().toISOString().slice(11, 19).replace(/:/g, '-'))
  }

  private async exportCanvas(canvas: HTMLCanvasElement, format: string, quality: number): Promise<Blob> {
    return new Promise((resolve) => {
      const mime = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : format === 'avif' ? 'image/avif' : 'image/png'
      canvas.toBlob((blob) => resolve(blob || new Blob()), mime, quality / 100)
    })
  }

  abortJob(jobId: string): void {
    const controller = this.abortControllers.get(jobId)
    if (controller) controller.abort()
  }
}

// Export presets
export const BATCH_PRESETS: Record<string, Partial<BatchJob>> = {
  'web-optimize': {
    name: 'Web Optimize',
    operations: [
      { type: 'resize', params: { width: 1920, height: 1080, maintainAspect: true }, enabled: true },
      { type: 'metadata', params: { stripExif: true, stripXmp: true, stripIcc: false }, enabled: true },
      { type: 'rename', params: { pattern: '{name}_web_{index}' }, enabled: true },
    ],
    outputFormat: 'webp',
    outputQuality: 85,
    namingPattern: '{name}_web_{index}.{ext}',
  },
  'print-prepare': {
    name: 'Print Prepare',
    operations: [
      { type: 'color-space', params: { sourceSpace: 'sRGB', destSpace: 'AdobeRGB', intent: 'relative' }, enabled: true },
      { type: 'metadata', params: { stripExif: false, stripXmp: false, stripIcc: false }, enabled: true },
    ],
    outputFormat: 'tiff',
    outputQuality: 100,
    namingPattern: '{name}_print_{index}.{ext}',
  },
  'social-media': {
    name: 'Social Media',
    operations: [
      { type: 'resize', params: { width: 1080, height: 1080, maintainAspect: true }, enabled: true },
      { type: 'pipeline', params: { pipelineId: 'pipeline-vintage-photo' }, enabled: true },
      { type: 'watermark', params: { text: '@chaysphotostudio', position: 'bottom-right', opacity: 30 }, enabled: true },
    ],
    outputFormat: 'jpg',
    outputQuality: 90,
    namingPattern: '{name}_ig_{index}.{ext}',
  },
  'thumbnail-batch': {
    name: 'Thumbnail Batch',
    operations: [
      { type: 'resize', params: { width: 256, height: 256, maintainAspect: true }, enabled: true },
      { type: 'metadata', params: { stripExif: true, stripXmp: true, stripIcc: true }, enabled: true },
    ],
    outputFormat: 'png',
    outputQuality: 100,
    namingPattern: '{name}_thumb_{index}.{ext}',
  },
}