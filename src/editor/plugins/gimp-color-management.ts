'use client'
// GIMP-style Color Management
// ICC profile support, color space conversions, soft proofing

export type ColorSpace = 'sRGB' | 'AdobeRGB' | 'ProPhotoRGB' | 'Rec2020' | 'Rec709' | 'DCI-P3' | 'Gray' | 'CMYK' | 'Lab'

export interface ICCProfile {
  name: string
  data: ArrayBuffer
  colorSpace: ColorSpace
  description: string
  manufacturer: string
  model: string
  copyright: string
}

export interface ColorManagedImage {
  canvas: HTMLCanvasElement
  profile: ICCProfile | null
  assignedProfile: ICCProfile | null // the profile we're treating it as
}

export interface SoftProofConfig {
  intent: 'perceptual' | 'relative' | 'saturation' | 'absolute'
  blackPointCompensation: boolean
  simulatePaper: boolean
  simulateInk: boolean
}

// Built-in sRGB profile (simplified)
export const SRGB_PROFILE: ICCProfile = {
  name: 'sRGB IEC61966-2.1',
  data: new ArrayBuffer(0), // Would contain actual ICC profile bytes
  colorSpace: 'sRGB',
  description: 'Standard RGB color space',
  manufacturer: 'IEC',
  model: '61966-2.1',
  copyright: 'Copyright International Electrotechnical Commission',
}

// Built-in profiles
export const BUILT_IN_PROFILES: Record<string, ICCProfile> = {
  sRGB: SRGB_PROFILE,
  AdobeRGB: {
    name: 'Adobe RGB (1998)',
    data: new ArrayBuffer(0),
    colorSpace: 'AdobeRGB',
    description: 'Adobe RGB (1998)',
    manufacturer: 'Adobe',
    model: 'RGB (1998)',
    copyright: 'Copyright Adobe Systems Incorporated',
  },
  ProPhotoRGB: {
    name: 'ProPhoto RGB',
    data: new ArrayBuffer(0),
    colorSpace: 'ProPhotoRGB',
    description: 'ProPhoto RGB (ROMM RGB)',
    manufacturer: 'Kodak',
    model: 'ProPhoto RGB',
    copyright: 'Copyright Eastman Kodak Company',
  },
  Rec2020: {
    name: 'ITU-R BT.2020',
    data: new ArrayBuffer(0),
    colorSpace: 'Rec2020',
    description: 'Ultra HD TV color space',
    manufacturer: 'ITU',
    model: 'BT.2020',
    copyright: 'International Telecommunication Union',
  },
  DCI_P3: {
    name: 'DCI-P3',
    data: new ArrayBuffer(0),
    colorSpace: 'DCI-P3',
    description: 'Digital Cinema P3',
    manufacturer: 'DCI',
    model: 'P3',
    copyright: 'Digital Cinema Initiatives',
  },
  Gray: {
    name: 'Gray Gamma 2.2',
    data: new ArrayBuffer(0),
    colorSpace: 'Gray',
    description: 'Grayscale with gamma 2.2',
    manufacturer: 'GIMP',
    model: 'Gray Gamma 2.2',
    copyright: 'GIMP',
  },
}

// ============================================================
// Color space conversion matrices
// ============================================================

// Bradford adaptation matrix
const BRADFORD = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
]

// sRGB to XYZ (D65)
const SRGB_TO_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.0721750],
  [0.0193339, 0.1191920, 0.9503041],
]

// XYZ to sRGB (D65)
const XYZ_TO_SRGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.9692660, 1.8760108, 0.0415560],
  [0.0556434, -0.2040259, 1.0572252],
]

// Adobe RGB to XYZ (D65)
const ADOBERGB_TO_XYZ = [
  [0.5767309, 0.1855540, 0.1881852],
  [0.2973769, 0.6273491, 0.0752741],
  [0.0270343, 0.0706872, 0.9911085],
]

// ProPhoto RGB to XYZ (D50)
const PROPHOTO_TO_XYZ_D50 = [
  [0.7976749, 0.1351917, 0.0313534],
  [0.2880402, 0.7118741, 0.0000857],
  [0.0000000, 0.0000000, 0.8252100],
]

// D50 to D65 Bradford adaptation
function adaptXYZ(xyz: number[], fromD50 = false, toD50 = false): number[] {
  if (!fromD50 && !toD50) return xyz
  // Simplified - would use full Bradford transform
  return xyz
}

function multiplyMatrixVector(m: number[][], v: number[]): number[] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}

function sRGBToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSRGB(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function adobeRGBToLinear(c: number): number {
  return Math.pow(c, 2.19921875) // 1/2.2 approx
}

function linearToAdobeRGB(c: number): number {
  return Math.pow(c, 1 / 2.19921875)
}

function proPhotoToLinear(c: number): number {
  const E = 16 / 512
  return c <= E ? c / 16 : Math.pow(c, 1.8)
}

function linearToProPhoto(c: number): number {
  const E = 16 / 512
  return c <= E ? 16 * c : Math.pow(c, 1 / 1.8)
}

// ============================================================
// Public conversion functions
// ============================================================

export function convertColorSpace(
  r: number, g: number, b: number,
  fromSpace: ColorSpace,
  toSpace: ColorSpace
): [number, number, number] {
  // Normalize to 0-1
  const rgb = [r / 255, g / 255, b / 255]

  // Convert from source to linear RGB
  let linear: number[]
  switch (fromSpace) {
    case 'sRGB':
      linear = rgb.map(sRGBToLinear)
      break
    case 'AdobeRGB':
      linear = rgb.map(adobeRGBToLinear)
      break
    case 'ProPhotoRGB':
      linear = rgb.map(proPhotoToLinear)
      break
    case 'Rec2020':
      linear = rgb.map(c => c <= 0.081242894 ? c / 4.5 : Math.pow((c + 0.0993) / 1.0993, 1 / 0.45))
      break
    case 'DCI-P3':
      linear = rgb.map(c => Math.pow(c, 2.6))
      break
    case 'Gray':
      linear = [rgb[0], rgb[0], rgb[0]]
      break
    default:
      linear = rgb
  }

  // Convert linear to XYZ (assuming D65 for most)
  let xyz: number[]
  switch (fromSpace) {
    case 'sRGB':
    case 'Rec2020':
    case 'DCI-P3':
      xyz = multiplyMatrixVector(SRGB_TO_XYZ, linear)
      break
    case 'AdobeRGB':
      xyz = multiplyMatrixVector(ADOBERGB_TO_XYZ, linear)
      break
    case 'ProPhotoRGB':
      // ProPhoto uses D50, would need adaptation
      xyz = multiplyMatrixVector(PROPHOTO_TO_XYZ_D50, linear)
      break
    default:
      xyz = multiplyMatrixVector(SRGB_TO_XYZ, linear)
  }

  // Convert XYZ to destination linear
  let destLinear: number[]
  switch (toSpace) {
    case 'sRGB':
      destLinear = multiplyMatrixVector(XYZ_TO_SRGB, xyz)
      break
    case 'AdobeRGB':
      // Would need inverse of ADOBERGB_TO_XYZ
      destLinear = multiplyMatrixVector(XYZ_TO_SRGB, xyz) // Approximation
      break
    case 'ProPhotoRGB':
      // Would need inverse of PROPHOTO_TO_XYZ_D50
      destLinear = multiplyMatrixVector(XYZ_TO_SRGB, xyz) // Approximation
      break
    default:
      destLinear = multiplyMatrixVector(XYZ_TO_SRGB, xyz)
  }

  // Convert linear to destination encoding
  let result: number[]
  switch (toSpace) {
    case 'sRGB':
      result = destLinear.map(linearToSRGB)
      break
    case 'AdobeRGB':
      result = destLinear.map(linearToAdobeRGB)
      break
    case 'ProPhotoRGB':
      result = destLinear.map(linearToProPhoto)
      break
    case 'Rec2020':
      result = destLinear.map(c => c <= 0.018053968510807 ? 4.5 * c : 1.0993 * Math.pow(c, 0.45) - 0.0993)
      break
    case 'DCI-P3':
      result = destLinear.map(c => Math.pow(c, 1 / 2.6))
      break
    case 'Gray':
      result = [destLinear[0], destLinear[0], destLinear[0]]
      break
    default:
      result = destLinear.map(linearToSRGB)
  }

  // Clamp and return 0-255
  return [
    Math.round(Math.max(0, Math.min(255, result[0] * 255))),
    Math.round(Math.max(0, Math.min(255, result[1] * 255))),
    Math.round(Math.max(0, Math.min(255, result[2] * 255))),
  ]
}

/** Convert entire canvas from one color space to another */
export async function convertCanvasColorSpace(
  canvas: HTMLCanvasElement,
  fromSpace: ColorSpace,
  toSpace: ColorSpace,
  intent: 'perceptual' | 'relative' | 'saturation' | 'absolute' = 'relative'
): Promise<HTMLCanvasElement> {
  if (fromSpace === toSpace) return canvas

  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data

  // Process in chunks for large images
  const chunkSize = 10000
  for (let i = 0; i < data.length; i += chunkSize * 4) {
    const end = Math.min(i + chunkSize * 4, data.length)
    for (let j = i; j < end; j += 4) {
      const [r, g, b] = convertColorSpace(data[j], data[j + 1], data[j + 2], fromSpace, toSpace)
      data[j] = r
      data[j + 1] = g
      data[j + 2] = b
      // Alpha unchanged
    }
    // Yield to main thread occasionally
    if (i % (chunkSize * 10) === 0) await new Promise(r => setTimeout(r, 0))
  }

  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const outCtx = output.getContext('2d')!
  outCtx.putImageData(img, 0, 0)
  return output
}

/** Assign a profile (changes interpretation, not pixel values) */
export function assignProfile(image: ColorManagedImage, profile: ICCProfile): ColorManagedImage {
  return { ...image, assignedProfile: profile }
}

/** Convert to profile (changes pixel values to match new profile) */
export async function convertToProfile(image: ColorManagedImage, profile: ICCProfile, intent: SoftProofConfig['intent'] = 'relative'): Promise<ColorManagedImage> {
  if (!image.assignedProfile) {
    // Assume sRGB if unassigned
    image.assignedProfile = SRGB_PROFILE
  }
  const converted = await convertCanvasColorSpace(image.canvas, image.assignedProfile.colorSpace, profile.colorSpace, intent)
  return { canvas: converted, profile, assignedProfile: profile }
}

// ============================================================
// Soft Proofing
// ============================================================

export async function softProof(
  canvas: HTMLCanvasElement,
  displayProfile: ICCProfile,
  proofProfile: ICCProfile,
  config: SoftProofConfig
): Promise<HTMLCanvasElement> {
  // Simplified: convert to proof space, then back to display space
  const inProof = await convertCanvasColorSpace(canvas, displayProfile.colorSpace, proofProfile.colorSpace, config.intent)
  if (config.simulatePaper || config.simulateInk) {
    // Would apply paper/ink simulation here
  }
  return convertCanvasColorSpace(inProof, proofProfile.colorSpace, displayProfile.colorSpace, config.intent)
}

// ============================================================
// Color space info for UI
// ============================================================

export const COLOR_SPACE_INFO: Record<ColorSpace, { name: string; description: string; gamut: string; useCases: string[] }> = {
  sRGB: { name: 'sRGB', description: 'Standard web/desktop color space', gamut: '~35% visible', useCases: ['Web', 'Email', 'Standard monitors'] },
  AdobeRGB: { name: 'Adobe RGB (1998)', description: 'Wider gamut for print', gamut: '~50% visible', useCases: ['Print', 'Photography', 'High-end monitors'] },
  ProPhotoRGB: { name: 'ProPhoto RGB', description: 'Very wide gamut, includes imaginary colors', gamut: '~90% visible', useCases: ['Archival', 'High-end print', 'HDR'] },
  Rec2020: { name: 'Rec.2020 (BT.2020)', description: 'Ultra HD / HDR video', gamut: '~75% visible', useCases: ['4K/8K video', 'HDR content', 'Wide gamut displays'] },
  'DCI-P3': { name: 'DCI-P3', description: 'Digital cinema standard', gamut: '~45% visible', useCases: ['Cinema', 'Apple displays', 'HDR'] },
  Rec709: { name: 'Rec.709 (BT.709)', description: 'HD TV standard (same as sRGB primaries)', gamut: '~35% visible', useCases: ['HD video', 'Broadcast'] },
  Gray: { name: 'Grayscale', description: 'Single channel luminance', gamut: 'N/A', useCases: ['Masks', 'Alpha channels', 'B&W print'] },
  CMYK: { name: 'CMYK', description: 'Print color space (device-dependent)', gamut: 'Varies by press', useCases: ['Commercial print', 'Offset', 'Packaging'] },
  Lab: { name: 'CIE Lab', description: 'Perceptually uniform, device-independent', gamut: 'All visible colors', useCases: ['Color science', 'Profile connection', 'Color editing'] },
}

export function getColorSpaceInfo(space: ColorSpace) {
  return COLOR_SPACE_INFO[space]
}

export function listColorSpaces(): ColorSpace[] {
  return Object.keys(COLOR_SPACE_INFO) as ColorSpace[]
}