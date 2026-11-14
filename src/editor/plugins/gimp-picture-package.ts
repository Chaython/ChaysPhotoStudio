'use client'
// GIMP Picture Package
// Professional print layout templates for photo packages

import { createCanvas, ctx2d } from '../utils/canvas'

export interface PicturePackageOptions {
  /** Images to include */
  images: Array<HTMLCanvasElement | HTMLImageElement | File>
  /** Package type */
  type: 'standard' | 'wallet' | 'passport' | 'custom' | 'school' | 'wedding' | 'holiday' | 'sports' | 'family' | 'portfolio'
  /** Layout preset */
  layout: string
  /** Paper size */
  paperSize: '4x6' | '5x7' | '8x10' | '11x14' | 'A4' | 'Letter' | 'A3' | '12x12' | 'Custom'
  /** Custom dimensions (inches) */
  customWidth?: number
  customHeight?: number
  /** DPI */
  dpi: number
  /** Margins (inches) */
  margins: { top: number; right: number; bottom: number; left: number }
  /** Background color */
  background: string
  /** Border */
  border: { width: number; color: string; radius: number }
  /** Copies per image */
  copies: number
  /** Crop to fit cell */
  cropToFit: boolean
  /** Fill mode */
  fitMode: 'cover' | 'contain' | 'fill' | 'stretch'
  /** Empty slot color */
  emptySlotColor: string
  /** Image captions */
  captions: {
    enabled: boolean
    font: string
    size: number
    color: string
    position: 'bottom' | 'top' | 'overlay'
    content: 'filename' | 'date' | 'custom' | 'none'
    customText?: string
  }
  /** Watermark */
  watermark: {
    enabled: boolean
    text: string
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'diagonal'
    opacity: number
    font: string
    color: string
    size: number
    rotation: number
  }
  /** Page numbers */
  pageNumbers: {
    enabled: boolean
    position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center'
    font: string
    color: string
  }
  /** Crop marks */
  cropMarks: {
    enabled: boolean
    length: number
    width: number
    color: string
    offset: number
  }
  /** Color bars */
  colorBars: {
    enabled: boolean
    position: 'bottom' | 'top' | 'left' | 'right'
    height: number
  }
  /** Metadata */
  metadata: {
    includeExif: boolean
    includeDate: boolean
    includeCamera: boolean
    includeSettings: boolean
    customFields: Record<string, string>
  }
}

export interface PicturePackageResult {
  pages: HTMLCanvasElement[]
  metadata: {
    totalImages: number
    pages: number
    imagesPerPage: number
    layout: string
    paperSize: string
    dpi: number
  }
}

/** Paper size dimensions in inches */
const PAPER_SIZES: Record<string, { width: number; height: number }> = {
  '4x6': { width: 4, height: 6 },
  '5x7': { width: 5, height: 7 },
  '8x10': { width: 8, height: 10 },
  '11x14': { width: 11, height: 14 },
  'A4': { width: 8.27, height: 11.69 },
  'Letter': { width: 8.5, height: 11 },
  'A3': { width: 11.69, height: 16.54 },
  '12x12': { width: 12, height: 12 },
  'Custom': { width: 8.5, height: 11 },
}

/** Layout configurations */
interface LayoutConfig {
  cols: number
  rows: number
  cellWidth: number
  cellH: number
  spacing: number
}

