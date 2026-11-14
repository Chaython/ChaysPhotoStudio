'use client'
// GIMP Neural Filters
// AI-powered filters using ONNX Runtime Web / TensorFlow.js / WebGPU

export interface NeuralFilter {
  id: string
  name: string
  description: string
  category: 'portrait' | 'landscape' | 'creative' | 'restoration' | 'utility'
  modelUrl: string
  inputShape: number[]
  outputShape: number[]
  parameters: NeuralFilterParam[]
  requirements: {
    webgpu: boolean
    memory: number // MB
    compute: 'low' | 'medium' | 'high'
  }
  tags: string[]
  previewUrl?: string
}

export interface NeuralFilterParam {
  key: string
  label: string
  type: 'slider' | 'number' | 'select' | 'toggle' | 'color' | 'image'
  min?: number
  max?: number
  step?: number
  default: any
  options?: { label: string; value: any }[]
  description: string
}

export interface NeuralFilterResult {
  outputCanvas: HTMLCanvasElement
  metadata: {
    modelName: string
    inferenceTime: number
    inputShape: number[]
    outputShape: number[]
    parameters: Record<string, any>
  }
}

export interface NeuralFilterPipeline {
  filters: Array<{
    filterId: string
    params: Record<string, any>
    enabled: boolean
    opacity: number
    blendMode: string
  }>
  inputCanvas: HTMLCanvasElement
  outputCanvas: HTMLCanvasElement
}

/** Neural Filter Manager */
export class NeuralFilterManager {
  private session: any = null // ONNX Runtime InferenceSession
  private backend: 'webgl' | 'webgpu' | 'wasm' | 'cpu' = 'webgl'
  private models: Map<string, any> = new Map()
  private loadingPromises: Map<string, Promise<any>> = new Map()
  private listeners: Set<() => void> = new Set()

  constructor() {
    this.detectBackend()
  }

  private async detectBackend(): Promise<void> {
    // Check WebGPU availability
    if ('gpu' in navigator) {
      try {
        const adapter = await (navigator as any).gpu?.requestAdapter?.({ powerPreference: 'high-performance' })
        if (adapter) {
          this.backend = 'webgpu'
          return
        }
      } catch {}
    }

    // Check WebGL2
    const canvas = document.createElement('canvas')
    const gl2 = canvas.getContext('webgl2')
    if (gl2) {
      this.backend = 'webgl'
      return
    }

    // Check WebGL1
    const gl1 = canvas.getContext('webgl')
    if (gl1) {
      this.backend = 'webgl'
      return
    }

    // Fallback to WASM/CPU
    this.backend = 'wasm'
  }

  getBackend(): string {
    return this.backend
  }

  /** Load a neural filter model */
  async loadFilter(filterId: string): Promise<void> {
    if (this.models.has(filterId)) return
    if (this.loadingPromises.has(filterId)) {
      return this.loadingPromises.get(filterId)
    }

    const filter = NEURAL_FILTERS[filterId]
    if (!filter) throw new Error(`Unknown filter: ${filterId}`)

    const promise = this.loadModel(filter)
    this.loadingPromises.set(filterId, promise)

    try {
      await promise
    } finally {
      this.loadingPromises.delete(filterId)
    }
  }

  private async loadModel(filter: NeuralFilter): Promise<void> {
    // Load ONNX model
    // This would use onnxruntime-web
    // For now, simulate loading
    await new Promise(r => setTimeout(r, 100))
    
    // In real implementation:
    // const session = await ort.InferenceSession.create(filter.modelUrl, {
    //   executionProviders: this.getExecutionProviders()
    // })
    // this.models.set(filter.id, session)
  }

  private getExecutionProviders(): string[] {
    switch (this.backend) {
      case 'webgpu':
        return ['webgpu']
      case 'webgl':
        return ['webgl']
      case 'wasm':
        return ['wasm']
      default:
        return ['cpu']
    }
  }

