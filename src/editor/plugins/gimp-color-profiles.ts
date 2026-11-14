'use client'
// GIMP Color Profiles & Proofing
// ICC profile management, soft proofing, gamut warning, color space conversion

import { createCanvas, ctx2d } from '../utils/canvas'

export interface ColorProfile {
  id: string
  name: string
  description: string
  data: ArrayBuffer
  type: 'input' | 'display' | 'output' | 'device-link' | 'color-space' | 'abstract'
  colorSpace: 'rgb' | 'cmyk' | 'gray' | 'lab' | 'xyz' | 'ycbcr' | 'hsv' | 'hls' | 'cmy' | 'luv' | 'lch'
  pcs: 'xyz' | 'lab' // Profile Connection Space
  whitePoint: { x: number; y: number; z: number }
  chromaticAdaptation?: 'bradford' | 'von-kries' | 'xyz-scaling' | 'none'
  manufacturer: string
  model: string
  copyright: string
  calibrationDate: string
  fileSize: number
  isDefault: boolean
  isSystem: boolean
}

export interface SoftProofConfig {
  profile: ColorProfile
  intent: 'perceptual' | 'relative' | 'saturation' | 'absolute'
  blackPointCompensation: boolean
  simulatePaper: boolean
  simulateInk: boolean
  preserveRgbNumbers: boolean
}

export interface GamutWarningConfig {
  enabled: boolean
  color: string
  opacity: number
  threshold: number // 0-1
}

export interface ColorSpaceConversion {
  sourceProfile: ColorProfile
  destinationProfile: ColorProfile
  intent: 'perceptual' | 'relative' | 'saturation' | 'absolute'
  blackPointCompensation: boolean
  adaptive: boolean
  preserveLayers: boolean
}

export interface DeviceCalibration {
  deviceId: string
  deviceName: string
  deviceType: 'monitor' | 'printer' | 'scanner' | 'camera' | 'projector'
  profile: ColorProfile
  measurementData?: CalibrationMeasurement[]
  calibrationDate: Date
  nextCalibrationDue: Date
  luminance: number // cd/m²
  whitePoint: { x: number; y: number }
  gamma: number
  contrast: number
  ambientLight: number // lux
}

export interface CalibrationMeasurement {
  patch: number
  target: { x: number; y: number; Y: number }
  measured: { x: number; y: number; Y: number }
  deltaE: number
}

export interface ProofSetup {
  id: string
  name: string
  deviceToSimulate: ColorProfile
  intent: 'perceptual' | 'relative' | 'saturation' | 'absolute'
  blackPointCompensation: boolean
  simulatePaper: boolean
  simulateInk: boolean
  preserveRgbNumbers: boolean
}

