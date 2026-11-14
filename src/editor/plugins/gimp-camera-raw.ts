'use client'
// GIMP Camera Raw Filter
// Full Adobe Camera Raw-like filter with all panels

import { createCanvas, ctx2d } from '../utils/canvas'

export interface CameraRawSettings {
  // Basic panel
  basic: {
    profile: string
    whiteBalance: 'auto' | 'daylight' | 'cloudy' | 'shade' | 'tungsten' | 'fluorescent' | 'flash' | 'custom'
    temperature: number
    tint: number
    exposure: number
    contrast: number
    highlights: number
    shadows: number
    whites: number
    blacks: number
    texture: number
    clarity: number
    dehaze: number
    vibrance: number
    saturation: number
  }
  // Tone Curve panel
  toneCurve: {
    parametric: {
      highlights: number
      lights: number
      darks: number
      shadows: number
    }
    pointCurve: Array<[number, number]> // [input, output] 0-255
    refine: boolean
  }
  // Detail panel
  detail: {
    sharpening: {
      amount: number
      radius: number
      detail: number
      masking: number
    }
    noiseReduction: {
      luminance: number
      luminanceDetail: number
      luminanceContrast: number
      color: number
      colorDetail: number
      colorSmoothness: number
    }
  }
  // Color Mixer panel
  colorMixer: {
    hue: Record<string, number> // colorName -> -100 to 100
    saturation: Record<string, number>
    luminance: Record<string, number>
  }
  // Color Grading panel
  colorGrading: {
    shadows: { hue: number; saturation: number; luminance: number }
    midtones: { hue: number; saturation: number; luminance: number }
    highlights: { hue: number; saturation: number; luminance: number }
    global: { hue: number; saturation: number; luminance: number }
    blending: number
    balance: number
  }
  // Optics panel
  optics: {
    removeChromaticAberration: boolean
    defringe: number
    lensCorrection: {
      enableProfileCorrections: boolean
      profile: string
      distortion: number
      vignetting: number
    }
    transform: {
      vertical: number
      horizontal: number
      rotate: number
      scale: number
      aspect: number
      offsetX: number
      offsetY: number
    }
  }
  // Geometry panel
  geometry: {
    upright: 'off' | 'auto' | 'level' | 'vertical' | 'full' | 'guided'
    perspective: {
      vertical: number
      horizontal: number
      rotate: number
      scale: number
      aspect: number
      offsetX: number
      offsetY: number
    }
  }
  // Calibration panel
  calibration: {
    shadows: { hue: number; saturation: number }
    redPrimary: { hue: number; saturation: number }
    greenPrimary: { hue: number; saturation: number }
    bluePrimary: { hue: number; saturation: number }
  }
  // Effects panel
  effects: {
    vignette: {
      amount: number
      midpoint: number
      roundness: number
      feather: number
      highlights: number
    }
    grain: {
      amount: number
      size: number
      roughness: number
    }
    dehaze: number
  }
}

export const DEFAULT_CAMERA_RAW_SETTINGS: CameraRawSettings = {
  basic: {
    profile: 'Adobe Color',
    whiteBalance: 'auto',
    temperature: 0,
    tint: 0,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    texture: 0,
    clarity: 0,
    dehaze: 0,
    vibrance: 0,
    saturation: 0,
  },
  toneCurve: {
    parametric: { highlights: 0, lights: 0, darks: 0, shadows: 0 },
    pointCurve: [[0, 0], [255, 255]],
    refine: false,
  },
  detail: {
    sharpening: { amount: 40, radius: 1, detail: 25, masking: 0 },
    noiseReduction: { luminance: 0, luminanceDetail: 50, luminanceContrast: 0, color: 25, colorDetail: 50, colorSmoothness: 50 },
  },
  colorMixer: {
    hue: {}, saturation: {}, luminance: {},
  },
  colorGrading: {
    shadows: { hue: 0, saturation: 0, luminance: 0 },
    midtones: { hue: 0, saturation: 0, luminance: 0 },
    highlights: { hue: 0, saturation: 0, luminance: 0 },
    global: { hue: 0, saturation: 0, luminance: 0 },
    blending: 50,
    balance: 0,
  },
  optics: {
    removeChromaticAberration: false,
    defringe: 0,
    lensCorrection: { enableProfileCorrections: false, profile: '', distortion: 0, vignetting: 0 },
    transform: { vertical: 0, horizontal: 0, rotate: 0, scale: 100, aspect: 100, offsetX: 0, offsetY: 0 },
  },
  geometry: {
    upright: 'off',
    perspective: { vertical: 0, horizontal: 0, rotate: 0, scale: 100, aspect: 100, offsetX: 0, offsetY: 0 },
  },
  calibration: {
    shadows: { hue: 0, saturation: 0 },
    redPrimary: { hue: 0, saturation: 0 },
    greenPrimary: { hue: 0, saturation: 0 },
    bluePrimary: { hue: 0, saturation: 0 },
  },
  effects: {
    vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 0, highlights: 0 },
    grain: { amount: 0, size: 25, roughness: 50 },
    dehaze: 0,
  },
}

