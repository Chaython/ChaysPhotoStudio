'use client'
// GIMP Filter Gallery
// Non-destructive filter gallery with live preview, categories, favorites, presets

export interface FilterGalleryItem {
  id: string
  name: string
  category: string
  description: string
  icon: string
  filter: string // GEGL operation name
  defaultParams: Record<string, any>
  paramsSchema: FilterParamSchema[]
  preview: string // base64 thumbnail
  tags: string[]
  isBuiltIn: boolean
  isFavorite: boolean
  author?: string
  version: string
}

export interface FilterParamSchema {
  key: string
  label: string
  type: 'slider' | 'number' | 'color' | 'select' | 'toggle' | 'curve' | 'gradient' | 'image'
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: { label: string; value: any }[]
  default: any
  description?: string
  affectsPreview: boolean
}

export interface FilterPreset {
  id: string
  name: string
  filterId: string
  params: Record<string, any>
  thumbnail: string // base64
  tags: string[]
  isBuiltIn: boolean
  created: number
  author?: string
}

export interface FilterCategory {
  id: string
  name: string
  icon: string
  description: string
  filters: string[] // filter IDs
  expanded: boolean
}

export interface FilterGalleryState {
  categories: FilterCategory[]
  filters: Map<string, FilterGalleryItem>
  presets: Map<string, FilterPreset>
  favorites: Set<string>
  recentFilters: string[]
  searchQuery: string
  selectedCategory: string
  selectedFilter: string | null
  previewMode: 'single' | 'compare' | 'split' | 'grid'
  previewSize: 'small' | 'medium' | 'large'
  showFavoritesOnly: boolean
  showBuiltInOnly: boolean
}

export class FilterGallery {
  private state: FilterGalleryState
  private listeners: Set<() => void> = new Map()
  private previewCache: Map<string, HTMLCanvasElement> = new Map()

  constructor() {
    this.state = this.getInitialState()
    this.registerBuiltInFilters()
  }

  private getInitialState(): FilterGalleryState {
    return {
      categories: this.getBuiltInCategories(),
      filters: new Map(),
      presets: new Map(),
      favorites: new Set(),
      recentFilters: [],
      searchQuery: '',
      selectedCategory: 'all',
      selectedFilter: null,
      previewMode: 'single',
      previewSize: 'medium',
      showFavoritesOnly: false,
      showBuiltInOnly: false,
    }
  }

  private getBuiltInCategories(): FilterCategory[] {
    return [
      { id: 'all', name: 'All Filters', icon: '📋', description: 'All available filters', filters: [], expanded: true },
      { id: 'blur', name: 'Blur', icon: '🌫️', description: 'Blur and soften effects', filters: ['gaussian-blur', 'box-blur', 'motion-blur', 'lens-blur', 'zoom-blur', 'radial-blur', 'smart-blur', 'surface-blur'], expanded: true },
      { id: 'sharpen', name: 'Sharpen', icon: '🔪', description: 'Sharpen and enhance detail', filters: ['unsharp-mask', 'smart-sharpen', 'high-pass', 'shake-reduction'], expanded: true },
      { id: 'noise', name: 'Noise', icon: '📺', description: 'Noise reduction and addition', filters: ['noise', 'gaussian-noise', 'median', 'dust-scratches', 'despeckle', 'mylar'], expanded: true },
      { id: 'distort', name: 'Distort', icon: '🌊', description: 'Geometric distortions', filters: ['ripple', 'wave', 'glass', 'ocean-ripple', 'pinch', 'spherize', 'twirl', 'zigzag', 'displace', 'shear', 'perspective', 'polar-coordinates'], expanded: false },
      { id: 'stylize', name: 'Stylize', icon: '🎨', description: 'Artistic stylization', filters: ['oil-paint', 'watercolor', 'dry-brush', 'colored-pencil', 'cutout', 'poster-edges', 'rough-pastels', 'smudge-stick', 'fresco', 'glowing-edges', 'ink-outlines'], expanded: false },
      { id: 'artistic', name: 'Artistic', icon: '🖼️', description: 'Artistic media simulations', filters: ['oilify', 'watercolor', 'pastel', 'charcoal', 'chalk', 'crayon', 'graphite', 'ink', 'sumi-e', 'impressionist', 'pointillize'], expanded: false },
      { id: 'color', name: 'Color', icon: '🌈', description: 'Color adjustments', filters: ['hue-saturation', 'color-balance', 'vibrance', 'colorize', 'replace-color', 'selective-color', 'channel-mixer', 'gradient-map', 'color-lookup', 'invert', 'posterize', 'threshold', 'equalize', 'auto-tone', 'auto-contrast', 'auto-color'], expanded: true },
      { id: 'tone', name: 'Tone', icon: '☀️', description: 'Tonal adjustments', filters: ['levels', 'curves', 'exposure', 'brightness-contrast', 'shadows-highlights', 'hdr-toning', 'shadows-highlights', 'exposure', 'gamma'], expanded: true },
      { id: 'blur-sharpen', name: 'Blur & Sharpen', icon: '🔍', description: 'Blur and sharpen tools', filters: ['gaussian-blur', 'lens-blur', 'motion-blur', 'radial-blur', 'smart-blur', 'surface-blur', 'unsharp-mask', 'smart-sharpen', 'high-pass', 'shake-reduction'], expanded: true },
      { id: 'noise-reduction', name: 'Noise Reduction', icon: '🔇', description: 'Remove noise and artifacts', filters: ['reduce-noise', 'median', 'dust-scratches', 'despeckle', 'mylar', 'gaussian-noise', 'poisson-noise'], expanded: true },
      { id: 'pixelate', name: 'Pixelate', icon: '🔲', description: 'Pixelation and mosaic effects', filters: ['mosaic', 'crystallize', 'facet', 'fragment', 'mezzotint', 'pointillize'], expanded: false },
      { id: 'render', name: 'Render', icon: '✨', description: 'Generate patterns and textures', filters: ['clouds', 'difference-clouds', 'fibers', 'lens-flare', 'lighting-effects', 'flare', 'mandelbrot', 'julia', 'plasma', 'checkerboard', 'grid'], expanded: false },
      { id: 'video', name: 'Video', icon: '🎬', description: 'Video-specific filters', filters: ['deinterlace', 'frame-blend', 'motion-blur', 'time-remap', 'frame-hold'], expanded: false },
      { id: 'other', name: 'Other', icon: '📦', description: 'Other filters', filters: ['custom', 'script-fu', 'gegl', 'maximum', 'minimum', 'offset', 'tile'], expanded: false },
    ]
  }