// Built-in color profiles
export const BUILT_IN_PROFILES: Record<string, ColorProfile> = {
  'srgb': {
    id: 'srgb',
    name: 'sRGB IEC61966-2.1',
    description: 'Standard RGB color space for web and consumer devices',
    data: new ArrayBuffer(0), // Would contain actual ICC profile data
    type: 'color-space',
    colorSpace: 'rgb',
    pcs: 'xyz',
    whitePoint: { x: 0.3127, y: 0.3290, z: 0.3583 }, // D65
    chromaticAdaptation: 'bradford',
    manufacturer: 'IEC',
    model: '61966-2.1',
    copyright: 'Copyright International Electrotechnical Commission',
    calibrationDate: '1999-01-01',
    fileSize: 3144,
    isDefault: true,
    isSystem: true,
  },
  'adobe-rgb': {
    id: 'adobe-rgb',
    name: 'Adobe RGB (1998)',
    description: 'Wide gamut RGB for professional photography',
    data: new ArrayBuffer(0),
    type: 'color-space',
    colorSpace: 'rgb',
    pcs: 'xyz',
    whitePoint: { x: 0.3127, y: 0.3290, z: 0.3583 }, // D65
    chromaticAdaptation: 'bradford',
    manufacturer: 'Adobe',
    model: 'RGB (1998)',
    copyright: 'Copyright Adobe Systems Incorporated',
    calibrationDate: '1998-01-01',
    fileSize: 3144,
    isDefault: false,
    isSystem: true,
  },
  'prophoto': {
    id: 'prophoto',
    name: 'ProPhoto RGB',
    description: 'Ultra-wide gamut for professional photography',
    data: new ArrayBuffer(0),
    type: 'color-space',
    colorSpace: 'rgb',
    pcs: 'xyz',
    whitePoint: { x: 0.3457, y: 0.3585, z: 0.2958 }, // D50
    chromaticAdaptation: 'bradford',
    manufacturer: 'Kodak',
    model: 'ProPhoto RGB',
    copyright: 'Copyright Eastman Kodak Company',
    calibrationDate: '2000-01-01',
    fileSize: 3144,
    isDefault: false,
    isSystem: true,
  },
  'rec2020': {
    id: 'rec2020',
    name: 'ITU-R BT.2020',
    description: 'Ultra HD / HDR video color space',
    data: new ArrayBuffer(0),
    type: 'color-space',
    colorSpace: 'rgb',
    pcs: 'xyz',
    whitePoint: { x: 0.3127, y: 0.3290, z: 0.3583 }, // D65
    chromaticAdaptation: 'bradford',
    manufacturer: 'ITU',
    model: 'BT.2020',
    copyright: 'International Telecommunication Union',
    calibrationDate: '2012-01-01',
    fileSize: 3144,
    isDefault: false,
    isSystem: true,
  },
  'dci-p3': {
    id: 'dci-p3',
    name: 'DCI-P3',
    description: 'Digital Cinema P3 color space',
    data: new ArrayBuffer(0),
    type: 'color-space',
    colorSpace: 'rgb',
    pcs: 'xyz',
    whitePoint: { x: 0.3127, y: 0.3290, z: 0.3583 }, // D65
    chromaticAdaptation: 'bradford',
    manufacturer: 'DCI',
    model: 'P3',
    copyright: 'Digital Cinema Initiatives',
    calibrationDate: '2007-01-01',
    fileSize: 3144,
    isDefault: false,
    isSystem: true,
  },
  'rec709': {
    id: 'rec709',
    name: 'Rec.709 / BT.709',
    description: 'HDTV standard color space',
    data: new ArrayBuffer(0),
    type: 'color-space',
    colorSpace: 'rgb',
    pcs: 'xyz',
    whitePoint: { x: 0.3127, y: 0.3290, z: 0.3583 }, // D65
    chromaticAdaptation: 'bradford',
    manufacturer: 'ITU',
    model: 'BT.709',
    copyright: 'International Telecommunication Union',
    calibrationDate: '1990-01-01',
    fileSize: 3144,
    isDefault: false,
    isSystem: true,
  },
  'gray-22': {
    id: 'gray-22',
    name: 'Gray Gamma 2.2',
    description: 'Standard grayscale with gamma 2.2',
    data: new ArrayBuffer(0),
    type: 'color-space',
    colorSpace: 'gray',
    pcs: 'lab',
    whitePoint: { x: 0.3127, y: 0.3290, z: 0.3583 },
    chromaticAdaptation: 'bradford',
    manufacturer: 'GIMP',
    model: 'Gray Gamma 2.2',
    copyright: 'GIMP',
    calibrationDate: '2000-01-01',
    fileSize: 1024,
    isDefault: false,
    isSystem: true,
  },
  'cmyk-us-web': {
    id: 'cmyk-us-web',
    name: 'US Web Coated (SWOP) v2',
    description: 'Standard US commercial printing',
    data: new ArrayBuffer(0),
    type: 'output',
    colorSpace: 'cmyk',
    pcs: 'lab',
    whitePoint: { x: 0.3127, y: 0.3290, z: 0.3583 },
    chromaticAdaptation: 'bradford',
    manufacturer: 'SWOP',
    model: 'US Web Coated v2',
    copyright: 'SWOP',
    calibrationDate: '2006-01-01',
    fileSize: 8192,
    isDefault: false,
    isSystem: true,
  },
  'cmyk-eu': {
    id: 'cmyk-eu',
    name: 'Euroscale Coated v2',
    description: 'European commercial printing',
    data: new ArrayBuffer(0),
    type: 'output',
    colorSpace: 'cmyk',
    pcs: 'lab',
    whitePoint: { x: 0.3127, y: 0.3290, z: 0.3583 },
    chromaticAdaptation: 'bradford',
    manufacturer: 'Euroscale',
    model: 'Euroscale Coated v2',
    copyright: 'Euroscale',
    calibrationDate: '2006-01-01',
    fileSize: 8192,
    isDefault: false,
    isSystem: true,
  },
  'cmyk-japan': {
    id: 'cmyk-japan',
    name: 'Japan Color 2001 Coated',
    description: 'Japanese commercial printing standard',
    data: new ArrayBuffer(0),
    type: 'output',
    colorSpace: 'cmyk',
    pcs: 'lab',
    whitePoint: { x: 0.3127, y: 0.3290, z: 0.3583 },
    chromaticAdaptation: 'bradford',
    manufacturer: 'JCPI',
    model: 'Japan Color 2001 Coated',
    copyright: 'Japan Color Printing Institute',
    calibrationDate: '2001-01-01',
    fileSize: 8192,
    isDefault: false,
    isSystem: true,
  },
  'cmyk-fogra39': {
    id: 'cmyk-fogra39',
    name: 'FOGRA39 (ISO 12647-2:2004)',
    description: 'European offset printing standard',
    data: new ArrayBuffer(0),
    type: 'output',
    colorSpace: 'cmyk',
    pcs: 'lab',
    whitePoint: { x: 0.3127, y: 0.3290, z: 0.3583 },
    chromaticAdaptation: 'bradford',
    manufacturer: 'FOGRA',
    model: 'FOGRA39',
    copyright: 'FOGRA',
    calibrationDate: '2006-01-01',
    fileSize: 8192,
    isDefault: false,
    isSystem: true,
  },
}