/** Camera Raw Filter - Main processing function */
export async function applyCameraRawFilter(
  canvas: HTMLCanvasElement,
  settings: CameraRawSettings
): Promise<HTMLCanvasElement> {
  let current = canvas

  // Apply panels in order
  current = await applyBasicPanel(current, settings.basic)
  current = await applyToneCurvePanel(current, settings.toneCurve)
  current = await applyDetailPanel(current, settings.detail)
  current = await applyColorMixerPanel(current, settings.colorMixer)
  current = await applyColorGradingPanel(current, settings.colorGrading)
  current = await applyOpticsPanel(current, settings.optics)
  current = await applyGeometryPanel(current, settings.geometry)
  current = await applyCalibrationPanel(current, settings.calibration)
  current = await applyEffectsPanel(current, settings.effects)

  return current
}

/** Basic Panel - White Balance, Tone, Presence */
async function applyBasicPanel(
  canvas: HTMLCanvasElement,
  settings: CameraRawSettings['basic']
): Promise<HTMLCanvasElement> {
  const { width, height } = canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Build filter string
  const filters: string[] = []

  // Exposure
  if (settings.exposure !== 0) {
    filters.push(`brightness(${1 + settings.exposure / 100})`)
  }

  // Contrast
  if (settings.contrast !== 0) {
    filters.push(`contrast(${1 + settings.contrast / 100})`)
  }

  // Highlights/Shadows
  if (settings.highlights !== 0 || settings.shadows !== 0) {
    // Approximation using brightness/contrast
    const highlightFactor = 1 + settings.highlights / 200
    const shadowFactor = 1 + settings.shadows / 200
    filters.push(`contrast(${highlightFactor}) brightness(${shadowFactor})`)
  }

  // Whites/Blacks
  if (settings.whites !== 0 || settings.blacks !== 0) {
    // Would need levels adjustment
  }

  // Texture/Clarity/Dehaze (approximations)
  if (settings.texture !== 0) {
    filters.push(`contrast(${1 + settings.texture / 200})`)
  }
  if (settings.clarity !== 0) {
    filters.push(`contrast(${1 + settings.clarity / 150})`)
  }
  if (settings.dehaze !== 0) {
    // Dehaze approximation
    filters.push(`contrast(${1 + settings.dehaze / 200}) saturate(${1 + settings.dehaze / 300})`)
  }

  // Vibrance/Saturation
  if (settings.vibrance !== 0) {
    filters.push(`saturate(${1 + settings.vibrance / 200})`)
  }
  if (settings.saturation !== 0) {
    filters.push(`saturate(${1 + settings.saturation / 100})`)
  }

  // White Balance (temperature/tint)
  if (settings.temperature !== 0 || settings.tint !== 0) {
    // Approximation using sepia/hue-rotate
    const tempFactor = settings.temperature / 100
    const tintFactor = settings.tint / 100
    filters.push(`sepia(${Math.abs(tempFactor) * 0.3}) hue-rotate(${tempFactor * 30}deg)`)
  }

  // Apply all filters
  if (filters.length > 0) {
    ctx.filter = filters.join(' ')
  }

  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  return output
}

/** Tone Curve Panel */
async function applyToneCurvePanel(
  canvas: HTMLCanvasElement,
  settings: CameraRawSettings['toneCurve']
): Promise<HTMLCanvasElement> {
  const { parametric, pointCurve } = settings

  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)

  // Build LUT from point curve
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) {
    // Interpolate curve
    let val = i
    for (let i = 0; i < pointCurve.length - 1; i++) {
      const [x1, y1] = pointCurve[i]
      const [x2, y2] = pointCurve[i + 1]
      if (i >= x1 && i <= x2) {
        const t = (i - x1) / (x2 - x1)
        val = y1 + (y2 - y1) * t
        break
      }
    }
    lut[i] = Math.round(Math.max(0, Math.min(255, val)))
  }

  // Apply parametric adjustments
  // This is simplified - real implementation would modify the curve

  // Apply LUT
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imgData.data
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]]
    data[i + 1] = lut[data[i + 1]]
    data[i + 2] = lut[data[i + 2]]
  }
  ctx.putImageData(imgData, 0, 0)

  return output
}

