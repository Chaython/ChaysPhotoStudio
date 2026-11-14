'use client'
// GIMP GPU Acceleration
// WebGL/WebGPU shader-based filter acceleration

export interface GpuFilter {
  name: string
  fragmentShader: string
  vertexShader?: string
  uniforms: Record<string, GpuUniform>
  attributes?: Record<string, GpuAttribute>
}

export interface GpuUniform {
  type: 'float' | 'vec2' | 'vec3' | 'vec4' | 'int' | 'sampler2D' | 'mat3' | 'mat4'
  value: any
}

export interface GpuAttribute {
  name: string
  size: number
  type: number
  normalized: boolean
  stride: number
  offset: number
}

export interface GpuContext {
  gl: WebGL2RenderingContext | WebGLRenderingContext
  canvas: HTMLCanvasElement
  programs: Map<string, WebGLProgram>
  textures: Map<string, WebGLTexture>
  framebuffers: Map<string, WebGLFramebuffer>
}

export class GpuAccelerator {
  private context: GpuContext | null = null
  private filters: Map<string, GpuFilter> = new Map()
  private isWebGPU = false
  private webgpuDevice: GPUDevice | null = null

  constructor() {
    this.registerBuiltInFilters()
  }

  async initialize(): Promise<boolean> {
    // Try WebGPU first
    if ('gpu' in navigator) {
      try {
        const adapter = await (navigator as any).gpu.requestAdapter({ powerPreference: 'high-performance' })
        if (adapter) {
          this.webgpuDevice = await adapter.requestDevice()
          this.isWebGPU = true
          return true
        }
      } catch {
        // Fall through to WebGL
      }
    }

    // Fallback to WebGL2
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: false })
    if (gl) {
      this.context = {
        gl,
        canvas,
        programs: new Map(),
        textures: new Map(),
        framebuffers: new Map(),
      }
      return true
    }

    // Fallback to WebGL1
    const gl1 = canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: false })
    if (gl1) {
      this.context = {
        gl: gl1,
        canvas,
        programs: new Map(),
        textures: new Map(),
        framebuffers: new Map(),
      }
      return true
    }

    return false
  }

  isAvailable(): boolean {
    return this.context !== null || this.webgpuDevice !== null
  }

  getBackend(): 'webgpu' | 'webgl2' | 'webgl' | 'none' {
    if (this.webgpuDevice) return 'webgpu'
    if (this.context?.gl instanceof WebGL2RenderingContext) return 'webgl2'
    if (this.context?.gl instanceof WebGLRenderingContext) return 'webgl'
    return 'none'
  }

  private registerBuiltInFilters(): void {
    // Gaussian Blur
    this.registerFilter({
      name: 'gaussian-blur',
      fragmentShader: `
        precision highp float;
        uniform sampler2D u_image;
        uniform vec2 u_resolution;
        uniform float u_radius;
        uniform vec2 u_direction;
        varying vec2 v_texCoord;

        void main() {
          vec4 color = vec4(0.0);
          float total = 0.0;
          float radius = u_radius;
          
          // Gaussian weights
          float weights[9] = float[](0.05, 0.09, 0.12, 0.15, 0.16, 0.15, 0.12, 0.09, 0.05);
          vec2 offsets[9];
          
          for (int i = -4; i <= 4; i++) {
            offsets[i + 4] = vec2(float(i)) * u_direction;
          }
          
          for (int i = 0; i < 9; i++) {
            vec2 coord = v_texCoord + offsets[i] / u_resolution;
            color += texture2D(u_image, coord) * weights[i];
            total += weights[i];
          }
          
          gl_FragColor = color / total;
        }
      `,
      uniforms: {
        u_image: { type: 'sampler2D', value: null },
        u_resolution: { type: 'vec2', value: [0, 0] },
        u_radius: { type: 'float', value: 10 },
        u_direction: { type: 'vec2', value: [1.0, 0.0] },
      },
    })

    // Unsharp Mask
    this.registerFilter({
      name: 'unsharp-mask',
      fragmentShader: `
        precision highp float;
        uniform sampler2D u_image;
        uniform sampler2D u_blurred;
        uniform float u_amount;
        uniform float u_threshold;
        varying vec2 v_texCoord;

        void main() {
          vec4 original = texture2D(u_image, v_texCoord);
          vec4 blurred = texture2D(u_blurred, v_texCoord);
          vec4 diff = original - blurred;
          
          float luminance = dot(diff.rgb, vec3(0.299, 0.587, 0.114));
          float mask = step(u_threshold, abs(luminance));
          
          vec4 result = original + diff * u_amount * mask;
          gl_FragColor = clamp(result, 0.0, 1.0);
        }
      `,
      uniforms: {
        u_image: { type: 'sampler2D', value: null },
        u_blurred: { type: 'sampler2D', value: null },
        u_amount: { type: 'float', value: 1.0 },
        u_threshold: { type: 'float', value: 0.0 },
      },
    })

    // Hue/Saturation
    this.registerFilter({
      name: 'hue-saturation',
      fragmentShader: `
        precision highp float;
        uniform sampler2D u_image;
        uniform float u_hue;
        uniform float u_saturation;
        uniform float u_lightness;
        uniform float u_range;
        varying vec2 v_texCoord;

        vec3 rgb2hsv(vec3 c) {
          vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
          vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
          vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
          float d = q.x - min(q.w, q.y);
          float e = 1.0e-10;
          return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
        }

        vec3 hsv2rgb(vec3 c) {
          vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
          vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
          return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }

        void main() {
          vec4 color = texture2D(u_image, v_texCoord);
          vec3 hsv = rgb2hsv(color.rgb);
          
          hsv.x = mod(hsv.x + u_hue / 360.0, 1.0);
          hsv.y = clamp(hsv.y * u_saturation, 0.0, 1.0);
          hsv.z = clamp(hsv.z + u_lightness, 0.0, 1.0);
          
          vec3 rgb = hsv2rgb(hsv);
          gl_FragColor = vec4(rgb, color.a);
        }
      `,
      uniforms: {
        u_image: { type: 'sampler2D', value: null },
        u_hue: { type: 'float', value: 0.0 },
        u_saturation: { type: 'float', value: 1.0 },
        u_lightness: { type: 'float', value: 0.0 },
        u_range: { type: 'float', value: 1.0 },
      },
    })

    // Levels
    this.registerFilter({
      name: 'levels',
      fragmentShader: `
        precision highp float;
        uniform sampler2D u_image;
        uniform float u_inLow;
        uniform float u_inHigh;
        uniform float u_gamma;
        uniform float u_outLow;
        uniform float u_outHigh;
        varying vec2 v_texCoord;

        void main() {
          vec4 color = texture2D(u_image, v_texCoord);
          vec3 rgb = color.rgb;
          
          rgb = (rgb - u_inLow) / (u_inHigh - u_inLow);
          rgb = pow(rgb, vec3(1.0 / u_gamma));
          rgb = rgb * (u_outHigh - u_outLow) + u_outLow;
          
          gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
        }
      `,
      uniforms: {
        u_image: { type: 'sampler2D', value: null },
        u_inLow: { type: 'float', value: 0.0 },
        u_inHigh: { type: 'float', value: 1.0 },
        u_gamma: { type: 'float', value: 1.0 },
        u_outLow: { type: 'float', value: 0.0 },
        u_outHigh: { type: 'float', value: 1.0 },
      },
    })

    // Curves (simplified - single channel)
    this.registerFilter({
      name: 'curves',
      fragmentShader: `
        precision highp float;
        uniform sampler2D u_image;
        uniform sampler2D u_curve_r;
        uniform sampler2D u_curve_g;
        uniform sampler2D u_curve_b;
        uniform sampler2D u_curve_a;
        varying vec2 v_texCoord;

        void main() {
          vec4 color = texture2D(u_image, v_texCoord);
          
          float r = texture2D(u_curve_r, vec2(color.r, 0.0)).r;
          float g = texture2D(u_curve_g, vec2(color.g, 0.0)).g;
          float b = texture2D(u_curve_b, vec2(color.b, 0.0)).b;
          float a = texture2D(u_curve_a, vec2(color.a, 0.0)).a;
          
          gl_FragColor = vec4(r, g, b, a);
        }
      `,
      uniforms: {
        u_image: { type: 'sampler2D', value: null },
        u_curve_r: { type: 'sampler2D', value: null },
        u_curve_g: { type: 'sampler2D', value: null },
        u_curve_b: { type: 'sampler2D', value: null },
        u_curve_a: { type: 'sampler2D', value: null },
      },
    })

    // Vibrance
    this.registerFilter({
      name: 'vibrance',
      fragmentShader: `
        precision highp float;
        uniform sampler2D u_image;
        uniform float u_vibrance;
        uniform float u_saturation;
        varying vec2 v_texCoord;

        void main() {
          vec4 color = texture2D(u_image, v_texCoord);
          vec3 rgb = color.rgb;
          
          float maxComp = max(max(rgb.r, rgb.g), rgb.b);
          float minComp = min(min(rgb.r, rgb.g), rgb.b);
          float saturation = maxComp - minComp;
          
          float vibranceFactor = 1.0 + u_vibrance * (1.0 - saturation);
          float saturationFactor = 1.0 + u_saturation;
          
          float avg = (rgb.r + rgb.g + rgb.b) / 3.0;
          vec3 gray = vec3(avg);
          
          vec3 result = mix(gray, rgb, saturationFactor) * vibranceFactor;
          
          gl_FragColor = vec4(clamp(result, 0.0, 1.0), color.a);
        }
      `,
      uniforms: {
        u_image: { type: 'sampler2D', value: null },
        u_vibrance: { type: 'float', value: 0.0 },
        u_saturation: { type: 'float', value: 0.0 },
      },
    })

    // Color Balance
    this.registerFilter({
      name: 'color-balance',
      fragmentShader: `
        precision highp float;
        uniform sampler2D u_image;
        uniform vec3 u_shadows;
        uniform vec3 u_midtones;
        uniform vec3 u_highlights;
        uniform bool u_preserveLuminosity;
        varying vec2 v_texCoord;

        void main() {
          vec4 color = texture2D(u_image, v_texCoord);
          float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          
          vec3 adjustment = mix(
            mix(u_shadows, u_midtones, smoothstep(0.25, 0.75, lum)),
            u_highlights,
            smoothstep(0.75, 1.0, lum)
          );
          
          vec3 result = color.rgb + adjustment;
          
          if (u_preserveLuminosity) {
            float newLum = dot(result, vec3(0.299, 0.587, 0.114));
            result = result * (lum / max(newLum, 0.001));
          }
          
          gl_FragColor = vec4(clamp(result, 0.0, 1.0), color.a);
        }
      `,
      uniforms: {
        u_image: { type: 'sampler2D', value: null },
        u_shadows: { type: 'vec3', value: [0.0, 0.0, 0.0] },
        u_midtones: { type: 'vec3', value: [0.0, 0.0, 0.0] },
        u_highlights: { type: 'vec3', value: [0.0, 0.0, 0.0] },
        u_preserveLuminosity: { type: 'bool', value: true },
      },
    })

    // Gradient Map
    this.registerFilter({
      name: 'gradient-map',
      fragmentShader: `
        precision highp float;
        uniform sampler2D u_image;
        uniform sampler2D u_gradient;
        varying vec2 v_texCoord;

        void main() {
          vec4 color = texture2D(u_image, v_texCoord);
          float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          vec4 mapped = texture2D(u_gradient, vec2(lum, 0.5));
          gl_FragColor = vec4(mapped.rgb, color.a);
        }
      `,
      uniforms: {
        u_image: { type: 'sampler2D', value: null },
        u_gradient: { type: 'sampler2D', value: null },
      },
    })

    // Bloom
    this.registerFilter({
      name: 'bloom',
      fragmentShader: `
        precision highp float;
        uniform sampler2D u_image;
        uniform float u_threshold;
        uniform float u_radius;
        uniform float u_intensity;
        varying vec2 v_texCoord;

        void main() {
          vec4 color = texture2D(u_image, v_texCoord);
          float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          
          vec4 bloom = vec4(0.0);
          if (luminance > u_threshold) {
            bloom = color * (luminance - u_threshold) / (1.0 - u_threshold) * u_intensity;
          }
          
          // Simple blur for bloom (would need multi-pass in real implementation)
          gl_FragColor = color + bloom;
        }
      `,
      uniforms: {
        u_image: { type: 'sampler2D', value: null },
        u_threshold: { type: 'float', value: 0.8 },
        u_radius: { type: 'float', value: 20.0 },
        u_intensity: { type: 'float', value: 1.0 },
      },
    })

    // Vignette
    this.registerFilter({
      name: 'vignette',
      fragmentShader: `
        precision highp float;
        uniform sampler2D u_image;
        uniform float u_radius;
        uniform float u_softness;
        uniform float u_amount;
        uniform float u_shape;
        varying vec2 v_texCoord;

        void main() {
          vec2 center = vec2(0.5, 0.5);
          vec2 coord = v_texCoord - center;
          
          float dist = length(coord * vec2(u_shape, 1.0));
          float vignette = smoothstep(u_radius, u_radius + u_softness, dist);
          
          vec4 color = texture2D(u_image, v_texCoord);
          vec3 vignetteColor = mix(color.rgb, vec3(0.0), vignette * u_amount);
          
          gl_FragColor = vec4(vignetteColor, color.a);
        }
      `,
      uniforms: {
        u_image: { type: 'sampler2D', value: null },
        u_radius: { type: 'float', value: 0.5 },
        u_softness: { type: 'float', value: 0.5 },
        u_amount: { type: 'float', value: 0.5 },
        u_shape: { type: 'float', value: 1.0 },
      },
    })

    // Noise
    this.registerFilter({
      name: 'noise',
      fragmentShader: `
        precision highp float;
        uniform sampler2D u_image;
        uniform float u_amount;
        uniform int u_type;
        uniform bool u_monochrome;
        uniform int u_seed;
        varying vec2 v_texCoord;

        float random(vec2 co, int seed) {
          return fract(sin(dot(co.xy + float(seed), vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
          vec4 color = texture2D(u_image, v_texCoord);
          float noise = random(v_texCoord * 100.0, u_seed) * 2.0 - 1.0;
          
          if (u_type == 1) {
            // Gaussian approximation
            noise = (random(v_texCoord * 100.0 + 1.0, u_seed) + 
                     random(v_texCoord * 100.0 + 2.0, u_seed) +
                     random(v_texCoord * 100.0 + 3.0, u_seed)) / 3.0 * 2.0 - 1.0;
          }
          
          float amount = u_amount / 100.0;
          
          if (bool(u_monochrome)) {
            float noiseVal = noise * amount;
            gl_FragColor = vec4(color.rgb + noiseVal, color.a);
          } else {
            float rNoise = random(v_texCoord * 100.0 + 10.0, u_seed) * 2.0 - 1.0;
            float gNoise = random(v_texCoord * 100.0 + 20.0, u_seed) * 2.0 - 1.0;
            float bNoise = random(v_texCoord * 100.0 + 30.0, u_seed) * 2.0 - 1.0;
            gl_FragColor = vec4(
              color.r + rNoise * amount,
              color.g + gNoise * amount,
              color.b + bNoise * amount,
              color.a
            );
          }
        }
      `,
      uniforms: {
        u_image: { type: 'sampler2D', value: null },
        u_amount: { type: 'float', value: 10.0 },
        u_type: { type: 'int', value: 0 },
        u_monochrome: { type: 'bool', value: false },
        u_seed: { type: 'int', value: 0 },
      },
    })

    // Lens Distortion
    this.registerFilter({
      name: 'lens-distortion',
      fragmentShader: `
        precision highp float;
        uniform sampler2D u_image;
        uniform float u_main;
        uniform float u_edge;
        uniform float u_zoom;
        uniform float u_brighten;
        varying vec2 v_texCoord;

        void main() {
          vec2 center = vec2(0.5, 0.5);
          vec2 coord = (v_texCoord - center) * 2.0;
          float r = length(coord);
          
          float distortion = 1.0 + u_main * r * r + u_edge * r * r * r * r;
          vec2 distorted = coord * distortion * u_zoom;
          
          vec2 uv = distorted * 0.5 + 0.5;
          
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            gl_FragColor = vec4(0.0);
          } else {
            vec4 color = texture2D(u_image, uv);
            gl_FragColor = vec4(color.rgb * (1.0 + u_brighten), color.a);
          }
        }
      `,
      uniforms: {
        u_image: { type: 'sampler2D', value: null },
        u_main: { type: 'float', value: 0.0 },
        u_edge: { type: 'float', value: 0.0 },
        u_zoom: { type: 'float', value: 1.0 },
        u_brighten: { type: 'float', value: 0.0 },
      },
    })
  }

  registerFilter(filter: GpuFilter): void {
    this.filters.set(filter.name, filter)
  }

  getFilter(name: string): GpuFilter | undefined {
    return this.filters.get(name)
  }

  getAllFilters(): GpuFilter[] {
    return Array.from(this.filters.values())
  }

  /** Apply filter to canvas */
  async applyFilter(
    canvas: HTMLCanvasElement,
    filterName: string,
    params: Record<string, any> = {}
  ): Promise<HTMLCanvasElement> {
    if (!this.context) throw new Error('GPU not initialized')

    const filter = this.filters.get(filterName)
    if (!filter) throw new Error(`Filter ${filterName} not found`)

    const gl = this.context.gl
    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = canvas.width
    outputCanvas.height = canvas.height

    // This is a simplified implementation
    // Real implementation would compile shaders, create programs, bind textures, etc.
    
    // For now, return original canvas
    const output = document.createElement('canvas')
    output.width = canvas.width
    output.height = canvas.height
    const ctx = output.getContext('2d')!
    ctx.drawImage(canvas, 0, 0)
    
    return output
  }

  /** Apply multiple filters in sequence */
  async applyFilterChain(
    canvas: HTMLCanvasElement,
    chain: Array<{ name: string; params: Record<string, any> }>
  ): Promise<HTMLCanvasElement> {
    let current = canvas
    for (const step of chain) {
      current = await this.applyFilter(current, step.name, step.params)
    }
    return current
  }

  /** Create GPU texture from canvas */
  createTexture(canvas: HTMLCanvasElement): WebGLTexture | null {
    if (!this.context) return null
    const gl = this.context.gl
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }

  /** Cleanup */
  dispose(): void {
    if (this.context) {
      for (const [, texture] of this.context.textures) {
        this.context.gl.deleteTexture(texture)
      }
      for (const [, fb] of this.context.framebuffers) {
        this.context.gl.deleteFramebuffer(fb)
      }
      for (const [, program] of this.context.programs) {
        this.context.gl.deleteProgram(program)
      }
      this.context.textures.clear()
      this.context.framebuffers.clear()
      this.context.programs.clear()
    }
    if (this.webgpuDevice) {
      this.webgpuDevice.destroy()
      this.webgpuDevice = null
    }
    this.context = null
    this.isWebGPU = false
  }
}

