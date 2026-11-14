'use client'
// GEGL (Generic Graphics Library) operation compatibility layer
// Implements common GEGL operations used by GIMP 3.0 filters
// GEGL ops are node-based image processing operations

import { createCanvas, ctx2d } from '../utils/canvas'

export interface GeglOperation {
  name: string
  title: string
  description: string
  categories: string[]
  properties: GeglProperty[]
}

export interface GeglProperty {
  name: string
  type: 'double' | 'int' | 'string' | 'boolean' | 'color' | 'curve' | 'matrix' | 'enum'
  label: string
  description: string
  default: any
  minimum?: number
  maximum?: number
  step?: number
  enumValues?: { value: string; label: string }[]
}

export interface GeglNode {
  operation: string
  properties: Record<string, any>
  inputs: Record<string, GeglNode>
  output?: string
}

// Common GEGL operations used by GIMP
export const GEGL_OPERATIONS = new Map<string, GeglOperation>([
  ['gegl:gaussian-blur', {
    name: 'gegl:gaussian-blur',
    title: 'Gaussian Blur',
    description: 'Blurs the input using a Gaussian kernel',
    categories: ['blur'],
    properties: [
      { name: 'std-dev-x', type: 'double', label: 'Horizontal radius', description: 'Standard deviation in X direction', default: 10, minimum: 0, maximum: 1000 },
      { name: 'std-dev-y', type: 'double', label: 'Vertical radius', description: 'Standard deviation in Y direction', default: 10, minimum: 0, maximum: 1000 },
      { name: 'blur-type', type: 'enum', label: 'Blur type', description: 'Blur algorithm', default: 'gaussian',
        enumValues: [{ value: 'gaussian', label: 'Gaussian (RLE)' }, { value: 'gaussian-iir', label: 'Gaussian (IIR)' }, { value: 'box', label: 'Box' }] },
    ],
  }],
  ['gegl:box-blur', {
    name: 'gegl:box-blur',
    title: 'Box Blur',
    description: 'Fast box blur approximation',
    categories: ['blur'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', description: 'Blur radius', default: 10, minimum: 0, maximum: 500 },
    ],
  }],
  ['gegl:motion-blur', {
    name: 'gegl:motion-blur',
    title: 'Motion Blur',
    description: 'Directional motion blur',
    categories: ['blur'],
    properties: [
      { name: 'length', type: 'double', label: 'Length', description: 'Blur length', default: 20, minimum: 0, maximum: 500 },
      { name: 'angle', type: 'double', label: 'Angle', description: 'Motion angle in degrees', default: 0, minimum: 0, maximum: 360 },
      { name: 'center', type: 'double', label: 'Center', description: 'Center of blur (0-1)', default: 0.5, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:lens-blur', {
    name: 'gegl:lens-blur',
    title: 'Lens Blur',
    description: 'Simulates camera lens bokeh',
    categories: ['blur'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', description: 'Blur radius', default: 10, minimum: 0, maximum: 200 },
      { name: 'blades', type: 'int', label: 'Blades', description: 'Number of aperture blades', default: 5, minimum: 3, maximum: 20 },
      { name: 'angle', type: 'double', label: 'Angle', description: 'Rotation angle', default: 0, minimum: 0, maximum: 360 },
      { name: 'curvature', type: 'double', label: 'Curvature', description: 'Blade curvature', default: 0, minimum: -1, maximum: 1 },
    ],
  }],
  ['gegl:unsharp-mask', {
    name: 'gegl:unsharp-mask',
    title: 'Unsharp Mask',
    description: 'Sharpens using unsharp masking',
    categories: ['enhance'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', description: 'Blur radius for unsharp mask', default: 5, minimum: 0, maximum: 200 },
      { name: 'amount', type: 'double', label: 'Amount', description: 'Sharpening amount', default: 1.0, minimum: 0, maximum: 10 },
      { name: 'threshold', type: 'double', label: 'Threshold', description: 'Threshold for edge detection', default: 0, minimum: 0, maximum: 255 },
    ],
  }],
  ['gegl:high-pass', {
    name: 'gegl:high-pass',
    title: 'High Pass',
    description: 'High-pass filter for edge enhancement',
    categories: ['enhance'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', description: 'Filter radius', default: 10, minimum: 0.1, maximum: 500 },
    ],
  }],
  ['gegl:noise-reduction', {
    name: 'gegl:noise-reduction',
    title: 'Noise Reduction',
    description: 'Reduces image noise while preserving edges',
    categories: ['enhance'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', description: 'Neighborhood radius', default: 3, minimum: 1, maximum: 20 },
      { name: 'strength', type: 'double', label: 'Strength', description: 'Denoising strength', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'preserve-edges', type: 'double', label: 'Preserve edges', description: 'Edge preservation factor', default: 0.5, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:bilateral-filter', {
    name: 'gegl:bilateral-filter',
    title: 'Bilateral Filter',
    description: 'Edge-preserving smoothing filter',
    categories: ['enhance'],
    properties: [
      { name: 'spatial-radius', type: 'double', label: 'Spatial radius', description: 'Spatial kernel radius', default: 5, minimum: 1, maximum: 50 },
      { name: 'color-radius', type: 'double', label: 'Color radius', description: 'Color similarity radius', default: 0.1, minimum: 0.01, maximum: 1 },
    ],
  }],
  ['gegl:color-temperature', {
    name: 'gegl:color-temperature',
    title: 'Color Temperature',
    description: 'Adjusts color temperature and tint',
    categories: ['color'],
    properties: [
      { name: 'temperature', type: 'double', label: 'Temperature', description: 'Color temperature (Kelvin)', default: 6500, minimum: 1000, maximum: 25000 },
      { name: 'tint', type: 'double', label: 'Tint', description: 'Green/Magenta tint', default: 0, minimum: -1, maximum: 1 },
      { name: 'preserve-luminance', type: 'boolean', label: 'Preserve luminance', description: 'Keep brightness constant', default: true },
    ],
  }],
  ['gegl:vibrance', {
    name: 'gegl:vibrance',
    title: 'Vibrance',
    description: 'Smart saturation adjustment',
    categories: ['color'],
    properties: [
      { name: 'vibrance', type: 'double', label: 'Vibrance', description: 'Vibrance amount', default: 0, minimum: -100, maximum: 100 },
      { name: 'saturation', type: 'double', label: 'Saturation', description: 'Global saturation', default: 0, minimum: -100, maximum: 100 },
    ],
  }],
  ['gegl:hue-saturation', {
    name: 'gegl:hue-saturation',
    title: 'Hue-Saturation',
    description: 'Adjusts hue, saturation, and lightness',
    categories: ['color'],
    properties: [
      { name: 'hue', type: 'double', label: 'Hue', description: 'Hue shift', default: 0, minimum: -180, maximum: 180 },
      { name: 'saturation', type: 'double', label: 'Saturation', description: 'Saturation multiplier', default: 1, minimum: 0, maximum: 3 },
      { name: 'lightness', type: 'double', label: 'Lightness', description: 'Lightness adjustment', default: 0, minimum: -1, maximum: 1 },
      { name: 'range', type: 'double', label: 'Range', description: 'Color range to affect', default: 1, minimum: 0, maximum: 1 },
      { name: 'overlap', type: 'double', label: 'Overlap', description: 'Range overlap', default: 0, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:color-balance', {
    name: 'gegl:color-balance',
    title: 'Color Balance',
    description: 'Adjusts color balance in shadows, midtones, highlights',
    categories: ['color'],
    properties: [
      { name: 'shadows-cyan-red', type: 'double', label: 'Shadows Cyan/Red', default: 0, minimum: -100, maximum: 100 },
      { name: 'shadows-magenta-green', type: 'double', label: 'Shadows Magenta/Green', default: 0, minimum: -100, maximum: 100 },
      { name: 'shadows-yellow-blue', type: 'double', label: 'Shadows Yellow/Blue', default: 0, minimum: -100, maximum: 100 },
      { name: 'midtones-cyan-red', type: 'double', label: 'Midtones Cyan/Red', default: 0, minimum: -100, maximum: 100 },
      { name: 'midtones-magenta-green', type: 'double', label: 'Midtones Magenta/Green', default: 0, minimum: -100, maximum: 100 },
      { name: 'midtones-yellow-blue', type: 'double', label: 'Midtones Yellow/Blue', default: 0, minimum: -100, maximum: 100 },
      { name: 'highlights-cyan-red', type: 'double', label: 'Highlights Cyan/Red', default: 0, minimum: -100, maximum: 100 },
      { name: 'highlights-magenta-green', type: 'double', label: 'Highlights Magenta/Green', default: 0, minimum: -100, maximum: 100 },
      { name: 'highlights-yellow-blue', type: 'double', label: 'Highlights Yellow/Blue', default: 0, minimum: -100, maximum: 100 },
      { name: 'preserve-luminosity', type: 'boolean', label: 'Preserve luminosity', default: true },
    ],
  }],
  ['gegl:levels', {
    name: 'gegl:levels',
    title: 'Levels',
    description: 'Adjusts input/output levels',
    categories: ['color'],
    properties: [
      { name: 'channel', type: 'enum', label: 'Channel', default: 'value',
        enumValues: [{ value: 'value', label: 'Value' }, { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' }, { value: 'alpha', label: 'Alpha' }] },
      { name: 'input-low', type: 'double', label: 'Input low', default: 0, minimum: 0, maximum: 255 },
      { name: 'input-high', type: 'double', label: 'Input high', default: 255, minimum: 0, maximum: 255 },
      { name: 'gamma', type: 'double', label: 'Gamma', default: 1, minimum: 0.1, maximum: 10 },
      { name: 'output-low', type: 'double', label: 'Output low', default: 0, minimum: 0, maximum: 255 },
      { name: 'output-high', type: 'double', label: 'Output high', default: 255, minimum: 0, maximum: 255 },
    ],
  }],
  ['gegl:curves', {
    name: 'gegl:curves',
    title: 'Curves',
    description: 'Adjusts tonal curves',
    categories: ['color'],
    properties: [
      { name: 'channel', type: 'enum', label: 'Channel', default: 'value',
        enumValues: [{ value: 'value', label: 'Value' }, { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' }, { value: 'alpha', label: 'Alpha' }] },
      { name: 'curve', type: 'curve', label: 'Curve', description: 'Control points', default: [[0, 0], [255, 255]] },
    ],
  }],
  ['gegl:exposure', {
    name: 'gegl:exposure',
    title: 'Exposure',
    description: 'Adjusts exposure, offset, and gamma',
    categories: ['color'],
    properties: [
      { name: 'exposure', type: 'double', label: 'Exposure', default: 0, minimum: -10, maximum: 10 },
      { name: 'offset', type: 'double', label: 'Offset', default: 0, minimum: -1, maximum: 1 },
      { name: 'gamma', type: 'double', label: 'Gamma', default: 1, minimum: 0.1, maximum: 10 },
      { name: 'black-level', type: 'double', label: 'Black level', default: 0, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:shadows-highlights', {
    name: 'gegl:shadows-highlights',
    title: 'Shadows/Highlights',
    description: 'Recovers detail in shadows and highlights',
    categories: ['color'],
    properties: [
      { name: 'shadows-strength', type: 'double', label: 'Shadows strength', default: 50, minimum: 0, maximum: 100 },
      { name: 'shadows-radius', type: 'double', label: 'Shadows radius', default: 50, minimum: 1, maximum: 500 },
      { name: 'highlights-strength', type: 'double', label: 'Highlights strength', default: 50, minimum: 0, maximum: 100 },
      { name: 'highlights-radius', type: 'double', label: 'Highlights radius', default: 50, minimum: 1, maximum: 500 },
      { name: 'midtones', type: 'double', label: 'Midtones', default: 0, minimum: -100, maximum: 100 },
    ],
  }],
  ['gegl:bloom', {
    name: 'gegl:bloom',
    title: 'Bloom',
    description: 'Adds glow to bright areas',
    categories: ['artistic'],
    properties: [
      { name: 'threshold', type: 'double', label: 'Threshold', default: 0.8, minimum: 0, maximum: 1 },
      { name: 'radius', type: 'double', label: 'Radius', default: 20, minimum: 0, maximum: 500 },
      { name: 'intensity', type: 'double', label: 'Intensity', default: 1, minimum: 0, maximum: 10 },
    ],
  }],
  ['gegl:vignette', {
    name: 'gegl:vignette',
    title: 'Vignette',
    description: 'Darkens or lightens image corners',
    categories: ['artistic'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'softness', type: 'double', label: 'Softness', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'amount', type: 'double', label: 'Amount', default: -0.5, minimum: -1, maximum: 1 },
      { name: 'shape', type: 'double', label: 'Shape', default: 0.5, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:lens-distortion', {
    name: 'gegl:lens-distortion',
    title: 'Lens Distortion',
    description: 'Corrects or adds lens distortion',
    categories: ['transform'],
    properties: [
      { name: 'main', type: 'double', label: 'Main', default: 0, minimum: -100, maximum: 100 },
      { name: 'edge', type: 'double', label: 'Edge', default: 0, minimum: -100, maximum: 100 },
      { name: 'zoom', type: 'double', label: 'Zoom', default: 1, minimum: 0.1, maximum: 10 },
      { name: 'brighten', type: 'double', label: 'Brighten', default: 0, minimum: -1, maximum: 1 },
    ],
  }],
  ['gegl:perspective', {
    name: 'gegl:perspective',
    title: 'Perspective Transform',
    description: 'Applies perspective transformation',
    categories: ['transform'],
    properties: [
      { name: 'x0', type: 'double', label: 'Top-left X', default: 0 },
      { name: 'y0', type: 'double', label: 'Top-left Y', default: 0 },
      { name: 'x1', type: 'double', label: 'Top-right X', default: 1 },
      { name: 'y1', type: 'double', label: 'Top-right Y', default: 0 },
      { name: 'x2', type: 'double', label: 'Bottom-right X', default: 1 },
      { name: 'y2', type: 'double', label: 'Bottom-right Y', default: 1 },
      { name: 'x3', type: 'double', label: 'Bottom-left X', default: 0 },
      { name: 'y3', type: 'double', label: 'Bottom-left Y', default: 1 },
      { name: 'interpolation', type: 'enum', label: 'Interpolation', default: 'cubic',
        enumValues: [{ value: 'none', label: 'None' }, { value: 'linear', label: 'Linear' }, { value: 'cubic', label: 'Cubic' }, { value: 'lohalo', label: 'LoHalo' }, { value: 'nohalo', label: 'NoHalo' }] },
      { name: 'clip', type: 'enum', label: 'Clip', default: 'adjust',
        enumValues: [{ value: 'adjust', label: 'Adjust' }, { value: 'clip', label: 'Clip' }, { value: 'crop', label: 'Crop' }, { value: 'crop-with-aspect', label: 'Crop with aspect' }] },
    ],
  }],
  ['gegl:seamless-clone', {
    name: 'gegl:seamless-clone',
    title: 'Seamless Clone',
    description: 'Blends a source into destination seamlessly',
    categories: ['composite'],
    properties: [
      { name: 'x', type: 'double', label: 'X position', default: 0 },
      { name: 'y', type: 'double', label: 'Y position', default: 0 },
      { name: 'mode', type: 'enum', label: 'Mode', default: 'normal',
        enumValues: [{ value: 'normal', label: 'Normal' }, { value: 'max', label: 'Max' }, { value: 'min', label: 'Min' }] },
    ],
  }],
  // Noise & Grain
  ['gegl:noise', {
    name: 'gegl:noise',
    title: 'Noise',
    description: 'Adds random noise',
    categories: ['noise'],
    properties: [
      { name: 'type', type: 'enum', label: 'Type', default: 'uniform',
        enumValues: [{ value: 'uniform', label: 'Uniform' }, { value: 'gaussian', label: 'Gaussian' }, { value: 'poisson', label: 'Poisson' }, { value: 'laplacian', label: 'Laplacian' }] },
      { name: 'amount', type: 'double', label: 'Amount', default: 0.1, minimum: 0, maximum: 1 },
      { name: 'seed', type: 'int', label: 'Seed', default: 0 },
      { name: 'monochrome', type: 'boolean', label: 'Monochrome', default: false },
    ],
  }],
  ['gegl:perlin-noise', {
    name: 'gegl:perlin-noise',
    title: 'Perlin Noise',
    description: 'Generates Perlin noise texture',
    categories: ['noise', 'render'],
    properties: [
      { name: 'detail', type: 'double', label: 'Detail', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'x-size', type: 'double', label: 'X Size', default: 1, minimum: 0.01, maximum: 100 },
      { name: 'y-size', type: 'double', label: 'Y Size', default: 1, minimum: 0.01, maximum: 100 },
      { name: 'octaves', type: 'int', label: 'Octaves', default: 4, minimum: 1, maximum: 16 },
      { name: 'seed', type: 'int', label: 'Seed', default: 0 },
    ],
  }],
  ['gegl:cairo-svg', {
    name: 'gegl:cairo-svg',
    title: 'SVG Render',
    description: 'Renders SVG to raster',
    categories: ['render'],
    properties: [
      { name: 'svg-data', type: 'string', label: 'SVG Data', default: '' },
      { name: 'width', type: 'int', label: 'Width', default: 512, minimum: 1, maximum: 8192 },
      { name: 'height', type: 'int', label: 'Height', default: 512, minimum: 1, maximum: 8192 },
    ],
  }],

  // Additional Blur Operations
  ['gegl:lens-blur', {
    name: 'gegl:lens-blur',
    title: 'Lens Blur',
    description: 'Simulates camera lens bokeh',
    categories: ['blur'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 10, minimum: 0, maximum: 200 },
      { name: 'blades', type: 'int', label: 'Blades', default: 5, minimum: 3, maximum: 20 },
      { name: 'angle', type: 'double', label: 'Angle', default: 0, minimum: 0, maximum: 360 },
      { name: 'curvature', type: 'double', label: 'Curvature', default: 0, minimum: -1, maximum: 1 },
    ],
  }],
  ['gegl:motion-blur', {
    name: 'gegl:motion-blur',
    title: 'Motion Blur',
    description: 'Directional motion blur',
    categories: ['blur'],
    properties: [
      { name: 'length', type: 'double', label: 'Length', default: 20, minimum: 0, maximum: 500 },
      { name: 'angle', type: 'double', label: 'Angle', default: 0, minimum: 0, maximum: 360 },
      { name: 'center', type: 'double', label: 'Center', default: 0.5, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:zoom-blur', {
    name: 'gegl:zoom-blur',
    title: 'Zoom Blur',
    description: 'Radial zoom blur',
    categories: ['blur'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 20, minimum: 0, maximum: 500 },
      { name: 'center-x', type: 'double', label: 'Center X', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'center-y', type: 'double', label: 'Center Y', default: 0.5, minimum: 0, maximum: 1 },
    ],
  }],

  // Additional Sharpen Operations
  ['gegl:focus-blur', {
    name: 'gegl:focus-blur',
    title: 'Focus Blur',
    description: 'Depth-of-field blur',
    categories: ['blur'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 10, minimum: 0, maximum: 100 },
      { name: 'focus-distance', type: 'double', label: 'Focus Distance', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'aperture', type: 'double', label: 'Aperture', default: 1, minimum: 0.1, maximum: 10 },
    ],
  }],
  ['gegl:high-pass', {
    name: 'gegl:high-pass',
    title: 'High Pass',
    description: 'High-pass filter for edge enhancement',
    categories: ['enhance'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 10, minimum: 0.1, maximum: 500 },
    ],
  }],

  // Artistic Filters
  ['gegl:watercolor', {
    name: 'gegl:watercolor',
    title: 'Watercolor',
    description: 'Watercolor painting effect',
    categories: ['artistic'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 5, minimum: 1, maximum: 50 },
      { name: 'pressure', type: 'double', label: 'Pressure', default: 0.5, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:pastel', {
    name: 'gegl:pastel',
    title: 'Pastel',
    description: 'Pastel drawing effect',
    categories: ['artistic'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 5, minimum: 1, maximum: 50 },
      { name: 'pressure', type: 'double', label: 'Pressure', default: 0.5, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:charcoal', {
    name: 'gegl:charcoal',
    title: 'Charcoal',
    description: 'Charcoal drawing effect',
    categories: ['artistic'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 5, minimum: 1, maximum: 50 },
      { name: 'sigma', type: 'double', label: 'Sigma', default: 1, minimum: 0.1, maximum: 10 },
    ],
  }],
  ['gegl:photocopy', {
    name: 'gegl:photocopy',
    title: 'Photocopy',
    description: 'Photocopy effect',
    categories: ['artistic'],
    properties: [
      { name: 'detail', type: 'double', label: 'Detail', default: 10, minimum: 1, maximum: 50 },
      { name: 'darkness', type: 'double', label: 'Darkness', default: 10, minimum: 1, maximum: 50 },
    ],
  }],

  // Texture Generation
  ['gegl:checkerboard', {
    name: 'gegl:checkerboard',
    title: 'Checkerboard',
    description: 'Generates checkerboard pattern',
    categories: ['render'],
    properties: [
      { name: 'size', type: 'int', label: 'Size', default: 32, minimum: 1, maximum: 512 },
      { name: 'color1', type: 'color', label: 'Color 1', default: '#000000' },
      { name: 'color2', type: 'color', label: 'Color 2', default: '#ffffff' },
    ],
  }],
  ['gegl:mandelbrot', {
    name: 'gegl:mandelbrot',
    title: 'Mandelbrot',
    description: 'Generates Mandelbrot fractal',
    categories: ['render'],
    properties: [
      { name: 'center-x', type: 'double', label: 'Center X', default: -0.5, minimum: -2, maximum: 1 },
      { name: 'center-y', type: 'double', label: 'Center Y', default: 0, minimum: -1.5, maximum: 1.5 },
      { name: 'zoom', type: 'double', label: 'Zoom', default: 1, minimum: 0.01, maximum: 1000 },
      { name: 'iterations', type: 'int', label: 'Iterations', default: 100, minimum: 10, maximum: 1000 },
    ],
  }],
  ['gegl:plasma', {
    name: 'gegl:plasma',
    title: 'Plasma',
    description: 'Generates plasma fractal',
    categories: ['render'],
    properties: [
      { name: 'turbulence', type: 'double', label: 'Turbulence', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'x-size', type: 'double', label: 'X Size', default: 1, minimum: 0.01, maximum: 100 },
      { name: 'y-size', type: 'double', label: 'Y Size', default: 1, minimum: 0.01, maximum: 100 },
      { name: 'seed', type: 'int', label: 'Seed', default: 0 },
    ],
  }],
  ['gegl:solid-noise', {
    name: 'gegl:solid-noise',
    title: 'Solid Noise',
    description: 'Generates solid noise texture',
    categories: ['render', 'noise'],
    properties: [
      { name: 'detail', type: 'double', label: 'Detail', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'x-size', type: 'double', label: 'X Size', default: 1, minimum: 0.01, maximum: 100 },
      { name: 'y-size', type: 'double', label: 'Y Size', default: 1, minimum: 0.01, maximum: 100 },
      { name: 'octaves', type: 'int', label: 'Octaves', default: 4, minimum: 1, maximum: 16 },
      { name: 'seed', type: 'int', label: 'Seed', default: 0 },
    ],
  }],

  // Color Correction
  ['gegl:color-enhance', {
    name: 'gegl:color-enhance',
    title: 'Color Enhance',
    description: 'Enhances color saturation and vibrance',
    categories: ['color'],
    properties: [
      { name: 'saturation', type: 'double', label: 'Saturation', default: 1, minimum: 0, maximum: 3 },
      { name: 'vibrance', type: 'double', label: 'Vibrance', default: 0, minimum: -100, maximum: 100 },
      { name: 'contrast', type: 'double', label: 'Contrast', default: 1, minimum: 0.1, maximum: 3 },
    ],
  }],
  ['gegl:color-temperature', {
    name: 'gegl:color-temperature',
    title: 'Color Temperature',
    description: 'Adjusts color temperature and tint',
    categories: ['color'],
    properties: [
      { name: 'temperature', type: 'double', label: 'Temperature', default: 6500, minimum: 1000, maximum: 25000 },
      { name: 'tint', type: 'double', label: 'Tint', default: 0, minimum: -1, maximum: 1 },
      { name: 'preserve-luminance', type: 'boolean', label: 'Preserve Luminance', default: true },
    ],
  }],
  ['gegl:white-balance', {
    name: 'gegl:white-balance',
    title: 'White Balance',
    description: 'Adjusts white balance',
    categories: ['color'],
    properties: [
      { name: 'temperature', type: 'double', label: 'Temperature', default: 0, minimum: -100, maximum: 100 },
      { name: 'tint', type: 'double', label: 'Tint', default: 0, minimum: -100, maximum: 100 },
    ],
  }],

  // Advanced Morphology
  ['gegl:morphology', {
    name: 'gegl:morphology',
    title: 'Morphology',
    description: 'Advanced morphological operations',
    categories: ['morphology'],
    properties: [
      { name: 'operation', type: 'enum', label: 'Operation', default: 'dilate',
        enumValues: [{ value: 'dilate', label: 'Dilate' }, { value: 'erode', label: 'Erode' }, { value: 'open', label: 'Open' }, { value: 'close', label: 'Close' }, { value: 'top-hat', label: 'Top Hat' }, { value: 'bottom-hat', label: 'Bottom Hat' }, { value: 'gradient', label: 'Gradient' }] },
      { name: 'radius', type: 'double', label: 'Radius', default: 1, minimum: 0, maximum: 50 },
      { name: 'shape', type: 'enum', label: 'Shape', default: 'circle',
        enumValues: [{ value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }, { value: 'diamond', label: 'Diamond' }] },
    ],
  }],

  // Compositing
  ['gegl:over', {
    name: 'gegl:over',
    title: 'Over',
    description: 'Standard over compositing',
    categories: ['composite'],
    properties: [],
  }],
  ['gegl:under', {
    name: 'gegl:under',
    title: 'Under',
    description: 'Under compositing',
    categories: ['composite'],
    properties: [],
  }],
  ['gegl:atop', {
    name: 'gegl:atop',
    title: 'Atop',
    description: 'Atop compositing',
    categories: ['composite'],
    properties: [],
  }],
  ['gegl:xor', {
    name: 'gegl:xor',
    title: 'XOR',
    description: 'XOR compositing',
    categories: ['composite'],
    properties: [],
  }],

  // Video/Film Effects
  ['gegl:film-grain', {
    name: 'gegl:film-grain',
    title: 'Film Grain',
    description: 'Adds film grain texture',
    categories: ['artistic'],
    properties: [
      { name: 'strength', type: 'double', label: 'Strength', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'size', type: 'double', label: 'Grain Size', default: 1, minimum: 0.1, maximum: 10 },
      { name: 'color', type: 'boolean', label: 'Color Grain', default: true },
    ],
  }],
  ['gegl:vignette', {
    name: 'gegl:vignette',
    title: 'Vignette',
    description: 'Vignette effect',
    categories: ['artistic'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'softness', type: 'double', label: 'Softness', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'amount', type: 'double', label: 'Amount', default: -0.5, minimum: -1, maximum: 1 },
      { name: 'shape', type: 'double', label: 'Shape', default: 0.5, minimum: 0, maximum: 1 },
    ],
  }],

  // Edge Detection
  ['gegl:canny-edge', {
    name: 'gegl:canny-edge',
    title: 'Canny Edge Detection',
    description: 'Canny edge detection',
    categories: ['edge-detect'],
    properties: [
      { name: 'low-threshold', type: 'double', label: 'Low Threshold', default: 0.1, minimum: 0, maximum: 1 },
      { name: 'high-threshold', type: 'double', label: 'High Threshold', default: 0.3, minimum: 0, maximum: 1 },
      { name: 'sigma', type: 'double', label: 'Sigma', default: 1, minimum: 0.1, maximum: 10 },
    ],
  }],
  // Edge Detection
  ['gegl:sobel', {
    name: 'gegl:sobel',
    title: 'Sobel Edge Detection',
    description: 'Detects edges using Sobel operator',
    categories: ['edge-detect'],
    properties: [
      { name: 'operator', type: 'enum', label: 'Operator', default: 'sobel',
        enumValues: [{ value: 'sobel', label: 'Sobel' }, { value: 'prewitt', label: 'Prewitt' }, { value: 'roberts', label: 'Roberts' }] },
      { name: 'amount', type: 'double', label: 'Amount', default: 1, minimum: 0, maximum: 10 },
    ],
  }],
  ['gegl:laplacian', {
    name: 'gegl:laplacian',
    title: 'Laplacian Edge Detection',
    description: 'Detects edges using Laplacian operator',
    categories: ['edge-detect'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 1, minimum: 0.1, maximum: 10 },
      { name: 'normalize', type: 'boolean', label: 'Normalize', default: true },
    ],
  }],
  // Morphology
  ['gegl:dilate', {
    name: 'gegl:dilate',
    title: 'Dilate',
    description: 'Morphological dilation',
    categories: ['morphology'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 1, minimum: 0, maximum: 50 },
      { name: 'shape', type: 'enum', label: 'Shape', default: 'circle',
        enumValues: [{ value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }, { value: 'cross', label: 'Cross' }] },
    ],
  }],
  ['gegl:erode', {
    name: 'gegl:erode',
    title: 'Erode',
    description: 'Morphological erosion',
    categories: ['morphology'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 1, minimum: 0, maximum: 50 },
      { name: 'shape', type: 'enum', label: 'Shape', default: 'circle',
        enumValues: [{ value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }, { value: 'cross', label: 'Cross' }] },
    ],
  }],
  ['gegl:opening', {
    name: 'gegl:opening',
    title: 'Opening',
    description: 'Morphological opening (erode then dilate)',
    categories: ['morphology'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 1, minimum: 0, maximum: 50 },
      { name: 'shape', type: 'enum', label: 'Shape', default: 'circle',
        enumValues: [{ value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }] },
    ],
  }],
  ['gegl:closing', {
    name: 'gegl:closing',
    title: 'Closing',
    description: 'Morphological closing (dilate then erode)',
    categories: ['morphology'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 1, minimum: 0, maximum: 50 },
      { name: 'shape', type: 'enum', label: 'Shape', default: 'circle',
        enumValues: [{ value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }] },
    ],
  }],
  // Artistic
  ['gegl:oilify', {
    name: 'gegl:oilify',
    title: 'Oilify',
    description: 'Oil painting effect',
    categories: ['artistic'],
    properties: [
      { name: 'mask-size', type: 'int', label: 'Mask Size', default: 5, minimum: 1, maximum: 50 },
    ],
  }],
  ['gegl:cartoon', {
    name: 'gegl:cartoon',
    title: 'Cartoon',
    description: 'Cartoon effect',
    categories: ['artistic'],
    properties: [
      { name: 'mask-radius', type: 'double', label: 'Mask Radius', default: 7, minimum: 1, maximum: 50 },
      { name: 'pct-black', type: 'double', label: 'Percent Black', default: 50, minimum: 0, maximum: 100 },
    ],
  }],
  ['gegl:cubism', {
    name: 'gegl:cubism',
    title: 'Cubism',
    description: 'Cubism effect',
    categories: ['artistic'],
    properties: [
      { name: 'tile-size', type: 'double', label: 'Tile Size', default: 0.1, minimum: 0.01, maximum: 1 },
      { name: 'tile-saturation', type: 'double', label: 'Tile Saturation', default: 1.5, minimum: 0, maximum: 5 },
    ],
  }],
  ['gegl:gimpressionist', {
    name: 'gegl:gimpressionist',
    title: 'GIMPressionist',
    description: 'Brush stroke simulation',
    categories: ['artistic'],
    properties: [
      { name: 'brush', type: 'string', label: 'Brush', default: 'round' },
      { name: 'orientation', type: 'enum', label: 'Orientation', default: 'direction',
        enumValues: [{ value: 'direction', label: 'Direction' }, { value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }, { value: 'random', label: 'Random' }] },
      { name: 'grid-size', type: 'int', label: 'Grid Size', default: 5, minimum: 1, maximum: 50 },
      { name: 'coverage', type: 'double', label: 'Coverage', default: 1.5, minimum: 0.1, maximum: 10 },
    ],
  }],
  // Distort
  ['gegl:ripple', {
    name: 'gegl:ripple',
    title: 'Ripple',
    description: 'Ripple distortion',
    categories: ['distort'],
    properties: [
      { name: 'period', type: 'double', label: 'Period', default: 20, minimum: 1, maximum: 200 },
      { name: 'amplitude', type: 'double', label: 'Amplitude', default: 5, minimum: 0, maximum: 100 },
      { name: 'phase', type: 'double', label: 'Phase', default: 0, minimum: 0, maximum: 360 },
      { name: 'orientation', type: 'enum', label: 'Orientation', default: 'horizontal',
        enumValues: [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }] },
    ],
  }],
  ['gegl:waves', {
    name: 'gegl:waves',
    title: 'Waves',
    description: 'Wave distortion',
    categories: ['distort'],
    properties: [
      { name: 'amplitude', type: 'double', label: 'Amplitude', default: 10, minimum: 0, maximum: 100 },
      { name: 'wavelength', type: 'double', label: 'Wavelength', default: 50, minimum: 1, maximum: 500 },
      { name: 'phase', type: 'double', label: 'Phase', default: 0, minimum: 0, maximum: 360 },
      { name: 'type', type: 'enum', label: 'Type', default: 'sine',
        enumValues: [{ value: 'sine', label: 'Sine' }, { value: 'triangle', label: 'Triangle' }, { value: 'square', label: 'Square' }] },
    ],
  }],
  ['gegl:whirl-pinch', {
    name: 'gegl:whirl-pinch',
    title: 'Whirl and Pinch',
    description: 'Whirl and pinch distortion',
    categories: ['distort'],
    properties: [
      { name: 'whirl', type: 'double', label: 'Whirl', default: 0, minimum: -1000, maximum: 1000 },
      { name: 'pinch', type: 'double', label: 'Pinch', default: 0, minimum: -100, maximum: 100 },
      { name: 'radius', type: 'double', label: 'Radius', default: 0.5, minimum: 0, maximum: 1 },
    ],
  }],
  // Color Effects
  ['gegl:colorize', {
    name: 'gegl:colorize',
    title: 'Colorize',
    description: 'Colorizes grayscale image',
    categories: ['color'],
    properties: [
      { name: 'hue', type: 'double', label: 'Hue', default: 0, minimum: 0, maximum: 360 },
      { name: 'saturation', type: 'double', label: 'Saturation', default: 50, minimum: 0, maximum: 100 },
      { name: 'lightness', type: 'double', label: 'Lightness', default: 0, minimum: -100, maximum: 100 },
    ],
  }],
  ['gegl:desaturate', {
    name: 'gegl:desaturate',
    title: 'Desaturate',
    description: 'Converts to grayscale',
    categories: ['color'],
    properties: [
      { name: 'mode', type: 'enum', label: 'Mode', default: 'luminosity',
        enumValues: [{ value: 'luminosity', label: 'Luminosity' }, { value: 'lightness', label: 'Lightness' }, { value: 'average', label: 'Average' }, { value: 'luma', label: 'Luma' }, { value: 'value', label: 'Value (HSV)' }] },
    ],
  }],
  ['gegl:invert', {
    name: 'gegl:invert',
    title: 'Invert',
    description: 'Inverts colors',
    categories: ['color'],
    properties: [],
  }],
  ['gegl:posterize', {
    name: 'gegl:posterize',
    title: 'Posterize',
    description: 'Reduces color levels',
    categories: ['color'],
    properties: [
      { name: 'levels', type: 'int', label: 'Levels', default: 4, minimum: 2, maximum: 256 },
    ],
  }],
  ['gegl:threshold', {
    name: 'gegl:threshold',
    title: 'Threshold',
    description: 'Black and white threshold',
    categories: ['color'],
    properties: [
      { name: 'threshold', type: 'double', label: 'Threshold', default: 0.5, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:channel-mixer', {
    name: 'gegl:channel-mixer',
    title: 'Channel Mixer',
    description: 'Mixes color channels',
    categories: ['color'],
    properties: [
      { name: 'output-channel', type: 'enum', label: 'Output Channel', default: 'red',
        enumValues: [{ value: 'red', label: 'Red' }, { value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' }] },
      { name: 'red-red', type: 'double', label: 'Red → Red', default: 100, minimum: -200, maximum: 200 },
      { name: 'red-green', type: 'double', label: 'Green → Red', default: 0, minimum: -200, maximum: 200 },
      { name: 'red-blue', type: 'double', label: 'Blue → Red', default: 0, minimum: -200, maximum: 200 },
      { name: 'green-red', type: 'double', label: 'Red → Green', default: 0, minimum: -200, maximum: 200 },
      { name: 'green-green', type: 'double', label: 'Green → Green', default: 100, minimum: -200, maximum: 200 },
      { name: 'green-blue', type: 'double', label: 'Blue → Green', default: 0, minimum: -200, maximum: 200 },
      { name: 'blue-red', type: 'double', label: 'Red → Blue', default: 0, minimum: -200, maximum: 200 },
      { name: 'blue-green', type: 'double', label: 'Green → Blue', default: 0, minimum: -200, maximum: 200 },
      { name: 'blue-blue', type: 'double', label: 'Blue → Blue', default: 100, minimum: -200, maximum: 200 },
      { name: 'constant', type: 'double', label: 'Constant', default: 0, minimum: -100, maximum: 100 },
      { name: 'monochrome', type: 'boolean', label: 'Monochrome', default: false },
    ],
  }],
  // Transform
  ['gegl:rotate', {
    name: 'gegl:rotate',
    title: 'Rotate',
    description: 'Rotates image',
    categories: ['transform'],
    properties: [
      { name: 'angle', type: 'double', label: 'Angle', default: 0, minimum: -180, maximum: 180 },
      { name: 'center-x', type: 'double', label: 'Center X', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'center-y', type: 'double', label: 'Center Y', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'interpolation', type: 'enum', label: 'Interpolation', default: 'cubic',
        enumValues: [{ value: 'none', label: 'None' }, { value: 'linear', label: 'Linear' }, { value: 'cubic', label: 'Cubic' }, { value: 'lohalo', label: 'LoHalo' }, { value: 'nohalo', label: 'NoHalo' }] },
      { name: 'clip', type: 'enum', label: 'Clip', default: 'adjust',
        enumValues: [{ value: 'adjust', label: 'Adjust' }, { value: 'clip', label: 'Clip' }, { value: 'crop', label: 'Crop' }, { value: 'crop-with-aspect', label: 'Crop with aspect' }] },
    ],
  }],
  ['gegl:scale', {
    name: 'gegl:scale',
    title: 'Scale',
    description: 'Scales image',
    categories: ['transform'],
    properties: [
      { name: 'scale-x', type: 'double', label: 'Scale X', default: 1, minimum: 0.01, maximum: 100 },
      { name: 'scale-y', type: 'double', label: 'Scale Y', default: 1, minimum: 0.01, maximum: 100 },
      { name: 'interpolation', type: 'enum', label: 'Interpolation', default: 'cubic',
        enumValues: [{ value: 'none', label: 'None' }, { value: 'linear', label: 'Linear' }, { value: 'cubic', label: 'Cubic' }, { value: 'lohalo', label: 'LoHalo' }, { value: 'nohalo', label: 'NoHalo' }] },
      { name: 'clip', type: 'enum', label: 'Clip', default: 'adjust',
        enumValues: [{ value: 'adjust', label: 'Adjust' }, { value: 'clip', label: 'Clip' }, { value: 'crop', label: 'Crop' }, { value: 'crop-with-aspect', label: 'Crop with aspect' }] },
    ],
  }],
  ['gegl:flip', {
    name: 'gegl:flip',
    title: 'Flip',
    description: 'Flips image horizontally or vertically',
    categories: ['transform'],
    properties: [
      { name: 'horizontal', type: 'boolean', label: 'Horizontal', default: false },
      { name: 'vertical', type: 'boolean', label: 'Vertical', default: false },
    ],
  }],
  ['gegl:crop', {
    name: 'gegl:crop',
    title: 'Crop',
    description: 'Crops image',
    categories: ['transform'],
    properties: [
      { name: 'x', type: 'int', label: 'X', default: 0, minimum: 0 },
      { name: 'y', type: 'int', label: 'Y', default: 0, minimum: 0 },
      { name: 'width', type: 'int', label: 'Width', default: 512, minimum: 1 },
      { name: 'height', type: 'int', label: 'Height', default: 512, minimum: 1 },
    ],
  }],
])

// GEGL graph processor
export class GeglGraph {
  private nodes: GeglNode[] = []

  addNode(op: string, properties: Record<string, any> = {}, inputs: Record<string, GeglNode> = {}): GeglNode {
    const node: GeglNode = { operation: op, properties, inputs }
    this.nodes.push(node)
    return node
  }

  // Process the graph - in a real implementation this would use GEGL
  // For now, we provide canvas-based fallbacks for common operations
  async process(input: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    let current = input
    for (const node of this.nodes) {
      current = await this.processNode(node, current)
    }
    return current
  }

  private async processNode(node: GeglNode, input: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    const op = GEGL_OPERATIONS.get(node.operation)
    if (!op) {
      console.warn(`Unknown GEGL operation: ${node.operation}`)
      return input
    }

    const props = { ...op.properties.reduce((acc, p) => { acc[p.name] = p.default; return acc }, {} as Record<string, any>), ...node.properties }

    switch (node.operation) {
      case 'gegl:gaussian-blur':
        return this.applyGaussianBlur(input, props['std-dev-x'], props['std-dev-y'])
      case 'gegl:box-blur':
        return this.applyBoxBlur(input, props['radius'])
      case 'gegl:unsharp-mask':
        return this.applyUnsharpMask(input, props['radius'], props['amount'], props['threshold'])
      case 'gegl:vibrance':
        return this.applyVibrance(input, props['vibrance'], props['saturation'])
      case 'gegl:hue-saturation':
        return this.applyHueSaturation(input, props['hue'], props['saturation'], props['lightness'])
      case 'gegl:color-balance':
        return this.applyColorBalance(input, props)
      case 'gegl:levels':
        return this.applyLevels(input, props)
      case 'gegl:curves':
        return this.applyCurves(input, props['curve'])
      case 'gegl:exposure':
        return this.applyExposure(input, props['exposure'], props['offset'], props['gamma'])
      case 'gegl:vignette':
        return this.applyVignette(input, props['radius'], props['softness'], props['amount'])
      // Noise
      case 'gegl:noise':
        return this.applyNoise(input, props['amount'], props['type'], props['monochrome'], props['seed'])
      case 'gegl:perlin-noise':
        return this.applyPerlinNoise(input, props['detail'], props['x-size'], props['y-size'], props['octaves'], props['seed'])
      // Edge Detection
      case 'gegl:sobel':
        return this.applySobel(input, props['amount'])
      case 'gegl:laplacian':
        return this.applyLaplacian(input, props['radius'], props['normalize'])
      // Morphology
      case 'gegl:dilate':
        return this.applyDilate(input, props['radius'], props['shape'])
      case 'gegl:erode':
        return this.applyErode(input, props['radius'], props['shape'])
      case 'gegl:opening':
        return this.applyOpening(input, props['radius'], props['shape'])
      case 'gegl:closing':
        return this.applyClosing(input, props['radius'], props['shape'])
      // Artistic
      case 'gegl:oilify':
        return this.applyOilify(input, props['mask-size'])
      case 'gegl:cartoon':
        return this.applyCartoon(input, props['mask-radius'], props['pct-black'])
      case 'gegl:cubism':
        return this.applyCubism(input, props['tile-size'], props['tile-saturation'])
      case 'gegl:gimpressionist':
        return this.applyGimpressionist(input, props['brush'], props['orientation'], props['grid-size'], props['coverage'])
      // Distort
      case 'gegl:ripple':
        return this.applyRipple(input, props['period'], props['amplitude'], props['phase'], props['orientation'])
      case 'gegl:waves':
        return this.applyWaves(input, props['amplitude'], props['wavelength'], props['phase'], props['type'])
      case 'gegl:whirl-pinch':
        return this.applyWhirlPinch(input, props['whirl'], props['pinch'], props['radius'])
      // Color Effects
      case 'gegl:colorize':
        return this.applyColorize(input, props['hue'], props['saturation'], props['lightness'])
      case 'gegl:desaturate':
        return this.applyDesaturate(input, props['mode'])
      case 'gegl:invert':
        return this.applyInvert(input)
      case 'gegl:posterize':
        return this.applyPosterize(input, props['levels'])
      case 'gegl:threshold':
        return this.applyThreshold(input, props['threshold'])
      case 'gegl:channel-mixer':
        return this.applyChannelMixer(input, props)
      // Transform
      case 'gegl:rotate':
        return this.applyRotate(input, props['angle'], props['center-x'], props['center-y'], props['interpolation'], props['clip'])
      case 'gegl:scale':
        return this.applyScale(input, props['scale-x'], props['scale-y'], props['interpolation'], props['clip'])
      case 'gegl:flip':
        return this.applyFlip(input, props['horizontal'], props['vertical'])
      case 'gegl:crop':
        return this.applyCrop(input, props['x'], props['y'], props['width'], props['height'])
      // Additional Blur Operations
      case 'gegl:lens-blur':
        return this.applyLensBlur(input, props['radius'], props['blades'], props['angle'], props['curvature'])
      case 'gegl:motion-blur':
        return this.applyMotionBlur(input, props['length'], props['angle'], props['center'])
      case 'gegl:zoom-blur':
        return this.applyZoomBlur(input, props['radius'], props['center-x'], props['center-y'])
      case 'gegl:focus-blur':
        return this.applyFocusBlur(input, props['radius'], props['focus-distance'], props['aperture'])
      case 'gegl:high-pass':
        return this.applyHighPass(input, props['radius'])
      // Artistic Filters
      case 'gegl:watercolor':
        return this.applyWatercolor(input, props['radius'], props['pressure'])
      case 'gegl:pastel':
        return this.applyPastel(input, props['radius'], props['pressure'])
      case 'gegl:charcoal':
        return this.applyCharcoal(input, props['radius'], props['sigma'])
      case 'gegl:photocopy':
        return this.applyPhotocopy(input, props['detail'], props['darkness'])
      // Texture Generation
      case 'gegl:checkerboard':
        return this.applyCheckerboard(input, props['size'], props['color1'], props['color2'])
      case 'gegl:mandelbrot':
        return this.applyMandelbrot(input, props['center-x'], props['center-y'], props['zoom'], props['iterations'])
      case 'gegl:plasma':
        return this.applyPlasma(input, props['turbulence'], props['x-size'], props['y-size'], props['seed'])
      case 'gegl:solid-noise':
        return this.applySolidNoise(input, props['detail'], props['x-size'], props['y-size'], props['octaves'], props['seed'])
      // Color Correction
      case 'gegl:color-enhance':
        return this.applyColorEnhance(input, props['saturation'], props['vibrance'], props['contrast'])
      case 'gegl:color-temperature':
        return this.applyColorTemperature(input, props['temperature'], props['tint'], props['preserve-luminance'])
      case 'gegl:white-balance':
        return this.applyWhiteBalance(input, props['temperature'], props['tint'])
      // Advanced Morphology
      case 'gegl:morphology':
        return this.applyMorphology(input, props['operation'], props['radius'], props['shape'])
      // Compositing
      case 'gegl:over':
        return this.applyOver(input, props)
      case 'gegl:under':
        return this.applyUnder(input, props)
      case 'gegl:atop':
        return this.applyAtop(input, props)
      case 'gegl:xor':
        return this.applyXor(input, props)
      // Video/Film Effects
      case 'gegl:film-grain':
        return this.applyFilmGrain(input, props['strength'], props['size'], props['color'])
      case 'gegl:vignette':
        return this.applyVignette(input, props['radius'], props['softness'], props['amount'], props['shape'])
      // Edge Detection
      case 'gegl:canny-edge':
        return this.applyCannyEdge(input, props['low-threshold'], props['high-threshold'], props['sigma'])
      default:
        console.warn(`GEGL operation ${node.operation} not implemented in fallback`)
        return input
    }
  }

  private async applyGaussianBlur(input: HTMLCanvasElement, rx: number, ry: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `blur(${(rx + ry) / 2}px)`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyBoxBlur(input: HTMLCanvasElement, radius: number): Promise<HTMLCanvasElement> {
    return this.applyGaussianBlur(input, radius, radius)
  }

  private async applyUnsharpMask(input: HTMLCanvasElement, radius: number, amount: number, threshold: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    // Simplified unsharp mask using canvas filters
    ctx.filter = `contrast(${1 + amount}) brightness(${1 + amount * 0.1})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyVibrance(input: HTMLCanvasElement, vibrance: number, saturation: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    const totalSat = saturation + vibrance * 0.5
    ctx.filter = `saturate(${1 + totalSat / 100})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyHueSaturation(input: HTMLCanvasElement, hue: number, saturation: number, lightness: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `hue-rotate(${hue}deg) saturate(${1 + saturation / 100}) brightness(${1 + lightness / 100})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyColorBalance(input: HTMLCanvasElement, props: Record<string, any>): Promise<HTMLCanvasElement> {
    // Simplified - would need pixel manipulation for true color balance
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    return canvas
  }

  private async applyLevels(input: HTMLCanvasElement, props: Record<string, any>): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    const gamma = props['gamma'] || 1
    const inputLow = props['input-low'] || 0
    const inputHigh = props['input-high'] || 255
    // Approximate with contrast/brightness
    ctx.filter = `brightness(${(inputLow / 255) * 0.5}) contrast(${(inputHigh / 255) * 2})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyCurves(input: HTMLCanvasElement, curve: number[][]): Promise<HTMLCanvasElement> {
    // Would need a LUT or pixel manipulation
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    return canvas
  }

  private async applyExposure(input: HTMLCanvasElement, exposure: number, offset: number, gamma: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `brightness(${1 + exposure}) contrast(${gamma})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyVignette(input: HTMLCanvasElement, radius: number, softness: number, amount: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)

    // Draw vignette overlay
    const gradient = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, 0,
      canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * radius
    )
    gradient.addColorStop(0, 'rgba(0,0,0,0)')
    gradient.addColorStop(1, `rgba(0,0,0,${Math.abs(amount)})`)
    ctx.globalCompositeOperation = amount < 0 ? 'multiply' : 'screen'
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'source-over'
    return canvas
  }

  // Noise
  private async applyNoise(input: HTMLCanvasElement, amount: number, type: string, monochrome: boolean, seed: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = img.data
    // Simple pseudo-random for reproducible noise
    let randSeed = seed || Date.now()
    const rand = () => { randSeed = (randSeed * 1664525 + 1013904223) % 4294967296; return randSeed / 4294967296 }
    for (let i = 0; i < data.length; i += 4) {
      const noise = (rand() - 0.5) * 2 * amount * 255
      if (monochrome) {
        data[i] = Math.max(0, Math.min(255, data[i] + noise))
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise))
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise))
      } else {
        data[i] = Math.max(0, Math.min(255, data[i] + noise * (rand() - 0.5) * 2))
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise * (rand() - 0.5) * 2))
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise * (rand() - 0.5) * 2))
      }
    }
    ctx.putImageData(img, 0, 0)
    return canvas
  }

  private async applyPerlinNoise(input: HTMLCanvasElement, detail: number, xSize: number, ySize: number, octaves: number, seed: number): Promise<HTMLCanvasElement> {
    // Simplified Perlin noise - would need full implementation
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    ctx.globalAlpha = detail * 0.3
    ctx.fillStyle = '#888'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = 1
    return canvas
  }

  // Edge Detection
  private async applySobel(input: HTMLCanvasElement, amount: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `contrast(${1 + amount}) grayscale(1)`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyLaplacian(input: HTMLCanvasElement, radius: number, normalize: boolean): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `contrast(${1 + radius}) grayscale(1)`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  // Morphology (simplified using canvas filters)
  private async applyDilate(input: HTMLCanvasElement, radius: number, shape: string): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `brightness(${1 + radius * 0.1})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyErode(input: HTMLCanvasElement, radius: number, shape: string): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `brightness(${1 - radius * 0.1})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyOpening(input: HTMLCanvasElement, radius: number, shape: string): Promise<HTMLCanvasElement> {
    let result = await this.applyErode(input, radius, shape)
    return this.applyDilate(result, radius, shape)
  }

  private async applyClosing(input: HTMLCanvasElement, radius: number, shape: string): Promise<HTMLCanvasElement> {
    let result = await this.applyDilate(input, radius, shape)
    return this.applyErode(result, radius, shape)
  }

  // Artistic
  private async applyOilify(input: HTMLCanvasElement, maskSize: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `blur(${maskSize * 0.5}px) contrast(1.2) saturate(1.3)`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyCartoon(input: HTMLCanvasElement, maskRadius: number, pctBlack: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `contrast(${1.5 + pctBlack / 200}) saturate(1.5) blur(${maskRadius * 0.3}px)`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyCubism(input: HTMLCanvasElement, tileSize: number, tileSaturation: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `saturate(${tileSaturation})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyGimpressionist(input: HTMLCanvasElement, brush: string, orientation: string, gridSize: number, coverage: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    return canvas
  }

  // Distort
  private async applyRipple(input: HTMLCanvasElement, period: number, amplitude: number, phase: number, orientation: string): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    return canvas
  }

  private async applyWaves(input: HTMLCanvasElement, amplitude: number, wavelength: number, phase: number, type: string): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    return canvas
  }

  private async applyWhirlPinch(input: HTMLCanvasElement, whirl: number, pinch: number, radius: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((whirl / 1000) * Math.PI / 180)
    ctx.scale(1 + pinch / 100, 1 + pinch / 100)
    ctx.translate(-canvas.width / 2, -canvas.height / 2)
    ctx.drawImage(input, 0, 0)
    return canvas
  }

  // Color Effects
  private async applyColorize(input: HTMLCanvasElement, hue: number, saturation: number, lightness: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `grayscale(1) hue-rotate(${hue}deg) saturate(${saturation / 50}) brightness(${1 + lightness / 100})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyDesaturate(input: HTMLCanvasElement, mode: string): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = 'grayscale(1)'
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyInvert(input: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = 'invert(1)'
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyPosterize(input: HTMLCanvasElement, levels: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    // Would need LUT for true posterize
    return canvas
  }

  private async applyThreshold(input: HTMLCanvasElement, threshold: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `contrast(10) brightness(${-threshold * 2})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyChannelMixer(input: HTMLCanvasElement, props: Record<string, any>): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    return canvas
  }

  // Transform
  private async applyRotate(input: HTMLCanvasElement, angle: number, centerX: number, centerY: number, interpolation: string, clip: string): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.translate(canvas.width * centerX, canvas.height * centerY)
    ctx.rotate(angle * Math.PI / 180)
    ctx.translate(-canvas.width * centerX, -canvas.height * centerY)
    ctx.drawImage(input, 0, 0)
    return canvas
  }

  private async applyScale(input: HTMLCanvasElement, scaleX: number, scaleY: number, interpolation: string, clip: string): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.scale(scaleX, scaleY)
    ctx.drawImage(input, 0, 0)
    return canvas
  }

  private async applyFlip(input: HTMLCanvasElement, horizontal: boolean, vertical: boolean): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    if (horizontal) ctx.scale(-1, 1), ctx.translate(-canvas.width, 0)
    if (vertical) ctx.scale(1, -1), ctx.translate(0, -canvas.height)
    ctx.drawImage(input, 0, 0)
    return canvas
  }

  private async applyCrop(input: HTMLCanvasElement, x: number, y: number, width: number, height: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(width, height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, -x, -y)
    return canvas
  }

  // Additional Blur Operations
  private async applyLensBlur(input: HTMLCanvasElement, radius: number, blades: number, angle: number, curvature: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `blur(${radius}px)`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyMotionBlur(input: HTMLCanvasElement, length: number, angle: number, center: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `blur(${length * 0.5}px)`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyZoomBlur(input: HTMLCanvasElement, radius: number, centerX: number, centerY: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `blur(${radius}px)`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyFocusBlur(input: HTMLCanvasElement, radius: number, focusDistance: number, aperture: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `blur(${radius * aperture}px)`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyHighPass(input: HTMLCanvasElement, radius: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `contrast(${1 + radius * 0.1})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  // Artistic Filters
  private async applyWatercolor(input: HTMLCanvasElement, radius: number, pressure: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `blur(${radius * 0.5}px) saturate(${1 + pressure})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyPastel(input: HTMLCanvasElement, radius: number, pressure: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `blur(${radius * 0.3}px) saturate(${1 + pressure * 0.5})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyCharcoal(input: HTMLCanvasElement, radius: number, sigma: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `grayscale(1) contrast(1.5) blur(${radius * 0.2}px)`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyPhotocopy(input: HTMLCanvasElement, detail: number, darkness: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `grayscale(1) contrast(${1 + darkness * 0.02}) brightness(${1 - detail * 0.01})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  // Texture Generation
  private async applyCheckerboard(input: HTMLCanvasElement, size: number, color1: string, color2: string): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    // Overlay checkerboard pattern
    for (let y = 0; y < input.height; y += size) {
      for (let x = 0; x < input.width; x += size) {
        const isEven = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0
        ctx.fillStyle = isEven ? color1 : color2
        ctx.fillRect(x, y, size, size)
      }
    }
    ctx.globalCompositeOperation = 'multiply'
    ctx.drawImage(input, 0, 0)
    return canvas
  }

  private async applyMandelbrot(input: HTMLCanvasElement, centerX: number, centerY: number, zoom: number, iterations: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    // Simplified - would need full Mandelbrot implementation
    return canvas
  }

  private async applyPlasma(input: HTMLCanvasElement, turbulence: number, xSize: number, ySize: number, seed: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    ctx.globalAlpha = turbulence * 0.3
    ctx.fillStyle = '#888'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = 1
    return canvas
  }

  private async applySolidNoise(input: HTMLCanvasElement, detail: number, xSize: number, ySize: number, octaves: number, seed: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    ctx.globalAlpha = detail * 0.3
    ctx.fillStyle = '#888'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = 1
    return canvas
  }

  // Color Correction
  private async applyColorEnhance(input: HTMLCanvasElement, saturation: number, vibrance: number, contrast: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    const totalSat = saturation + vibrance * 0.5
    ctx.filter = `saturate(${totalSat}) contrast(${contrast})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyColorTemperature(input: HTMLCanvasElement, temperature: number, tint: number, preserveLuminance: boolean): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    const tempFactor = (temperature - 6500) / 6500
    ctx.filter = `sepia(${Math.abs(tempFactor) * 0.3}) hue-rotate(${tempFactor * 30}deg)`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyWhiteBalance(input: HTMLCanvasElement, temperature: number, tint: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `hue-rotate(${temperature}deg) saturate(${1 + tint * 0.1})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  // Advanced Morphology
  private async applyMorphology(input: HTMLCanvasElement, operation: string, radius: number, shape: string): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    const factor = 1 + (operation === 'dilate' ? radius * 0.1 : -radius * 0.1)
    ctx.filter = `brightness(${factor})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  // Compositing
  private async applyOver(input: HTMLCanvasElement, props: Record<string, any>): Promise<HTMLCanvasElement> {
    return input
  }

  private async applyUnder(input: HTMLCanvasElement, props: Record<string, any>): Promise<HTMLCanvasElement> {
    return input
  }

  private async applyAtop(input: HTMLCanvasElement, props: Record<string, any>): Promise<HTMLCanvasElement> {
    return input
  }

  private async applyXor(input: HTMLCanvasElement, props: Record<string, any>): Promise<HTMLCanvasElement> {
    return input
  }

  // Video/Film Effects
  private async applyFilmGrain(input: HTMLCanvasElement, strength: number, size: number, color: boolean): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = img.data
    let randSeed = Date.now()
    const rand = () => { randSeed = (randSeed * 1664525 + 1013904223) % 4294967296; return randSeed / 4294967296 }
    for (let i = 0; i < data.length; i += 4) {
      const noise = (rand() - 0.5) * 2 * strength * 255
      if (color) {
        data[i] = Math.max(0, Math.min(255, data[i] + noise * (rand() - 0.5) * 2))
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise * (rand() - 0.5) * 2))
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise * (rand() - 0.5) * 2))
      } else {
        data[i] = Math.max(0, Math.min(255, data[i] + noise))
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise))
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise))
      }
    }
    ctx.putImageData(img, 0, 0)
    return canvas
  }

  private async applyVignette(input: HTMLCanvasElement, radius: number, softness: number, amount: number, shape: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)

    const gradient = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, 0,
      canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * radius
    )
    gradient.addColorStop(0, 'rgba(0,0,0,0)')
    gradient.addColorStop(1, `rgba(0,0,0,${Math.abs(amount)})`)
    ctx.globalCompositeOperation = amount < 0 ? 'multiply' : 'screen'
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'source-over'
    return canvas
  }

  private async applyCannyEdge(input: HTMLCanvasElement, lowThreshold: number, highThreshold: number, sigma: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `grayscale(1) contrast(${1 + highThreshold * 2})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }
}

// Helper: Create a GEGL graph for common GIMP filter pipelines
export function createGeglGraphForFilter(filterName: string, params: Record<string, any>): GeglGraph {
  const graph = new GeglGraph()
  const op = GEGL_OPERATIONS.get(filterName)
  if (op) {
    graph.addNode(filterName, params)
  }
  return graph
}

// Export operation list for UI
export function getGeglOperations(): GeglOperation[] {
  return Array.from(GEGL_OPERATIONS.values()).sort((a, b) => a.title.localeCompare(b.title))
}

export function getGeglOperation(name: string): GeglOperation | undefined {
  return GEGL_OPERATIONS.get(name)
}