  /** Run a neural filter */
  async runFilter(
    filterId: string,
    inputCanvas: HTMLCanvasElement,
    params: Record<string, any>
  ): Promise<NeuralFilterResult> {
    await this.loadFilter(filterId)

    const filter = NEURAL_FILTERS[filterId]
    if (!filter) throw new Error(`Unknown filter: ${filterId}`)

    const startTime = performance.now()

    // Preprocess input
    const inputTensor = await this.preprocessInput(inputCanvas, filter.inputShape)

    // Run inference
    // const outputTensor = await this.models.get(filterId).run({ input: inputTensor })

    // Postprocess output
    const outputCanvas = await this.postprocessOutput(null, filter.outputShape, inputCanvas.width, inputCanvas.height)

    const inferenceTime = performance.now() - startTime

    return {
      outputCanvas,
      metadata: {
        modelName: filter.name,
        inferenceTime,
        inputShape: filter.inputShape,
        outputShape: filter.outputShape,
        parameters: params,
      },
    }
  }

  private async preprocessInput(
    canvas: HTMLCanvasElement,
    inputShape: number[]
  ): Promise<any> {
    // Resize and normalize
    const [, , height, width] = inputShape
    const resized = createCanvas(width, height)
    const ctx = ctx2d(resized)
    ctx.drawImage(canvas, 0, 0, width, height)

    // Normalize to [-1, 1] or [0, 1] depending on model
    const imgData = ctx.getImageData(0, 0, width, height)
    const data = imgData.data

    const tensorData = new Float32Array(width * height * 3)
    for (let i = 0; i < data.length; i += 4) {
      tensorData[i / 4 * 3] = data[i] / 255
      tensorData[i / 4 * 3 + 1] = data[i + 1] / 255
      tensorData[i / 4 * 3 + 2] = data[i + 2] / 255
    }

    return tensorData
  }

  private async postprocessOutput(
    outputTensor: any,
    outputShape: number[],
    originalWidth: number,
    originalHeight: number
  ): Promise<HTMLCanvasElement> {
    const output = createCanvas(originalWidth, originalHeight)
    const ctx = ctx2d(output)

    // Would decode output tensor to canvas
    // For now, return placeholder
    const ctx = ctx2d(createCanvas(originalWidth, originalHeight))
    ctx.fillStyle = '#888'
    ctx.fillRect(0, 0, originalWidth, originalHeight)

    return output
  }

  /** Run multiple filters in pipeline */
  async runPipeline(pipeline: NeuralFilterPipeline): Promise<HTMLCanvasElement> {
    let current = pipeline.inputCanvas

    for (const step of pipeline.filters) {
      if (!step.enabled) continue

      const result = await this.runFilter(step.filterId, current, step.params)
      current = result.outputCanvas
    }

    return current
  }

  /** Get available filters */
  getAvailableFilters(): NeuralFilter[] {
    return Object.values(NEURAL_FILTERS)
  }

  getFilter(filterId: string): NeuralFilter | undefined {
    return NEURAL_FILTERS[filterId]
  }

  isLoaded(filterId: string): boolean {
    return this.models.has(filterId)
  }

  isLoading(filterId: string): boolean {
    return this.loadingPromises.has(filterId)
  }

  unloadFilter(filterId: string): void {
    const model = this.models.get(filterId)
    if (model) {
      // model.release()
      this.models.delete(filterId)
      this.notify()
    }
  }