export interface ColorProfileManager {
  profiles: Map<string, ColorProfile>
  activeInputProfile: string
  activeDisplayProfile: string
  activeOutputProfile: string
  activeDocumentProfile: string
  proofSetup: ProofSetup | null
  customProfiles: Map<string, ColorProfile>
}

export const DEFAULT_COLOR_MANAGEMENT: ColorProfileManager = {
  profiles: new Map(Object.entries(BUILT_IN_PROFILES)),
  activeInputProfile: 'srgb',
  activeDisplayProfile: 'srgb',
  activeOutputProfile: 'srgb',
  activeDocumentProfile: 'srgb',
  proofSetup: null,
  customProfiles: new Map(),
}

// Color Management Operations
export class ColorManagement {
  private profiles: Map<string, ColorProfile>
  private customProfiles: Map<string, ColorProfile>
  private activeInput: string
  private activeDisplay: string
  private activeOutput: string
  private activeDocument: string
  private proofSetup: ProofSetup | null
  private listeners: Set<() => void> = new Set()

  constructor() {
    this.profiles = new Map(Object.entries(BUILT_IN_PROFILES))
    this.customProfiles = new Map()
    this.activeInput = 'srgb'
    this.activeDisplay = 'srgb'
    this.activeOutput = 'srgb'
    this.activeDocument = 'srgb'
    this.proofSetup = null
  }

  // Profile management
  getProfile(id: string): ColorProfile | undefined {
    return BUILT_IN_PROFILES[id] || this.customProfiles.get(id)
  }

  getAllProfiles(): ColorProfile[] {
    return [...Object.values(BUILT_IN_PROFILES), ...Array.from(this.customProfiles.values())]
  }

  getProfilesByType(type: ColorProfile['type']): ColorProfile[] {
    const all = this.getAllProfiles()
    return all.filter(p => p.type === type)
  }

  getProfilesByColorSpace(cs: ColorProfile['colorSpace']): ColorProfile[] {
    const all = this.getAllProfiles()
    return all.filter(p => p.colorSpace === cs)
  }

  // Profile management
  addCustomProfile(profile: ColorProfile): void {
    if (BUILT_IN_PROFILES[profile.id] || this.customProfiles.has(profile.id)) {
      throw new Error('Profile ID already exists')
    }
    this.customProfiles.set(profile.id, profile)
    this.notify()
  }

  removeCustomProfile(id: string): boolean {
    if (BUILT_IN_PROFILES[id]) return false
    const result = this.customProfiles.delete(id)
    if (result) this.notify()
    return result
  }