const LAYOUTS: Record<string, (paper: { width: number; height: number }, margins: any) => LayoutConfig> = {
  standard: (paper, margins) => ({
    cols: 2,
    rows: 3,
    cellWidth: (paper.width - margins.left - margins.right) / 2,
    cellH: (paper.height - margins.top - margins.bottom) / 3,
    spacing: 20,
  }),
  wallet: (paper, margins) => ({
    cols: 4,
    rows: 5,
    cellWidth: (paper.width - margins.left - margins.right) / 4,
    cellH: (paper.height - margins.top - margins.bottom) / 5,
    spacing: 10,
  },
  passport: (paper, margins) => ({
    cols: 4,
    rows: 6,
    cellWidth: (paper.width - margins.left - margins.right) / 4,
    cellH: (paper.height - margins.top - margins.bottom) / 6,
    spacing: 10,
  },
  school: (paper, margins) => ({
    cols: 3,
    rows: 4,
    cellWidth: (paper.width - margins.left - margins.right) / 3,
    cellH: (paper.height - margins.top - margins.bottom) / 4,
    spacing: 15,
  },
  wedding: (paper, margins) => ({
    cols: 2,
    rows: 2,
    cellWidth: (paper.width - margins.left - margins.right) / 2,
    cellH: (paper.height - margins.top - margins.bottom) / 2,
    spacing: 30,
  },
  holiday: (paper, margins) => ({
    cols: 3,
    rows: 3,
    cellWidth: (paper.width - margins.left - margins.right) / 3,
    cellH: (paper.height - margins.top - margins.bottom) / 3,
    spacing: 20,
  },
  sports: (paper, margins) => ({
    cols: 3,
    rows: 4,
    cellWidth: (paper.width - margins.left - margins.right) / 3,
    cellH: (paper.height - margins.top - margins.bottom) / 4,
    spacing: 15,
  },
  family: (paper, margins) => ({
    cols: 2,
    rows: 4,
    cellWidth: (paper.width - margins.left - margins.right) / 2,
    cellH: (paper.height - margins.top - margins.bottom) / 4,
    spacing: 20,
  },
  portfolio: (paper, margins) => ({
    cols: 3,
    rows: 3,
    cellWidth: (paper.width - margins.left - margins.right) / 3,
    cellH: (paper.height - margins.top - margins.bottom) / 3,
    spacing: 25,
  },
  custom: (paper, margins) => ({
    cols: 3,
    rows: 3,
    cellWidth: (paper.width - margins.left - margins.right) / 3,
    cellH: (paper.height - margins.top - margins.bottom) / 3,
    spacing: 20,
  },
}

/** Main picture package generation function */
export async function createPicturePackage(
  options: PicturePackageOptions
): Promise<PicturePackageResult> {
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
    border = { width: 2, color: '#cccccc', radius: 4 },
    copies = 1,
    cropToFit = true,
    fitMode = 'cover',
    emptySlotColor = '#f0f0f0',
    captions = { enabled: true, font: '12px sans-serif', size: 12, color: '#333333', position: 'bottom', content: 'filename' },
    watermark = { enabled: false, text: '', position: 'bottom-right', opacity: 50, font: '14px sans-serif', color: '#ffffff', size: 14, rotation: 0 },
    pageNumbers = { enabled: true, position: 'bottom-center', font: '10px sans-serif', color: '#666666' },
    cropMarks = { enabled: false, length: 20, width: 1, color: '#000000', offset: 5 },
    colorBars = { enabled: false, position: 'bottom', height: 20 },
    metadata = { includeExif: true, includeDate: true, includeCamera: true, includeSettings: true, customFields: {} },
  } = options

  // Get paper dimensions in pixels
  let paper = PAPER_SIZES[paperSize] || PAPER_SIZES['4x6']
  if (paperSize === 'Custom') {
    paper = { width: (customWidth || 8.5) * dpi, height: (customHeight || 11) * dpi }
  } else {
    paper = { width: paper.width * dpi, height: paper.height * dpi }
  }

  const marginsPx = {
    top: margins.top * dpi,
    right: margins.right * dpi,
    bottom: margins.bottom * dpi,
    left: margins.left * dpi,
  }

  const layoutFn = LAYOUTS[layout] || LAYOUTS.standard
  const layoutConfig = layoutFn(paper, marginsPx)

  const pages: HTMLCanvasElement[] = []
  let imgIndex = 0

  // Load all images
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

  const totalSlots = layoutConfig.cols * layoutConfig.rows
  const totalPages = Math.ceil((images.length * copies) / (layoutConfig.cols * layoutConfig.rows))

  for (let copy = 0; copy < copies; copy++) {
    for (let pageNum = 0; pageNum < totalPages; pageNum++) {
      const pageCanvas = createCanvas(paper.width, paper.height)
      const ctx = ctx2d(pageCanvas)

      // Background
      ctx.fillStyle = background
      ctx.fillRect(0, 0, paper.width, paper.height)

      // Color bars
      if (colorBars.enabled) {
        drawColorBars(ctx, paper.width, paper.height, colorBars)
      }

      // Crop marks
      if (cropMarks.enabled) {
        drawCropMarks(ctx, paper.width, paper.height, cropMarks, marginsPx)
      }

      let hasImages = false
      let imgIndex = pageNum * layoutConfig.cols * layoutConfig.rows + copy * images.length * layoutConfig.cols * layoutConfig.rows

      for (let row = 0; row < layoutConfig.rows; row++) {
        for (let col = 0; col < layoutConfig.cols; col++) {
          const slotIndex = row * layoutConfig.cols + col

          // Check if we have an image for this slot
          const globalIdx = imgIndex + slotIndex
          const useImage = globalIdx < images.length * copies

          const x = marginsPx.left + col * (layoutConfig.cellWidth + layoutConfig.spacing)
          const y = marginsPx.top + row * (layoutConfig.cellH + layoutConfig.spacing)

          // Draw empty slot background
          ctx.fillStyle = emptySlotColor
          ctx.fillRect(x, y, layoutConfig.cellWidth, layoutConfig.cellH)

          if (useImage && imgIndex < loadedImages.length) {
            const img = loadedImages[imgIndex]
            const imgCanvas = img.canvas

            // Calculate draw dimensions
            let drawX = x
            let drawY = y
            let drawW = layoutConfig.cellWidth
            let drawH = layoutConfig.cellH

            if (cropToFit) {
              const imgAspect = imgCanvas.width / imgCanvas.height
              const cellAspect = layoutConfig.cellWidth / layoutConfig.cellH

              if (fitMode === 'cover') {
                if (imgCanvas.width / imgCanvas.height > layoutConfig.cellWidth / layoutConfig.cellH) {
                  drawH = layoutConfig.cellH
                  drawW = drawH * (imgCanvas.width / imgCanvas.height)
                  drawX = x + (layoutConfig.cellWidth - drawW) / 2
                  drawY = y
                } else {
                  drawW = layoutConfig.cellWidth
                  drawH = drawW / (imgCanvas.width / imgCanvas.height)
                  drawX = x
                  drawY = y + (layoutConfig.cellH - drawH) / 2
                }
              } else if (fitMode === 'contain') {
                if (imgCanvas.width / imgCanvas.height > layoutConfig.cellWidth / layoutConfig.cellH) {
                  drawW = layoutConfig.cellWidth
                  drawH = drawW / (imgCanvas.width / imgCanvas.height)
                  drawX = x
                  drawY = y + (layoutConfig.cellH - drawH) / 2
                } else {
                  drawH = layoutConfig.cellH
                  drawW = drawH * (imgCanvas.width / imgCanvas.height)
                  drawX = x + (layoutConfig.cellWidth - drawW) / 2
                  drawY = y
                }
              } else if (fitMode === 'fill') {
                drawW = layoutConfig.cellWidth
                drawH = layoutConfig.cellH
                drawX = x
                drawY = y
              }

              // Draw border
              if (border.width > 0) {
                ctx.strokeStyle = border.color
                ctx.lineWidth = border.width
                if (border.radius > 0) {
                  ctx.beginPath()
                  ctx.roundRect(drawX, drawY, drawW, drawH, border.radius)
                  ctx.stroke()
                } else {
                  ctx.strokeRect(drawX, drawY, drawW, drawH)
                }
              }

              // Clip to rounded rect if needed
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

              // Caption
              if (captions.enabled) {
                drawCaption(ctx, img, captions, drawX, drawY, drawW, drawH)
              }

              // Watermark
              if (watermark.enabled) {
                drawWatermark(ctx, drawX, drawY, drawW, drawH, watermark)
              }
            } else {
              // Empty slot
              if (border.width > 0) {
                ctx.strokeStyle = border.color
                ctx.lineWidth = border.width
                if (border.radius > 0) {
                  ctx.beginPath()
                  ctx.roundRect(x, y, layoutConfig.cellWidth, layoutConfig.cellH, border.radius)
                  ctx.stroke()
                } else {
                  ctx.strokeRect(x, y, layoutConfig.cellWidth, layoutConfig.cellH)
                }
              }
            }

            // Page numbers
            if (pageNumbers.enabled) {
              drawPageNumber(ctx, paper.width, paper.height, pageNumbers, pageNum + 1)
            }
          }

          if (!hasImages) break

          pages.push(pageCanvas)
        }

        if (imgIndex >= images.length * copies) break
      }

      return {
        pages,
        metadata: {
          totalImages: images.length,
          pages: pages.length,
          imagesPerPage: layoutConfig.cols * layoutConfig.rows,
          layout,
          paperSize,
          dpi,
        },
      }
    }

/** Draw caption under image */
function drawCaption(
  ctx: CanvasRenderingContext2D,
  img: any,
  captions: any,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  if (!captions.enabled) return

  let text = ''
  switch (captions.content) {
    case 'filename': text = img.name || 'Untitled'; break
    case 'date': text = new Date().toLocaleDateString(); break
    case 'custom': text = captions.customText || ''; break
    default: text = ''
  }

  if (!text) return

  ctx.font = `${captions.size}px ${captions.font}`
  ctx.fillStyle = captions.color
  ctx.textAlign = 'center'

  let captionY = y + h + captions.size + 5
  if (captions.position === 'top') {
    captionY = y - 5
    ctx.textBaseline = 'bottom'
  } else if (captions.position === 'overlay') {
    captionY = y + h - 5
    ctx.textBaseline = 'bottom'
  } else {
    captionY = y + h + captions.size + 5
    ctx.textBaseline = 'top'
  }

  ctx.fillText(text, x + w / 2, captionY)
}

/** Draw watermark */
function drawWatermark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  watermark: any
): void {
  if (!watermark.enabled || !watermark.text) return

  ctx.save()
  ctx.translate(x + w / 2, y + h / 2)
  ctx.rotate((watermark.rotation * Math.PI) / 180)
  ctx.globalAlpha = watermark.opacity / 100
  ctx.font = `${watermark.size}px ${watermark.font}`
  ctx.fillStyle = watermark.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  let xPos = 0, yPos = 0
  switch (watermark.position) {
    case 'top-left': xPos = -w/2 + 10; yPos = -h/2 + 10; break
    case 'top-right': xPos = w/2 - 10; yPos = -h/2 + 10; break
    case 'bottom-left': xPos = -w/2 + 10; yPos = h/2 - 10; break
    case 'bottom-right': xPos = w/2 - 10; yPos = h/2 - 10; break
    case 'center': xPos = 0; yPos = 0; break
    case 'diagonal':
      ctx.rotate(-Math.PI / 4)
      xPos = 0
      yPos = 0
      break
  }

  ctx.fillText(watermark.text, xPos, yPos)
  ctx.restore()
}

/** Draw page number */
function drawPageNumber(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pageNumbers: any,
  pageNum: number
): void {
  if (!pageNumbers.enabled) return

  ctx.font = pageNumbers.font
  ctx.fillStyle = pageNumbers.color
  ctx.textAlign = 'center'

  let x = width / 2
  let y = height - 30

  switch (pageNumbers.position) {
    case 'bottom-center': x = width / 2; y = height - 20; break
    case 'bottom-right': x = width - 20; y = height - 20; ctx.textAlign = 'right'; break
    case 'bottom-left': x = 20; y = height - 20; ctx.textAlign = 'left'; break
    case 'top-center': x = width / 2; y = 20; break
  }

  ctx.fillText(`${pageNum}`, x, y)
}

/** Draw crop marks */
function drawCropMarks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cropMarks: any,
  margins: any
): void {
  if (!cropMarks.enabled) return

  const { length, width: markWidth, color, offset } = cropMarks
  ctx.strokeStyle = color
  ctx.lineWidth = markWidth
  ctx.lineCap = 'butt'

  const offsetPx = offset * 1 // assuming offset in mm, convert if needed

  // Top-left
  drawCropMark(ctx, margins.left + offsetPx, margins.top + offsetPx, length, 'tl')
  // Top-right
  drawCropMark(ctx, width - margins.right - offsetPx, margins.top + offsetPx, length, 'tr')
  // Bottom-left
  drawCropMark(ctx, margins.left + offsetPx, height - margins.bottom - offsetPx, length, 'bl')
  // Bottom-right
  drawCropMark(ctx, width - margins.right - offsetPx, height - margins.bottom - offsetPx, length, 'br')
}

function drawCropMark(ctx: CanvasRenderingContext2D, x: number, y: number, length: number, corner: string): void {
  ctx.beginPath()
  switch (corner) {
    case 'tl':
      ctx.moveTo(x, y)
      ctx.lineTo(x + length, y)
      ctx.moveTo(x, y)
      ctx.lineTo(x, y + length)
      break
    case 'tr':
      ctx.moveTo(x, y)
      ctx.lineTo(x - length, y)
      ctx.moveTo(x, y)
      ctx.lineTo(x, y + length)
      break
    case 'bl':
      ctx.moveTo(x, y)
      ctx.lineTo(x + length, y)
      ctx.moveTo(x, y)
      ctx.lineTo(x, y - length)
      break
    case 'br':
      ctx.moveTo(x, y)
      ctx.lineTo(x - length, y)
      ctx.moveTo(x, y)
      ctx.lineTo(x, y - length)
      break
  }
  ctx.stroke()
}

/** Draw color bars for print calibration */
function drawColorBars(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colorBars: any
): void {
  if (!colorBars.enabled) return

  const barHeight = colorBars.height * 1 // assuming mm to px conversion
  const barWidth = width / 16

  const colors = [
    '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff',
    '#ffff00', '#ff00ff', '#00ffff', '#ff00ff', '#ff8800',
    '#888888', '#cccccc', '#999999', '#666666', '#333333', '#000000'
  ]

  const y = colorBars.position === 'top' ? 0 : height - barHeight

  colors.forEach((color, i) => {
    ctx.fillStyle = color
    ctx.fillRect(i * barWidth, y, barWidth, barHeight)
  })
}

/** Draw watermark on page */
function drawPageWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  watermark: any
): void {
  if (!watermark.enabled || !watermark.text) return

  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.rotate((watermark.rotation * Math.PI) / 180)
  ctx.globalAlpha = watermark.opacity / 100
  ctx.font = `${watermark.size}px ${watermark.font}`
  ctx.fillStyle = watermark.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(watermark.text, 0, 0)
  ctx.restore()
}

/** Export pages as PDF */
export async function exportPackageAsPDF(
  pages: HTMLCanvasElement[],
  options: { dpi: number; title: string; author: string; subject: string }
): Promise<Blob> {
  // Would use pdf-lib to generate PDF
  // Placeholder
  return new Blob()
}

/** Export pages as individual images */
export async function exportPackageAsImages(
  pages: HTMLCanvasElement[],
  format: 'png' | 'jpg' | 'webp' = 'png',
  quality = 1
): Promise<Blob[]> {
  return Promise.all(
    pages.map(page => new Promise<Blob>(resolve => {
      page.toBlob(blob => resolve(blob!), `image/${format}`, quality)
    }))
  )
}

/** Picture Package Presets */
export const PICTURE_PACKAGE_PRESETS: Record<string, Partial<PicturePackageOptions>> = {
  'standard-4x6': {
    name: 'Standard 4x6',
    paperSize: '4x6',
    layout: 'standard',
    type: 'standard',
    copies: 1,
  },
  'wallet-prints': {
    name: 'Wallet Prints',
    paperSize: '5x7',
    layout: 'wallet',
    type: 'wallet',
    copies: 2,
  },
  'passport-photos': {
    name: 'Passport Photos',
    paperSize: '4x6',
    layout: 'passport',
    type: 'passport',
    copies: 4,
    border: { width: 1, color: '#000000', radius: 0 },
    background: '#ffffff',
  },
  'school-portraits': {
    name: 'School Portraits',
    paperSize: '8x10',
    layout: 'school',
    type: 'school',
    copies: 1,
    captions: { enabled: true, content: 'filename', position: 'bottom' },
  },
  'wedding-package': {
    name: 'Wedding Package',
    paperSize: '8x10',
    layout: 'wedding',
    type: 'wedding',
    copies: 2,
    border: { width: 3, color: '#ffffff', radius: 8 },
    background: '#fafafa',
    watermark: { enabled: true, text: '© Studio', position: 'bottom-right', opacity: 30 },
  },
  'holiday-cards': {
    name: 'Holiday Cards',
    paperSize: '5x7',
    layout: 'holiday',
    type: 'holiday',
    copies: 1,
    border: { width: 0, color: '#ffffff', radius: 0 },
    background: '#f0f0f0',
  },
  'sports-package': {
    name: 'Sports Package',
    paperSize: '8x10',
    layout: 'sports',
    type: 'sports',
    copies: 1,
    captions: { enabled: true, content: 'date', position: 'bottom' },
  },
  'family-album': {
    name: 'Family Album',
    paperSize: '11x14',
    layout: 'family',
    type: 'family',
    copies: 1,
    border: { width: 5, color: '#ffffff', radius: 4 },
    background: '#fafafa',
    watermark: { enabled: true, text: 'Family Archive', position: 'center', opacity: 20 },
  },
  'portfolio-review': {
    name: 'Portfolio Review',
    paperSize: '12x12',
    layout: 'portfolio',
    type: 'portfolio',
    copies: 1,
    border: { width: 2, color: '#dddddd', radius: 4 },
    background: '#fafafa',
  },
}