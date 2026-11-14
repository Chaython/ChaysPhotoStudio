'use client'
// GIMP Lighting Effects
// 3D lighting simulation with multiple light types, materials, and bump mapping

import { createCanvas, ctx2d } from '../utils/canvas'

export interface LightSource {
  id: string
  type: 'point' | 'directional' | 'spot' | 'area' | 'ambient' | 'hemisphere'
  position: { x: number; y: number; z: number } // 3D position
  target: { x: number; y: number; z: number } // for spot/directional
  color: string
  intensity: number // 0-100
  attenuation: {
    constant: number
    linear: number
    quadratic: number
  }
  // Spot light specific
  angle: number // degrees
  penumbra: number // 0-1
  decay: number
  // Area light
  width?: number
  height?: number
  // Shadows
  castShadow: boolean
  shadowMapSize: number
  shadowBias: number
  shadowRadius: number
  // Light properties
  temperature: number // Kelvin
  iesProfile?: string // IES file path
  goboTexture?: HTMLCanvasElement // Cookie texture
  enabled: boolean
}

export interface MaterialProperties {
  diffuse: string // base color
  specular: string
  shininess: number // 0-1000
  roughness: number // 0-1
  metallic: number // 0-1
  ambient: string
  emissive: string
  emissiveIntensity: number
  opacity: number
  refractiveIndex: number
  clearcoat: number
  clearcoatRoughness: number
  anisotropy: number
  anisotropyRotation: number
  sheen: string
  sheenRoughness: number
  transmission: number
  thickness: number
  ior: number
  dispersion: number
}

export interface BumpMapSettings {
  enabled: boolean
  texture: HTMLCanvasElement
  scale: number
  strength: number
  type: 'bump' | 'normal' | 'displacement'
  invertY: boolean
}

export interface LightingOptions {
  /** Light sources */
  lights: LightSource[]
  /** Material properties */
  material: MaterialProperties
  /** Bump/normal map */
  bumpMap: BumpMapSettings
  /** Environment */
  environment: {
    enabled: boolean
    texture: HTMLCanvasElement
    intensity: number
    rotation: number
    blur: number
  }
  /** Ambient occlusion */
  ambientOcclusion: {
    enabled: boolean
    radius: number
    intensity: number
    samples: number
  }
  /** Global settings */
  exposure: number
  gamma: number
  toneMapping: 'none' | 'reinhard' | 'filmic' | 'aces' | 'linear'
  colorGrading: {
    exposure: number
    contrast: number
    saturation: number
    temperature: number
    tint: number
  }
  /** Quality */
  quality: 'draft' | 'normal' | 'high' | 'ultra'
  samples: number
  denoise: boolean
}

export interface LightingResult {
  canvas: HTMLCanvasElement
  lightPasses: {
    diffuse: HTMLCanvasElement
    specular: HTMLCanvasElement
    shadow: HTMLCanvasElement
    ao: HTMLCanvasElement
    emission: HTMLCanvasElement
  }
  depthMap: HTMLCanvasElement
  normalMap: HTMLCanvasElement
}

