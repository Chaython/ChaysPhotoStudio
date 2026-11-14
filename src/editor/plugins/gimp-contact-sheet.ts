'use client'
// GIMP Contact Sheet / Picture Package / Web Photo Gallery / PDF Presentation
// Automated layout and export tools

import { createCanvas, ctx2d } from '../utils/canvas'

export interface ContactSheetOptions {
  /** Images to include */
  images: Array<HTMLCanvasElement | HTMLImageElement | File>
  /** Layout */
  layout: 'grid' | 'masonry' | 'justified' | 'mosaic' | 'strip' | 'custom'
  /** Grid options */
  columns: number
  rows: number
  /** Spacing */
  spacing: number
  margin: number
  /** Cell size */
  cellWidth: number
  cellHeight: number
  /** Maintain aspect ratio */
  maintainAspect: boolean
  /** Fit mode */
  fitMode: 'cover' | 'contain' | 'fill' | 'stretch'
  /** Thumbnail size */
  thumbnailSize: number
  /** Background */
  background: string
  /** Border */
  border: {
    width: number
    color: string
    radius: number
  }
  /** Labels */
  labels: {
    enabled: boolean
    font: string
    size: number
    color: string
    position: 'top' | 'bottom' | 'overlay' | 'none'
    content: 'filename' | 'date' | 'size' | 'dimensions' | 'custom'
    customText?: string
  }
  /** Page setup */
  page: {
    size: 'A4' | 'Letter' | 'Legal' | 'Custom'
    width: number
    height: number
    orientation: 'portrait' | 'landscape'
    margins: { top: number; right: number; bottom: number; left: number }
    dpi: number
  }
  /** Metadata */
  metadata: {
    includeExif: boolean
    includeDate: boolean
    includeCamera: boolean
    includeSettings: boolean
    includeFilename: boolean
    customFields: Record<string, string>
  }
  /** Output */
  output: {
    format: 'png' | 'jpg' | 'pdf' | 'webp'
    quality: number
    dpi: number
    colorSpace: string
  }
}

export interface ContactSheetResult {
  pages: HTMLCanvasElement[]
  metadata: {
    totalImages: number
    pages: number
    imagesPerPage: number
    layout: string
  }
}

export interface PicturePackageOptions {
  /** Images */
  images: Array<HTMLCanvasElement | HTMLImageElement | File>
  /** Package type */
  type: 'standard' | 'wallet' | 'passport' | 'custom' | 'school' | 'wedding' | 'holiday' | 'sports'
  /** Layout preset */
  layout: string
  /** Paper size */
  paperSize: '4x6' | '5x7' | '8x10' | '11x14' | 'A4' | 'Letter' | 'Custom'
  /** Custom dimensions */
  customWidth?: number
  customHeight?: number
  /** DPI */
  dpi: number
  /** Margins */
  margins: { top: number; right: number; bottom: number; left: number }
  /** Background */
  background: string
  /** Border */
  border: { width: number; color: string }
  /** Copies per image */
  copies: number
  /** Crop to fit */
  cropToFit: boolean
  /** Background color for empty slots */
  emptySlotColor: string
}

export interface WebGalleryOptions {
  /** Images */
  images: Array<HTMLCanvasElement | HTMLImageElement | File>
  /** Gallery template */
  template: 'grid' | 'masonry' | 'justified' | 'slider' | 'carousel' | 'lightbox' | 'fullscreen' | 'thumbnails' | 'mosaic'
  /** Theme */
  theme: 'light' | 'dark' | 'minimal' | 'classic' | 'modern' | 'custom'
  /** Colors */
  colors: {
    background: string
    text: string
    accent: string
    border: string
    hover: string
  }
  /** Layout */
  columns: number
  rows: number
  spacing: number
  thumbnailSize: number
  /** Navigation */
  navigation: {
    arrows: boolean
    dots: boolean
    thumbnails: boolean
    keyboard: boolean
    swipe: boolean
    autoplay: boolean
    interval: number
  }
  /** Metadata */
  showMetadata: boolean
  metadataFields: string[]
  /** Download */
  allowDownload: boolean
  downloadQuality: 'original' | 'web' | 'thumbnail'
  /** Watermark */
  watermark: {
    enabled: boolean
    text: string
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
    opacity: number
    font: string
    color: string
  }
  /** Social sharing */
  socialSharing: {
    enabled: boolean
    platforms: string[]
  }
  /** SEO */
  seo: {
    title: string
    description: string
    keywords: string[]
  }
  /** Output */
  outputPath: string
  generateSitemap: boolean
  generateRSS: boolean
}