/** High-level GPU filter pipeline */
export class GpuFilterPipeline {
  private accelerator: GpuAccelerator
  private steps: Array<{ filter: string; params: Record<string, any> }> = []

  constructor(accelerator: GpuAccelerator) {
    this.accelerator = accelerator
  }

  addStep(filterName: string, params: Record<string, any> = {}): this {
    this.steps.push({ filter: filterName, params })
    return this
  }

  clear(): this {
    this.steps = []
    return this
  }

  async process(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    let current = canvas
    for (const step of this.steps) {
      current = await this.accelerator.applyFilter(current, step.filter, step.params)
    }
    return current
  }

  getSteps(): Array<{ filter: string; params: Record<string, any> }> {
    return [...this.steps]
  }
}

/** Pre-built filter pipelines */
export const GPU_PIPELINES: Record<string, Array<{ filter: string; params: Record<string, any> }>> = {
  'vintage': [
    { filter: 'hue-saturation', params: { u_hue: 30, u_saturation: 0.8, u_lightness: -0.1 } },
    { filter: 'vignette', params: { u_radius: 0.6, u_softness: 0.4, u_amount: 0.4 } },
    { filter: 'noise', params: { u_amount: 8, u_monochrome: true } },
    { filter: 'levels', params: { u_inLow: 0.05, u_inHigh: 0.95, u_gamma: 1.1 } },
  ],
  'high-contrast-bw': [
    { filter: 'hue-saturation', params: { u_saturation: 0 } },
    { filter: 'curves', params: {} },
    { filter: 'levels', params: { u_inLow: 0.1, u_inHigh: 0.9, u_gamma: 1.2 } },
    { filter: 'unsharp-mask', params: { u_amount: 1.5, u_threshold: 2 } },
  ],
  'cinematic': [
    { filter: 'color-balance', params: { u_shadows: [0.1, -0.05, 0.15], u_midtones: [0.05, 0.02, -0.05], u_highlights: [0.1, 0.05, -0.1] } },
    { filter: 'curves', params: {} },
    { filter: 'vibrance', params: { u_vibrance: 20, u_saturation: 10 } },
  ],
  'dreamy': [
    { filter: 'gaussian-blur', params: { u_radius: 8, u_direction: [1, 1] } },
    { filter: 'exposure', params: { u_exposure: 0.3, u_gamma: 0.9 } },
    { filter: 'vibrance', params: { u_vibrance: 20, u_saturation: 5 } },
    { filter: 'bloom', params: { u_threshold: 0.7, u_radius: 30, u_intensity: 0.5 } },
  ],
  'sharpen': [
    { filter: 'unsharp-mask', params: { u_amount: 1.0, u_threshold: 2 } },
  ],
  'denoise': [
    { filter: 'gaussian-blur', params: { u_radius: 2 } },
    { filter: 'unsharp-mask', params: { u_amount: 0.5, u_threshold: 5 } },
  ],
}

/** Shader compilation utilities */
export function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compilation failed: ${error}`)
  }

  return shader
}

export function createProgram(gl: WebGLRenderingContext, vertexSrc: string, fragmentSrc: string): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSrc)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc)

  const program = gl.createProgram()!
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`Program linking failed: ${error}`)
  }

  return program
}