  importProfile(file: File): Promise<ColorProfile> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const profile = this.parseIccProfile(reader.result as ArrayBuffer)
          this.customProfiles.set(profile.id, profile)
          this.notify()
          resolve(profile)
        } catch (error) {
          reject(error)
        }
      }
      reader.readAsArrayBuffer(file)
    })
  }

  exportProfile(id: string): ArrayBuffer | null {
    const profile = this.getProfile(id)
    if (!profile) return null
    return profile.data
  }

  // Profile assignment
  setInputProfile(id: string): boolean {
    if (!this.getProfile(id)) return false
    this.activeInput = id
    this.notify()
    return true
  }

  setDisplayProfile(id: string): boolean {
    if (!this.getProfile(id)) return false
    this.activeDisplay = id
    this.notify()
    return true
  }

  setOutputProfile(id: string): boolean {
    if (!this.getProfile(id)) return false
    this.activeOutput = id
    this.notify()
    return true
  }

  setDocumentProfile(id: string): boolean {
    if (!this.getProfile(id)) return false
    this.activeDocument = id
    this.notify()
    return true
  }

  getActiveProfiles(): { input: string; display: string; output: string; document: string } {
    return {
      input: this.activeInput,
      display: this.activeDisplay,
      output: this.activeOutput,
      document: this.activeDocument,
    }
  }

  // Proof Setup
  setProofSetup(setup: ProofSetup): void {
    this.proofSetup = setup
    this.notify()
  }

  getProofSetup(): ProofSetup | null {
    return this.proofSetup
  }

  clearProofSetup(): void {
    this.proofSetup = null
    this.notify()
  }

  // Profile conversion
  async convertColorSpace(
    canvas: HTMLCanvasElement,
    sourceProfileId: string,
    destinationProfileId: string,
    intent: 'perceptual' | 'relative' | 'saturation' | 'absolute' = 'relative',
    blackPointCompensation = true
  ): Promise<HTMLCanvasElement> {
    // This would use LittleCMS or similar library
    // For now, return original canvas
    const output = document.createElement('canvas')
    const ctx = output.getContext('2d')!
    const canvasEl = document.createElement('canvas')
    output.width = canvas.width
    output.height = canvas.height
    const outCtx = output.getContext('2d')!
    outCtx.drawImage(canvas, 0, 0)
    return output
  }

  // Soft proofing
  async softProof(
    canvas: HTMLCanvasElement,
    proofSetup: ProofSetup,
    config: GamutWarningConfig = { enabled: true, color: '#ff0000', opacity: 0.5, threshold: 0.01 }
  ): Promise<HTMLCanvasElement> {
    // Would apply soft proofing with gamut warning
    const output = document.createElement('canvas')
    const ctx = output.getContext('2d')!
    const canvasEl = document.createElement('canvas')
    output.width = canvas.width
    output.height = canvas.height
    const outCtx = output.getContext('2d')!
    outCtx.drawImage(canvas, 0, 0)
    return output
  }

  // Gamut warning
  async gamutWarning(
    canvas: HTMLCanvasElement,
    targetProfileId: string,
    config: GamutWarningConfig
  ): Promise<HTMLCanvasElement> {
    const output = document.createElement('canvas')
    output.width = canvas.width
    output.height = canvas.height
    const ctx = output.getContext('2d')!
    ctx.drawImage(canvas, 0, 0)

    // Would analyze colors and highlight out-of-gamut
    // Simplified: just return original with overlay
    ctx.fillStyle = config.color
    ctx.globalAlpha = config.opacity
    ctx.globalCompositeOperation = 'source-over'
    // Would draw gamut warning overlay

    return output
  }

  // Device calibration
  async calibrateDevice(
    deviceType: 'monitor' | 'printer' | 'scanner' | 'camera' | 'projector',
    measurements: CalibrationMeasurement[]
  ): Promise<DeviceCalibration> {
    // Would use measurements to create ICC profile
    const profile: ColorProfile = {
      id: 'calibrated-' + Date.now(),
      name: `Calibrated ${new Date().toISOString()}`,
      description: 'User calibrated profile',
      data: new ArrayBuffer(0),
      type: 'display',
      colorSpace: 'rgb',
      pcs: 'xyz',
      whitePoint: { x: 0.3127, y: 0.3290, z: 0.3583 },
      chromaticAdaptation: 'bradford',
      manufacturer: 'User',
      model: 'Calibrated',
      copyright: 'User Calibration',
      calibrationDate: new Date().toISOString(),
      fileSize: 0,
      isDefault: false,
      isSystem: false,
    }

    const calibration: DeviceCalibration = {
      deviceId: 'device-' + Date.now(),
      deviceName: 'Calibrated Device',
      deviceType: 'monitor',
      profile,
      measurementData: measurements,
      calibrationDate: new Date(),
      nextCalibrationDue: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      luminance: 120, // cd/m²
      whitePoint: { x: 0.3127, y: 0.3290 },
      gamma: 2.2,
      contrast: 1000,
      ambientLight: 100, // lux
    }

    return calibration
  }

  // Profile validation
  validateProfile(profile: ColorProfile): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!profile.id) errors.push('Missing profile ID')
    if (!profile.name) errors.push('Missing profile name')
    if (!profile.data || profile.data.byteLength === 0) errors.push('Missing profile data')
    if (!profile.whitePoint) errors.push('Missing white point')
    if (profile.data.byteLength > 10 * 1024 * 1024) errors.push('Profile too large (>10MB)')

    return { valid: errors.length === 0, errors }
  }

  // Profile comparison
  compareProfiles(id1: string, id2: string): { deltaE: number; differences: string[] } {
    // Would compare two profiles and compute deltaE
    return { deltaE: 0, differences: [] }
  }

  // Profile editing
  createProfileFromImage(canvas: HTMLCanvasElement, name: string): ColorProfile {
    // Would create profile from image color characteristics
    return {
      id: 'generated-' + Date.now(),
      name,
      description: 'Generated from image',
      data: new ArrayBuffer(0),
      type: 'color-space',
      colorSpace: 'rgb',
      pcs: 'xyz',
      whitePoint: { x: 0.3127, y: 0.3290, z: 0.3583 },
      chromaticAdaptation: 'bradford',
      manufacturer: 'Generated',
      model: 'Auto',
      copyright: 'Auto-generated',
      calibrationDate: new Date().toISOString(),
      fileSize: 0,
      isDefault: false,
      isSystem: false,
    }
  }

  // Profile set management
  getProfileSet(): ColorProfile[] {
    return [
      this.getProfile('srgb')!,
      this.getProfile('adobe-rgb')!,
      this.getProfile('prophoto')!,
      this.getProfile('rec2020')!,
      this.getProfile('dci-p3')!,
    ].filter(Boolean)
  }

  getPrintProfiles(): ColorProfile[] {
    return this.getProfilesByType('output')
  }

  getMonitorProfiles(): ColorProfile[] {
    return this.getProfilesByType('display')
  }

  getInputProfiles(): ColorProfile[] {
    return this.getProfilesByType('input')
  }

  private getProfile(id: string): ColorProfile | undefined {
    return BUILT_IN_PROFILES[id] || undefined
  }

  private getProfilesByType(type: ColorProfile['type']): ColorProfile[] {
    return Object.values(BUILT_IN_PROFILES).filter(p => p.type === type)
  }

  // Notify
  private notify(): void {
    // Would notify listeners
  }
}