export interface PDFPresentationOptions {
  /** Slides */
  slides: Array<{
    image: HTMLCanvasElement | HTMLImageElement | File
    title?: string
    subtitle?: string
    notes?: string
    duration?: number
    transition?: 'fade' | 'slide' | 'push' | 'wipe' | 'zoom' | 'none'
    transitionDuration: number
    background?: string
    layout: 'full' | 'fit' | 'fill' | 'center' | 'custom'
    elements?: Array<{
      type: 'text' | 'image' | 'shape' | 'chart'
      content: string
      position: { x: number; y: number; width: number; height: number }
      style: Record<string, any>
    }>
  }>
  /** Settings */
  pageSize: 'A4' | 'Letter' | 'Legal' | 'A3' | 'Custom'
  customWidth?: number
  customHeight?: number
  orientation: 'portrait' | 'landscape'
  margins: { top: number; right: number; bottom: number; left: number }
  dpi: number
  /** Transitions */
  defaultTransition: 'fade' | 'slide' | 'push' | 'wipe' | 'zoom' | 'none'
  defaultDuration: number
  /** Background */
  backgroundColor: string
  backgroundImage?: HTMLCanvasElement
  /** Metadata */
  title: string
  author: string
  subject: string
  keywords: string[]
  /** Security */
  password?: string
  permissions?: {
    print: boolean
    modify: boolean
    copy: boolean
    annotate: boolean
  }
  /** Output */
  outputPath: string
  embedFonts: boolean
  compress: boolean
}

export interface LayerComp {
  id: string
  name: string
  comment: string
  visibility: Map<string, boolean> // layerId -> visible
  position: Map<string, { x: number; y: number }> // layerId -> position
  appearance: Map<string, { opacity: number; blendMode: string; effects: string[] }> // layerId -> appearance
  selectedLayers: string[]
  activeLayer: string | null
}

