import type { ParsedDocument, ParsedDocumentLayer } from './document-parser-types'
import { createCanvas, ctx2d } from '../utils/canvas'
import { choosePdfPages } from './pdf-page-picker'
import { MAX_PDF_BYTES, MAX_PDF_TOTAL_PIXELS, pdfRenderSize, selectedPdfPages, checkPdfPixelBudget } from './pdf-import-plan'

/**
 * Rasterize the actual visual PDF pages via bundled PDF.js. This replaces the
 * old stream-regex extractor, which misplaced XObjects, dropped vectors and
 * sometimes returned blank pages. Original PDF text and paths are NOT editable
 * after import; each page is a distinct editable raster layer.
 *
 * The runtime and worker are lazy-loaded together by pdfjs-dist/webpack.mjs,
 * so no CDN, native Ghostscript, browser PDF plug-in or network is necessary.
 */
export async function renderPdfPages(bytes: Uint8Array, fileName: string): Promise<ParsedDocument> {
  if (typeof document === 'undefined') throw new Error('PDF rendering requires a browser canvas')
  if (bytes.byteLength < 8 || bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error('PDF is empty or exceeds the 100 MiB import limit')
  }

  const pdfjs = await import('pdfjs-dist/webpack.mjs')
  const task = pdfjs.getDocument({
    data: bytes.slice(), // give the worker ownership of a copy
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: true,
  })
  let pdf: Awaited<typeof task.promise> | null = null
  try {
    pdf = await task.promise // rejects for invalid, corrupt and encrypted PDFs
    const choice = await choosePdfPages(fileName, pdf.numPages)
    const indices = selectedPdfPages(pdf.numPages, choice)
    const layers: ParsedDocumentLayer[] = []
    let width = 1, height = 1, pixels = 0
    let firstScale = 2
    for (const index of indices) {
      const page = await pdf.getPage(index + 1)
      try {
        const natural = page.getViewport({ scale: 1 })
        const size = pdfRenderSize(natural.width, natural.height)
        pixels = checkPdfPixelBudget(pixels, size.pixels)
        if (pixels > MAX_PDF_TOTAL_PIXELS) throw new Error('PDF raster budget exceeded')
        const viewport = page.getViewport({ scale: size.scale })
        const canvas = createCanvas(size.width, size.height)
        const context = ctx2d(canvas)
        await page.render({
          canvas,
          canvasContext: context,
          viewport,
          background: 'rgb(255,255,255)',
        }).promise
        if (layers.length === 0) firstScale = size.scale
        width = Math.max(width, canvas.width)
        height = Math.max(height, canvas.height)
        layers.push({
          kind: 'raster', name: `PDF Page ${index + 1}`,
          canvas, left: 0, top: 0, visible: layers.length === 0,
          metadata: { sourceFormat: 'pdf', pageNumber: index + 1, rasterScale: size.scale },
        })
      } finally {
        page.cleanup()
      }
    }
    if (!layers.length || !layers[0].canvas) throw new Error('PDF yielded no rendered pages')
    const composite = createCanvas(width, height)
    const compositeCtx = ctx2d(composite)
    compositeCtx.fillStyle = '#ffffff'
    compositeCtx.fillRect(0, 0, width, height)
    compositeCtx.drawImage(layers[0].canvas, 0, 0)
    return {
      name: fileName, width, height, composite, layers,
      sourceBitDepth: 8, resolutionPpi: Math.round(firstScale * 72),
      warnings: [
        'PDF pages were rasterized by PDF.js; text, fonts and vector paths are not preserved as editable objects.',
        ...(pdf.numPages > 1 ? [`Imported ${layers.length} of ${pdf.numPages} PDF pages. Only the first page layer is initially visible.`] : []),
        ...(firstScale < 2 ? ['Page raster size was reduced to fit the safe import memory limit.'] : []),
      ],
    }
  } finally {
    try { await task.destroy() } catch { /* worker may have failed during loading */ }
  }
}