/** Main lighting effects function */
export async function applyLightingEffects(
  canvas: HTMLCanvasElement,
  options: LightingOptions
): Promise<LightingResult> {
  const { width, height } = canvas
  const { lights, material, bumpMap, environment, ambientOcclusion, exposure, gamma, toneMapping, colorGrading, quality, samples, denoise } = options

  // Create render targets
  const albedoCanvas = createCanvas(width, height)
  const normalCanvas = createCanvas(width, height)
  const depthCanvas = createCanvas(width, height)
  const roughCanvas = createCanvas(width, height)
  const metalCanvas = createCanvas(width, height)
  const aoCanvas = createCanvas(width, height)
  const shadowCanvas = createCanvas(width, height)
  const emissionCanvas = createCanvas(width, height)

  // 1. Generate G-buffer (geometry buffer)
  await generateGBuffer(canvas, {
    albedoCanvas,
    normalCanvas,
    depthCanvas,
    roughCanvas,
    metalCanvas,
    material,
    bumpMap,
  })

  // 2. Calculate ambient occlusion
  let aoMap = aoCanvas
  if (ambientOcclusion.enabled) {
    aoMap = await calculateAmbientOcclusion(depthCanvas, normalCanvas, ambientOcclusion)
  }

  // 6. Render shadows
  let shadowMap = shadowCanvas
  const shadowCasters = options.lights.filter(l => l.castShadow)
  if (shadowCasters.length > 0) {
    shadowMap = await renderShadows(depthCanvas, normalCanvas, shadowCasters)
  }

  // 7. Lighting pass
  const { diffuse, specular, emission } = await renderLighting(
    albedoCanvas,
    normalCanvas,
    depthCanvas,
    roughCanvas,
    metalCanvas,
    aoMap,
    shadowMap,
    options.lights,
    options.material
  )

  // 7. Composite all passes
  const composite = await compositeLightingPasses({
    diffuse,
    specular,
    shadow: shadowMap,
    ao: aoMap,
    emission: emissionCanvas,
    albedo: albedoCanvas,
    exposure,
    gamma,
    toneMapping,
    colorGrading,
  })

  // 8. Post-processing
  let result = composite
  if (denoise) {
    result = await denoiseImage(composite)
  }

  return {
    canvas: result,
    lightPasses: { diffuse, specular, shadow: shadowMap, ao: aoMap, emission: emissionCanvas },
    depthMap: depthCanvas,
    normalMap: normalCanvas,
  }
}

/** Generate G-Buffer from source image */
async function generateGBuffer(
  canvas: HTMLCanvasElement,
  targets: {
    albedoCanvas: HTMLCanvasElement
    normalCanvas: HTMLCanvasElement
    depthCanvas: HTMLCanvasElement
    roughCanvas: HTMLCanvasElement
    metalCanvas: HTMLCanvasElement
    material: MaterialProperties
    bumpMap: BumpMapSettings
  }
): Promise<void> {
  const { albedoCanvas, normalCanvas, depthCanvas, roughCanvas, metalCanvas, material, bumpMap } = targets
  const { width, height } = canvas

  // Albedo - base color
  const albedoCtx = ctx2d(albedoCanvas)
  albedoCtx.drawImage(canvas, 0, 0)
  // Apply material diffuse color
  albedoCtx.globalCompositeOperation = 'multiply'
  albedoCtx.fillStyle = material.diffuse
  albedoCtx.fillRect(0, 0, width, height)
  albedoCtx.globalCompositeOperation = 'source-over'

  // Normal map from bump map
  if (bumpMap.enabled && bumpMap.texture) {
    await generateNormalMap(bumpMap.texture, normalCanvas, bumpMap.strength, bumpMap.scale, bumpMap.type)
  } else {
    // Flat normal
    const normalCtx = ctx2d(normalCanvas)
    const imgData = normalCtx.createImageData(width, height)
    const data = imgData.data
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128    // X = 0
      data[i + 1] = 128 // Y = 0
      data[i + 2] = 255 // Z = 1 (pointing up)
      data[i + 3] = 255
    }
    normalCtx.putImageData(imgData, 0, 0)
  }

  // Depth from image luminance (approximate)
  const depthCtx = ctx2d(depthCanvas)
  const srcCtx = canvas.getContext('2d')!
  const srcData = srcCtx.getImageData(0, 0, width, height).data
  const depthData = depthCtx.createImageData(width, height)
  const depthDataArr = depthData.data

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    const depth = 1 - lum / 255 // Brighter = closer
    const val = Math.round(depth * 255)
    const idx = (i / 4) * 4
    depthDataArr[idx] = depthDataArr[idx + 1] = depthDataArr[idx + 2] = Math.round(clamp(val, 0, 255))
    depthDataArr[idx + 3] = 255
  }
  depthCtx.putImageData(depthData, 0, 0)

  // Roughness map
  const roughCtx = ctx2d(roughCanvas)
  const roughValue = Math.round(clamp((1 - material.roughness) * 255, 0, 255))
  roughCtx.fillStyle = `rgb(${roughValue},${roughValue},${roughValue})`
  roughCtx.fillRect(0, 0, width, height)

  // Metallic map
  const metalCtx = ctx2d(metalCanvas)
  const metalValue = Math.round(clamp(material.metallic * 255, 0, 255))
  metalCtx.fillStyle = `rgb(${metalValue},${metalValue},${metalValue})`
  metalCtx.fillRect(0, 0, width, height)
}