  private registerBuiltInFilters(): void {
    const filters: FilterGalleryItem[] = [
      // Blur
      {
        id: 'gaussian-blur',
        name: 'Gaussian Blur',
        category: 'blur',
        description: 'Standard Gaussian blur',
        icon: '🌫️',
        filter: 'gegl:gaussian-blur',
        defaultParams: { 'std-dev-x': 10, 'std-dev-y': 10, 'blur-type': 'gaussian' },
        paramsSchema: [
          { key: 'std-dev-x', label: 'Horizontal Radius', type: 'slider', min: 0, max: 500, step: 0.1, unit: 'px', default: 10, description: 'Horizontal blur radius', affectsPreview: true },
          { key: 'std-dev-y', label: 'Vertical Radius', type: 'slider', min: 0, max: 500, step: 0.1, unit: 'px', default: 10, description: 'Vertical blur radius', affectsPreview: true },
          { key: 'blur-type', label: 'Blur Type', type: 'select', options: [{ label: 'Gaussian (RLE)', value: 'gaussian' }, { label: 'Gaussian (IIR)', value: 'gaussian-iir' }, { label: 'Box', value: 'box' }], default: 'gaussian', description: 'Blur algorithm', affectsPreview: true },
        ],
        preview: '',
        tags: ['blur', 'soften', 'gaussian'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Lens Blur
      {
        id: 'lens-blur',
        name: 'Lens Blur',
        category: 'blur',
        description: 'Simulates camera lens bokeh',
        icon: '🔍',
        filter: 'gegl:lens-blur',
        defaultParams: { radius: 20, blades: 5, angle: 0, curvature: 0 },
        paramsSchema: [
          { key: 'radius', label: 'Radius', type: 'slider', min: 0, max: 200, step: 1, unit: 'px', default: 20, affectsPreview: true },
          { key: 'blades', label: 'Blades', type: 'slider', min: 3, max: 20, step: 1, default: 5, affectsPreview: true },
          { key: 'angle', label: 'Angle', type: 'slider', min: 0, max: 360, step: 1, unit: '°', default: 0, affectsPreview: true },
          { key: 'curvature', label: 'Curvature', type: 'slider', min: -1, max: 1, step: 0.01, default: 0, affectsPreview: true },
        ],
        preview: '',
        tags: ['blur', 'bokeh', 'depth-of-field'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Motion Blur
      {
        id: 'motion-blur',
        name: 'Motion Blur',
        category: 'blur',
        description: 'Directional motion blur',
        icon: '💨',
        filter: 'gegl:motion-blur',
        defaultParams: { length: 20, angle: 0, center: 0.5 },
        paramsSchema: [
          { key: 'length', label: 'Length', type: 'slider', min: 0, max: 500, step: 1, unit: 'px', default: 20, affectsPreview: true },
          { key: 'angle', label: 'Angle', type: 'slider', min: 0, max: 360, step: 1, unit: '°', default: 0, affectsPreview: true },
          { key: 'center', label: 'Center', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, affectsPreview: true },
        ],
        preview: '',
        tags: ['blur', 'motion', 'directional'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Unsharp Mask
      {
        id: 'unsharp-mask',
        name: 'Unsharp Mask',
        category: 'sharpen',
        description: 'Classic sharpening with threshold',
        icon: '🔪',
        filter: 'gegl:unsharp-mask',
        defaultParams: { radius: 5, amount: 1.0, threshold: 0 },
        paramsSchema: [
          { key: 'radius', label: 'Radius', type: 'slider', min: 0.1, max: 200, step: 0.1, unit: 'px', default: 5, affectsPreview: true },
          { key: 'amount', label: 'Amount', type: 'slider', min: 0, max: 5, step: 0.01, default: 1.0, affectsPreview: true },
          { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 255, step: 1, default: 0, affectsPreview: true },
        ],
        preview: '',
        tags: ['sharpen', 'unsharp', 'detail'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Smart Sharpen
      {
        id: 'smart-sharpen',
        name: 'Smart Sharpen',
        category: 'sharpen',
        description: 'Advanced sharpening with noise reduction',
        icon: '✨',
        filter: 'gegl:smart-sharpen',
        defaultParams: { radius: 5, amount: 1.0, threshold: 2 },
        paramsSchema: [
          { key: 'radius', label: 'Radius', type: 'slider', min: 0.1, max: 100, step: 0.1, unit: 'px', default: 5, affectsPreview: true },
          { key: 'amount', label: 'Amount', type: 'slider', min: 0, max: 5, step: 0.01, default: 1.0, affectsPreview: true },
          { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 100, step: 1, default: 2, affectsPreview: true },
          { key: 'reduce-noise', label: 'Reduce Noise', type: 'slider', min: 0, max: 100, step: 1, default: 0, affectsPreview: true },
        ],
        preview: '',
        tags: ['sharpen', 'smart', 'detail'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Noise
      {
        id: 'noise',
        name: 'Add Noise',
        category: 'noise',
        description: 'Add random noise',
        icon: '📺',
        filter: 'gegl:noise',
        defaultParams: { type: 'gaussian', amount: 0.1, monochrome: false },
        paramsSchema: [
          { key: 'type', label: 'Distribution', type: 'select', options: [{ label: 'Uniform', value: 'uniform' }, { label: 'Gaussian', value: 'gaussian' }, { label: 'Poisson', value: 'poisson' }, { label: 'Laplacian', value: 'laplacian' }], default: 'gaussian', affectsPreview: true },
          { key: 'amount', label: 'Amount', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.1, affectsPreview: true },
          { key: 'monochrome', label: 'Monochrome', type: 'toggle', default: false, affectsPreview: true },
          { key: 'seed', label: 'Seed', type: 'number', min: 0, max: 10000, default: 0, affectsPreview: true },
        ],
        preview: '',
        tags: ['noise', 'grain', 'texture'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Median (Dust & Scratches)
      {
        id: 'median',
        name: 'Dust & Scratches',
        category: 'noise-reduction',
        description: 'Remove dust and scratches',
        icon: '🧹',
        filter: 'gegl:median',
        defaultParams: { radius: 3 },
        paramsSchema: [
          { key: 'radius', label: 'Radius', type: 'slider', min: 1, max: 100, step: 1, unit: 'px', default: 3, affectsPreview: true },
        ],
        preview: '',
        tags: ['denoise', 'dust', 'scratches', 'cleanup'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Hue/Saturation
      {
        id: 'hue-saturation',
        name: 'Hue/Saturation',
        category: 'color',
        description: 'Adjust hue, saturation, lightness',
        icon: '🌈',
        filter: 'gegl:hue-saturation',
        defaultParams: { hue: 0, saturation: 0, lightness: 0, range: 1, overlap: 0 },
        paramsSchema: [
          { key: 'hue', label: 'Hue', type: 'slider', min: -180, max: 180, step: 1, unit: '°', default: 0, affectsPreview: true },
          { key: 'saturation', label: 'Saturation', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'lightness', label: 'Lightness', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'range', label: 'Range', type: 'slider', min: 0, max: 1, step: 0.01, default: 1, affectsPreview: true },
          { key: 'overlap', label: 'Overlap', type: 'slider', min: 0, max: 1, step: 0.01, default: 0, affectsPreview: true },
        ],
        preview: '',
        tags: ['color', 'hue', 'saturation', 'adjustment'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Color Balance
      {
        id: 'color-balance',
        name: 'Color Balance',
        category: 'color',
        description: 'Adjust shadows, midtones, highlights',
        icon: '⚖️',
        filter: 'gegl:color-balance',
        defaultParams: { 'shadows-cyan-red': 0, 'shadows-magenta-green': 0, 'shadows-yellow-blue': 0, 'midtones-cyan-red': 0, 'midtones-magenta-green': 0, 'midtones-yellow-blue': 0, 'highlights-cyan-red': 0, 'highlights-magenta-green': 0, 'highlights-yellow-blue': 0, 'preserve-luminosity': true },
        paramsSchema: [
          { key: 'shadows-cyan-red', label: 'Shadows Cyan/Red', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'shadows-magenta-green', label: 'Shadows Magenta/Green', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'shadows-yellow-blue', label: 'Shadows Yellow/Blue', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'midtones-cyan-red', label: 'Midtones Cyan/Red', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'midtones-magenta-green', label: 'Midtones Magenta/Green', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'midtones-yellow-blue', label: 'Midtones Yellow/Blue', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'highlights-cyan-red', label: 'Highlights Cyan/Red', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'highlights-magenta-green', label: 'Highlights Magenta/Green', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'highlights-yellow-blue', label: 'Highlights Yellow/Blue', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'preserve-luminosity', label: 'Preserve Luminosity', type: 'toggle', default: true, affectsPreview: true },
        ],
        preview: '',
        tags: ['color', 'balance', 'tone', 'adjustment'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Levels
      {
        id: 'levels',
        name: 'Levels',
        category: 'tone',
        description: 'Adjust input/output levels',
        icon: '📊',
        filter: 'gegl:levels',
        defaultParams: { channel: 'value', 'input-low': 0, 'input-high': 255, gamma: 1, 'output-low': 0, 'output-high': 255 },
        paramsSchema: [
          { key: 'channel', label: 'Channel', type: 'select', options: [{ label: 'RGB', value: 'value' }, { label: 'Red', value: 'red' }, { label: 'Green', value: 'green' }, { label: 'Blue', value: 'blue' }, { label: 'Alpha', value: 'alpha' }], default: 'value', affectsPreview: true },
          { key: 'input-low', label: 'Input Low', type: 'slider', min: 0, max: 255, step: 1, default: 0, affectsPreview: true },
          { key: 'input-high', label: 'Input High', type: 'slider', min: 0, max: 255, step: 1, default: 255, affectsPreview: true },
          { key: 'gamma', label: 'Gamma', type: 'slider', min: 0.1, max: 10, step: 0.01, default: 1, affectsPreview: true },
          { key: 'output-low', label: 'Output Low', type: 'slider', min: 0, max: 255, step: 1, default: 0, affectsPreview: true },
          { key: 'output-high', label: 'Output High', type: 'slider', min: 0, max: 255, step: 1, default: 255, affectsPreview: true },
        ],
        preview: '',
        tags: ['levels', 'tonal', 'histogram', 'adjustment'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Curves
      {
        id: 'curves',
        name: 'Curves',
        category: 'tone',
        description: 'Adjust tonal curves',
        icon: '📈',
        filter: 'gegl:curves',
        defaultParams: { channel: 'value', curve: [[0, 0], [255, 255]] },
        paramsSchema: [
          { key: 'channel', label: 'Channel', type: 'select', options: [{ label: 'RGB', value: 'value' }, { label: 'Red', value: 'red' }, { label: 'Green', value: 'green' }, { label: 'Blue', value: 'blue' }, { label: 'Alpha', value: 'alpha' }], default: 'value', affectsPreview: true },
          { key: 'curve', label: 'Curve', type: 'curve', default: [[0, 0], [255, 255]], affectsPreview: true },
        ],
        preview: '',
        tags: ['curves', 'tonal', 'contrast', 'adjustment'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Vibrance
      {
        id: 'vibrance',
        name: 'Vibrance',
        category: 'color',
        description: 'Smart saturation adjustment',
        icon: '🎨',
        filter: 'gegl:vibrance',
        defaultParams: { vibrance: 0, saturation: 0 },
        paramsSchema: [
          { key: 'vibrance', label: 'Vibrance', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'saturation', label: 'Saturation', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
        ],
        preview: '',
        tags: ['color', 'vibrance', 'saturation', 'smart'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Vignette
      {
        id: 'vignette',
        name: 'Vignette',
        category: 'stylize',
        description: 'Darken or lighten edges',
        icon: '🖤',
        filter: 'gegl:vignette',
        defaultParams: { radius: 0.5, softness: 0.5, amount: -0.5, shape: 0.5 },
        paramsSchema: [
          { key: 'radius', label: 'Radius', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, affectsPreview: true },
          { key: 'softness', label: 'Softness', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, affectsPreview: true },
          { key: 'amount', label: 'Amount', type: 'slider', min: -1, max: 1, step: 0.01, default: -0.5, affectsPreview: true },
          { key: 'shape', label: 'Shape', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, affectsPreview: true },
        ],
        preview: '',
        tags: ['vignette', 'edge', 'darken', 'focus'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Oilify
      {
        id: 'oilify',
        name: 'Oilify',
        category: 'artistic',
        description: 'Oil painting effect',
        icon: '🖌️',
        filter: 'gegl:oilify',
        defaultParams: { 'mask-size': 5 },
        paramsSchema: [
          { key: 'mask-size', label: 'Mask Size', type: 'slider', min: 1, max: 50, step: 1, default: 5, affectsPreview: true },
        ],
        preview: '',
        tags: ['artistic', 'oil', 'painting', 'impasto'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Cartoon
      {
        id: 'cartoon',
        name: 'Cartoon',
        category: 'artistic',
        description: 'Cartoon effect',
        icon: '🎭',
        filter: 'gegl:cartoon',
        defaultParams: { 'mask-radius': 7, 'pct-black': 50 },
        paramsSchema: [
          { key: 'mask-radius', label: 'Mask Radius', type: 'slider', min: 1, max: 50, step: 1, default: 7, affectsPreview: true },
          { key: 'pct-black', label: 'Percent Black', type: 'slider', min: 0, max: 100, step: 1, default: 50, affectsPreview: true },
        ],
        preview: '',
        tags: ['artistic', 'cartoon', 'cel-shading', 'comic'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Cubism
      {
        id: 'cubism',
        name: 'Cubism',
        category: 'artistic',
        description: 'Cubism effect',
        icon: '🧩',
        filter: 'gegl:cubism',
        defaultParams: { 'tile-size': 0.1, 'tile-saturation': 1.5 },
        paramsSchema: [
          { key: 'tile-size', label: 'Tile Size', type: 'slider', min: 0.01, max: 1, step: 0.01, default: 0.1, affectsPreview: true },
          { key: 'tile-saturation', label: 'Tile Saturation', type: 'slider', min: 0, max: 5, step: 0.1, default: 1.5, affectsPreview: true },
        ],
        preview: '',
        tags: ['artistic', 'cubism', 'geometric', 'abstract'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Ripple
      {
        id: 'ripple',
        name: 'Ripple',
        category: 'distort',
        description: 'Ripple distortion',
        icon: '🌊',
        filter: 'gegl:ripple',
        defaultParams: { period: 20, amplitude: 5, phase: 0, orientation: 'horizontal' },
        paramsSchema: [
          { key: 'period', label: 'Period', type: 'slider', min: 1, max: 200, step: 1, default: 20, affectsPreview: true },
          { key: 'amplitude', label: 'Amplitude', type: 'slider', min: 0, max: 100, step: 1, default: 5, affectsPreview: true },
          { key: 'phase', label: 'Phase', type: 'slider', min: 0, max: 360, step: 1, default: 0, affectsPreview: true },
          { key: 'orientation', label: 'Orientation', type: 'select', options: [{ label: 'Horizontal', value: 'horizontal' }, { label: 'Vertical', value: 'vertical' }], default: 'horizontal', affectsPreview: true },
        ],
        preview: '',
        tags: ['distort', 'ripple', 'wave', 'water'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Wave
      {
        id: 'wave',
        name: 'Wave',
        category: 'distort',
        description: 'Wave distortion',
        icon: '〰️',
        filter: 'gegl:waves',
        defaultParams: { amplitude: 10, wavelength: 50, phase: 0, type: 'sine' },
        paramsSchema: [
          { key: 'amplitude', label: 'Amplitude', type: 'slider', min: 0, max: 100, step: 1, default: 10, affectsPreview: true },
          { key: 'wavelength', label: 'Wavelength', type: 'slider', min: 1, max: 500, step: 1, default: 50, affectsPreview: true },
          { key: 'phase', label: 'Phase', type: 'slider', min: 0, max: 360, step: 1, default: 0, affectsPreview: true },
          { key: 'type', label: 'Wave Type', type: 'select', options: [{ label: 'Sine', value: 'sine' }, { label: 'Triangle', value: 'triangle' }, { label: 'Square', value: 'square' }], default: 'sine', affectsPreview: true },
        ],
        preview: '',
        tags: ['distort', 'wave', 'oscillate'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Lens Distortion
      {
        id: 'lens-distortion',
        name: 'Lens Distortion',
        category: 'distort',
        description: 'Correct or add lens distortion',
        icon: '🔍',
        filter: 'gegl:lens-distortion',
        defaultParams: { main: 0, edge: 0, zoom: 1, brighten: 0 },
        paramsSchema: [
          { key: 'main', label: 'Main', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'edge', label: 'Edge', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'zoom', label: 'Zoom', type: 'slider', min: 0.1, max: 10, step: 0.01, default: 1, affectsPreview: true },
          { key: 'brighten', label: 'Brighten', type: 'slider', min: -1, max: 1, step: 0.01, default: 0, affectsPreview: true },
        ],
        preview: '',
        tags: ['distort', 'lens', 'barrel', 'pincushion', 'correction'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Gaussian Blur (for completeness)
      {
        id: 'gaussian-blur',
        name: 'Gaussian Blur',
        category: 'blur',
        description: 'Standard Gaussian blur',
        icon: '🌫️',
        filter: 'gegl:gaussian-blur',
        defaultParams: { 'std-dev-x': 10, 'std-dev-y': 10, 'blur-type': 'gaussian' },
        paramsSchema: [
          { key: 'std-dev-x', label: 'Horizontal Radius', type: 'slider', min: 0, max: 500, step: 0.1, unit: 'px', default: 10, affectsPreview: true },
          { key: 'std-dev-y', label: 'Vertical Radius', type: 'slider', min: 0, max: 500, step: 0.1, unit: 'px', default: 10, affectsPreview: true },
          { key: 'blur-type', label: 'Blur Type', type: 'select', options: [{ label: 'Gaussian (RLE)', value: 'gaussian' }, { label: 'Gaussian (IIR)', value: 'gaussian-iir' }, { label: 'Box', value: 'box' }], default: 'gaussian', affectsPreview: true },
        ],
        preview: '',
        tags: ['blur', 'soften', 'gaussian'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Box Blur
      {
        id: 'box-blur',
        name: 'Box Blur',
        category: 'blur',
        description: 'Fast box blur',
        icon: '⬜',
        filter: 'gegl:box-blur',
        defaultParams: { radius: 10 },
        paramsSchema: [
          { key: 'radius', label: 'Radius', type: 'slider', min: 0, max: 500, step: 1, unit: 'px', default: 10, affectsPreview: true },
        ],
        preview: '',
        tags: ['blur', 'box', 'fast'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Zoom Blur
      {
        id: 'zoom-blur',
        name: 'Zoom Blur',
        category: 'blur',
        description: 'Radial zoom blur',
        icon: '🎯',
        filter: 'gegl:zoom-blur',
        defaultParams: { radius: 20, 'center-x': 0.5, 'center-y': 0.5 },
        paramsSchema: [
          { key: 'radius', label: 'Radius', type: 'slider', min: 0, max: 500, step: 1, unit: 'px', default: 20, affectsPreview: true },
          { key: 'center-x', label: 'Center X', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, affectsPreview: true },
          { key: 'center-y', label: 'Center Y', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, affectsPreview: true },
        ],
        preview: '',
        tags: ['blur', 'zoom', 'radial', 'radial-blur'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // High Pass
      {
        id: 'high-pass',
        name: 'High Pass',
        category: 'sharpen',
        description: 'High-pass filter for edge enhancement',
        icon: '🔍',
        filter: 'gegl:high-pass',
        defaultParams: { radius: 10 },
        paramsSchema: [
          { key: 'radius', label: 'Radius', type: 'slider', min: 0.1, max: 500, step: 0.1, default: 10, affectsPreview: true },
        ],
        preview: '',
        tags: ['sharpen', 'high-pass', 'edge', 'detail'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Exposure
      {
        id: 'exposure',
        name: 'Exposure',
        category: 'tone',
        description: 'Adjust exposure, offset, gamma',
        icon: '☀️',
        filter: 'gegl:exposure',
        defaultParams: { exposure: 0, offset: 0, gamma: 1, 'black-level': 0 },
        paramsSchema: [
          { key: 'exposure', label: 'Exposure', type: 'slider', min: -10, max: 10, step: 0.01, default: 0, affectsPreview: true },
          { key: 'offset', label: 'Offset', type: 'slider', min: -1, max: 1, step: 0.01, default: 0, affectsPreview: true },
          { key: 'gamma', label: 'Gamma', type: 'slider', min: 0.1, max: 10, step: 0.01, default: 1, affectsPreview: true },
          { key: 'black-level', label: 'Black Level', type: 'slider', min: 0, max: 1, step: 0.01, default: 0, affectsPreview: true },
        ],
        preview: '',
        tags: ['exposure', 'tone', 'hdr', 'brightness'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Shadows/Highlights
      {
        id: 'shadows-highlights',
        name: 'Shadows/Highlights',
        category: 'tone',
        description: 'Recover detail in shadows and highlights',
        icon: '☀️',
        filter: 'gegl:shadows-highlights',
        defaultParams: { 'shadows-strength': 50, 'shadows-radius': 50, 'highlights-strength': 50, 'highlights-radius': 50, midtones: 0 },
        paramsSchema: [
          { key: 'shadows-strength', label: 'Shadows Strength', type: 'slider', min: 0, max: 100, step: 1, default: 50, affectsPreview: true },
          { key: 'shadows-radius', label: 'Shadows Radius', type: 'slider', min: 1, max: 500, step: 1, default: 50, affectsPreview: true },
          { key: 'highlights-strength', label: 'Highlights Strength', type: 'slider', min: 0, max: 100, step: 1, default: 50, affectsPreview: true },
          { key: 'highlights-radius', label: 'Highlights Radius', type: 'slider', min: 1, max: 500, step: 1, default: 50, affectsPreview: true },
          { key: 'midtones', label: 'Midtones', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
        ],
        preview: '',
        tags: ['tone', 'shadows', 'highlights', 'recovery', 'hdr'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Vibrance
      {
        id: 'vibrance',
        name: 'Vibrance',
        category: 'color',
        description: 'Smart saturation adjustment',
        icon: '🎨',
        filter: 'gegl:vibrance',
        defaultParams: { vibrance: 0, saturation: 0 },
        paramsSchema: [
          { key: 'vibrance', label: 'Vibrance', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'saturation', label: 'Saturation', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
        ],
        preview: '',
        tags: ['color', 'vibrance', 'smart', 'saturation'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Color Balance
      {
        id: 'color-balance',
        name: 'Color Balance',
        category: 'color',
        description: 'Adjust shadows, midtones, highlights',
        icon: '⚖️',
        filter: 'gegl:color-balance',
        defaultParams: { 'shadows-cyan-red': 0, 'shadows-magenta-green': 0, 'shadows-yellow-blue': 0, 'midtones-cyan-red': 0, 'midtones-magenta-green': 0, 'midtones-yellow-blue': 0, 'highlights-cyan-red': 0, 'highlights-magenta-green': 0, 'highlights-yellow-blue': 0, 'preserve-luminosity': true },
        paramsSchema: [
          { key: 'shadows-cyan-red', label: 'Shadows Cyan/Red', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'shadows-magenta-green', label: 'Shadows Magenta/Green', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'shadows-yellow-blue', label: 'Shadows Yellow/Blue', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'midtones-cyan-red', label: 'Midtones Cyan/Red', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'midtones-magenta-green', label: 'Midtones Magenta/Green', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'midtones-yellow-blue', label: 'Midtones Yellow/Blue', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'highlights-cyan-red', label: 'Highlights Cyan/Red', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'highlights-magenta-green', label: 'Highlights Magenta/Green', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'highlights-yellow-blue', label: 'Highlights Yellow/Blue', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'preserve-luminosity', label: 'Preserve Luminosity', type: 'toggle', default: true, affectsPreview: true },
        ],
        preview: '',
        tags: ['color', 'balance', 'tone', 'adjustment'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Brightness/Contrast
      {
        id: 'brightness-contrast',
        name: 'Brightness/Contrast',
        category: 'tone',
        description: 'Simple brightness and contrast adjustment',
        icon: '☀️',
        filter: 'gegl:brightness-contrast',
        defaultParams: { brightness: 0, contrast: 0 },
        paramsSchema: [
          { key: 'brightness', label: 'Brightness', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'contrast', label: 'Contrast', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
        ],
        preview: '',
        tags: ['brightness', 'contrast', 'simple', 'basic'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Desaturate
      {
        id: 'desaturate',
        name: 'Desaturate',
        category: 'color',
        description: 'Convert to grayscale',
        icon: '⚫',
        filter: 'gegl:desaturate',
        defaultParams: { mode: 'luminosity' },
        paramsSchema: [
          { key: 'mode', label: 'Mode', type: 'select', options: [{ label: 'Luminosity', value: 'luminosity' }, { label: 'Lightness', value: 'lightness' }, { label: 'Average', value: 'average' }, { label: 'Luma', value: 'luma' }, { label: 'Value (HSV)', value: 'value' }], default: 'luminosity', affectsPreview: true },
        ],
        preview: '',
        tags: ['desaturate', 'grayscale', 'bw', 'monochrome'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Invert
      {
        id: 'invert',
        name: 'Invert',
        category: 'color',
        description: 'Invert colors',
        icon: '🔄',
        filter: 'gegl:invert',
        defaultParams: {},
        paramsSchema: [],
        preview: '',
        tags: ['invert', 'negative', 'complement'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Posterize
      {
        id: 'posterize',
        name: 'Posterize',
        category: 'stylize',
        description: 'Reduce color levels',
        icon: '🎨',
        filter: 'gegl:posterize',
        defaultParams: { levels: 4 },
        paramsSchema: [
          { key: 'levels', label: 'Levels', type: 'slider', min: 2, max: 256, step: 1, default: 4, affectsPreview: true },
        ],
        preview: '',
        tags: ['posterize', 'levels', 'reduce', 'pop-art'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Threshold
      {
        id: 'threshold',
        name: 'Threshold',
        category: 'stylize',
        description: 'Black and white threshold',
        icon: '⚫⚪',
        filter: 'gegl:threshold',
        defaultParams: { threshold: 0.5 },
        paramsSchema: [
          { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, affectsPreview: true },
        ],
        preview: '',
        tags: ['threshold', 'binary', 'bw', 'high-contrast'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Channel Mixer
      {
        id: 'channel-mixer',
        name: 'Channel Mixer',
        category: 'color',
        description: 'Mix color channels',
        icon: '🔀',
        filter: 'gegl:channel-mixer',
        defaultParams: { 'output-channel': 'red', 'red-red': 100, 'red-green': 0, 'red-blue': 0, 'green-red': 0, 'green-green': 100, 'green-blue': 0, 'blue-red': 0, 'blue-green': 0, 'blue-blue': 100, constant: 0, monochrome: false },
        paramsSchema: [
          { key: 'output-channel', label: 'Output Channel', type: 'select', options: [{ label: 'Red', value: 'red' }, { label: 'Green', value: 'green' }, { label: 'Blue', value: 'blue' }], default: 'red', affectsPreview: true },
          { key: 'red-red', label: 'Red → Red', type: 'slider', min: -200, max: 200, step: 1, default: 100, affectsPreview: true },
          { key: 'red-green', label: 'Green → Red', type: 'slider', min: -200, max: 200, step: 1, default: 0, affectsPreview: true },
          { key: 'red-blue', label: 'Blue → Red', type: 'slider', min: -200, max: 200, step: 1, default: 0, affectsPreview: true },
          { key: 'green-red', label: 'Red → Green', type: 'slider', min: -200, max: 200, step: 1, default: 0, affectsPreview: true },
          { key: 'green-green', label: 'Green → Green', type: 'slider', min: -200, max: 200, step: 1, default: 100, affectsPreview: true },
          { key: 'green-blue', label: 'Blue → Green', type: 'slider', min: -200, max: 200, step: 1, default: 0, affectsPreview: true },
          { key: 'blue-red', label: 'Red → Blue', type: 'slider', min: -200, max: 200, step: 1, default: 0, affectsPreview: true },
          { key: 'blue-green', label: 'Green → Blue', type: 'slider', min: -200, max: 200, step: 1, default: 0, affectsPreview: true },
          { key: 'blue-blue', label: 'Blue → Blue', type: 'slider', min: -200, max: 200, step: 1, default: 100, affectsPreview: true },
          { key: 'constant', label: 'Constant', type: 'slider', min: -100, max: 100, step: 1, default: 0, affectsPreview: true },
          { key: 'monochrome', label: 'Monochrome', type: 'toggle', default: false, affectsPreview: true },
        ],
        preview: '',
        tags: ['channel', 'mixer', 'rgb', 'color'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Gradient Map
      {
        id: 'gradient-map',
        name: 'Gradient Map',
        category: 'color',
        description: 'Map grayscale to gradient',
        icon: '🌈',
        filter: 'gegl:gradient-map',
        defaultParams: { gradient: 'foreground-background' },
        paramsSchema: [
          { key: 'gradient', label: 'Gradient', type: 'gradient', default: 'foreground-background', affectsPreview: true },
        ],
        preview: '',
        tags: ['gradient', 'map', 'colorize', 'tonal'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Sepia
      {
        id: 'sepia',
        name: 'Sepia',
        category: 'stylize',
        description: 'Sepia tone effect',
        icon: '🟤',
        filter: 'gegl:colorize',
        defaultParams: { hue: 30, saturation: 40, lightness: -10 },
        paramsSchema: [
          { key: 'hue', label: 'Hue', type: 'slider', min: 0, max: 360, step: 1, default: 30, affectsPreview: true },
          { key: 'saturation', label: 'Saturation', type: 'slider', min: 0, max: 100, step: 1, default: 40, affectsPreview: true },
          { key: 'lightness', label: 'Lightness', type: 'slider', min: -100, max: 100, step: 1, default: -10, affectsPreview: true },
        ],
        preview: '',
        tags: ['sepia', 'vintage', 'old-photo', 'brown'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Cross Process
      {
        id: 'cross-process',
        name: 'Cross Process',
        category: 'stylize',
        description: 'Cross-processed film look',
        icon: '🎞️',
        filter: 'gegl:curves',
        defaultParams: { curve: [[0, 0], [64, 50], [128, 128], [192, 200], [255, 255]] },
        paramsSchema: [
          { key: 'curve', label: 'Curve', type: 'curve', default: [[0, 0], [64, 50], [128, 128], [192, 200], [255, 255]], affectsPreview: true },
        ],
        preview: '',
        tags: ['cross-process', 'film', 'vintage', 'retro'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Bleach Bypass
      {
        id: 'bleach-bypass',
        name: 'Bleach Bypass',
        category: 'stylize',
        description: 'Bleach bypass film effect',
        icon: '🎬',
        filter: 'gegl:colorize',
        defaultParams: { hue: 0, saturation: -30, lightness: 10 },
        paramsSchema: [
          { key: 'saturation', label: 'Saturation', type: 'slider', min: -100, max: 100, step: 1, default: -30, affectsPreview: true },
          { key: 'lightness', label: 'Lightness', type: 'slider', min: -100, max: 100, step: 1, default: 10, affectsPreview: true },
        ],
        preview: '',
        tags: ['bleach-bypass', 'film', 'cinematic', 'desaturated'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
      // Teal & Orange
      {
        id: 'teal-orange',
        name: 'Teal & Orange',
        category: 'color',
        description: 'Cinematic teal & orange look',
        icon: '🎬',
        filter: 'gegl:color-balance',
        defaultParams: { 'shadows-cyan-red': -30, 'shadows-yellow-blue': 40, 'highlights-cyan-red': 40, 'highlights-yellow-blue': -20, 'midtones-yellow-blue': -10, 'preserve-luminosity': true },
        paramsSchema: [
          { key: 'shadows-cyan-red', label: 'Shadows Cyan/Red', type: 'slider', min: -100, max: 100, step: 1, default: -30, affectsPreview: true },
          { key: 'shadows-yellow-blue', label: 'Shadows Yellow/Blue', type: 'slider', min: -100, max: 100, step: 1, default: 40, affectsPreview: true },
          { key: 'highlights-cyan-red', label: 'Highlights Cyan/Red', type: 'slider', min: -100, max: 100, step: 1, default: 40, affectsPreview: true },
          { key: 'highlights-yellow-blue', label: 'Highlights Yellow/Blue', type: 'slider', min: -100, max: 100, step: 1, default: -20, affectsPreview: true },
          { key: 'midtones-yellow-blue', label: 'Midtones Yellow/Blue', type: 'slider', min: -100, max: 100, step: 1, default: -10, affectsPreview: true },
          { key: 'preserve-luminosity', label: 'Preserve Luminosity', type: 'toggle', default: true, affectsPreview: true },
        ],
        preview: '',
        tags: ['teal', 'orange', 'cinematic', 'color-grading', 'movie'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Vintage
      {
        id: 'vintage',
        name: 'Vintage',
        category: 'stylize',
        description: 'Vintage photo look',
        icon: '📷',
        filter: 'gegl:curves',
        defaultParams: { curve: [[0, 15], [64, 60], [128, 128], [192, 196], [255, 240]] },
        paramsSchema: [
          { key: 'curve', label: 'Curve', type: 'curve', default: [[0, 15], [64, 60], [128, 128], [192, 196], [255, 240]], affectsPreview: true },
        ],
        preview: '',
        tags: ['vintage', 'retro', 'old-photo', 'analog', 'film'],
        isBuiltIn: true,
        isFavorite: true,
        version: '1.0',
      },
      // Film Emulation
      {
        id: 'film-emulation',
        name: 'Film Emulation',
        category: 'stylize',
        description: 'Film stock emulation',
        icon: '🎞️',
        filter: 'gegl:color-enhance',
        defaultParams: { saturation: 1.1, vibrance: 20, contrast: 1.1 },
        paramsSchema: [
          { key: 'saturation', label: 'Saturation', type: 'slider', min: 0, max: 3, step: 0.01, default: 1.1, affectsPreview: true },
          { key: 'vibrance', label: 'Vibrance', type: 'slider', min: -100, max: 100, step: 1, default: 20, affectsPreview: true },
          { key: 'contrast', label: 'Contrast', type: 'slider', min: 0.1, max: 3, step: 0.01, default: 1.1, affectsPreview: true },
        ],
        preview: '',
        tags: ['film', 'emulation', 'kodak', 'fuji', 'portra', 'velvia'],
        isBuiltIn: true,
        isFavorite: false,
        version: '1.0',
      },
    ]

    // Register all filters
    for (const filter of filters) {
      this.state.filters.set(filter.id, filter)
      // Add to category
      const cat = this.state.categories.find(c => c.id === filter.category)
      if (cat && !cat.filters.includes(filter.id)) {
        cat.filters.push(filter.id)
      }
    }
  }

  // State management
  getState(): FilterGalleryState {
    return this.state
  }

  setSearchQuery(query: string): void {
    this.state.searchQuery = query
    this.notify()
  }

  setSelectedCategory(categoryId: string): void {
    this.state.selectedCategory = categoryId
    this.notify()
  }

  setSelectedFilter(filterId: string | null): void {
    this.state.selectedFilter = filterId
    if (filterId) {
      // Add to recent
      this.state.recentFilters = [filterId, ...this.state.recentFilters.filter(f => f !== filterId)].slice(0, 20)
    }
    this.notify()
  }

  setPreviewMode(mode: FilterGalleryState['previewMode']): void {
    this.state.previewMode = mode
    this.notify()
  }

  setPreviewSize(size: FilterGalleryState['previewSize']): void {
    this.state.previewSize = size
    this.notify()
  }

  toggleFavorite(filterId: string): void {
    if (this.state.favorites.has(filterId)) {
      this.state.favorites.delete(filterId)
    } else {
      this.state.favorites.add(filterId)
    }
    this.notify()
  }

  isFavorite(filterId: string): boolean {
    return this.state.favorites.has(filterId)
  }

  toggleShowFavoritesOnly(): void {
    this.state.showFavoritesOnly = !this.state.showFavoritesOnly
    this.notify()
  }

  toggleShowBuiltInOnly(): void {
    this.state.showBuiltInOnly = !this.state.showBuiltInOnly
    this.notify()
  }

  setSearchQuery(query: string): void {
    this.state.searchQuery = query
    this.notify()
  }

  setPreviewMode(mode: FilterGalleryState['previewMode']): void {
    this.state.previewMode = mode
    this.notify()
  }

  setPreviewSize(size: FilterGalleryState['previewSize']): void {
    this.state.previewSize = size
    this.notify()
  }

  // Get filtered filters
  getFilteredFilters(): FilterGalleryItem[] {
    let filters = Array.from(this.state.filters.values())

    // Category filter
    if (this.state.selectedCategory !== 'all') {
      filters = filters.filter(f => f.category === this.state.selectedCategory)
    }

    // Search filter
    if (this.state.searchQuery) {
      const query = this.state.searchQuery.toLowerCase()
      filters = filters.filter(f =>
        f.name.toLowerCase().includes(query) ||
        f.description.toLowerCase().includes(query) ||
        f.tags.some(t => t.toLowerCase().includes(query))
      )
    }

    // Favorites only
    if (this.state.showFavoritesOnly) {
      filters = filters.filter(f => this.state.favorites.has(f.id))
    }

    // Built-in only
    if (this.state.showBuiltInOnly) {
      filters = filters.filter(f => f.isBuiltIn)
    }

    // Sort: favorites first, then alphabetical
    filters.sort((a, b) => {
      const aFav = this.state.favorites.has(a.id)
      const bFav = this.state.favorites.has(b.id)
      if (aFav !== bFav) return bFav ? 1 : -1
      return a.name.localeCompare(b.name)
    })

    return filters
  }

  getCategories(): FilterCategory[] {
    return this.state.categories
  }

  getSelectedFilter(): FilterGalleryItem | null {
    if (!this.state.selectedFilter) return null
    return this.state.filters.get(this.state.selectedFilter) || null
  }

  getRecentFilters(): FilterGalleryItem[] {
    return this.state.recentFilters
      .map(id => this.state.filters.get(id))
      .filter(Boolean) as FilterGalleryItem[]
  }

  getFavorites(): FilterGalleryItem[] {
    return Array.from(this.state.favorites)
      .map(id => this.state.filters.get(id))
      .filter(Boolean) as FilterGalleryItem[]
  }

  // Preset management
  createPreset(filterId: string, name: string, params: Record<string, any>, thumbnail: string): FilterPreset {
    const preset: FilterPreset = {
      id: 'preset-' + Date.now(),
      name,
      filterId,
      params,
      thumbnail,
      tags: [],
      isBuiltIn: false,
      created: Date.now(),
    }
    this.state.presets.set(preset.id, preset)
    this.notify()
    return preset
  }

  getPresets(filterId?: string): FilterPreset[] {
    const presets = Array.from(this.state.presets.values())
    if (filterId) {
      return presets.filter(p => p.filterId === filterId)
    }
    return presets
  }

  deletePreset(presetId: string): boolean {
    const result = this.state.presets.delete(presetId)
    if (result) this.notify()
    return result
  }

  // Preview generation
  async generatePreview(filterId: string, canvas: HTMLCanvasElement): Promise<string> {
    // Would generate preview thumbnail
    return ''
  }

  // Subscribe to changes
  subscribe(listener: () => void): () => void {
    const id = Math.random().toString(36)
    this.listeners.set(id, listener)
    return () => this.listeners.delete(id)
  }

  private notify(): void {
    for (const listener of this.listeners.values()) listener()
  }
}

/** Filter Gallery UI Component */
export interface FilterGalleryUIProps {
  gallery: FilterGallery
  onApplyFilter: (filterId: string, params: Record<string, any>) => void
  onClose: () => void
}

/** Filter Gallery Presets */
export const FILTER_GALLERY_PRESETS: Record<string, { name: string; filters: Array<{ id: string; params: Record<string, any> }> }> = {
  'vintage-photo': {
    name: 'Vintage Photo',
    filters: [
      { id: 'curves', params: { curve: [[0, 15], [64, 60], [128, 128], [192, 196], [255, 240]] } },
      { id: 'vignette', params: { radius: 0.6, softness: 0.4, amount: -0.4 } },
      { id: 'noise', params: { amount: 0.08, type: 'gaussian', monochrome: true } },
      { id: 'levels', params: { 'input-low': 15, 'input-high': 240, gamma: 1.1 } },
    ],
  },
  'high-contrast-bw': {
    name: 'High Contrast B&W',
    filters: [
      { id: 'desaturate', params: { mode: 'luminosity' } },
      { id: 'curves', params: { curve: [[0, 0], [64, 40], [128, 128], [192, 216], [255, 255]] } },
      { id: 'levels', params: { 'input-low': 20, 'output-low': 0 } },
      { id: 'unsharp-mask', params: { radius: 2, amount: 1.5, threshold: 2 } },
    ],
  },
  'cinematic-teal-orange': {
    name: 'Cinematic Teal & Orange',
    filters: [
      { id: 'color-balance', params: { 'shadows-cyan-red': -30, 'shadows-yellow-blue': 40, 'highlights-cyan-red': 40, 'highlights-yellow-blue': -20, 'midtones-yellow-blue': -10, 'preserve-luminosity': true } },
      { id: 'curves', params: { curve: [[0, 10], [128, 128], [255, 245]] } },
      { id: 'vibrance', params: { vibrance: 15, saturation: 10 } },
    ],
  },
  'dreamy-portrait': {
    name: 'Dreamy Portrait',
    filters: [
      { id: 'gaussian-blur', params: { 'std-dev-x': 8, 'std-dev-y': 8 } },
      { id: 'exposure', params: { exposure: 0.3, gamma: 0.9 } },
      { id: 'vibrance', params: { vibrance: 20, saturation: 5 } },
      { id: 'bloom', params: { threshold: 0.7, radius: 30, intensity: 0.5 } },
    ],
  },
  'hdr-look': {
    name: 'HDR Look',
    filters: [
      { id: 'shadows-highlights', params: { 'shadows-strength': 40, 'highlights-strength': 30, midtones: 0 } },
      { id: 'unsharp-mask', params: { radius: 30, amount: 1.2, threshold: 0 } },
      { id: 'vibrance', params: { vibrance: 20, saturation: 10 } },
    ],
  },
  'ink-sketch': {
    name: 'Ink Sketch',
    filters: [
      { id: 'desaturate', params: { mode: 'luminosity' } },
      { id: 'edge-detect', params: { algorithm: 'sobel', amount: 1.0 } },
      { id: 'invert', params: {} },
      { id: 'levels', params: { 'input-low': 100, 'input-high': 180 } },
      { id: 'gaussian-blur', params: { 'std-dev-x': 0.5, 'std-dev-y': 0.5 } },
    ],
  },
  'watercolor': {
    name: 'Watercolor',
    filters: [
      { id: 'bilateral-filter', params: { 'spatial-radius': 10, 'color-radius': 0.05 } },
      { id: 'oilify', params: { 'mask-size': 4 } },
      { id: 'gimpressionist', params: { brush: 'watercolor', orientation: 'random', 'grid-size': 6, coverage: 1.3 } },
      { id: 'colorize', params: { hue: 220, saturation: 15, lightness: 5 } },
      { id: 'vignette', params: { radius: 0.4, softness: 0.6, amount: -0.2 } },
    ],
  },
}