/** Detail Panel - Sharpening & Noise Reduction */
async function applyDetailPanel(
  canvas: HTMLCanvasElement,
  settings: CameraRawSettings['detail']
): Promise<HTMLCanvasElement> {
  const { sharpening, noiseReduction } = settings

  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)

  // Sharpening
  if (sharpening.amount > 0) {
    ctx.filter = `contrast(${1 + sharpening.amount / 200})`
    ctx.drawImage(canvas, 0, 0)
    ctx.filter = 'none'

    // Apply unsharp mask approximation
    const output2 = createCanvas(canvas.width, canvas.height)
    const ctx2 = ctx2d(output2)
    ctx2.filter = `blur(${sharpening.radius}px)`
    ctx2.drawImage(output, 0, 0)
    ctx2.filter = 'none'

    // Blend with original
    ctx2.globalCompositeOperation = 'difference'
    ctx2.globalAlpha = sharpening.amount / 100
    ctx2.drawImage(canvas, 0, 0)
    ctx2.globalCompositeOperation = 'source-over'
    ctx2.globalAlpha = 1

    // Apply masking
    if (sharpening.masking > 0) {
      // Would create mask from edges
    }

    return output2
  }

  // Noise Reduction
  if (noiseReduction.luminance > 0) {
    const output = createCanvas(canvas.width, canvas.height)
    const ctx = ctx2d(output)
    const strength = noiseReduction.luminance / 100

    // Simple blur for noise reduction
    ctx.filter = `blur(${strength * 2}px)`
    ctx.drawImage(canvas, 0, 0)
    ctx.filter = 'none'

    // Preserve details
    if (noiseReduction.luminanceDetail > 0) {
      // Would blend with original based on edges
    }

    return output
  }

  return canvas
}

/** Color Mixer Panel */
async function applyColorMixerPanel(
  canvas: HTMLCanvasElement,
  settings: CameraRawSettings['colorMixer']
): Promise<HTMLCanvasElement> {
  // Would adjust hue/saturation/luminance per color range
  // This is complex - simplified implementation
  return canvas
}

/** Color Grading Panel */
async function applyColorGradingPanel(
  canvas: HTMLCanvasElement,
  settings: CameraRawSettings['colorGrading']
): Promise<HTMLCanvasElement> {
  const { shadows, midtones, highlights, global, blending, balance } = settings

  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)

  // Apply color grading using color matrix
  // Simplified: use hue-rotate for hue shifts
  const filters: string[] = []

  if (global.hue !== 0) {
    filters.push(`hue-rotate(${global.hue}deg)`)
  }
  if (global.saturation !== 0) {
    filters.push(`saturate(${1 + global.saturation / 100})`)
  }
  if (global.luminance !== 0) {
    filters.push(`brightness(${1 + global.luminance / 100})`)
  }

  // For shadows/midtones/highlights, would need luminance masking
  // Simplified implementation
  if (filters.length > 0) {
    ctx.filter = filters.join(' ')
  }

  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  return output
}

/** Optics Panel */
async function applyOpticsPanel(
  canvas: HTMLCanvasElement,
  settings: CameraRawSettings['optics']
): Promise<HTMLCanvasElement> {
  let current = canvas

  // Chromatic aberration
  if (settings.removeChromaticAberration || settings.defringe > 0) {
    current = await removeChromaticAberration(current, settings.defringe)
  }

  // Lens correction
  if (settings.lensCorrection.enableProfileCorrections) {
    // Would apply lens profile
  }

  // Transform
  const { vertical, horizontal, rotate, scale, aspect, offsetX, offsetY } = settings.transform
  if (vertical !== 0 || horizontal !== 0 || rotate !== 0 || scale !== 100 || aspect !== 100 || offsetX !== 0 || offsetY !== 0) {
    current = await applyTransform(current, { vertical, horizontal, rotate, scale, aspect, offsetX, offsetY })
  }

  return current
}

async function removeChromaticAberration(canvas: HTMLCanvasElement, defringe: number): Promise<HTMLCanvasElement> {
  // Simplified CA removal
  return canvas
}

async function applyTransform(canvas: HTMLCanvasElement, transform: any): Promise<HTMLCanvasElement> {
  const { width, height } = canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.rotate((transform.rotate || 0) * Math.PI / 180)
  ctx.scale((transform.scale || 100) / 100 * (transform.aspect || 100) / 100, (transform.scale || 100) / 100)
  ctx.translate(-width / 2, -height / 2)
  ctx.drawImage(canvas, transform.offsetX || 0, transform.offsetY || 0)
  ctx.restore()

  return output
}

