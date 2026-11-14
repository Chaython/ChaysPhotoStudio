'use client'
// GIMP Smart Objects
// Non-destructive containers with linked/embedded content, transforms, filters

import { createCanvas, ctx2d } from '../utils/canvas'

export interface SmartObject {
  id: string
  name: string
  type: 'embedded' | 'linked' | 'layer-group'
  source: SmartObjectSource
  transform: SmartTransform
  filters: SmartFilter[]
  opacity: number // 0-100
  blendMode: string
  visible: boolean
  clipped: boolean
  mask?: LayerMask
}

export interface SmartObjectSource {
  type: 'image' | 'vector' | 'raw' | 'document' | 'placeholder'
  data?: HTMLCanvasElement | ImageBitmap | string // canvas, bitmap, or URL
  url?: string // for linked
  width: number
  height: number
  colorSpace: string
  metadata?: Record<string, any>
}

export interface SmartTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number // radians
  skewX: number
  skewY: number
  perspectiveX: number
  perspectiveY: number
  anchorX: number // 0-1
  anchorY: number // 0-1
}

export interface SmartFilter {
  id: string
  type: string
  name: string
  enabled: boolean
  params: Record<string, any>
  mask?: LayerMask
  blendMode: string
  opacity: number // 0-100
}

export interface LayerMask {
  id: string
  canvas: HTMLCanvasElement
  density: number
  feather: number
  invert: boolean
  backgroundColor: string
}

export interface SmartObjectLayer extends SmartObject {
  children?: SmartObjectLayer[] // for layer groups
}

export class SmartObjectManager {
  private objects: Map<string, SmartObjectLayer> = new Map()
  private rootObjects: string[] = []
  private listeners: Set<() => void> = new Set()
  private canvasSize: { width: number; height: number } = { width: 0, height: 0 }

  setCanvasSize(width: number, height: number): void {
    this.canvasSize = { width, height }
  }

  /** Create smart object from image file */
  async createFromFile(file: File, name?: string): Promise<SmartObjectLayer> {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)

