'use client'
// GIMP Liquify Tool
// Mesh-based warping with tools: warp, reconstruct, smooth, twirl, pinch, bloat, push, freeze, thaw

import { createCanvas, ctx2d } from '../utils/canvas'

export interface LiquifyMesh {
  width: number
  height: number
  spacing: number // grid spacing
  vertices: Float32Array // [x, y, u, v] for each vertex
  originalVertices: Float32Array
}

export interface LiquifyTool {
  type: 'warp' | 'reconstruct' | 'smooth' | 'twirl' | 'pinch' | 'bloat' | 'push' | 'freeze' | 'thaw' | 'face-aware'
  size: number // brush size
  pressure: number // 0-1
  density: number // 0-1
  rate: number // 0-1
  pressureSize: boolean
  pressureDensity: boolean
  pressureRate: boolean
}

export interface LiquifyState {
  mesh: LiquifyMesh
  tool: LiquifyTool
  brushX: number
  brushY: number
  brushPressure: number
  frozenMask: Uint8Array // 0 = frozen, 255 = free
  history: Float32Array[] // for undo
  historyIndex: number
  showMesh: boolean
  showFrozen: boolean
  showBackdrop: boolean
  backdropOpacity: number
}

export interface FaceAwareLiquify {
  eyes: { x: number; y: number; scale: number }[]
  nose: { x: number; y: number; width: number; height: number }
  mouth: { x: number; y: number; width: number; height: number; smile: number }
  face: { x: number; y: number; width: number; height: number }
}

/** Create initial mesh */
export function createLiquifyMesh(
  width: number,
  height: number,
  spacing = 16
): LiquifyMesh {
  const cols = Math.floor(width / spacing) + 1
  const rows = Math.floor(height / spacing) + 1
  const vertexCount = cols * rows

  const vertices = new Float32Array(vertexCount * 4) // x, y, u, v
  const originalVertices = new Float32Array(vertexCount * 4)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = (row * cols + col) * 4
      const x = col * spacing
      const y = row * spacing

      vertices[idx] = x
      vertices[idx + 1] = y
      vertices[idx + 2] = x // u (texture coord)
      vertices[idx + 3] = y // v (texture coord)

      originalVertices[idx] = x
      originalVertices[idx + 1] = y
      originalVertices[idx + 2] = x
      originalVertices[idx + 3] = y
    }
  }

  return {
    width,
    height,
    spacing,
    vertices,
    originalVertices,
  }
}

/** Get vertex index at position */
export function getVertexAt(
  mesh: LiquifyMesh,
  x: number,
  y: number
): number | null {
  const { cols, rows, spacing } = getMeshDimensions(mesh)
  const col = Math.round(x / spacing)
  const row = Math.round(y / spacing)

  if (col < 0 || col >= cols || row < 0 || row >= rows) return null
  return row * mesh.spacing + col
}

function getMeshDimensions(mesh: LiquifyMesh) {
  const cols = Math.floor(mesh.width / mesh.spacing) + 1
  const rows = Math.floor(mesh.height / mesh.spacing) + 1
  return { cols, rows, spacing: mesh.spacing }
}

/** Apply brush deformation to mesh */
export function applyBrushToMesh(
  mesh: LiquifyMesh,
  brushX: number,
  brushY: number,
  tool: LiquifyTool,
  pressure: number,
  frozenMask: Uint8Array
): void {
  const { cols, rows, spacing } = getMeshDimensions(mesh)
  const radius = tool.size
  const radiusSq = radius * radius

  const strength = tool.pressure * pressure * 0.1

  // Determine affected vertices
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = (row * cols + col) * 4
      const vx = mesh.vertices[idx]
      const vy = mesh.vertices[idx + 1]

      const dx = vx - tool.brushX
      const dy = vy - tool.brushY
      const distSq = dx * dx + dy * dy

      if (distSq > radiusSq) continue

      // Check frozen
      const vertexIdx = row * Math.ceil(radius / spacing) + col
      if (frozenMask[vertexIdx] === 0) continue // frozen

      const dist = Math.sqrt(distSq)
      const falloff = 1 - dist / radius
      const pressureFactor = Math.pow(falloff, 2) * strength

      if (pressureFactor <= 0) continue

      const dx = tool.brushX - vx
      const dy = tool.brushY - vy
      const dist = Math.hypot(dx, dy)

      if (dist === 0) continue

      switch (tool.type) {
        case 'warp':
          // Pull vertices toward brush
          mesh.vertices[idx] += (dx / dist) * pressureFactor
          mesh.vertices[idx + 1] += (dy / dist) * pressureFactor
          break

        case 'push':
          // Push vertices perpendicular to brush direction
          const angle = Math.atan2(dy, dx)
          const perpX = Math.cos(angle + Math.PI / 2)
          const perpY = Math.sin(angle + Math.PI / 2)
          mesh.vertices[idx] += perpX * pressureFactor
          mesh.vertices[idx + 1] += perpY * pressureFactor
          break

        case 'twirl':
          // Rotate around brush center
          const twirlAngle = strength * 0.5
          const cos = Math.cos(twirlAngle)
          const sin = Math.sin(twirlAngle)
          const relX = vx - tool.brushX
          const relY = vy - tool.brushY
          mesh.vertices[idx] = tool.brushX + relX * cos - relY * sin
          mesh.vertices[idx + 1] = tool.brushY + relX * sin + relY * cos
          break

        case 'pinch':
          // Pull toward center
          const pinchFactor = 1 - strength * 0.5
          mesh.vertices[idx] = tool.brushX + (vx - tool.brushX) * pinchFactor
          mesh.vertices[idx + 1] = tool.brushY + (vy - tool.brushY) * pinchFactor
          break

        case 'bloat':
          // Push away from center
          const bloatFactor = 1 + strength * 0.5
          mesh.vertices[idx] = tool.brushX + (vx - tool.brushX) * bloatFactor
          mesh.vertices[idx + 1] = tool.brushY + (vy - tool.brushY) * bloatFactor
          break

        case 'push':
          // Push in direction of brush movement
          mesh.vertices[idx] += (dx / dist) * pressureFactor
          mesh.vertices[idx + 1] += (dy / dist) * pressureFactor
          break
      }
    }
  }
}