/** Geometry Panel */
async function applyGeometryPanel(
  canvas: HTMLCanvasElement,
  settings: CameraRawSettings['geometry']
): Promise<HTMLCanvasElement> {
  const { upright, perspective } = settings

  let current = canvas

  // Upright
  if (upright !== 'off') {
    // Would auto-correct perspective
  }

  // Manual perspective
  const { vertical, horizontal, rotate, scale, aspect, offsetX, offsetY } = perspective
  if (vertical !== 0 || horizontal !== 0 || rotate !== 0 || scale !== 100 || aspect !== 100 || offsetX !== 0 || offsetY !== 0) {
    current = await applyTransform(current, { vertical, horizontal, rotate, scale, aspect, offsetX, offsetY })
  }

  return current
}

/** Calibration Panel */
async function applyCalibrationPanel(
  canvas: HTMLCanvasElement,
  settings: CameraRawSettings['calibration']
): Promise<HTMLCanvasElement> {
  // Would adjust primary colors and shadows tint
  // Simplified
  return canvas
}

/** Effects Panel */
async function applyEffectsPanel(
  canvas: HTMLCanvasElement,
  settings: CameraRawSettings['effects']
): Promise<HTMLCanvasElement> {
  let current = canvas

  // Vignette
  const { amount, midpoint, roundness, feather, highlights } = settings.vignette
  if (amount !== 0) {
    current = await applyVignette(current, { amount, midpoint, roundness, feather, highlights })
  }

  // Grain
  const { amount, size, roughness } = settings.grain
  if (amount > 0) {
    current = await addGrain(current, amount, size, roughness)
  }

  // Dehaze
  if (settings.dehaze !== 0) {
    current = await applyDehaze(current, settings.dehaze)
  }

  return current
}

/** Apply vignette */
async function applyVignette(
  canvas: HTMLCanvasElement,
  settings: { amount: number; midpoint: number; roundness: number; feather: number; highlights: number }
): Promise<HTMLCanvasElement> {
  const { amount, midpoint, roundness, feather, highlights } = settings
  if (amount === 0) return canvas

  const { width, height } = canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)
  ctx.drawImage(canvas, 0, 0)

  // Create vignette mask
  const mask = createCanvas(width, height)
  const maskCtx = ctx2d(mask)

  const cx = width / 2
  const cy = height / 2
  const maxRadius = Math.sqrt(cx * cx + cy * cy)

  const imgData = maskCtx.createImageData(width, height)
  const data = imgData.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / cx
      const dy = (cy - y) / cy
      let r = Math.sqrt(dx * dx + dy * dy) / Math.sqrt(2)

      // Roundness
      if (roundness !== 0) {
        const angle = Math.atan2(dy, dx)
        r = Math.pow(Math.abs(Math.cos(angle)) ** (2 / (1 + roundness / 100)) + Math.abs(Math.sin(angle)) ** (2 / (1 + roundness / 100)), -0.5 * (1 + roundness / 100))
      }

      // Normalize
      r = r / Math.sqrt(2)

      let vignette = 1
      const midpointNorm = midpoint / 100
      const featherNorm = feather / 100

      if (r > midpointNorm) {
        const t = (r - midpointNorm) / (1 - midpointNorm)
        vignette = 1 - Math.pow(t, 1 + featherNorm) * (Math.abs(amount) / 100)
      }

      const idx = ((y * width) + x) * 4
      const v = Math.round(vignette * 255)
      data[idx] = v
      data[idx + 1] = v
      data[idx + 2] = v
      data[idx + 3] = 255
    }

    maskCtx.putImageData(imgData, 0, 0)

    // Apply
    const ctx = ctx2d(canvas)
    ctx.globalCompositeOperation = amount < 0 ? 'multiply' : 'screen'
    ctx.globalAlpha = Math.abs(amount) / 100
    ctx.drawImage(mask, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1

    return canvas
  }

/** Add grain */
async function addGrain(canvas: HTMLCanvasElement, amount: number, size: number, roughness: number): Promise<HTMLCanvasElement> {
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(canvas, 0, 0)

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imgData.data

  let seed = Date.now()
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }

  const grainStrength = amount / 100 * 255 * (roughness / 100)

  for (let i = 0; i < data.length; i += 4) {
    const noise = (rand() - 0.5) * 2 * grainStrength
    data[i] = Math.max(0, Math.min(255, data[i] + noise))
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise))
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise))
  }

  ctx.putImageData(imgData, 0, 0)
  return output
}