    return this.createFromCanvas(canvas, name || file.name.replace(/\.[^.]+$/, ''), 'embedded')
  }

  /** Create smart object from canvas */
  createFromCanvas(canvas: HTMLCanvasElement, name: string, type: 'embedded' | 'linked' = 'embedded'): SmartObjectLayer {
    const id = 'so-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
    const obj: SmartObjectLayer = {
      id,
      name,
      type,
      source: {
        type: 'image',
        data: canvas,
        width: canvas.width,
        height: canvas.height,
        colorSpace: 'sRGB',
      },
      transform: this.getDefaultTransform(canvas.width, canvas.height),
      filters: [],
      opacity: 100,
      blendMode: 'normal',
      visible: true,
      clipped: false,
    }
    this.objects.set(id, obj)
    this.rootObjects.push(id)
    this.notify()
    return obj
  }

  /** Create smart object from URL (linked) */
  async createFromUrl(url: string, name: string): Promise<SmartObjectLayer> {
    const response = await fetch(url)
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)

    const id = 'so-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
    const obj: SmartObjectLayer = {
      id,
      name,
      type: 'linked',
      source: {
        type: 'image',
        data: canvas,
        url,
        width: bitmap.width,
        height: bitmap.height,
        colorSpace: 'sRGB',
      },
      transform: this.getDefaultTransform(bitmap.width, bitmap.height),
      filters: [],
      opacity: 100,
      blendMode: 'normal',
      visible: true,
      clipped: false,
    }
    this.objects.set(id, obj)
    this.rootObjects.push(id)
    this.notify()
    return obj
  }

  /** Create layer group */
  createGroup(name: string): SmartObjectLayer {
    const id = 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
    const group: SmartObjectLayer = {
      id,
      name,
      type: 'layer-group',
      source: { type: 'document', width: this.canvasSize.width, height: this.canvasSize.height, colorSpace: 'sRGB' },
      transform: this.getDefaultTransform(this.canvasSize.width, this.canvasSize.height),
      filters: [],
      opacity: 100,
      blendMode: 'normal',
      visible: true,
      clipped: false,
      children: [],
    }
    this.objects.set(id, group)
    this.rootObjects.push(id)
    this.notify()
    return group
  }

  private getDefaultTransform(width: number, height: number): SmartTransform {
    return {
      x: (this.canvasSize.width - width) / 2,
      y: (this.canvasSize.height - height) / 2,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      skewX: 0,
      skewY: 0,
      perspectiveX: 0,
      perspectiveY: 0,
      anchorX: 0.5,
      anchorY: 0.5,
    }
  }

  getObject(id: string): SmartObjectLayer | undefined {
    return this.objects.get(id)
  }

  getRootObjects(): SmartObjectLayer[] {
    return this.rootObjects.map(id => this.objects.get(id)!).filter(Boolean)
  }

  getAllObjects(): SmartObjectLayer[] {
    const all: SmartObjectLayer[] = []
    const traverse = (obj: SmartObjectLayer) => {
      all.push(obj)
      if (obj.children) {
        for (const child of obj.children) traverse(child)
      }
    }
    for (const id of this.rootObjects) traverse(this.objects.get(id)!)
    return all
  }

  addChild(parentId: string, childId: string): boolean {
    const parent = this.objects.get(parentId)
    const child = this.objects.get(childId)
    if (!parent || !child || parent.type !== 'layer-group') return false
    if (!parent.children) parent.children = []
    parent.children.push(child)
    this.rootObjects = this.rootObjects.filter(id => id !== childId)
    this.notify()
    return true
  }

  removeChild(parentId: string, childId: string): boolean {
    const parent = this.objects.get(parentId)
    if (!parent || !parent.children) return false
    parent.children = parent.children.filter(c => c.id !== childId)
    if (!this.rootObjects.includes(childId)) this.rootObjects.push(childId)
    this.notify()
    return true
  }

  setTransform(id: string, transform: Partial<SmartTransform>): boolean {
    const obj = this.objects.get(id)
    if (!obj) return false
    obj.transform = { ...obj.transform, ...transform }
    this.notify()
    return true
  }

  setOpacity(id: string, opacity: number): boolean {
    const obj = this.objects.get(id)
    if (!obj) return false
    obj.opacity = Math.max(0, Math.min(100, opacity))
    this.notify()
    return true
  }

  setBlendMode(id: string, blendMode: string): boolean {
    const obj = this.objects.get(id)
    if (!obj) return false
    obj.blendMode = blendMode
    this.notify()
    return true
  }

  setVisible(id: string, visible: boolean): boolean {
    const obj = this.objects.get(id)
    if (!obj) return false
    obj.visible = visible
    this.notify()
    return true
  }

  setClipped(id: string, clipped: boolean): boolean {
    const obj = this.objects.get(id)
    if (!obj) return false
    obj.clipped = clipped
    this.notify()
    return true
  }

  /** Add smart filter */
  addFilter(id: string, filter: Omit<SmartFilter, 'id'>): SmartFilter | null {
    const obj = this.objects.get(id)
    if (!obj) return null
    const newFilter: SmartFilter = { ...filter, id: 'sf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9) }
    obj.filters.push(newFilter)
    this.notify()
    return newFilter
  }

  /** Remove smart filter */
  removeFilter(objectId: string, filterId: string): boolean {
    const obj = this.objects.get(objectId)
    if (!obj) return false
    obj.filters = obj.filters.filter(f => f.id !== filterId)
    this.notify()
    return true
  }

  /** Update smart filter */
  updateFilter(objectId: string, filterId: string, params: Record<string, any>): boolean {
    const obj = this.objects.get(objectId)
    if (!obj) return false
    const filter = obj.filters.find(f => f.id === filterId)
    if (!filter) return false
    filter.params = { ...filter.params, ...params }
    this.notify()
    return true
  }

  /** Toggle filter enabled */
  toggleFilter(objectId: string, filterId: string): boolean {
    const obj = this.objects.get(objectId)
    if (!obj) return false
    const filter = obj.filters.find(f => f.id === filterId)
    if (!filter) return false
    filter.enabled = !filter.enabled
    this.notify()
    return true
  }

  /** Reorder filters */
  reorderFilters(objectId: string, filterId: string, newIndex: number): boolean {
    const obj = this.objects.get(objectId)
    if (!obj) return false
    const idx = obj.filters.findIndex(f => f.id === filterId)
    if (idx < 0) return false
    const [filter] = obj.filters.splice(idx, 1)
    obj.filters.splice(Math.max(0, Math.min(newIndex, obj.filters.length)), 0, filter)
    this.notify()
    return true
  }

  /** Render smart object to canvas */
  async renderObject(obj: SmartObjectLayer, parentTransform?: SmartTransform): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(this.canvasSize.width, this.canvasSize.height)
    const ctx = ctx2d(canvas)

    // Apply parent transform
    const transform = parentTransform ? this.combineTransforms(parentTransform, obj.transform) : obj.transform

    if (obj.type === 'layer-group' && obj.children) {
      // Render children
      for (const child of obj.children) {
        const childCanvas = await this.renderObject(child, transform)
        ctx.globalAlpha = obj.opacity / 100
        ctx.globalCompositeOperation = obj.blendMode as GlobalCompositeOperation
        ctx.drawImage(childCanvas, 0, 0)
      }
    } else if (obj.source.data) {
      // Render smart object content
      const contentCanvas = await this.renderSource(obj.source, transform)
      ctx.globalAlpha = obj.opacity / 100
      ctx.globalCompositeOperation = obj.blendMode as GlobalCompositeOperation
      ctx.drawImage(contentCanvas, 0, 0)
    }

    // Apply smart filters
    if (obj.filters.length > 0) {
      const filtered = await this.applySmartFilters(canvas, obj.filters)
      return filtered
    }

    return canvas
  }

  private async renderSource(source: SmartObjectSource, transform: SmartTransform): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(this.canvasSize.width, this.canvasSize.height)
    const ctx = ctx2d(canvas)

    if (source.data instanceof HTMLCanvasElement || source.data instanceof ImageBitmap) {
      ctx.save()
      this.applyTransform(ctx, transform)
      ctx.drawImage(source.data, 0, 0)
      ctx.restore()
    } else if (typeof source.data === 'string') {
      // URL - would load image
      const img = new Image()
      img.src = source.data
      await new Promise(resolve => img.onload = resolve)
      ctx.save()
      this.applyTransform(ctx, transform)
      ctx.drawImage(img, 0, 0)
      ctx.restore()
    }

    return canvas
  }

  private applyTransform(ctx: CanvasRenderingContext2D, t: SmartTransform): void {
    ctx.translate(t.x + t.anchorX * 0, t.y + t.anchorY * 0) // simplified
    ctx.rotate(t.rotation)
    ctx.scale(t.scaleX, t.scaleY)
    ctx.transform(1, t.skewY, t.skewX, 1, 0, 0)
  }

  private combineTransforms(parent: SmartTransform, child: SmartTransform): SmartTransform {
    // Simplified combination
    return {
      x: parent.x + child.x,
      y: parent.y + child.y,
      scaleX: parent.scaleX * child.scaleX,
      scaleY: parent.scaleY * child.scaleY,
      rotation: parent.rotation + child.rotation,
      skewX: parent.skewX + child.skewX,
      skewY: parent.skewY + child.skewY,
      perspectiveX: parent.perspectiveX + child.perspectiveX,
      perspectiveY: parent.perspectiveY + child.perspectiveY,
      anchorX: child.anchorX,
      anchorY: child.anchorY,
    }
  }

  /** Apply smart filters to canvas */
  private async applySmartFilters(canvas: HTMLCanvasElement, filters: SmartFilter[]): Promise<HTMLCanvasElement> {
    let current = canvas

    for (const filter of filters) {
      if (!filter.enabled) continue
      current = await this.applySingleFilter(current, filter)
    }

    return current
  }

  private async applySingleFilter(canvas: HTMLCanvasElement, filter: SmartFilter): Promise<HTMLCanvasElement> {
    // This would apply the actual filter
    // For now, return original
    return canvas
  }

  /** Convert to regular layers (flatten) */
  async flattenObject(id: string): Promise<HTMLCanvasElement> {
    const obj = this.objects.get(id)
    if (!obj) throw new Error('Object not found')
    return this.renderObject(obj)
  }

  /** Convert to linked (externalize) */
  async externalizeObject(id: string, url: string): Promise<boolean> {
    const obj = this.objects.get(id)
    if (!obj || obj.type !== 'embedded') return false

    obj.type = 'linked'
    obj.source.url = url
    obj.source.type = 'image'
    this.notify()
    return true
  }

  /** Embed linked object */
  async embedObject(id: string): Promise<boolean> {
    const obj = this.objects.get(id)
    if (!obj || obj.type !== 'linked') return false

    if (obj.source.url) {
      try {
        const response = await fetch(obj.source.url)
        const blob = await response.blob()
        const bitmap = await createImageBitmap(blob)
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)

        obj.source.data = canvas
        obj.source.type = 'image'
        obj.type = 'embedded'
        delete obj.source.url
        this.notify()
        return true
      } catch {
        return false
      }
    }
    return false
  }

  /** Duplicate smart object */
  duplicateObject(id: string): SmartObjectLayer | null {
    const obj = this.objects.get(id)
    if (!obj) return null

    const newObj = JSON.parse(JSON.stringify(obj))
    newObj.id = 'so-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
    newObj.name = obj.name + ' copy'
    if (obj.children) {
      newObj.children = obj.children.map(child => this.duplicateObject(child.id)!)
    }
    this.objects.set(newObj.id, newObj)
    this.rootObjects.push(newObj.id)
    this.notify()
    return newObj
  }

  deleteObject(id: string): boolean {
    const result = this.objects.delete(id)
    if (result) {
      this.rootObjects = this.rootObjects.filter(o => o !== id)
      // Also remove from parent's children
      for (const obj of this.objects.values()) {
        if (obj.children) {
          obj.children = obj.children.filter(c => c.id !== id)
        }
      }
      this.notify()
    }
    return result
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Smart Filter Presets */
export const SMART_FILTER_PRESETS: Record<string, Omit<SmartFilter, 'id' | 'mask'>> = {
  'gaussian-blur': {
    type: 'gaussian-blur',
    name: 'Gaussian Blur',
    enabled: true,
    params: { radius: 10 },
    blendMode: 'normal',
    opacity: 100,
  },
  'motion-blur': {
    type: 'motion-blur',
    name: 'Motion Blur',
    enabled: true,
    params: { length: 20, angle: 0 },
    blendMode: 'normal',
    opacity: 100,
  },
  'smart-sharpen': {
    type: 'smart-sharpen',
    name: 'Smart Sharpen',
    enabled: true,
    params: { amount: 100, radius: 1, reduceNoise: 0 },
    blendMode: 'normal',
    opacity: 100,
  },
  'camera-raw': {
    type: 'camera-raw',
    name: 'Camera Raw Filter',
    enabled: true,
    params: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, clarity: 0, vibrance: 0, saturation: 0 },
    blendMode: 'normal',
    opacity: 100,
  },
  'oil-paint': {
    type: 'oil-paint',
    name: 'Oil Paint',
    enabled: true,
    params: { radius: 3, cleanliness: 5 },
    blendMode: 'normal',
    opacity: 100,
  },
  'lens-correction': {
    type: 'lens-correction',
    name: 'Lens Correction',
    enabled: true,
    params: { distortion: 0, vignette: 0, chromaticAberration: 0 },
    blendMode: 'normal',
    opacity: 100,
  },
  'noise-reduction': {
    type: 'noise-reduction',
    name: 'Noise Reduction',
    enabled: true,
    params: { strength: 5, preserveDetails: 50, reduceColorNoise: 50, sharpenDetails: 25 },
    blendMode: 'normal',
    opacity: 100,
  },
  'adaptive-wide-angle': {
    type: 'adaptive-wide-angle',
    name: 'Adaptive Wide Angle',
    enabled: true,
    params: { correction: 0.5, focalLength: 35, cropFactor: 1 },
    blendMode: 'normal',
    opacity: 100,
  },
}