/** Generate normal map from height/bump map */
async function generateNormalMap(
  heightMap: HTMLCanvasElement,
  outputCanvas: HTMLCanvasElement,
  strength: number,
  scale: number,
  type: 'bump' | 'normal' | 'displacement'
): Promise<void> {
  const { width, height } = heightMap
  const ctx = heightMap.getContext('2d')!
  const srcData = ctx.getImageData(0, 0, width, height).data

  const outputCtx = ctx2d(outputCanvas)
  const outputData = outputCtx.createImageData(width, height)
  const outData = outputData.data

  const strengthFactor = strength / 100
  const scaleFactor = scale / 100

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      // Sobel operator for derivatives
      const idx = (y * width + x) * 4
      const idxL = (y * width + x - 1) * 4
      const idxR = (y * width + x + 1) * 4
      const idxT = ((y - 1) * width + x) * 4
      const idxB = ((y + 1) * width + x) * 4

      const hL = (srcData[idxL] + srcData[idxL + 1] + srcData[idxL + 2]) / 3 / 255
      const hR = (srcData[idxR] + srcData[idxR + 1] + srcData[idxR + 2]) / 3 / 255
      const hT = (srcData[idxT] + srcData[idxT + 1] + srcData[idxT + 2]) / 3 / 255
      const hB = (srcData[idxB] + srcData[idxB + 1] + srcData[idxB + 2]) / 3 / 255

      const dx = (hR - hL) * strengthFactor
      const dy = (hB - hT) * strengthFactor

      // Normal vector
      const nx = -dx
      const ny = -dy
      const nz = 1 / scaleFactor

      const len = Math.sqrt(nx * nx + ny * ny + 1)
      const nx_n = nx / len
      const ny_n = ny / len
      const nz_n = 1 / len

      const idx = (y * width + x) * 4
      outputData[idx] = Math.round((nx_n * 0.5 + 0.5) * 255)
      outputData[idx + 1] = Math.round((ny_n * 0.5 + 0.5) * 255)
      outputData[idx + 2] = Math.round((nz_n * 0.5 + 0.5) * 255)
      outputData[idx + 3] = 255
    }

    outputCtx.putImageData(outputData, 0, 0)
  }
}

/** Calculate ambient occlusion */
async function calculateAmbientOcclusion(
  depthCanvas: HTMLCanvasElement,
  normalCanvas: HTMLCanvasElement,
  ao: LightingOptions['ambientOcclusion']
): Promise<HTMLCanvasElement> {
  const { width, height } = depthCanvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Simplified SSAO
  const depthCtx = depthCanvas.getContext('2d')!
  const normalCtx = normalCanvas.getContext('2d')!
  const depthData = depthCtx.getImageData(0, 0, width, height).data
  const normalData = normalCtx.getImageData(0, 0, width, height).data

  const outputData = ctx.createImageData(width, height)
  const outData = outputData.data

  const radius = ao.radius || 10
  const intensity = ao.intensity || 1
  const samples = ao.samples || 16

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      let occlusion = 0

      // Sample hemisphere
      for (let i = 0; i < samples; i++) {
        // Random hemisphere direction
        const u = Math.random()
        const v = Math.random()
        const theta = 2 * Math.PI * u
        const phi = Math.acos(2 * v - 1)

        const dx = Math.sin(phi) * Math.cos(theta)
        const dy = Math.sin(phi) * Math.sin(theta)
        const dz = Math.cos(phi)

        // Sample depth
        const sampleX = Math.min(width - 1, Math.max(0, Math.round(x + dx * radius)))
        const sampleY = Math.min(height - 1, Math.max(0, y + dy * radius))
        const sIdx = (sampleY * width + sampleX) * 4
        const sampleDepth = depthData[sIdx] / 255

        const currentDepth = depthData[(y * width + x) * 4] / 255
        if (sampleDepth > currentDepth) {
          occlusion++
        }
      }

      const ao = 1 - (occlusion / samples) * intensity
      const aoVal = Math.round(clamp(ao, 0, 1) * 255)
      const idx = (y * width + x) * 4
      outData[idx] = outData[idx + 1] = outData[idx + 2] = aoVal
      outData[idx + 3] = 255
    }

    outputCtx.putImageData(outputData, 0, 0)
    return output
  }
}