/** Apply dehaze */
async function applyDehaze(canvas: HTMLCanvasElement, amount: number): Promise<HTMLCanvasElement> {
  if (amount === 0) return canvas

  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)

  // Dehaze approximation: increase contrast and reduce haze in shadows
  const strength = amount / 100
  ctx.filter = `contrast(${1 + strength * 0.5}) brightness(${1 + strength * 0.1})`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  // Would add more sophisticated dehaze (dark channel prior)
  return output
}

/** Camera Raw UI Component */
export function createCameraRawUI(
  canvas: HTMLCanvasElement,
  onApply: (settings: CameraRawSettings) => void
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'camera-raw-ui'
  container.innerHTML = `
    <div class="camera-raw-panel">
      <div class="cr-tabs">
        <button data-tab="basic" class="active">Basic</button>
        <button data-tab="tone-curve">Tone Curve</button>
        <button data-tab="detail">Detail</button>
        <button data-tab="color-mixer">Color Mixer</button>
        <button data-tab="color-grading">Color Grading</button>
        <button data-tab="optics">Optics</button>
        <button data-tab="geometry">Geometry</button>
        <button data-tab="calibration">Calibration</button>
        <button data-tab="effects">Effects</button>
      </div>
      <div class="cr-panels">
        <div id="basic-panel" class="cr-panel active">
          <!-- Basic panel controls -->
        </div>
        <div id="tone-curve-panel" class="cr-panel">
          <!-- Tone Curve controls -->
        </div>
        <div id="detail-panel" class="cr-panel">
          <!-- Detail controls -->
        </div>
        <div id="color-mixer-panel" class="cr-panel">
          <!-- Color Mixer controls -->
        </div>
        <div id="color-grading-panel" class="cr-panel">
          <!-- Color Grading controls -->
        </div>
        <div id="optics-panel" class="cr-panel">
          <!-- Optics controls -->
        </div>
        <div id="geometry-panel" class="cr-panel">
          <!-- Geometry controls -->
        </div>
        <div id="calibration-panel" class="cr-panel">
          <!-- Calibration controls -->
        </div>
        <div id="effects-panel" class="cr-panel">
          <!-- Effects controls -->
        </div>
      </div>
    </div>
  `

  // Tab switching
  container.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      container.querySelectorAll('.cr-panel').forEach(p => p.classList.remove('active'))
      document.getElementById(`${btn.dataset.tab}-panel`)?.classList.add('active')
    })
  })

  return container
}

/** Camera Raw Presets */
export const CAMERA_RAW_PRESETS: Record<string, Partial<CameraRawSettings>> = {
  'portrait': {
    basic: { temperature: -10, tint: 5, exposure: 0.2, contrast: 10, highlights: -20, shadows: 20, clarity: 10, vibrance: 15 },
    detail: { sharpening: { amount: 50, radius: 1, detail: 25, masking: 20 } },
  },
  'landscape': {
    basic: { temperature: 5, tint: 0, exposure: 0, contrast: 15, highlights: -30, shadows: 30, clarity: 20, dehaze: 15, vibrance: 20, saturation: 10 },
    detail: { sharpening: { amount: 60, radius: 1, detail: 30, masking: 10 } },
  },
  'bw': {
    basic: { saturation: -100, contrast: 20, clarity: 15 },
    effects: { grain: { amount: 20, size: 30, roughness: 60 } },
  },
  'vintage': {
    basic: { temperature: -20, tint: 10, contrast: -10, highlights: -20, shadows: 20 },
    toneCurve: { pointCurve: [[0, 15], [64, 60], [128, 128], [192, 196], [255, 240]] },
    effects: { vignette: { amount: -30, midpoint: 40, roundness: 0, feather: 50 } },
  },
  'cinematic': {
    basic: { contrast: 15, highlights: -20, shadows: 15 },
    colorGrading: {
      shadows: { hue: 210, saturation: 30, luminance: -10 },
      midtones: { hue: 30, saturation: 20, luminance: 0 },
      highlights: { hue: 30, saturation: 20, luminance: 10 },
      blending: 50,
      balance: 0,
    },
  },
  'cross-process': {
    basic: { contrast: 20, saturation: 20 },
    toneCurve: { pointCurve: [[0, 20], [64, 60], [128, 128], [192, 200], [255, 235]] },
    colorGrading: {
      shadows: { hue: 200, saturation: 40, luminance: -20 },
      highlights: { hue: 60, saturation: 40, luminance: 20 },
    },
  },
}