/** Reconstruct - restore original positions */
export function reconstructMesh(
  mesh: LiquifyMesh,
  brushX: number,
  brushY: number,
  radius: number,
  pressure: number,
  frozenMask: Uint8Array
): void {
  const { cols, rows, spacing } = getMeshDimensions(mesh)
  const radiusSq = radius * radius
  const strength = pressure * 0.5

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = (row * mesh.spacing + col) * 4
      const vx = mesh.vertices[idx]
      const vy = mesh.vertices[idx + 1]

      const dx = vx - brushX
      const dy = vy - brushY
      const distSq = dx * dx + dy * dy

      if (distSq > radius * radius) continue

      const vertexIdx = row * Math.ceil(radius / mesh.spacing) + col
      if (frozenMask[vertexIdx] === 0) continue

      const falloff = 1 - Math.sqrt(distSq) / radius
      const factor = falloff * strength

      // Move back toward original position
      const ox = mesh.originalVertices[idx]
      const oy = mesh.originalVertices[idx + 1]
      mesh.vertices[idx] += (ox - mesh.vertices[idx]) * factor
      mesh.vertices[idx + 1] += (oy - mesh.vertices[idx + 1]) * factor
    }
  }
}

/** Smooth mesh */
export function smoothMesh(
  mesh: LiquifyMesh,
  brushX: number,
  brushY: number,
  radius: number,
  pressure: number,
  frozenMask: Uint8Array
): void {
  const { cols, rows, spacing } = getMeshDimensions(mesh)
  const radiusSq = radius * radius
  const strength = pressure * 0.3

  // Laplacian smoothing
  const newVertices = new Float32Array(mesh.vertices.length)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = (row * mesh.spacing + col) * 4

      if (frozenMask[row * Math.ceil(radius / spacing) + col] === 0) {
        newVertices[idx] = mesh.vertices[idx]
        newVertices[idx + 1] = mesh.vertices[idx + 1]
        continue
      }

      const dx = mesh.vertices[idx] - brushX
      const dy = mesh.vertices[idx + 1] - brushY
      if (dx * dx + dy * dy > radius * radius) {
        newVertices[idx] = mesh.vertices[idx]
        newVertices[idx + 1] = mesh.vertices[idx + 1]
        continue
      }

      // Average neighbors
      let sumX = 0, sumY = 0, count = 0
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const nr = row + dr, nc = col + dc
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            const nIdx = (nr * cols + nc) * 4
            sumX += mesh.vertices[nIdx]
            sumY += mesh.vertices[nIdx + 1]
            count++
          }
        }
      }

      const falloff = 1 - Math.sqrt(
        (mesh.vertices[idx] - brushX) ** 2 + (mesh.vertices[idx + 1] - brushY) ** 2
      ) / radius

      const factor = falloff * strength
      newVertices[idx] = mesh.vertices[idx] + (sumX / count - mesh.vertices[idx]) * factor
      newVertices[idx + 1] = mesh.vertices[idx + 1] + (sumY / count - mesh.vertices[idx + 1]) * factor
    }
  }

  mesh.vertices.set(newVertices)
}

/** Freeze/Thaw mask operations */
export function freezeArea(
  frozenMask: Uint8Array,
  mesh: LiquifyMesh,
  brushX: number,
  brushY: number,
  radius: number
): void {
  const { cols, rows, spacing } = getMeshDimensions(mesh)
  const radiusSq = radius * radius

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = (row * mesh.spacing + col) * 4
      const vx = mesh.vertices[idx]
      const vy = mesh.vertices[idx + 1]

      const dx = vx - brushX
      const dy = vy - brushY
      if (dx * dx + dy * dy <= radius * radius) {
        const idx = row * Math.ceil(radius / spacing) + col
        frozenMask[idx] = 0 // frozen
      }
    }
  }
}