/** Render shadows */
async function renderShadows(
  depthCanvas: HTMLCanvasElement,
  normalCanvas: HTMLCanvasElement,
  lights: LightSource[]
): Promise<HTMLCanvasElement> {
  // Simplified shadow rendering
  const width = depthCanvas.width
  const height = depthCanvas.height
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Start with white (no shadow)
  const ctx = output.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, output.width, output.height)

  for (const light of lights) {
    if (!light.castShadow) continue

    // Render shadow map from light perspective
    // Simplified: create soft shadows
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = 0.5

    // Would render depth from light view
    // Simplified: draw shadow shape
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(0, 0, 100, 100) // placeholder
  }

  return output
}

/** Render lighting passes */
async function renderLighting(
  albedo: HTMLCanvasElement,
  normal: HTMLCanvasElement,
  depth: HTMLCanvasElement,
  roughness: HTMLCanvasElement,
  metallic: HTMLCanvasElement,
  ao: HTMLCanvasElement,
  shadow: HTMLCanvasElement,
  lights: LightSource[],
  material: MaterialProperties
): Promise<{ diffuse: HTMLCanvasElement; specular: HTMLCanvasElement; emission: HTMLCanvasElement }> {
  const { width, height } = albedo

  const diffuse = createCanvas(width, height)
  const specular = createCanvas(width, height)
  const emission = createCanvas(width, height)

  const diffCtx = ctx2d(diffuse)
  const specCtx = ctx2d(specular)
  const emitCtx = ctx2d(emission)

  // Start with ambient
  const diffCtx = diffuse.getContext('2d')!
  diffCtx.globalCompositeOperation = 'source-over'
  diffCtx.fillStyle = material.ambient || '#000000'
  diffCtx.fillRect(0, 0, width, height)

  // Ambient occlusion
  diffCtx.globalCompositeOperation = 'multiply'
  diffCtx.drawImage(ao, 0, 0)

  // Accumulate light contributions
  for (const light of lights) {
    if (!light.enabled) continue

    // Calculate lighting for each pixel
    // This is simplified - real implementation would use shaders
    await applyLight(light, ambientLight, diffuse, specular, emission)
  }

  // Emission
  if (material.emissive && material.emissive !== '#000000') {
    emitCtx.globalCompositeOperation = 'source-over'
    emitCtx.fillStyle = material.emissive
    emitCtx.globalAlpha = material.emissiveIntensity / 100
    emitCtx.fillRect(0, 0, width, height)
  }

  return { diffuse, specular, emission }
}

async function applyLight(
  light: LightSource,
  ambientLight: HTMLCanvasElement,
  diffuse: HTMLCanvasElement,
  specular: HTMLCanvasElement,
  emission: HTMLCanvasElement
): Promise<void> {
  // Would calculate lighting per pixel
  // Simplified: just add light contribution
}