/** Convert smart object to regular layers */
export async function rasterizeSmartObject(
  manager: SmartObjectManager,
  id: string
): Promise<HTMLCanvasElement> {
  return manager.flattenObject(id)
}

/** Replace smart object contents */
export async function replaceSmartObjectContents(
  manager: SmartObjectManager,
  id: string,
  newSource: File | HTMLCanvasElement | string
): Promise<boolean> {
  const obj = manager.getObject(id)
  if (!obj) return false

  if (newSource instanceof File) {
    const bitmap = await createImageBitmap(newSource)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    obj.source.data = canvas
    obj.source.width = bitmap.width
    obj.source.height = bitmap.height
  } else if (newSource instanceof HTMLCanvasElement) {
    obj.source.data = newSource
    obj.source.width = newSource.width
    obj.source.height = newSource.height
  } else if (typeof newSource === 'string') {
    const response = await fetch(newSource)
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    obj.source.data = canvas
    obj.source.url = newSource
    obj.source.width = bitmap.width
    obj.source.height = bitmap.height
  } else {
    return false
  }

  obj.transform = {
    x: (manager.getObject(id)!.transform.x),
    y: (manager.getObject(id)!.transform.y),
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    skewX: 0,
    skewY: 0,
    perspectiveX: 0,
    perspectiveY: 0,
    anchorX: 0.5,
    anchorY: 0.5,
  }

  manager.notify()
  return true
}

/** Smart Object Templates */
export const SMART_OBJECT_TEMPLATES: Record<string, Partial<SmartObjectLayer>> = {
  'photo-frame': {
    name: 'Photo Frame',
    type: 'layer-group',
    children: [],
  },
  'collage': {
    name: 'Collage Template',
    type: 'layer-group',
    children: [],
  },
  'mockup': {
    name: 'Mockup Template',
    type: 'layer-group',
    children: [],
  },
}

/** Export smart object as PSD-compatible data */
export function exportSmartObjectToPSD(obj: SmartObjectLayer): any {
  return {
    id: obj.id,
    name: obj.name,
    type: obj.type,
    transform: obj.transform,
    opacity: obj.opacity,
    blendMode: obj.blendMode,
    visible: obj.visible,
    clipped: obj.clipped,
    filters: obj.filters.map(f => ({
      type: f.type,
      name: f.name,
      enabled: f.enabled,
      params: f.params,
      blendMode: f.blendMode,
      opacity: f.opacity,
    })),
    source: {
      type: obj.source.type,
      width: obj.source.width,
      height: obj.source.height,
      colorSpace: obj.source.colorSpace,
      url: obj.source.url,
    },
    children: obj.children?.map(exportSmartObjectToPSD),
  }
}