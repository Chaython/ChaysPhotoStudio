// Bounded planning for PDF.js rendering. Pure helpers allow validation in Bun
// without a DOM or a PDF.js worker.
export const MAX_PDF_BYTES = 100 * 1024 * 1024
export const MAX_PDF_PAGES = 32
export const MAX_PDF_PAGE_PIXELS = 14_000_000
export const MAX_PDF_TOTAL_PIXELS = 48_000_000
export const MAX_PDF_EDGE = 8192

export type PdfPageChoice = 'all' | number | null // selected page is zero-based

export function selectedPdfPages(total: number, choice: PdfPageChoice): number[] {
  if (!Number.isSafeInteger(total) || total < 1) throw new Error('PDF has no importable pages')
  if (choice === null) throw new Error('PDF import cancelled')
  if (choice === 'all') {
    if (total > MAX_PDF_PAGES) {
      throw new Error(`PDF has ${total} pages; import at most ${MAX_PDF_PAGES} at once or select a single page`)
    }
    return Array.from({ length: total }, (_, index) => index)
  }
  if (!Number.isSafeInteger(choice) || choice < 0 || choice >= total) {
    throw new Error('Selected PDF page is outside the document')
  }
  return [choice]
}

export interface PdfRenderSize { scale: number; width: number; height: number; pixels: number }

export function pdfRenderSize(pageWidth: number, pageHeight: number): PdfRenderSize {
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) ||
      pageWidth <= 0 || pageHeight <= 0) {
    throw new Error('Invalid PDF page dimensions')
  }
  const scale = Math.min(
    2, // 144 DPI for ordinary 72 pt/in PDF pages
    MAX_PDF_EDGE / Math.max(pageWidth, pageHeight),
    Math.sqrt(MAX_PDF_PAGE_PIXELS / (pageWidth * pageHeight)),
  )
  if (!Number.isFinite(scale) || scale < 0.001) throw new Error('PDF page is too large to render safely')
  const width = Math.max(1, Math.floor(pageWidth * scale))
  const height = Math.max(1, Math.floor(pageHeight * scale))
  return { scale, width, height, pixels: width * height }
}

export function checkPdfPixelBudget(alreadyRendered: number, nextPixels: number): number {
  if (!Number.isSafeInteger(alreadyRendered) || !Number.isSafeInteger(nextPixels) ||
      alreadyRendered < 0 || nextPixels < 1 ||
      alreadyRendered + nextPixels > MAX_PDF_TOTAL_PIXELS) {
    throw new Error('Selected PDF pages exceed the safe raster memory budget; import fewer pages')
  }
  return alreadyRendered + nextPixels
}