/** Composite all lighting passes */
async function compositeLightingPasses(params: {
  diffuse: HTMLCanvasElement
  specular: HTMLCanvasElement
  shadow: HTMLCanvasElement
  ao: HTMLCanvasElement
  emission: HTMLCanvasElement
  albedo: HTMLCanvasElement
  exposure: number
  gamma: number
  toneMapping: string
  colorGrading: any
}): Promise<HTMLCanvasElement> {
  const { diffuse, specular, shadow, ao, emission, albedo, exposure, gamma, toneMapping, colorGrading } = params
  const { width, height } = diffuse

  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Base: albedo * diffuse
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(albedo, 0, 0)
  ctx.globalCompositeOperation = 'multiply'
  ctx.drawImage(diffuse, 0, 0)

  // Add specular
  ctx.globalCompositeOperation = 'screen'
  ctx.drawImage(specular, 0, 0)

  // Apply shadows
  ctx.globalCompositeOperation = 'multiply'
  ctx.drawImage(shadow, 0, 0)

  // Apply AO
  ctx.globalCompositeOperation = 'multiply'
  ctx.drawImage(ao, 0, 0)

  // Add emission
  ctx.globalCompositeOperation = 'screen'
  ctx.drawImage(emission, 0, 0)

  ctx.globalCompositeOperation = 'source-over'

  // Exposure
  if (exposure !== 0) {
    const ctx2 = output.getContext('2d')!
    ctx2.filter = `brightness(${1 + exposure / 100})`
    ctx2.drawImage(output, 0, 0)
    ctx2.filter = 'none'
  }

  // Gamma correction
  if (gamma !== 1) {
    const ctx2 = output.getContext('2d')!
    ctx2.filter = `gamma(${gamma})` // Not standard, would use LUT
    ctx2.drawImage(output, 0, 0)
    ctx2.filter = 'none'
  }

  // Tone mapping
  if (toneMapping !== 'none') {
    await applyToneMapping(output, toneMapping)
  }

  // Color grading
  if (colorGrading) {
    await applyColorGrading(output, colorGrading)
  }

  return output
}

async function applyToneMapping(canvas: HTMLCanvasElement, method: string): Promise<void> {
  // Would apply tone mapping operator
}

async function applyColorGrading(canvas: HTMLCanvasElement, grading: any): Promise<void> {
  // Would apply color grading
}

async function denoiseImage(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  // Would apply denoising
  return canvas
}

