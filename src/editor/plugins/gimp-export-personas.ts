'use client'
// GIMP Export Personas
// Quick export presets with format, quality, metadata, naming, and destination

export interface ExportPersona {
  id: string
  name: string
  description: string
  icon: string
  category: 'web' | 'print' | 'social' | 'archive' | 'custom'
  format: ExportFormat
  quality: number // 0-100
  metadata: ExportMetadataOptions
  naming: ExportNamingOptions
  destination: ExportDestination
  transformations: ExportTransformation[]
  colorSpace: ExportColorSpace
  postProcess?: ExportPostProcess
  shortcut?: string
}

export type ExportFormat = 'png' | 'jpg' | 'jpeg' | 'webp' | 'avif' | 'tiff' | 'tif' | 'psd' | 'psb' | 'gif' | 'bmp' | 'ico' | 'pdf' | 'svg' | 'exr' | 'hdr'

export interface ExportMetadataOptions {
  includeExif: boolean
  includeXmp: boolean
  includeIptc: boolean
  includeIccProfile: boolean
  includeColorProfile: boolean
  stripGps: boolean
  stripPersonal: boolean
  addCopyright: string
  copyrightUrl?: string
  customXmp?: Record<string, string>
}

export interface ExportNamingOptions {
  pattern: string // e.g., "{name}_{width}x{height}_{date}.{ext}"
  overwriteExisting: boolean
  createFolders: boolean
  folderPattern?: string
  conflictResolution: 'overwrite' | 'rename' | 'skip' | 'ask'
  sequentialStart: number
  sequentialPadding: number
}

export interface ExportDestination {
  type: 'folder' | 'clipboard' | 'email' | 'cloud' | 'ftp' | 'api'
  path?: string
  createIfMissing: boolean
  cloudProvider?: 'google-drive' | 'dropbox' | 'onedrive' | 'icloud'
  ftpConfig?: FtpConfig
  apiConfig?: ApiConfig
}

export interface FtpConfig {
  host: string
  port: number
  username: string
  password: string
  remotePath: string
  passive: boolean
  secure: boolean
}

export interface ApiConfig {
  endpoint: string
  method: 'POST' | 'PUT'
  headers: Record<string, string>
  authToken?: string
  fileFieldName: string
}

export interface ExportTransformation {
  type: 'resize' | 'crop' | 'rotate' | 'flip' | 'color-space' | 'sharpen' | 'watermark' | 'border' | 'canvas-size'
  params: Record<string, any>
  enabled: boolean
  order: number
}

export interface ExportColorSpace {
  source: string // 'auto' or specific
  destination: string
  intent: 'perceptual' | 'relative' | 'saturation' | 'absolute'
  blackPointCompensation: boolean
  simulatePaper: boolean
  simulateInk: boolean
}

export interface ExportPostProcess {
  action: 'open-folder' | 'copy-path' | 'show-notification' | 'run-script' | 'none'
  scriptPath?: string
  notificationMessage?: string
}

export interface ExportJob {
  id: string
  personaId: string
  files: File[]
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: number
  currentFile: string
  processedCount: number
  totalFiles: number
  startTime: number
  endTime?: number
  errors: Array<{ file: string; error: string }>
  outputs: Array<{ original: string; output: string; size: number }>
}

export interface ExportPreset {
  id: string
  name: string
  description: string
  personas: string[] // persona IDs to run in sequence
  matchPattern?: string // file pattern to auto-apply
}