  unloadAll(): void {
    for (const model of this.models.values()) {
      // model.release()
    }
    this.models.clear()
    this.notify()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Built-in Neural Filters */
export const NEURAL_FILTERS: Record<string, NeuralFilter> = {
  // Portrait filters
  'smart-portrait': {
    id: 'smart-portrait',
    name: 'Smart Portrait',
    description: 'AI-powered portrait enhancement: skin smoothing, eye enhancement, teeth whitening, relighting',
    category: 'portrait',
    modelUrl: '/models/smart_portrait.onnx',
    inputShape: [1, 3, 512, 512],
    outputShape: [1, 3, 512, 512],
    parameters: [
      { key: 'skinSmoothing', label: 'Skin Smoothing', type: 'slider', min: 0, max: 100, step: 1, default: 50, description: 'Amount of skin smoothing' },
      { key: 'eyeEnhancement', label: 'Eye Enhancement', type: 'slider', min: 0, max: 100, step: 1, default: 30, description: 'Brighten and sharpen eyes' },
      { key: 'teethWhitening', label: 'Teeth Whitening', type: 'slider', min: 0, max: 100, step: 1, default: 40, description: 'Whiten teeth' },
      { key: 'relighting', label: 'Relighting', type: 'slider', min: 0, max: 100, step: 1, default: 20, description: 'Adjust facial lighting' },
      { key: 'faceShape', label: 'Face Shape', type: 'slider', min: -50, max: 50, step: 1, default: 0, description: 'Adjust face shape' },
      { key: 'eyeSize', label: 'Eye Size', type: 'slider', min: -50, max: 50, step: 1, default: 0, description: 'Adjust eye size' },
      { key: 'noseWidth', label: 'Nose Width', type: 'slider', min: -50, max: 50, step: 1, default: 0, description: 'Adjust nose width' },
      { key: 'jawline', label: 'Jawline', type: 'slider', min: -50, max: 50, step: 1, default: 0, description: 'Adjust jawline definition' },
    ],
    requirements: { webgpu: true, memory: 512, compute: 'high' },
    tags: ['portrait', 'face', 'beauty', 'retouch'],
  },

  'skin-smoothing': {
    id: 'skin-smoothing',
    name: 'Skin Smoothing',
    description: 'Advanced skin smoothing with texture preservation',
    category: 'portrait',
    modelUrl: '/models/skin_smoothing.onnx',
    inputShape: [1, 3, 512, 512],
    outputShape: [1, 3, 512, 512],
    parameters: [
      { key: 'amount', label: 'Amount', type: 'slider', min: 0, max: 100, step: 1, default: 50 },
      { key: 'texturePreservation', label: 'Texture Preservation', type: 'slider', min: 0, max: 100, step: 1, default: 70 },
      { key: 'frequencySeparation', label: 'Frequency Separation', type: 'toggle', default: true },
    ],
    requirements: { webgpu: true, memory: 256, compute: 'medium' },
    tags: ['portrait', 'skin', 'retouch', 'beauty'],
  },

  'eye-enhancement': {
    id: 'eye-enhancement',
    name: 'Eye Enhancement',
    description: 'Brighten, sharpen, and enhance eyes',
    category: 'portrait',
    modelUrl: '/models/eye_enhancement.onnx',
    inputShape: [1, 3, 256, 256],
    outputShape: [1, 3, 256, 256],
    parameters: [
      { key: 'brightness', label: 'Brightness', type: 'slider', min: -50, max: 50, step: 1, default: 20 },
      { key: 'sharpness', label: 'Sharpness', type: 'slider', min: 0, max: 100, step: 1, default: 30 },
      { key: 'whiteness', label: 'Whiteness', type: 'slider', min: 0, max: 100, step: 1, default: 30 },
      { key: 'irisEnhancement', label: 'Iris Enhancement', type: 'slider', min: 0, max: 100, step: 1, default: 40 },
      { key: 'catchlight', label: 'Catchlight', type: 'toggle', default: true },
    ],
    requirements: { webgpu: false, memory: 128, compute: 'low' },
    tags: ['portrait', 'eyes', 'enhancement'],
  },

  'teeth-whitening': {
    id: 'teeth-whitening',
    name: 'Teeth Whitening',
    description: 'Natural-looking teeth whitening',
    category: 'portrait',
    modelUrl: '/models/teeth_whitening.onnx',
    inputShape: [1, 3, 256, 256],
    outputShape: [1, 3, 256, 256],
    parameters: [
      { key: 'whiteness', label: 'Whiteness', type: 'slider', min: 0, max: 100, step: 1, default: 60 },
      { key: 'naturalness', label: 'Naturalness', type: 'slider', min: 0, max: 100, step: 1, default: 80 },
    ],
    requirements: { webgpu: false, memory: 64, compute: 'low' },
    tags: ['portrait', 'teeth', 'whitening'],
  },

  'relighting': {
    id: 'relighting',
    name: 'Portrait Relighting',
    description: 'Change lighting direction and quality on portraits',
    category: 'portrait',
    modelUrl: '/models/relighting.onnx',
    inputShape: [1, 3, 512, 512],
    outputShape: [1, 3, 512, 512],
    parameters: [
      { key: 'lightDirection', label: 'Light Direction', type: 'select', options: [
        { label: 'Top', value: 'top' },
        { label: 'Bottom', value: 'bottom' },
        { label: 'Left', value: 'left' },
        { label: 'Right', value: 'right' },
        { label: 'Rembrandt', value: 'rembrandt' },
        { label: 'Butterfly', value: 'butterfly' },
        { label: 'Split', value: 'split' },
        { label: 'Loop', value: 'loop' },
      ], default: 'top' },
      { key: 'intensity', label: 'Intensity', type: 'slider', min: 0, max: 100, step: 1, default: 50 },
      { key: 'softness', label: 'Softness', type: 'slider', min: 0, max: 100, step: 1, default: 50 },
      { key: 'fillLight', label: 'Fill Light', type: 'slider', min: 0, max: 100, step: 1, default: 30 },
      { key: 'rimLight', label: 'Rim Light', type: 'slider', min: 0, max: 100, step: 1, default: 20 },
    ],
    requirements: { webgpu: true, memory: 512, compute: 'high' },
    tags: ['portrait', 'lighting', 'relighting', 'studio'],
  },

  'age-progression': {
    id: 'age-progression',
    name: 'Age Progression/Regression',
    description: 'Age or de-age a face',
    category: 'portrait',
    modelUrl: '/models/age_progression.onnx',
    inputShape: [1, 3, 512, 512],
    outputShape: [1, 3, 512, 512],
    parameters: [
      { key: 'age', label: 'Target Age', type: 'slider', min: 1, max: 100, step: 1, default: 25 },
      { key: 'preserveIdentity', label: 'Preserve Identity', type: 'slider', min: 0, max: 100, step: 1, default: 80 },
    ],
    requirements: { webgpu: true, memory: 512, compute: 'high' },
    tags: ['portrait', 'age', 'aging', 'transformation'],
  },

  'expression-edit': {
    id: 'expression-edit',
    name: 'Expression Editor',
    description: 'Change facial expressions',
    category: 'portrait',
    modelUrl: '/models/expression_edit.onnx',
    inputShape: [1, 3, 512, 512],
    outputShape: [1, 3, 512, 512],
    parameters: [
      { key: 'smile', label: 'Smile', type: 'slider', min: -100, max: 100, step: 1, default: 0 },
      { key: 'anger', label: 'Anger', type: 'slider', min: 0, max: 100, step: 1, default: 0 },
      { key: 'surprise', label: 'Surprise', type: 'slider', min: 0, max: 100, step: 1, default: 0 },
      { key: 'sadness', label: 'Sadness', type: 'slider', min: 0, max: 100, step: 1, default: 0 },
    ],
    requirements: { webgpu: true, memory: 512, compute: 'high' },
    tags: ['portrait', 'expression', 'emotion', 'face'],
  },

  // Landscape/Creative
  'sky-replacement': {
    id: 'sky-replacement',
    name: 'Sky Replacement',
    description: 'Automatically detect and replace sky',
    category: 'landscape',
    modelUrl: '/models/sky_segmentation.onnx',
    inputShape: [1, 3, 512, 512],
    outputShape: [1, 1, 512, 512], // Segmentation mask
    parameters: [
      { key: 'skyImage', label: 'Sky Image', type: 'image', default: null },
      { key: 'edgeFeather', label: 'Edge Feather', type: 'slider', min: 0, max: 100, step: 1, default: 20 },
      { key: 'brightness', label: 'Sky Brightness', type: 'slider', min: -100, max: 100, step: 1, default: 0 },
      { key: 'temperature', label: 'Temperature', type: 'slider', min: -100, max: 100, step: 1, default: 0 },
      { key: 'scale', label: 'Scale', type: 'slider', min: 50, max: 200, step: 1, default: 100 },
      { key: 'position', label: 'Vertical Position', type: 'slider', min: -50, max: 50, step: 1, default: 0 },
      { key: 'flip', label: 'Flip Horizontal', type: 'toggle', default: false },
      { key: 'blendMode', label: 'Blend Mode', type: 'select', options: [
        { label: 'Normal', value: 'normal' },
        { label: 'Multiply', value: 'multiply' },
        { label: 'Screen', value: 'screen' },
        { label: 'Overlay', value: 'overlay' },
      ], default: 'normal' },
    ],
    requirements: { webgpu: true, memory: 256, compute: 'medium' },
    tags: ['landscape', 'sky', 'replacement', 'compositing'],
  },

  'depth-estimation': {
    id: 'depth-estimation',
    name: 'Depth Estimation',
    description: 'Generate depth map from single image',
    category: 'utility',
    modelUrl: '/models/depth_estimation.onnx',
    inputShape: [1, 3, 384, 384],
    outputShape: [1, 1, 384, 384],
    parameters: [
      { key: 'detail', label: 'Detail Level', type: 'slider', min: 1, max: 5, step: 1, default: 3 },
      { key: 'invert', label: 'Invert Depth', type: 'toggle', default: false },
      { key: 'colorize', label: 'Colorize Depth', type: 'toggle', default: true },
      { key: 'colormap', label: 'Colormap', type: 'select', options: [
        { label: 'Viridis', value: 'viridis' },
        { label: 'Plasma', value: 'plasma' },
        { label: 'Inferno', value: 'inferno' },
        { label: 'Magma', value: 'magma' },
        { label: 'Turbo', value: 'turbo' },
        { label: 'Grayscale', value: 'grayscale' },
      ], default: 'viridis' },
    ],
    requirements: { webgpu: false, memory: 128, compute: 'medium' },
    tags: ['depth', '3d', 'depth-map', 'utility'],
  },

  'super-resolution': {
    id: 'super-resolution',
    name: 'Super Resolution',
    description: 'AI-powered image upscaling (2x, 4x)',
    category: 'utility',
    modelUrl: '/models/esrgan.onnx',
    inputShape: [1, 3, null, null], // Dynamic
    outputShape: [1, 3, null, null],
    parameters: [
      { key: 'scale', label: 'Scale Factor', type: 'select', options: [
        { label: '2x', value: 2 },
        { label: '4x', value: 4 },
        { label: '8x', value: 8 },
      ], default: 4 },
      { key: 'model', label: 'Model', type: 'select', options: [
        { label: 'ESRGAN (General)', value: 'esrgan' },
        { label: 'RealESRGAN (Photos)', value: 'realesrgan' },
        { label: 'Anime (Illustrations)', value: 'anime' },
        { label: 'Text/Document', value: 'text' },
      ], default: 'realesrgan' },
      { key: 'faceEnhance', label: 'Face Enhancement', type: 'toggle', default: true },
      { key: 'tileSize', label: 'Tile Size', type: 'slider', min: 64, max: 512, step: 64, default: 256 },
    ],
    requirements: { webgpu: true, memory: 1024, compute: 'high' },
    tags: ['upscale', 'super-resolution', 'enhancement', 'ai'],
  },

  'denoise': {
    id: 'denoise',
    name: 'AI Denoise',
    description: 'Remove noise while preserving detail',
    category: 'restoration',
    modelUrl: '/models/denoise.onnx',
    inputShape: [1, 3, 512, 512],
    outputShape: [1, 3, 512, 512],
    parameters: [
      { key: 'strength', label: 'Strength', type: 'slider', min: 0, max: 100, step: 1, default: 50 },
      { key: 'preserveDetails', label: 'Preserve Details', type: 'slider', min: 0, max: 100, step: 1, default: 50 },
      { key: 'colorNoise', label: 'Color Noise Reduction', type: 'slider', min: 0, max: 100, step: 1, default: 50 },
    ],
    requirements: { webgpu: true, memory: 256, compute: 'medium' },
    tags: ['denoise', 'noise-reduction', 'restoration', 'cleanup'],
  },

  'deblur': {
    id: 'deblur',
    name: 'Deblur / Sharpen',
    description: 'Remove motion blur and camera shake',
    category: 'restoration',
    modelUrl: '/models/deblur.onnx',
    inputShape: [1, 3, 512, 512],
    outputShape: [1, 3, 512, 512],
    parameters: [
      { key: 'strength', label: 'Strength', type: 'slider', min: 0, max: 100, step: 1, default: 50 },
      { key: 'blurType', label: 'Blur Type', type: 'select', options: [
        { label: 'Motion Blur', value: 'motion' },
        { label: 'Defocus', value: 'defocus' },
        { label: 'Gaussian', value: 'gaussian' },
        { label: 'Auto Detect', value: 'auto' },
      ], default: 'auto' },
    ],
    requirements: { webgpu: true, memory: 512, compute: 'high' },
    tags: ['deblur', 'sharpen', 'motion-blur', 'restoration'],
  },

  'colorize': {
    id: 'colorize',
    name: 'Colorize B&W Photos',
    description: 'Automatically colorize black and white photos',
    category: 'restoration',
    modelUrl: '/models/colorization.onnx',
    inputShape: [1, 1, 256, 256], // Grayscale input
    outputShape: [1, 3, 256, 256],
    parameters: [
      { key: 'renderFactor', label: 'Render Factor', type: 'slider', min: 10, max: 50, step: 1, default: 35 },
      { key: 'artistic', label: 'Artistic', type: 'toggle', default: false },
      { key: 'colorHints', label: 'Color Hints', type: 'image', default: null },
    ],
    requirements: { webgpu: true, memory: 256, compute: 'high' },
    tags: ['colorize', 'bw', 'restoration', 'ai'],
  },

  'style-transfer': {
    id: 'style-transfer',
    name: 'Neural Style Transfer',
    description: 'Apply artistic styles to photos',
    category: 'creative',
    modelUrl: '/models/style_transfer.onnx',
    inputShape: [1, 3, 512, 512],
    outputShape: [1, 3, 512, 512],
    parameters: [
      { key: 'styleImage', label: 'Style Image', type: 'image', default: null },
      { key: 'styleStrength', label: 'Style Strength', type: 'slider', min: 0, max: 100, step: 1, default: 70 },
      { key: 'contentWeight', label: 'Content Weight', type: 'slider', min: 0, max: 100, step: 1, default: 50 },
      { key: 'styleWeight', label: 'Style Weight', type: 'slider', min: 0, max: 100, step: 1, default: 100 },
      { key: 'tvWeight', label: 'Total Variation', type: 'slider', min: 0, max: 100, step: 1, default: 10 },
      { key: 'styleModel', label: 'Style Model', type: 'select', options: [
        { label: 'Van Gogh - Starry Night', value: 'starry_night' },
        { label: 'Mona Lisa', value: 'mona_lisa' },
        { label: 'Kandinsky', value: 'kandinsky' },
        { label: 'Picasso', value: 'picasso' },
        { label: 'Custom', value: 'custom' },
      ], default: 'starry_night' },
    ],
    requirements: { webgpu: true, memory: 512, compute: 'high' },
    tags: ['style-transfer', 'artistic', 'ai', 'creative'],
  },

  'anime-gan': {
    id: 'anime-gan',
    name: 'AnimeGAN',
    description: 'Convert photos to anime style',
    category: 'creative',
    modelUrl: '/models/animegan.onnx',
    inputShape: [1, 3, 512, 512],
    outputShape: [1, 3, 512, 512],
    parameters: [
      { key: 'style', label: 'Style', type: 'select', options: [
        { label: 'Hayao', value: 'hayao' },
        { label: 'Shinkai', value: 'shinkai' },
        { label: 'Paprika', value: 'paprika' },
        { label: 'Custom', value: 'custom' },
      ], default: 'hayao' },
      { key: 'smoothness', label: 'Smoothness', type: 'slider', min: 0, max: 100, step: 1, default: 50 },
    ],
    requirements: { webgpu: true, memory: 512, compute: 'high' },
    tags: ['anime', 'cartoon', 'style-transfer', 'gan'],
  },

  'background-removal': {
    id: 'background-removal',
    name: 'Background Removal',
    description: 'Remove background from images',
    category: 'utility',
    modelUrl: '/models/u2net.onnx',
    inputShape: [1, 3, 320, 320],
    outputShape: [1, 1, 320, 320], // Alpha mask
    parameters: [
      { key: 'feather', label: 'Edge Feather', type: 'slider', min: 0, max: 20, step: 1, default: 2 },
      { key: 'refine', label: 'Refine Edges', type: 'toggle', default: true },
      { key: 'backgroundColor', label: 'Background Color', type: 'color', default: '#ffffff' },
    ],
    requirements: { webgpu: false, memory: 128, compute: 'medium' },
    tags: ['background', 'removal', 'segmentation', 'mask', 'cutout'],
  },

  'segmentation': {
    id: 'segmentation',
    name: 'Semantic Segmentation',
    description: 'Segment image into semantic regions',
    category: 'utility',
    modelUrl: '/models/deeplabv3.onnx',
    inputShape: [1, 3, 512, 512],
    outputShape: [1, 21, 512, 512], // 21 classes
    parameters: [
      { key: 'overlay', label: 'Overlay Colors', type: 'toggle', default: true },
      { key: 'opacity', label: 'Overlay Opacity', type: 'slider', min: 0, max: 100, step: 1, default: 50 },
    ],
    requirements: { webgpu: false, memory: 256, compute: 'medium' },
    tags: ['segmentation', 'semantic', 'ai', 'masking'],
  },

  'object-detection': {
    id: 'object-detection',
    name: 'Object Detection',
    description: 'Detect and locate objects in images',
    category: 'utility',
    modelUrl: '/models/yolov8.onnx',
    inputShape: [1, 3, 640, 640],
    outputShape: [1, 84, 8400], // YOLOv8 format
    parameters: [
      { key: 'confidence', label: 'Confidence Threshold', type: 'slider', min: 0, max: 100, step: 1, default: 25 },
      { key: 'iou', label: 'IoU Threshold', type: 'slider', min: 0, max: 100, step: 1, default: 45 },
      { key: 'classes', label: 'Classes to Detect', type: 'select', options: [
        { label: 'All (80 classes)', value: 'all' },
        { label: 'People', value: 'person' },
        { label: 'Vehicles', value: 'vehicle' },
        { label: 'Animals', value: 'animal' },
      ], default: 'all' },
    ],
    requirements: { webgpu: true, memory: 256, compute: 'high' },
    tags: ['detection', 'yolo', 'object', 'ai', 'bounding-box'],
  },

  'face-detection': {
    id: 'face-detection',
    name: 'Face Detection & Landmarks',
    description: 'Detect faces and 68 facial landmarks',
    category: 'utility',
    modelUrl: '/models/face_detection.onnx',
    inputShape: [1, 3, 640, 640],
    outputShape: [1, 68, 2], // 68 landmarks x,y
    parameters: [
      { key: 'confidence', label: 'Confidence', type: 'slider', min: 0, max: 100, step: 1, default: 50 },
      { key: 'maxFaces', label: 'Max Faces', type: 'slider', min: 1, max: 50, step: 1, default: 10 },
      { key: 'landmarks', label: 'Show Landmarks', type: 'toggle', default: true },
    ],
    requirements: { webgpu: false, memory: 128, compute: 'medium' },
    tags: ['face', 'detection', 'landmarks', 'facial-recognition'],
  },

  'pose-estimation': {
    id: 'pose-estimation',
    name: 'Pose Estimation',
    description: 'Detect human body pose keypoints',
    category: 'utility',
    modelUrl: '/models/posenet.onnx',
    inputShape: [1, 3, 257, 257],
    outputShape: [1, 17, 3], // 17 keypoints x,y,confidence
    parameters: [
      { key: 'confidence', label: 'Confidence', type: 'slider', min: 0, max: 100, step: 1, default: 30 },
      { key: 'maxPoses', label: 'Max Poses', type: 'slider', min: 1, max: 10, step: 1, default: 5 },
      { key: 'skeleton', label: 'Draw Skeleton', type: 'toggle', default: true },
    ],
    requirements: { webgpu: false, memory: 128, compute: 'medium' },
    tags: ['pose', 'keypoints', 'body', 'skeleton', 'animation'],
  },

  'hand-tracking': {
    id: 'hand-tracking',
    name: 'Hand Tracking',
    description: 'Detect 21 hand landmarks',
    category: 'utility',
    modelUrl: '/models/hand_tracking.onnx',
    inputShape: [1, 3, 256, 256],
    outputShape: [1, 21, 3], // 21 landmarks x,y,z
    parameters: [
      { key: 'confidence', label: 'Confidence', type: 'slider', min: 0, max: 100, step: 1, default: 50 },
      { key: 'maxHands', label: 'Max Hands', type: 'slider', min: 1, max: 4, step: 1, default: 2 },
    ],
    requirements: { webgpu: false, memory: 64, compute: 'low' },
    tags: ['hand', 'gesture', 'tracking', 'ar', 'vr'],
  },
}

/** High-level API for applying neural filters */
export async function applyNeuralFilter(
  filterId: string,
  canvas: HTMLCanvasElement,
  params: Record<string, any> = {}
): Promise<HTMLCanvasElement> {
  const manager = new NeuralFilterManager()
  const result = await manager.runFilter(filterId, canvas, params)
  return result.outputCanvas
}

/** Apply neural filter pipeline */
export async function applyNeuralPipeline(
  canvas: HTMLCanvasElement,
  steps: Array<{ filterId: string; params: Record<string, any>; opacity?: number; blendMode?: string }>
): Promise<HTMLCanvasElement> {
  const manager = new NeuralFilterManager()
  let current = canvas

  for (const step of steps) {
    const result = await manager.runFilter(step.filterId, current, step.params)
    current = result.outputCanvas
  }

  return current
}

/** Batch process images with neural filter */
export async function batchNeuralFilter(
  filterId: string,
  files: File[],
  params: Record<string, any>,
  onProgress?: (completed: number, total: number, currentFile: string) => void
): Promise<Blob[]> {
  const manager = new NeuralFilterManager()
  const results: Blob[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)

    const result = await manager.runFilter(filterId, canvas, params)
    const blob = await new Promise<Blob>(resolve => 
      result.outputCanvas.toBlob(b => resolve(b!), 'image/png')
    )
    results.push(blob)

    onProgress?.(i + 1, files.length, file.name)
  }

  return results
}