/** Contact Sheet Generator */
export async function createContactSheet(
  options: ContactSheetOptions
): Promise<ContactSheetResult> {
  const {
    images,
    layout = 'grid',
    columns = 4,
    rows = 4,
    spacing = 10,
    margin = 20,
    cellWidth = 200,
    cellHeight = 200,
    maintainAspect = true,
    fitMode = 'cover',
    thumbnailSize = 150,
    background = '#ffffff',
    border = { width: 2, color: '#cccccc', radius: 4 },
    labels = { enabled: true, font: '12px sans-serif', size: 12, color: '#333333', position: 'bottom', content: 'filename' },
    page = { size: 'A4', width: 2480, height: 3508, orientation: 'portrait', margins: { top: 50, right: 50, bottom: 50, left: 50 }, dpi: 300 },
    metadata = { includeExif: true, includeDate: true, includeCamera: true, includeSettings: true, includeFilename: true, customFields: {} },
    output = { format: 'png', quality: 1, dpi: 300, colorSpace: 'sRGB' },
  } = options

  // Load images
  const loadedImages = await Promise.all(
    images.map(async (img) => {
      if (img instanceof File) {
        const bitmap = await createImageBitmap(img)
        const canvas = createCanvas(bitmap.width, bitmap.height)
        ctx2d(canvas).drawImage(bitmap, 0, 0)
        return { canvas, name: img.name, file: img }
      } else if (img instanceof HTMLImageElement) {
        const canvas = createCanvas(img.width, img.height)
        ctx2d(canvas).drawImage(img, 0, 0)
        return { canvas, name: img.src, file: null }
      } else {
        return { canvas: img, name: '', file: null }
      }
    })
  )

  // Calculate layout
  const imagesPerPage = columns * rows
  const totalPages = Math.ceil(images.length / imagesPerPage)
  const pages: HTMLCanvasElement[] = []

  // Page dimensions
  const pageWidth = page.orientation === 'landscape' ? page.height : page.width
  const pageHeight = page.orientation === 'landscape' ? page.width : page.height

  for (let pageNum = 0; pageNum < totalPages; pageNum++) {
    const pageCanvas = createCanvas(pageWidth, pageHeight)
    const ctx = ctx2d(pageCanvas)

    // Background
    ctx.fillStyle = background
    ctx.fillRect(0, 0, pageWidth, pageHeight)

    // Calculate cell positions
    const startIdx = pageNum * imagesPerPage
    const endIdx = Math.min(startIdx + imagesPerPage, loadedImages.length)
    const pageImages = loadedImages.slice(startIdx, endIdx)

    // Calculate grid
    const cols = Math.min(columns, pageImages.length)
    const rows = Math.ceil(pageImages.length / cols)

    const availableWidth = pageWidth - margin * 2 - spacing * (cols - 1)
    const availableHeight = pageHeight - margin * 2 - spacing * (rows - 1)

    const cellW = availableWidth / cols
    const cellH = availableHeight / rows

    // Draw each image
    for (let i = 0; i < pageImages.length; i++) {
      const img = pageImages[i]
      const col = i % cols
      const row = Math.floor(i / cols)

      const x = margin + col * (cellW + spacing)
      const y = margin + row * (cellH + spacing)

      // Draw border
      if (border.width > 0) {
        ctx.strokeStyle = border.color
        ctx.lineWidth = border.width
        ctx.beginPath()
        if (border.radius > 0) {
          ctx.roundRect(x, y, cellW, cellH, border.radius)
        } else {
          ctx.rect(x, y, cellW, cellH)
        }
        ctx.stroke()
      }

      // Draw image
      const imgCanvas = pageImages[i].canvas
      let drawX = x
      let drawY = y
      let drawW = cellW
      let drawH = cellH

      if (maintainAspect) {
        const imgAspect = imgCanvas.width / imgCanvas.height
        const cellAspect = cellW / cellH

        if (fitMode === 'cover') {
          if (imgAspect > cellAspect) {
            drawH = cellH
            drawW = cellH * imgAspect
            drawX = x + (cellW - drawW) / 2
            drawY = y
          } else {
            drawW = cellW
            drawH = cellW / imgAspect
            drawX = x
            drawY = y + (cellH - drawH) / 2
          }
        } else if (fitMode === 'contain') {
          if (imgAspect > cellAspect) {
            drawW = cellW
            drawH = cellW / imgAspect
            drawX = x
            drawY = y + (cellH - drawH) / 2
          } else {
            drawH = cellH
            drawW = cellH * imgAspect
            drawX = x + (cellW - drawW) / 2
            drawY = y
          }
        } else {
          drawW = cellW
          drawH = cellH
          drawX = x
          drawY = y
        }
      } else {
        drawW = cellW
        drawH = cellH
        drawX = x
        drawY = y
      }

      // Clip to cell if border radius
      if (border.radius > 0) {
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(drawX, drawY, drawW, drawH, border.radius)
        ctx.clip()
      }

      ctx.drawImage(imgCanvas, drawX, drawY, drawW, drawH)

      if (border.radius > 0) {
        ctx.restore()
      }

      // Draw label
      if (labels.enabled && labels.position !== 'none') {
        ctx.font = labels.font
        ctx.fillStyle = labels.color
        ctx.textAlign = 'center'
        ctx.textBaseline = labels.position === 'top' ? 'bottom' : 'top'

        let labelText = ''
        switch (labels.content) {
          case 'filename': labelText = pageImages[i].name; break
          case 'date': labelText = new Date().toLocaleDateString(); break
          case 'size': labelText = `${imgCanvas.width}x${imgCanvas.height}`; break
          case 'dimensions': labelText = `${imgCanvas.width}×${imgCanvas.height}`; break
          case 'custom': labelText = labels.customText || ''; break
        }

        let labelY: number
        if (labels.position === 'top') {
          labelY = y - 5
          ctx.textBaseline = 'bottom'
        } else if (labels.position === 'bottom') {
          labelY = y + drawH + 15
          ctx.textBaseline = 'top'
        } else {
          labelY = y + drawH / 2
          ctx.textBaseline = 'middle'
        }

        ctx.fillText(labelText, x + drawW / 2, labelY)
      }
    }

    pages.push(pageCanvas)
  }

  return {
    pages,
    metadata: {
      totalImages: images.length,
      pages: pages.length,
      imagesPerPage,
      layout,
    },
  }
}