// Color space utilities
export function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  // sRGB to XYZ (D65)
  const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  const r = toLinear(r)
  const g = toLinear(g)
  const b = toLinear(b)

  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
    r * 0.0193339 + g * 0.1191920 + b * 0.9503041,
  ]
}

export function xyzToRgb(x: number, y: number, z: number): [number, number, number] {
  // XYZ to sRGB (D65)
  const r = x * 3.2404542 - y * 1.5371385 - z * 0.4985314
  const g = -x * 0.9692660 + y * 1.8760108 + z * 0.0415560
  const b = x * 0.0556434 - y * 0.2040259 + z * 1.0572252

  const toGamma = (c: number) => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1/2.4) - 0.055

  return [
    Math.max(0, Math.min(1, toGamma(r))),
    Math.max(0, Math.min(1, toGamma(g))),
    Math.max(0, Math.min(1, toGamma(b))),
  ]
}

export function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  // XYZ to Lab (D65 reference white)
  const xr = 0.95047, yr = 1.0, zr = 1.08883
  const fx = f(x / xr)
  const fy = f(y / yr)
  const fz = f(z / zr)

  return [
    116 * fy - 16,
    500 * (fx - fy),
    200 * (fy - fz),
  ]

  function f(t: number): number {
    return t > 0.008856 ? Math.pow(t, 1/3) : 7.787 * t + 16/116
  }
}