/** Light presets */
export const LIGHT_PRESETS: Record<string, LightSource[]> = {
  'studio-three-point': [
    {
      id: 'key',
      type: 'spot',
      position: { x: 2, y: 3, z: 2 },
      target: { x: 0, y: 0, z: 0 },
      color: '#fffef0',
      intensity: 100,
      attenuation: { constant: 1, linear: 0.1, quadratic: 0.01 },
      angle: 30,
      penumbra: 0.5,
      decay: 2,
      castShadow: true,
      shadowMapSize: 1024,
      shadowBias: 0.001,
      shadowRadius: 2,
      temperature: 5500,
      enabled: true,
    },
    {
      id: 'fill',
      type: 'spot',
      position: { x: -1.5, y: 1, z: 1.5 },
      target: { x: 0, y: 0, z: 0 },
      color: '#ffeedd',
      intensity: 40,
      attenuation: { constant: 1, linear: 0.1, quadratic: 0.01 },
      angle: 45,
      penumbra: 0.5,
      decay: 2,
      castShadow: false,
      shadowMapSize: 512,
      shadowBias: 0.001,
      shadowRadius: 3,
      temperature: 6500,
      enabled: true,
    },
    {
      id: 'rim',
      type: 'spot',
      position: { x: 0, y: 2, z: -2 },
      target: { x: 0, y: 0, z: 0 },
      color: '#fff8e8',
      intensity: 30,
      attenuation: { constant: 1, linear: 0.1, quadratic: 0.01 },
      angle: 20,
      penumbra: 0.3,
      decay: 2,
      castShadow: false,
      shadowMapSize: 512,
      shadowBias: 0.001,
      shadowRadius: 2,
      temperature: 6500,
      enabled: true,
    },
  ],
  'studio-softbox': [
    {
      id: 'main',
      type: 'area',
      position: { x: 0, y: 3, z: 2 },
      target: { x: 0, y: 0, z: 0 },
      color: '#ffffff',
      intensity: 80,
      attenuation: { constant: 1, linear: 0.05, quadratic: 0.005 },
      angle: 90,
      penumbra: 1,
      decay: 1.5,
      castShadow: true,
      shadowMapSize: 2048,
      shadowBias: 0.0005,
      shadowRadius: 5,
      width: 2,
      height: 1.5,
      temperature: 5500,
      enabled: true,
    },
    {
      id: 'fill',
      type: 'area',
      position: { x: -2, y: 1, z: 1 },
      target: { x: 0, y: 0, z: 0 },
      color: '#ffffff',
      intensity: 30,
      attenuation: { constant: 1, linear: 0.1, quadratic: 0.01 },
      angle: 90,
      penumbra: 1,
      decay: 1.5,
      castShadow: false,
      shadowMapSize: 512,
      shadowBias: 0.001,
      shadowRadius: 3,
      width: 1.5,
      height: 1,
      temperature: 6500,
      enabled: true,
    },
  ],
  'outdoor-sun': [
    {
      id: 'sun',
      type: 'directional',
      position: { x: 10, y: 20, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      color: '#fff8e8',
      intensity: 100,
      attenuation: { constant: 1, linear: 0, quadratic: 0 },
      angle: 0.5,
      penumbra: 0,
      decay: 0,
      castShadow: true,
      shadowMapSize: 4096,
      shadowBias: 0.0001,
      shadowRadius: 4,
      temperature: 5500,
      enabled: true,
    },
    {
      id: 'sky',
      type: 'hemisphere',
      position: { x: 0, y: 10, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      color: '#87ceeb',
      intensity: 30,
      attenuation: { constant: 1, linear: 0, quadratic: 0 },
      angle: 180,
      penumbra: 1,
      decay: 0,
      castShadow: false,
      shadowMapSize: 512,
      shadowBias: 0,
      shadowRadius: 0,
      temperature: 10000,
      enabled: true,
    },
  ],
  'studio-ring': [
    {
      id: 'ring',
      type: 'area',
      position: { x: 0, y: 2, z: 1.5 },
      target: { x: 0, y: 0, z: 0 },
      color: '#ffffff',
      intensity: 60,
      attenuation: { constant: 1, linear: 0.1, quadratic: 0.01 },
      angle: 60,
      penumbra: 0.5,
      decay: 2,
      castShadow: false,
      shadowMapSize: 1024,
      shadowBias: 0.001,
      shadowRadius: 2,
      width: 1.5,
      height: 0.1,
      temperature: 5500,
      enabled: true,
    },
  ],
  'dramatic-rim': [
    {
      id: 'key',
      type: 'spot',
      position: { x: 2, y: 2, z: 2 },
      target: { x: 0, y: 0, z: 0 },
      color: '#fff8e8',
      intensity: 80,
      attenuation: { constant: 1, linear: 0.1, quadratic: 0.01 },
      angle: 25,
      penumbra: 0.3,
      decay: 2,
      castShadow: true,
      shadowMapSize: 1024,
      shadowBias: 0.001,
      shadowRadius: 2,
      temperature: 5500,
      enabled: true,
    },
    {
      id: 'rim',
      type: 'spot',
      position: { x: 0, y: 1, z: -3 },
      target: { x: 0, y: 0, z: 0 },
      color: '#ffffff',
      intensity: 50,
      attenuation: { constant: 1, linear: 0.05, quadratic: 0.005 },
      angle: 15,
      penumbra: 0.2,
      decay: 2,
      castShadow: false,
      shadowMapSize: 512,
      shadowBias: 0.001,
      shadowRadius: 1,
      temperature: 6500,
      enabled: true,
    },
  ],
  'product-photography': [
    {
      id: 'main',
      type: 'area',
      position: { x: 0, y: 2, z: 1.5 },
      target: { x: 0, y: 0, z: 0 },
      color: '#ffffff',
      intensity: 70,
      attenuation: { constant: 1, linear: 0.05, quadratic: 0.005 },
      angle: 90,
      penumbra: 1,
      decay: 1.5,
      castShadow: true,
      shadowMapSize: 2048,
      shadowBias: 0.0005,
      shadowRadius: 5,
      width: 2,
      height: 1.5,
      temperature: 5500,
      enabled: true,
    },
    {
      id: 'fill',
      type: 'area',
      position: { x: -1.5, y: 1, z: 1 },
      target: { x: 0, y: 0, z: 0 },
      color: '#ffffff',
      intensity: 25,
      attenuation: { constant: 1, linear: 0.1, quadratic: 0.01 },
      angle: 90,
      penumbra: 1,
      decay: 1.5,
      castShadow: false,
      shadowMapSize: 512,
      shadowBias: 0.001,
      shadowRadius: 3,
      width: 1.5,
      height: 1,
      temperature: 6500,
      enabled: true,
    },
    {
      id: 'rim',
      type: 'spot',
      position: { x: 0, y: 1.5, z: -2 },
      target: { x: 0, y: 0, z: 0 },
      color: '#ffffff',
      intensity: 40,
      attenuation: { constant: 1, linear: 0.05, quadratic: 0.005 },
      angle: 20,
      penumbra: 0.3,
      decay: 2,
      castShadow: false,
      shadowMapSize: 512,
      shadowBias: 0.001,
      shadowRadius: 2,
      temperature: 6500,
      enabled: true,
    },
    {
      id: 'backlight',
      type: 'area',
      position: { x: 0, y: 0, z: -2 },
      target: { x: 0, y: 0, z: 0 },
      color: '#ffffee',
      intensity: 20,
      attenuation: { constant: 1, linear: 0.1, quadratic: 0.01 },
      angle: 120,
      penumbra: 1,
      decay: 1,
      castShadow: false,
      shadowMapSize: 512,
      shadowBias: 0.001,
      shadowRadius: 3,
      width: 2,
      height: 2,
      temperature: 5000,
      enabled: true,
    },
  ],
}

/** Material presets */
export const MATERIAL_PRESETS: Record<string, MaterialProperties> = {
  'default': {
    diffuse: '#ffffff',
    specular: '#ffffff',
    shininess: 30,
    roughness: 0.5,
    metallic: 0,
    ambient: '#000000',
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    refractiveIndex: 1.5,
    clearcoat: 0,
    clearcoatRoughness: 0,
    anisotropy: 0,
    anisotropyRotation: 0,
    sheen: '#000000',
    sheenRoughness: 0.5,
    transmission: 0,
    thickness: 1,
    ior: 1.5,
    dispersion: 0,
  },
  'metal': {
    diffuse: '#cccccc',
    specular: '#ffffff',
    shininess: 100,
    roughness: 0.1,
    metallic: 1,
    ambient: '#000000',
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    refractiveIndex: 1.5,
    clearcoat: 0,
    clearcoatRoughness: 0,
    anisotropy: 0.8,
    anisotropyRotation: 0,
    sheen: '#000000',
    sheenRoughness: 0.5,
    transmission: 0,
    thickness: 1,
    ior: 1.5,
    dispersion: 0,
  },
  'gold': {
    diffuse: '#ffd700',
    specular: '#ffd700',
    shininess: 200,
    roughness: 0.1,
    metallic: 1,
    ambient: '#000000',
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    refractiveIndex: 1.5,
    clearcoat: 0,
    clearcoatRoughness: 0,
    anisotropy: 0.9,
    anisotropyRotation: 0,
    sheen: '#000000',
    sheenRoughness: 0.5,
    transmission: 0,
    thickness: 1,
    ior: 1.5,
    dispersion: 0,
  },
  'chrome': {
    diffuse: '#cccccc',
    specular: '#ffffff',
    shininess: 500,
    roughness: 0,
    metallic: 1,
    ambient: '#000000',
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    refractiveIndex: 1.5,
    clearcoat: 0,
    clearcoatRoughness: 0,
    anisotropy: 1,
    anisotropyRotation: 0,
    sheen: '#000000',
    sheenRoughness: 0.5,
    transmission: 0,
    thickness: 1,
    ior: 1.5,
    dispersion: 0,
  },
  'glass': {
    diffuse: '#ffffff',
    specular: '#ffffff',
    shininess: 1000,
    roughness: 0,
    metallic: 0,
    ambient: '#000000',
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 0.1,
    refractiveIndex: 1.52,
    clearcoat: 1,
    clearcoatRoughness: 0,
    anisotropy: 0,
    anisotropyRotation: 0,
    sheen: '#000000',
    sheenRoughness: 0.5,
    transmission: 1,
    thickness: 2,
    ior: 1.52,
    dispersion: 0.01,
  },
  'water': {
    diffuse: '#0066cc',
    specular: '#ffffff',
    shininess: 500,
    roughness: 0.01,
    metallic: 0,
    ambient: '#001133',
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 0.8,
    refractiveIndex: 1.33,
    clearcoat: 1,
    clearcoatRoughness: 0.01,
    anisotropy: 0.1,
    anisotropyRotation: 0,
    sheen: '#000000',
    sheenRoughness: 0.5,
    transmission: 0.9,
    thickness: 10,
    ior: 1.33,
    dispersion: 0.005,
  },
  'plastic': {
    diffuse: '#ff0000',
    specular: '#ffffff',
    shininess: 100,
    roughness: 0.3,
    metallic: 0,
    ambient: '#000000',
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    refractiveIndex: 1.5,
    clearcoat: 0.2,
    clearcoatRoughness: 0.2,
    anisotropy: 0,
    anisotropyRotation: 0,
    sheen: '#000000',
    sheenRoughness: 0.5,
    transmission: 0,
    thickness: 1,
    ior: 1.5,
    dispersion: 0,
  },
  'rubber': {
    diffuse: '#333333',
    specular: '#555555',
    shininess: 20,
    roughness: 0.8,
    metallic: 0,
    ambient: '#000000',
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    refractiveIndex: 1.5,
    clearcoat: 0,
    clearcoatRoughness: 0,
    anisotropy: 0,
    anisotropyRotation: 0,
    sheen: '#000000',
    sheenRoughness: 0.5,
    transmission: 0,
    thickness: 1,
    ior: 1.5,
    dispersion: 0,
  },
  'velvet': {
    diffuse: '#800020',
    specular: '#ff8888',
    shininess: 10,
    roughness: 0.9,
    metallic: 0,
    ambient: '#000000',
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    refractiveIndex: 1.5,
    clearcoat: 0,
    clearcoatRoughness: 0,
    anisotropy: 0.8,
    anisotropyRotation: 90,
    sheen: '#ff4466',
    sheenRoughness: 0.3,
    transmission: 0,
    thickness: 1,
    ior: 1.5,
    dispersion: 0,
  },
  'silk': {
    diffuse: '#e8d8c8',
    specular: '#fff8e8',
    shininess: 50,
    roughness: 0.4,
    metallic: 0,
    ambient: '#000000',
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    refractiveIndex: 1.5,
    clearcoat: 0.1,
    clearcoatRoughness: 0.2,
    anisotropy: 0.9,
    anisotropyRotation: 0,
    sheen: '#fff8e8',
    sheenRoughness: 0.3,
    transmission: 0,
    thickness: 1,
    ior: 1.5,
    dispersion: 0,
  },
  'skin': {
    diffuse: '#fdbcb4',
    specular: '#ffebd0',
    shininess: 30,
    roughness: 0.4,
    metallic: 0,
    ambient: '#000000',
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    refractiveIndex: 1.4,
    clearcoat: 0.05,
    clearcoatRoughness: 0.1,
    anisotropy: 0,
    anisotropyRotation: 0,
    sheen: '#ffccaa',
    sheenRoughness: 0.5,
    transmission: 0.1,
    thickness: 2,
    ior: 1.4,
    dispersion: 0,
  },
}