/** Picture Package Generator */
export async function createPicturePackage(
  options: PicturePackageOptions
): Promise<HTMLCanvasElement[]> {
  const {
    images,
    type = 'standard',
    layout = 'standard',
    paperSize = '4x6',
    customWidth,
    customHeight,
    dpi = 300,
    margins = { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
    background = '#ffffff',
    border = { width: 0, color: '#000000' },
    copies = 1,
    cropToFit = true,
    emptySlotColor = '#f0f0f0',
  } = options

  // Paper size dimensions in inches at DPI
  const paperSizes: Record<string, { width: number; height: number }> = {
    '4x6': { width: 4 * dpi, height: 6 * dpi },
    '5x7': { width: 5 * dpi, height: 7 * dpi },
    '8x10': { width: 8 * dpi, height: 10 * dpi },
    '11x14': { width: 11 * dpi, height: 14 * dpi },
    A4: { width: 8.27 * dpi, height: 11.69 * dpi },
    Letter: { width: 8.5 * dpi, height: 11 * dpi },
    Custom: { width: (customWidth || 8.5) * dpi, height: (customHeight || 11) * dpi },
  }

  const paper = paperSizes[paperSize] || paperSizes['4x6']
  const canvas = createCanvas(paper.width, paper.height)
  const ctx = ctx2d(canvas)

  // Background
  ctx.fillStyle = background
  ctx.fillRect(0, 0, paper.width, paper.height)

  // Layout configurations
  const layouts: Record<string, { cols: number; rows: number; cellW: number; cellH: number; spacing: number }> = {
    standard: { cols: 2, rows: 3, cellW: paper.width / 2 - margins.left - margins.right, cellH: paper.height / 3 - margins.top - margins.bottom, spacing: 20 },
    wallet: { cols: 4, rows: 5, cellW: paper.width / 4 - margins.left - margins.right, cellH: paper.height / 5 - margins.top - margins.bottom, spacing: 10 },
    passport: { cols: 4, rows: 6, cellW: paper.width / 4 - margins.left - margins.right, cellH: paper.height / 6 - margins.top - margins.bottom, spacing: 10 },
    school: { cols: 3, rows: 4, cellW: paper.width / 3 - margins.left - margins.right, cellH: paper.height / 4 - margins.top - margins.bottom, spacing: 15 },
    wedding: { cols: 2, rows: 2, cellW: paper.width / 2 - margins.left - margins.right, cellH: paper.height / 2 - margins.top - margins.bottom, spacing: 30 },
    holiday: { cols: 3, rows: 3, cellW: paper.width / 3 - margins.left - margins.right, cellH: paper.height / 3 - margins.top - margins.bottom, spacing: 20 },
    sports: { cols: 3, rows: 4, cellW: paper.width / 3 - margins.left - margins.right, cellH: paper.height / 4 - margins.top - margins.bottom, spacing: 15 },
  }

  const layoutConfig = layouts[layout] || layouts.standard

  const pages: HTMLCanvasElement[] = []
  let imgIndex = 0

  for (let copy = 0; copy < copies; copy++) {
    for (let pageNum = 0; ; pageNum++) {
      const pageCanvas = createCanvas(paper.width, paper.height)
      const ctx = ctx2d(pageCanvas)

      // Background
      ctx.fillStyle = background
      ctx.fillRect(0, 0, paper.width, paper.height)

      let hasImages = false

      for (let row = 0; row < layoutConfig.rows; row++) {
        for (let col = 0; col < layoutConfig.cols; col++) {
          const cellIndex = row * layoutConfig.cols + col

          if (imgIndex >= images.length) break

          const img = images[imgIndex]
          const imgCanvas = img instanceof HTMLCanvasElement ? img : (() => { const c = createCanvas(img.width, img.height); ctx2d(c).drawImage(img, 0, 0); return c })()

          const x = margins.left + col * (layoutConfig.cellW + 10)
          const y = margins.top + row * (layoutConfig.cellH + 10)

          // Draw border
          if (border.width > 0) {
            ctx.strokeStyle = border.color
            ctx.lineWidth = border.width
            ctx.strokeRect(x, y, layoutConfig.cellW, layoutConfig.cellH)
          }

          // Draw image
          let drawX = x
          let drawY = y
          let drawW = layoutConfig.cellW
          let drawH = layoutConfig.cellH

          if (cropToFit) {
            const imgAspect = imgCanvas.width / imgCanvas.height
            const cellAspect = layoutConfig.cellW / layoutConfig.cellH

            if (imgAspect > cellAspect) {
              drawH = layoutConfig.cellH
              drawW = drawH * imgAspect
              drawX = x + (layoutConfig.cellW - drawW) / 2
              drawY = y
            } else {
              drawW = layoutConfig.cellW
              drawH = drawW / (imgCanvas.width / imgCanvas.height)
              drawX = x
              drawY = y + (layoutConfig.cellH - drawH) / 2
            }
          }

          ctx.drawImage(imgCanvas, drawX, drawY, drawW, drawH)
          hasImages = true
          imgIndex++
        }

        if (!hasImages) break

        pages.push(pageCanvas)
      }

      if (imgIndex >= images.length * copies) break
    }

    return pages
  }
}

/** Web Photo Gallery Generator */
export async function createWebGallery(
  options: WebGalleryOptions
): Promise<{ html: string; assets: Map<string, Blob> }> {
  const {
    images,
    template = 'grid',
    theme = 'light',
    colors = { background: '#ffffff', text: '#333333', accent: '#007acc', border: '#e0e0e0', hover: '#f5f5f5' },
    columns = 4,
    rows = 4,
    spacing = 10,
    thumbnailSize = 200,
    navigation = { arrows: true, dots: true, thumbnails: true, keyboard: true, swipe: true, autoplay: false, interval: 5000 },
    showMetadata = true,
    metadataFields = ['filename', 'date', 'camera', 'settings'],
    allowDownload = true,
    downloadQuality = 'web',
    watermark = { enabled: false, text: '', position: 'bottom-right', opacity: 50, font: '14px sans-serif', color: '#ffffff' },
    socialSharing = { enabled: true, platforms: ['twitter', 'facebook', 'pinterest'] },
    seo = { title: 'Photo Gallery', description: '', keywords: [] },
    outputPath = '',
    generateSitemap = true,
    generateRSS = false,
  } = options

  // Load images
  const loadedImages = await Promise.all(
    images.map(async (img) => {
      if (img instanceof File) {
        const bitmap = await createImageBitmap(img)
        const canvas = createCanvas(bitmap.width, bitmap.height)
        ctx2d(canvas).drawImage(bitmap, 0, 0)
        return { canvas, name: img.name, file: img }
      } else if (img instanceof HTMLImageElement) {
        const canvas = createCanvas(img.width, img.height)
        ctx2d(canvas).drawImage(img, 0, 0)
        return { canvas, name: img.src, file: null }
      } else {
        return { canvas: img, name: '', file: null }
      }
    })

  // Generate thumbnails
  const thumbnails = await Promise.all(
    loadedImages.map(async (img) => {
      const thumb = createCanvas(thumbnailSize, thumbnailSize)
      const ctx = ctx2d(thumb)
      const scale = Math.min(thumbnailSize / img.canvas.width, thumbnailSize / img.canvas.height)
      ctx.drawImage(img.canvas, 0, 0, img.canvas.width * scale, img.canvas.height * scale)
      return thumb
    })

  // Apply watermark if enabled
  if (watermark.enabled) {
    // Add watermark to each thumbnail
  }

  // Generate HTML
  const html = generateGalleryHTML({
    template,
    theme,
    colors,
    images: loadedImages,
    thumbnails,
    columns,
    rows,
    spacing,
    navigation,
    showMetadata,
    metadataFields,
    allowDownload,
    downloadQuality,
    watermark,
    socialSharing,
    seo,
  })

  // Generate assets
  const assets = new Map<string, Blob>()
  // Would save thumbnails, full images, etc.

  return { html, assets }
}

function generateGalleryHTML(params: any): string {
  // Generate HTML template
  const { template, theme, colors, images, thumbnails, columns, rows, spacing, navigation, showMetadata, metadataFields, allowDownload, downloadQuality, watermark, socialSharing, seo } = params

  const themeStyles = getThemeStyles(theme, colors)

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${seo.title}</title>
  <meta name="description" content="${seo.description}">
  <meta name="keywords" content="${seo.keywords.join(', ')}">
  <style>
    ${themeStyles}
    .gallery { display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: ${spacing}px; padding: 20px; }
    .gallery-item { position: relative; overflow: hidden; border-radius: 8px; background: ${colors.background}; }
    .gallery-item img { width: 100%; height: auto; display: block; transition: transform 0.3s; }
    .gallery-item:hover img { transform: scale(1.05); }
    .gallery-item .metadata { position: absolute; bottom: 0; left: 0; right: 0; padding: 10px; background: rgba(0,0,0,0.7); color: white; font-size: 12px; }
    .navigation { display: flex; justify-content: center; gap: 10px; margin: 20px 0; }
    .nav-btn { padding: 10px 20px; background: ${colors.accent}; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .nav-btn:hover { opacity: 0.9; }
    .lightbox { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: none; justify-content: center; align-items: center; z-index: 1000; }
    .lightbox img { max-width: 90%; max-height: 90%; }
    .lightbox .close { position: absolute; top: 20px; right: 30px; color: white; font-size: 30px; cursor: pointer; }
  </style>
</head>
<body>
  <header>
    <h1>${seo.title}</h1>
  </header>
  <div class="gallery">
    ${loadedImages.map((img, i) => `
      <div class="gallery-item" data-index="${i}">
        <img src="thumbnails/${img.name}" alt="${img.name}" loading="lazy">
        <div class="metadata">${img.name}</div>
      </div>
    `).join('')}
  </div>
  ${navigation.arrows ? `
  <div class="navigation">
    <button class="nav-btn prev">← Previous</button>
    <button class="nav-btn next">Next →</button>
  </div>
  ` : ''}
  <div class="lightbox">
    <span class="close">&times;</span>
    <img src="" alt="">
    <div class="lightbox-info"></div>
  </div>
  <script>
    // Lightbox and navigation logic
    document.querySelectorAll('.gallery-item').forEach((item, i) => {
      item.addEventListener('click', () => openLightbox(i))
    })
    function openLightbox(index) {
      const lightbox = document.querySelector('.lightbox')
      lightbox.querySelector('img').src = images[index].src
      lightbox.style.display = 'flex'
    }
    document.querySelector('.lightbox .close').addEventListener('click', () => {
      document.querySelector('.lightbox').style.display = 'none'
    })
  </script>
</body>
</html>`

  return html
}

function getThemeStyles(theme: string, colors: any): string {
  const themes: Record<string, string> = {
    light: `
      body { background: ${colors.background}; color: ${colors.text}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      .nav-btn { background: ${colors.accent}; color: white; }
      .nav-btn:hover { background: ${colors.hover}; }
    `,
    dark: `
      body { background: #1a1a1a; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      .nav-btn { background: ${colors.accent}; color: #000; }
      .nav-btn:hover { opacity: 0.8; }
    `,
    minimal: `
      body { background: ${colors.background}; color: ${colors.text}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      .gallery { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
    `,
  }
  return themes[theme] || themes.light
}

/** PDF Presentation Generator */
export async function createPDFPresentation(
  options: PDFPresentationOptions
): Promise<Blob> {
  const {
    slides,
    pageSize = 'A4',
    customWidth,
    customHeight,
    orientation = 'landscape',
    margins = { top: 50, right: 50, bottom: 50, left: 50 },
    dpi = 300,
    defaultTransition = 'fade',
    defaultDuration = 2,
    backgroundColor = '#ffffff',
    backgroundImage,
    title = 'Presentation',
    author = '',
    subject = '',
    keywords = [],
    password,
    permissions = { print: true, modify: true, copy: true, annotate: true },
    outputPath = '',
    embedFonts = true,
    compress = true,
  } = options

  // Page dimensions
  const pageSizes: Record<string, { width: number; height: number }> = {
    A4: { width: 8.27 * dpi, height: 11.69 * dpi },
    Letter: { width: 8.5 * dpi, height: 11 * dpi },
    Legal: { width: 8.5 * dpi, height: 14 * dpi },
    A3: { width: 11.69 * dpi, height: 16.54 * dpi },
    Custom: { width: (customWidth || 8.5) * dpi, height: (customHeight || 11) * dpi },
  }

  const page = pageSizes[pageSize] || pageSizes.A4
  const pageWidth = orientation === 'landscape' ? page.height : page.width
  const pageHeight = orientation === 'landscape' ? page.width : page.height

  // Generate PDF using PDF-lib or similar
  // This is a placeholder - would use pdf-lib or similar library

  const pdfContent = generatePDFContent({
    slides,
    pageWidth,
    pageHeight,
    margins,
    defaultTransition,
    defaultDuration,
    backgroundColor,
    backgroundImage,
    title,
    author,
    subject,
    keywords,
    transitions: slides.map(s => s.transition || defaultTransition),
    durations: slides.map(s => s.duration || defaultDuration),
  })

  return new Blob([pdfContent], { type: 'application/pdf' })
}

function generatePDFContent(params: any): Uint8Array {
  // Would generate actual PDF content using pdf-lib
  // Placeholder
  return new Uint8Array()
}

/** Layer Comps Manager */
export class LayerCompsManager {
  private comps: Map<string, LayerComp> = new Map()
  private listeners: Set<() => void> = new Set()

  constructor() {}

  createComp(comp: Omit<LayerComp, 'id'>): LayerComp {
    const comp: LayerComp = {
      ...comp,
      id: 'comp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
    }
    this.comps.set(comp.id, comp)
    this.notify()
    return comp
  }

  getComp(id: string): LayerComp | undefined {
    return this.comps.get(id)
  }

  getAllComps(): LayerComp[] {
    return Array.from(this.comps.values())
  }

  updateComp(id: string, updates: Partial<LayerComp>): boolean {
    const comp = this.comps.get(id)
    if (!comp) return false
    Object.assign(comp, updates)
    this.notify()
    return true
  }

  deleteComp(id: string): boolean {
    const result = this.comps.delete(id)
    if (result) this.notify()
    return result
  }

  applyComp(compId: string, layers: Map<string, any>): void {
    const comp = this.comps.get(compId)
    if (!comp) return

    // Apply visibility
    for (const [layerId, visible] of comp.visibility) {
      const layer = layers.get(layerId)
      if (layer) layer.visible = visible
    }

    // Apply position
    for (const [layerId, pos] of comp.position) {
      const layer = layers.get(layerId)
      if (layer) {
        layer.x = pos.x
        layer.y = pos.y
      }
    }

    // Apply appearance
    for (const [layerId, app] of comp.appearance) {
      const layer = layers.get(layerId)
      if (layer) {
        layer.opacity = app.opacity
        layer.blendMode = app.blendMode
        // Apply effects
      }
    }

    // Select layers
    // Would update selection
  }

  captureCurrentState(layers: Map<string, any>, name: string): LayerComp {
    const visibility = new Map<string, boolean>()
    const position = new Map<string, { x: number; y: number }>()
    const appearance = new Map<string, { opacity: number; blendMode: string; effects: string[] }>()

    for (const [id, layer] of layers) {
      visibility.set(id, layer.visible)
      position.set(id, { x: layer.x, y: layer.y })
      appearance.set(id, {
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        effects: layer.effects || [],
      })
    }

    return {
      id: 'comp-' + Date.now(),
      name,
      comment: '',
      visibility,
      position,
      appearance,
      selectedLayers: Array.from(layers.keys()).filter(id => layers.get(id)!.selected),
      activeLayer: Array.from(layers.keys()).find(id => layers.get(id)!.active) || null,
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

/** History Brush Tool */
export class HistoryBrushTool {
  private history: Array<{ canvas: HTMLCanvasElement; timestamp: number }> = []
  private sourceSnapshot: HTMLCanvasElement | null = null
  private maxHistory = 50

  constructor() {}

  setSource(snapshot: HTMLCanvasElement): void {
    this.sourceSnapshot = snapshot
  }

  addHistoryState(canvas: HTMLCanvasElement): void {
    // Clone canvas
    const snapshot = createCanvas(canvas.width, canvas.height)
    ctx2d(snapshot).drawImage(canvas, 0, 0)

    this.history.push({ canvas: snapshot, timestamp: Date.now() })

    // Limit history size
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }
  }

  paintFromHistory(
    targetCanvas: HTMLCanvasElement,
    x: number,
    y: number,
    radius: number,
    hardness: number,
    opacity: number,
    flow: number,
    historyIndex: number
  ): void {
    if (historyIndex < 0 || historyIndex >= this.history.length) return
    if (!this.sourceSnapshot) return

    const historyState = this.history[historyIndex]
    const sourceCtx = historyState.canvas.getContext('2d')!
    const targetCtx = targetCanvas.getContext('2d')!

    // Create brush
    const brushCanvas = createCanvas(radius * 2, radius * 2)
    const brushCtx = ctx2d(brushCanvas)

    // Create soft brush
    const gradient = brushCtx.createRadialGradient(radius, radius, 0, radius, radius, radius)
    gradient.addColorStop(0, `rgba(255,255,255,${opacity})`)
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    brushCtx.fillStyle = gradient
    brushCtx.beginPath()
    brushCtx.arc(radius, radius, radius, 0, Math.PI * 2)
    brushCtx.fill()

    // Sample from history
    const sourceData = historyState.canvas.getContext('2d')!.getImageData(
      x - radius, y - radius, radius * 2, radius * 2
    )

    // Apply with brush shape
    // This would use the brush as a mask to copy from history
  }

  getHistory(): Array<{ canvas: HTMLCanvasElement; timestamp: number }> {
    return this.history
  }

  clearHistory(): void {
    this.history = []
  }
}

/** Art History Brush Tool */
export class ArtHistoryBrushTool {
  private history: Array<{ canvas: HTMLCanvasElement; timestamp: number }> = []
  private styles: Array<{
    name: string
    style: 'tight-short' | 'tight-medium' | 'tight-long' | 'loose-short' | 'loose-medium' | 'loose-long' | 'dab' | 'spatter' | 'curl'
    size: number
    opacity: number
    colorVariation: number
  }> = [
    { name: 'Tight Short', style: 'tight-short', size: 10, opacity: 1, colorVariation: 0.1 },
    { name: 'Tight Medium', style: 'tight-medium', size: 15, opacity: 0.8, colorVariation: 0.15 },
    { name: 'Tight Long', style: 'tight-long', size: 20, opacity: 0.6, colorVariation: 0.2 },
    { name: 'Loose Short', style: 'loose-short', size: 15, opacity: 0.8, colorVariation: 0.2 },
    { name: 'Loose Medium', style: 'loose-medium', size: 25, opacity: 0.6, colorVariation: 0.25 },
    { name: 'Loose Long', style: 'loose-long', size: 30, opacity: 0.5, colorVariation: 0.3 },
    { name: 'Dab', style: 'dab', size: 10, opacity: 0.9, colorVariation: 0.1 },
    { name: 'Spatter', style: 'spatter', size: 20, opacity: 0.5, colorVariation: 0.4 },
    { name: 'Curl', style: 'curl', size: 15, opacity: 0.7, colorVariation: 0.2 },
  ]

  constructor() {}

  paintArtHistory(
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
    styleIndex: number,
    pressure: number,
    sourceCanvas: HTMLCanvasElement
  ): void {
    const style = this.styles[styleIndex]
    if (!style) return

    const ctx = canvas.getContext('2d')!
    const sourceCtx = sourceCanvas.getContext('2d')!

    // Sample from source
    // Apply artistic style
  }
}

/** Pattern Stamp Tool */
export class PatternStampTool {
  private patternCanvas: HTMLCanvasElement | null = null
  private patternScale = 1
  private patternRotation = 0
  private spacing = 1
  private jitter = 0
  private opacity = 100
  private blendMode = 'normal'

  constructor() {}

  setPattern(pattern: HTMLCanvasElement | HTMLImageElement): void {
    if (pattern instanceof HTMLCanvasElement) {
      this.patternCanvas = pattern
    } else {
      const canvas = createCanvas(pattern.width, pattern.height)
      ctx2d(canvas).drawImage(pattern, 0, 0)
      this.patternCanvas = canvas
    }
  }

  setOptions(options: {
    scale?: number
    rotation?: number
    spacing?: number
    jitter?: number
    opacity?: number
    blendMode?: string
  }): void {
    if (options.scale !== undefined) this.patternScale = options.scale
    if (options.rotation !== undefined) this.patternRotation = options.rotation
    if (options.spacing !== undefined) this.spacing = options.spacing
    if (options.jitter !== undefined) this.jitter = options.jitter
    if (options.opacity !== undefined) this.opacity = options.opacity
    if (options.blendMode !== undefined) this.blendMode = options.blendMode
  }

  stamp(
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
    pressure: number
  ): void {
    if (!this.patternCanvas) return

    const ctx = canvas.getContext('2d')!
    const pattern = this.patternCanvas

    // Apply jitter
    const jitterX = (Math.random() - 0.5) * this.jitter
    const jitterY = (Math.random() - 0.5) * this.jitter

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate((this.patternRotation * Math.PI) / 180)
    ctx.scale(this.patternScale, this.patternScale)
    ctx.globalAlpha = this.opacity / 100
    ctx.globalCompositeOperation = this.blendMode as GlobalCompositeOperation

    // Draw pattern with spacing
    const patternWidth = this.patternCanvas.width * this.patternScale
    const patternHeight = this.patternCanvas.height * this.patternScale
    const spacing = this.spacing / 100 * Math.min(this.patternCanvas.width, this.patternCanvas.height)

    for (let x = -patternWidth; x < canvas.width + patternWidth; x += patternWidth + this.spacing) {
      for (let j = 0; j < canvas.height + patternHeight; j += patternHeight + this.spacing) {
        ctx.drawImage(this.patternCanvas, -this.patternCanvas.width / 2, -this.patternCanvas.height / 2)
      }
    }

    ctx.restore()
  }

  setPatternFromCanvas(canvas: HTMLCanvasElement): void {
    this.patternCanvas = canvas
  }

  getPattern(): HTMLCanvasElement | null {
    return this.patternCanvas
  }
}