// Built-in Export Personas
export const BUILT_IN_EXPORT_PERSONAS: ExportPersona[] = [
  // Web Personas
  {
    id: 'web-standard',
    name: 'Web Standard',
    description: 'Optimized for web use with good quality/size balance',
    icon: '🌐',
    category: 'web',
    format: 'webp',
    quality: 85,
    metadata: {
      includeExif: false,
      includeXmp: false,
      includeIptc: false,
      includeIccProfile: true,
      includeColorProfile: true,
      stripGps: true,
      stripPersonal: true,
      addCopyright: 'Chay\'s Photo Studio',
    },
    naming: {
      pattern: '{name}_web_{width}x{height}.{ext}',
      overwriteExisting: false,
      createFolders: true,
      conflictResolution: 'rename',
      sequentialStart: 1,
      sequentialPadding: 3,
    },
    destination: { type: 'folder', path: '~/Exports/Web', createIfMissing: true },
    transformations: [
      { type: 'resize', params: { width: 1920, height: 1080, maintainAspect: true }, enabled: true, order: 1 },
      { type: 'sharpen', params: { amount: 25, radius: 0.5 }, enabled: true, order: 2 },
    ],
    colorSpace: { source: 'auto', destination: 'sRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
  },
  {
    id: 'web-retina',
    name: 'Web Retina / HiDPI',
    description: '2x resolution for retina displays',
    icon: '📱',
    category: 'web',
    format: 'webp',
    quality: 90,
    metadata: { includeExif: false, includeXmp: false, includeIptc: false, includeIccProfile: true, includeColorProfile: true, stripGps: true, stripPersonal: true, addCopyright: 'Chay\'s Photo Studio' },
    naming: { pattern: '{name}@2x_{width}x{height}.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 3 },
    destination: { type: 'folder', path: '~/Exports/Web/Retina', createIfMissing: true },
    transformations: [
      { type: 'resize', params: { width: 3840, height: 2160, maintainAspect: true }, enabled: true, order: 1 },
      { type: 'sharpen', params: { amount: 30, radius: 0.5 }, enabled: true, order: 2 },
    ],
    colorSpace: { source: 'auto', destination: 'sRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
  },
  {
    id: 'web-thumbnail',
    name: 'Web Thumbnail',
    description: 'Small thumbnails for galleries',
    icon: '🖼️',
    category: 'web',
    format: 'webp',
    quality: 80,
    metadata: { includeExif: false, includeXmp: false, includeIptc: false, includeIccProfile: false, includeColorProfile: false, stripGps: true, stripPersonal: true, addCopyright: '' },
    naming: { pattern: '{name}_thumb_{width}x{height}.{ext}', overwriteExisting: true, createFolders: true, conflictResolution: 'overwrite', sequentialStart: 1, sequentialPadding: 2 },
    destination: { type: 'folder', path: '~/Exports/Web/Thumbs', createIfMissing: true },
    transformations: [
      { type: 'resize', params: { width: 256, height: 256, maintainAspect: true, fit: 'cover' }, enabled: true, order: 1 },
      { type: 'crop', params: { x: 0, y: 0, width: 256, height: 256, anchor: 'center' }, enabled: true, order: 2 },
    ],
    colorSpace: { source: 'auto', destination: 'sRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
  },

  // Social Media Personas
  {
    id: 'instagram-post',
    name: 'Instagram Post (1:1)',
    description: 'Square format for Instagram feed',
    icon: '📸',
    category: 'social',
    format: 'jpg',
    quality: 90,
    metadata: { includeExif: false, includeXmp: false, includeIptc: false, includeIccProfile: true, includeColorProfile: true, stripGps: true, stripPersonal: true, addCopyright: '@username' },
    naming: { pattern: '{name}_ig_post_{date}.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 2 },
    destination: { type: 'folder', path: '~/Exports/Social/Instagram', createIfMissing: true },
    transformations: [
      { type: 'crop', params: { aspectRatio: '1:1', anchor: 'center' }, enabled: true, order: 1 },
      { type: 'resize', params: { width: 1080, height: 1080 }, enabled: true, order: 2 },
      { type: 'sharpen', params: { amount: 30, radius: 0.5 }, enabled: true, order: 3 },
      { type: 'watermark', params: { text: '@username', position: 'bottom-right', opacity: 30, fontSize: 24 }, enabled: true, order: 4 },
    ],
    colorSpace: { source: 'auto', destination: 'sRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
  },
  {
    id: 'instagram-story',
    name: 'Instagram Story (9:16)',
    description: 'Vertical format for Instagram Stories',
    icon: '📱',
    category: 'social',
    format: 'jpg',
    quality: 90,
    metadata: { includeExif: false, includeXmp: false, includeIptc: false, includeIccProfile: true, includeColorProfile: true, stripGps: true, stripPersonal: true, addCopyright: '@username' },
    naming: { pattern: '{name}_ig_story_{date}.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 2 },
    destination: { type: 'folder', path: '~/Exports/Social/Instagram/Stories', createIfMissing: true },
    transformations: [
      { type: 'crop', params: { aspectRatio: '9:16', anchor: 'center' }, enabled: true, order: 1 },
      { type: 'resize', params: { width: 1080, height: 1920 }, enabled: true, order: 2 },
      { type: 'watermark', params: { text: '@username', position: 'bottom-center', opacity: 30, fontSize: 28 }, enabled: true, order: 3 },
    ],
    colorSpace: { source: 'auto', destination: 'sRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
  },
  {
    id: 'facebook-post',
    name: 'Facebook Post',
    description: 'Optimized for Facebook feed',
    icon: '👍',
    category: 'social',
    format: 'jpg',
    quality: 85,
    metadata: { includeExif: false, includeXmp: false, includeIptc: false, includeIccProfile: true, includeColorProfile: true, stripGps: true, stripPersonal: true, addCopyright: '' },
    naming: { pattern: '{name}_fb_{date}.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 2 },
    destination: { type: 'folder', path: '~/Exports/Social/Facebook', createIfMissing: true },
    transformations: [
      { type: 'resize', params: { width: 1200, height: 630, maintainAspect: true }, enabled: true, order: 1 },
      { type: 'sharpen', params: { amount: 20, radius: 0.5 }, enabled: true, order: 2 },
    ],
    colorSpace: { source: 'auto', destination: 'sRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
  },
  {
    id: 'twitter-post',
    name: 'Twitter/X Post',
    description: 'Optimized for Twitter/X feed',
    icon: '🐦',
    category: 'social',
    format: 'jpg',
    quality: 85,
    metadata: { includeExif: false, includeXmp: false, includeIptc: false, includeIccProfile: true, includeColorProfile: true, stripGps: true, stripPersonal: true, addCopyright: '' },
    naming: { pattern: '{name}_twitter_{date}.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 2 },
    destination: { type: 'folder', path: '~/Exports/Social/Twitter', createIfMissing: true },
    transformations: [
      { type: 'resize', params: { width: 1600, height: 900, maintainAspect: true }, enabled: true, order: 1 },
      { type: 'sharpen', params: { amount: 25, radius: 0.5 }, enabled: true, order: 2 },
    ],
    colorSpace: { source: 'auto', destination: 'sRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
  },
  {
    id: 'linkedin-post',
    name: 'LinkedIn Post',
    description: 'Professional format for LinkedIn',
    icon: '💼',
    category: 'social',
    format: 'jpg',
    quality: 90,
    metadata: { includeExif: false, includeXmp: false, includeIptc: false, includeIccProfile: true, includeColorProfile: true, stripGps: true, stripPersonal: true, addCopyright: '' },
    naming: { pattern: '{name}_linkedin_{date}.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 2 },
    destination: { type: 'folder', path: '~/Exports/Social/LinkedIn', createIfMissing: true },
    transformations: [
      { type: 'resize', params: { width: 1200, height: 627, maintainAspect: true }, enabled: true, order: 1 },
      { type: 'sharpen', params: { amount: 15, radius: 0.5 }, enabled: true, order: 2 },
    ],
    colorSpace: { source: 'auto', destination: 'sRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
  },
  {
    id: 'pinterest-pin',
    name: 'Pinterest Pin (2:3)',
    description: 'Vertical format for Pinterest',
    icon: '📌',
    category: 'social',
    format: 'jpg',
    quality: 85,
    metadata: { includeExif: false, includeXmp: false, includeIptc: false, includeIccProfile: true, includeColorProfile: true, stripGps: true, stripPersonal: true, addCopyright: '' },
    naming: { pattern: '{name}_pin_{date}.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 2 },
    destination: { type: 'folder', path: '~/Exports/Social/Pinterest', createIfMissing: true },
    transformations: [
      { type: 'crop', params: { aspectRatio: '2:3', anchor: 'center' }, enabled: true, order: 1 },
      { type: 'resize', params: { width: 1000, height: 1500 }, enabled: true, order: 2 },
    ],
    colorSpace: { source: 'auto', destination: 'sRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
  },

  // Print Personas
  {
    id: 'print-standard',
    name: 'Standard Print (300 DPI)',
    description: 'High quality print at 300 DPI',
    icon: '🖨️',
    category: 'print',
    format: 'tiff',
    quality: 100,
    metadata: { includeExif: true, includeXmp: true, includeIptc: true, includeIccProfile: true, includeColorProfile: true, stripGps: false, stripPersonal: false, addCopyright: 'Chay\'s Photo Studio' },
    naming: { pattern: '{name}_print_{width}x{height}_{dpi}dpi.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 3 },
    destination: { type: 'folder', path: '~/Exports/Print', createIfMissing: true },
    transformations: [
      { type: 'resize', params: { width: 2400, height: 3000, dpi: 300, maintainAspect: true }, enabled: true, order: 1 },
      { type: 'color-space', params: { source: 'sRGB', destination: 'AdobeRGB', intent: 'relative' }, enabled: true, order: 2 },
    ],
    colorSpace: { source: 'auto', destination: 'AdobeRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: true, simulateInk: true },
    postProcess: { action: 'open-folder', notificationMessage: 'Print-ready files exported' },
  },
  {
    id: 'print-large-format',
    name: 'Large Format Print',
    description: 'For posters, banners, large prints',
    icon: '📏',
    category: 'print',
    format: 'tiff',
    quality: 100,
    metadata: { includeExif: true, includeXmp: true, includeIptc: true, includeIccProfile: true, includeColorProfile: true, stripGps: false, stripPersonal: false, addCopyright: 'Chay\'s Photo Studio' },
    naming: { pattern: '{name}_large_{width}x{height}_{dpi}dpi.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 3 },
    destination: { type: 'folder', path: '~/Exports/Print/Large', createIfMissing: true },
    transformations: [
      { type: 'resize', params: { width: 4800, height: 7200, dpi: 150, maintainAspect: true }, enabled: true, order: 1 },
      { type: 'color-space', params: { source: 'sRGB', destination: 'AdobeRGB', intent: 'perceptual' }, enabled: true, order: 2 },
    ],
    colorSpace: { source: 'auto', destination: 'AdobeRGB', intent: 'perceptual', blackPointCompensation: true, simulatePaper: true, simulateInk: true },
  },
  {
    id: 'print-web-ready',
    name: 'Print + Web Bundle',
    description: 'Exports both print (TIFF) and web (WebP) versions',
    icon: '📦',
    category: 'print',
    format: 'tiff',
    quality: 100,
    metadata: { includeExif: true, includeXmp: true, includeIptc: true, includeIccProfile: true, includeColorProfile: true, stripGps: false, stripPersonal: false, addCopyright: 'Chay\'s Photo Studio' },
    naming: { pattern: '{name}_{variant}.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 3 },
    destination: { type: 'folder', path: '~/Exports/Bundle', createIfMissing: true },
    transformations: [
      { type: 'resize', params: { width: 2400, height: 3000, dpi: 300, maintainAspect: true }, enabled: true, order: 1 },
      { type: 'color-space', params: { source: 'sRGB', destination: 'AdobeRGB', intent: 'relative' }, enabled: true, order: 2 },
    ],
    colorSpace: { source: 'auto', destination: 'AdobeRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: true, simulateInk: true },
    postProcess: { action: 'open-folder', notificationMessage: 'Print + Web bundle exported' },
  },

  // Archive Personas
  {
    id: 'archive-master',
    name: 'Archive Master (Lossless)',
    description: 'Lossless archival with full metadata',
    icon: '💾',
    category: 'archive',
    format: 'tiff',
    quality: 100,
    metadata: { includeExif: true, includeXmp: true, includeIptc: true, includeIccProfile: true, includeColorProfile: true, stripGps: false, stripPersonal: false, addCopyright: 'Chay\'s Photo Studio - All Rights Reserved' },
    naming: { pattern: '{name}_archive_{date}_{time}.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 4 },
    destination: { type: 'folder', path: '~/Archive/Masters', createIfMissing: true },
    transformations: [],
    colorSpace: { source: 'auto', destination: 'ProPhotoRGB', intent: 'perceptual', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
  },
  {
    id: 'archive-compressed',
    name: 'Archive Compressed (Lossy)',
    description: 'Space-efficient archival with good quality',
    icon: '🗜️',
    category: 'archive',
    format: 'webp',
    quality: 95,
    metadata: { includeExif: true, includeXmp: true, includeIptc: true, includeIccProfile: true, includeColorProfile: true, stripGps: false, stripPersonal: false, addCopyright: 'Chay\'s Photo Studio' },
    naming: { pattern: '{name}_archive_{date}.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 3 },
    destination: { type: 'folder', path: '~/Archive/Compressed', createIfMissing: true },
    transformations: [],
    colorSpace: { source: 'auto', destination: 'sRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
  },

  // Specialty Personas
  {
    id: 'email-attachment',
    name: 'Email Attachment (<25MB)',
    description: 'Compressed for email attachment limits',
    icon: '📧',
    category: 'custom',
    format: 'jpg',
    quality: 75,
    metadata: { includeExif: false, includeXmp: false, includeIptc: false, includeIccProfile: true, includeColorProfile: true, stripGps: true, stripPersonal: true, addCopyright: '' },
    naming: { pattern: '{name}_email.{ext}', overwriteExisting: true, createFolders: false, conflictResolution: 'overwrite', sequentialStart: 1, sequentialPadding: 2 },
    destination: { type: 'folder', path: '~/Exports/Email', createIfMissing: true },
    transformations: [
      { type: 'resize', params: { width: 1920, height: 1080, maintainAspect: true, maxSize: 25000000 }, enabled: true, order: 1 },
    ],
    colorSpace: { source: 'auto', destination: 'sRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
  },
  {
    id: 'proof-sheet',
    name: 'Contact Sheet / Proof',
    description: 'Contact sheet with thumbnails and metadata',
    icon: '📋',
    category: 'custom',
    format: 'pdf',
    quality: 100,
    metadata: { includeExif: true, includeXmp: true, includeIptc: true, includeIccProfile: true, includeColorProfile: true, stripGps: false, stripPersonal: false, addCopyright: 'Chay\'s Photo Studio' },
    naming: { pattern: 'proof_{date}_{time}.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 3 },
    destination: { type: 'folder', path: '~/Exports/Proofs', createIfMissing: true },
    transformations: [
      { type: 'resize', params: { width: 256, height: 256, maintainAspect: true }, enabled: true, order: 1 },
    ],
    colorSpace: { source: 'auto', destination: 'sRGB', intent: 'relative', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
    postProcess: { action: 'open-folder', notificationMessage: 'Contact sheet generated' },
  },
  {
    id: 'hdr-merge',
    name: 'HDR Merge Output',
    description: '32-bit EXR for HDR workflow',
    icon: '✨',
    category: 'archive',
    format: 'exr',
    quality: 100,
    metadata: { includeExif: true, includeXmp: true, includeIptc: false, includeIccProfile: true, includeColorProfile: true, stripGps: false, stripPersonal: false, addCopyright: '' },
    naming: { pattern: '{name}_hdr_{date}.{ext}', overwriteExisting: false, createFolders: true, conflictResolution: 'rename', sequentialStart: 1, sequentialPadding: 3 },
    destination: { type: 'folder', path: '~/Exports/HDR', createIfMissing: true },
    transformations: [],
    colorSpace: { source: 'auto', destination: 'Rec2020', intent: 'perceptual', blackPointCompensation: true, simulatePaper: false, simulateInk: false },
  },
]

// Persona Manager
export class ExportPersonaManager {
  private personas: Map<string, ExportPersona> = new Map()
  private customPersonas: Map<string, ExportPersona> = new Map()
  private listeners: Set<() => void> = new Set()
  private activeJobs: Map<string, ExportJob> = new Map()

  constructor() {
    for (const persona of BUILT_IN_EXPORT_PERSONAS) {
      this.personas.set(persona.id, persona)
    }
  }

  getAllPersonas(): ExportPersona[] {
    return [...BUILT_IN_EXPORT_PERSONAS, ...Array.from(this.customPersonas.values())]
  }

  getPersona(id: string): ExportPersona | undefined {
    return this.personas.get(id) || this.customPersonas.get(id)
  }

  getPersonasByCategory(category: ExportPersona['category']): ExportPersona[] {
    return this.getAllPersonas().filter(p => p.category === category)
  }

  addCustomPersona(persona: ExportPersona): void {
    if (this.personas.has(persona.id) || this.customPersonas.has(persona.id)) {
      throw new Error('Persona ID already exists')
    }
    this.customPersonas.set(persona.id, persona)
    this.notify()
  }

  updatePersona(id: string, updates: Partial<ExportPersona>): boolean {
    const persona = this.getPersona(id)
    if (!persona) return false
    Object.assign(persona, updates)
    this.notify()
    return true
  }

  deleteCustomPersona(id: string): boolean {
    if (BUILT_IN_EXPORT_PERSONAS.some(p => p.id === id)) return false
    const result = this.customPersonas.delete(id)
    if (result) this.notify()
    return result
  }

  duplicatePersona(id: string, newName: string): ExportPersona | null {
    const persona = this.getPersona(id)
    if (!persona) return null

    const newPersona: ExportPersona = {
      ...persona,
      id: 'persona-' + Date.now(),
      name: newName,
    }
    this.customPersonas.set(newPersona.id, newPersona)
    this.notify()
    return newPersona
  }

  // Export execution
  async exportFiles(
    personaId: string,
    files: File[],
    options: { onProgress?: (job: ExportJob) => void; onComplete?: (job: ExportJob) => void } = {}
  ): Promise<ExportJob> {
    const persona = this.getPersona(personaId)
    if (!persona) throw new Error('Persona not found')

    const job: ExportJob = {
      id: 'job-' + Date.now(),
      personaId,
      files,
      status: 'pending',
      progress: 0,
      currentFile: '',
      processedCount: 0,
      totalFiles: files.length,
      startTime: Date.now(),
      errors: [],
      outputs: [],
    }

    this.activeJobs.set(job.id, job)
    job.status = 'processing'
    options.onProgress?.(job)

    for (let i = 0; i < files.length; i++) {
      if (job.status === 'cancelled') break

      job.currentFile = files[i].name
      job.processedCount = i + 1
      job.progress = (i + 1) / files.length * 100
      options.onProgress?.(job)

      try {
        const output = await this.processFile(files[i], persona)
        job.outputs.push({ original: files[i].name, output: output.name, size: output.size })
      } catch (error) {
        job.errors.push({ file: files[i].name, error: String(error) })
      }
    }

    job.status = job.errors.length === files.length ? 'failed' : job.errors.length > 0 ? 'completed' : 'completed'
    job.endTime = Date.now()
    job.progress = 100
    options.onComplete?.(job)
    this.activeJobs.delete(job.id)
    this.notify()

    return job
  }

  private async processFile(file: File, persona: ExportPersona): Promise<{ name: string; size: number }> {
    // This would use the actual export pipeline
    // For now, return mock
    const outputName = this.generateOutputName(file, persona)
    return { name: outputName, size: file.size }
  }

  private generateOutputName(file: File, persona: ExportPersona): string {
    const baseName = file.name.replace(/\.[^.]+$/, '')
    const ext = persona.format
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const time = new Date().toISOString().slice(11, 19).replace(/:/g, '-')

    return persona.naming.pattern
      .replace('{name}', baseName)
      .replace('{ext}', ext)
      .replace('{date}', date)
      .replace('{time}', time)
      .replace('{width}', '1920')
      .replace('{height}', '1080')
      .replace('{dpi}', '300')
      .replace('{variant}', 'web')
  }

  getActiveJobs(): ExportJob[] {
    return Array.from(this.activeJobs.values())
  }

  cancelJob(jobId: string): boolean {
    const job = this.activeJobs.get(jobId)
    if (!job) return false
    job.status = 'cancelled'
    this.notify()
    return true
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Export Preset Manager */
export class ExportPresetManager {
  private presets: Map<string, ExportPreset> = new Map()
  private listeners: Set<() => void> = new Set()

  constructor() {
    this.loadBuiltInPresets()
  }

  private loadBuiltInPresets(): void {
    const presets: ExportPreset[] = [
      {
        id: 'web-bundle',
        name: 'Web Bundle',
        description: 'Standard web + retina + thumbnail',
        personas: ['web-standard', 'web-retina', 'web-thumbnail'],
      },
      {
        id: 'social-bundle',
        name: 'Social Media Bundle',
        description: 'All major social platforms',
        personas: ['instagram-post', 'instagram-story', 'facebook-post', 'twitter-post', 'linkedin-post', 'pinterest-pin'],
      },
      {
        id: 'print-bundle',
        name: 'Print Bundle',
        description: 'Standard + large format print',
        personas: ['print-standard', 'print-large-format'],
      },
      {
        id: 'full-bundle',
        name: 'Complete Export Bundle',
        description: 'Everything: web, social, print, archive',
        personas: ['web-standard', 'web-retina', 'web-thumbnail', 'instagram-post', 'instagram-story', 'facebook-post', 'twitter-post', 'print-standard', 'archive-master'],
      },
      {
        id: 'social-quick',
        name: 'Quick Social',
        description: 'Instagram + Facebook + Twitter',
        personas: ['instagram-post', 'facebook-post', 'twitter-post'],
      },
      {
        id: 'web-print',
        name: 'Web + Print',
        description: 'Web optimized + print ready',
        personas: ['web-standard', 'print-standard'],
      },
    ]

    for (const preset of presets) {
      this.presets.set(preset.id, preset)
    }
  }

  getAllPresets(): ExportPreset[] {
    return Array.from(this.presets.values())
  }

  getPreset(id: string): ExportPreset | undefined {
    return this.presets.get(id)
  }

  createPreset(preset: ExportPreset): void {
    if (this.presets.has(preset.id)) throw new Error('Preset ID already exists')
    this.presets.set(preset.id, preset)
    this.notify()
  }

  deletePreset(id: string): boolean {
    const result = this.presets.delete(id)
    if (result) this.notify()
    return result
  }

  async applyPreset(presetId: string, files: File[], personaManager: ExportPersonaManager): Promise<void> {
    const preset = this.presets.get(presetId)
    if (!preset) throw new Error('Preset not found')

    for (const personaId of preset.personas) {
      await personaManager.exportFiles(personaId, files)
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Quick Export Menu */
export function getQuickExportMenu(personas: ExportPersona[]): Array<{ label: string; personaId: string; shortcut?: string }> {
  return [
    { label: 'Web Standard', personaId: 'web-standard', shortcut: 'Ctrl+E' },
    { label: 'Web Retina', personaId: 'web-retina', shortcut: 'Ctrl+Shift+E' },
    { label: 'Instagram Post', personaId: 'instagram-post' },
    { label: 'Instagram Story', personaId: 'instagram-story' },
    { label: 'Facebook', personaId: 'facebook-post' },
    { label: 'Twitter/X', personaId: 'twitter-post' },
    { label: 'LinkedIn', personaId: 'linkedin-post' },
    { label: 'Print Standard', personaId: 'print-standard' },
    { label: 'Archive Master', personaId: 'archive-master' },
    { label: 'Email Attachment', personaId: 'email-attachment' },
  ].filter(item => personas.some(p => p.id === item.personaId))
}