export function thawArea(
  frozenMask: Uint8Array,
  mesh: LiquifyMesh,
  brushX: number,
  brushY: number,
  radius: number
): void {
  const { cols, rows, spacing } = getMeshDimensions(mesh)
  const radiusSq = radius * radius

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = (row * mesh.spacing + col) * 4
      const vx = mesh.vertices[idx]
      const vy = mesh.vertices[idx + 1]

      const dx = vx - brushX
      const dy = vy - brushY
      if (dx * dx + dy * dy <= radius * radius) {
        const idx = row * Math.ceil(radius / spacing) + col
        frozenMask[idx] = 255 // thawed
      }
    }
  }
}

/** Warp image using mesh */
export async function warpWithMesh(
  sourceCanvas: HTMLCanvasElement,
  mesh: LiquifyMesh
): Promise<HTMLCanvasElement> {
  const { width, height } = sourceCanvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  const { cols, rows, spacing } = getMeshDimensions(mesh)

  // Draw each quad
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      // Get 4 corners of quad
      const idx00 = (row * cols + col) * 4
      const idx10 = (row * cols + col + 1) * 4
      const idx01 = ((row + 1) * cols + col) * 4
      const idx11 = ((row + 1) * cols + col + 1) * 4

      const src00 = { x: mesh.originalVertices[idx00], y: mesh.originalVertices[idx00 + 1] }
      const src10 = { x: mesh.originalVertices[idx10], y: mesh.originalVertices[idx10 + 1] }
      const src01 = { x: mesh.originalVertices[idx01], y: mesh.originalVertices[idx01 + 1] }
      const src11 = { x: mesh.originalVertices[idx11], y: mesh.originalVertices[idx11 + 1] }

      const dst00 = { x: mesh.vertices[idx00], y: mesh.vertices[idx00 + 1] }
      const dst10 = { x: mesh.vertices[idx10], y: mesh.vertices[idx10 + 1] }
      const dst01 = { x: mesh.vertices[idx01], y: mesh.vertices[idx01 + 1] }
      const dst11 = { x: mesh.vertices[idx11], y: mesh.vertices[idx11 + 1] }

      // Draw quad using two triangles
      drawTexturedQuad(ctx, sourceCanvas, dst00, dst10, dst01, src00, src10, src01)
      drawTexturedQuad(ctx, sourceCanvas, dst10, dst11, dst01, src10, src11, src01)
    }
  }

  return output
}

function drawTexturedQuad(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  dst0: { x: number; y: number },
  dst1: { x: number; y: number },
  dst2: { x: number; y: number },
  src0: { x: number; y: number },
  src1: { x: number; y: number },
  src2: { x: number; y: number }
): void {
  // Split quad into two triangles
  // Triangle 1: dst0, dst1, dst2
  // Triangle 2: dst1, dst2, dst3 (would need dst3)

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(dst0.x, dst0.y)
  ctx.lineTo(dst1.x, dst1.y)
  ctx.lineTo(dst2.x, dst2.y)
  ctx.closePath()
  ctx.clip()

  // Affine transform for triangle
  // This is simplified - would need proper affine mapping
  ctx.drawImage(source, 0, 0)
  ctx.restore()
}

/** Face-Aware Liquify - Detect facial features and provide high-level controls */
export async function detectFaceFeatures(
  canvas: HTMLCanvasElement
): Promise<FaceAwareLiquify | null> {
  // This would use a face detection model (MediaPipe, etc.)
  // Placeholder returning mock data
  const { width, height } = canvas

  return {
    eyes: [
      { x: width * 0.35, y: height * 0.35, scale: 1 },
      { x: width * 0.65, y: height * 0.35, scale: 1 },
    ],
    nose: { x: width * 0.5, y: height * 0.5, width: 40, height: 60 },
    mouth: { x: width * 0.5, y: height * 0.65, width: 80, height: 30, smile: 0 },
    face: { x: width * 0.25, y: height * 0.2, width: width * 0.5, height: height * 0.6 },
  }
}

export function applyFaceLiquify(
  mesh: LiquifyMesh,
  face: FaceAwareLiquify,
  params: {
    eyeSize: number
    eyeDistance: number
    noseWidth: number
    noseHeight: number
    mouthWidth: number
    mouthHeight: number
    smile: number
    faceWidth: number
    foreheadHeight: number
    jawline: number
  }
): void {
  // Apply high-level face modifications to mesh
  // This would map high-level params to vertex displacements
  // Simplified implementation
}

/** Mesh utilities */
export function saveMeshState(mesh: LiquifyMesh): Float32Array {
  return new Float32Array(mesh.vertices)
}

export function restoreMeshState(mesh: LiquifyMesh, state: Float32Array): void {
  mesh.vertices.set(state)
}

export function resetMesh(mesh: LiquifyMesh): void {
  mesh.vertices.set(mesh.originalVertices)
}

export function getMeshBounds(mesh: LiquifyMesh): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  for (let i = 0; i < mesh.vertices.length; i += 4) {
    const x = mesh.vertices[i]
    const y = mesh.vertices[i + 1]
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  return { minX, minY, maxX, maxY }
}