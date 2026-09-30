import type { BlendMode, ShapeSpec, TextSpec, TransformSpec } from '../types'

export type ParsedLayerKind = 'raster' | 'smart' | 'text' | 'shape'

export interface ParsedDocumentLayer {
  name: string
  kind: ParsedLayerKind
  visible?: boolean
  opacity?: number
  blendMode?: BlendMode | string
  left?: number
  top?: number
  canvas?: HTMLCanvasElement | null
  source?: HTMLCanvasElement | null
  transform?: TransformSpec | null
  text?: Partial<TextSpec> | null
  shape?: Partial<ShapeSpec> | null
  /** Parser-specific metadata kept for diagnostics / future upgrades. */
  metadata?: Record<string, unknown>
}

export interface ParsedDocument {
  width: number
  height: number
  name?: string
  resolutionPpi?: number
  sourceBitDepth?: number
  layers: ParsedDocumentLayer[]
  composite?: HTMLCanvasElement | null
  warnings?: string[]
}