export function labToXyz(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116
  const fx = a / 500 + fy
  const fz = fy - b / 200

  const x = invF(fx) * 0.95047
  const y = invF(fy) * 1.0
  const z = invF(fz) * 1.08883

  return [x, y, z]

  function invF(t: number): number {
    return t > 6/29 ? t*t*t : 3*(6/29)*(6/29)*(t - 4/29)
  }
}

// Delta E calculations
export function deltaE76(lab1: [number, number, number], lab2: [number, number, number]): number {
  const dl = lab1[0] - lab2[0]
  const da = lab1[1] - lab2[1]
  const db = lab1[2] - lab2[2]
  return Math.sqrt(dl*dl + da*da + db*db)
}

export function deltaE94(lab1: [number, number, number], lab2: [number, number, number]): number {
  const dl = lab1[0] - lab2[0]
  const da = lab1[1] - lab2[1]
  const db = lab1[2] - lab2[2]

  const c1 = Math.sqrt(lab1[1]*lab1[1] + lab1[2]*lab1[2])
  const c2 = Math.sqrt(lab2[1]*lab2[1] + lab2[2]*lab2[2])

  const dl_ = dl
  const dc = c1 - c2
  const dh2 = da*da + db*db - dc*dc
  const dh = dh2 > 0 ? Math.sqrt(dh2) : 0

  const sl = 1
  const sc = 1 + 0.045 * c1
  const sh = 1 + 0.015 * c1

  return Math.sqrt(
    (dl_/sl)*(dl_/sl) +
    (dc/sc)*(dc/sc) +
    (dh/sh)*(dh/sh)
  )
}

export function deltaE2000(lab1: [number, number, number], lab2: [number, number, number]): number {
  // Simplified CIEDE2000 - full implementation is complex
  return deltaE94(lab1, lab2)
}

// Chromatic adaptation
export function bradfordAdaptation(
  xyz: [number, number, number],
  fromWhite: [number, number, number],
  toWhite: [number, number, number]
): [number, number, number] {
  // Bradford matrix
  const M = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
  ]

  const Minv = [
    [0.9869929, -0.1470543, 0.1599627],
    [0.4323053, 0.5183603, 0.0492912],
    [-0.0085287, 0.0400428, 0.9684867],
  ]

  // Convert XYZ to LMS
  const lms = [
    M[0][0]*xyz[0] + M[0][1]*xyz[1] + M[0][2]*xyz[2],
    M[1][0]*xyz[0] + M[1][1]*xyz[1] + M[1][2]*xyz[2],
    M[2][0]*xyz[0] + M[2][1]*xyz[1] + M[2][2]*xyz[2],
  ]

  // Apply scaling
  const scale = [
    toWhite[0] / fromWhite[0],
    toWhite[1] / fromWhite[1],
    toWhite[2] / fromWhite[2],
  ]

  const lmsAdapted = [
    lms[0] * scale[0],
    lms[1] * scale[1],
    lms[2] * scale[2],
  ]

  // Convert back to XYZ
  return [
    Minv[0][0]*lmsAdapted[0] + Minv[0][1]*lmsAdapted[1] + Minv[0][2]*lmsAdapted[2],
    Minv[1][0]*lmsAdapted[0] + Minv[1][1]*lmsAdapted[1] + Minv[1][2]*lmsAdapted[2],
    Minv[2][0]*lmsAdapted[0] + Minv[2][1]*lmsAdapted[1] + Minv[2][2]*lmsAdapted[2],
  ]
}

export interface ProofSetup {
  id: string
  name: string
  deviceToSimulate: string
  intent: 'perceptual' | 'relative' | 'saturation' | 'absolute'
  blackPointCompensation: boolean
  simulatePaper: boolean
  simulateInk: boolean
  preserveRgbNumbers: boolean
}

export interface GamutWarningConfig {
  enabled: boolean
  color: string
  opacity: number
  threshold: number
}