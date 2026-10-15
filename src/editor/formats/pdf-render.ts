import type { ParsedDocument, ParsedDocumentLayer } from './document-parser-types'
import { createCanvas, ctx2d } from '../utils/canvas'
import { choosePdfPages } from './pdf-page-picker'
import { MAX_PDF_BYTES, MAX_PDF_TOTAL_PIXELS, pdfRenderSize, selectedPdfPages, checkPdfPixelBudget } from './pdf-import-plan'
import { pdfEditableText, pdfEditableVectors } from './pdf-native'

/**
 * Rasterize the actual visual PDF pages via bundled PDF.js. This replaces the
 * old stream-regex extractor, which misplaced XObjects, dropped vectors and
 * sometimes returned blank pages. An untouched reference raster preserves
 * visual fidelity, while supported text runs and vectors are ALSO recovered
 * into hidden native text/shape layers for independent editing.
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
    let recoveredText = 0, recoveredVectors = 0
    let truncatedObjects = false
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
          kind: 'raster', name: `PDF Page ${index + 1} · Visual reference`,
          canvas, left: 0, top: 0, visible: layers.length === 0,
          metadata: { sourceFormat: 'pdf', pageNumber: index + 1, rasterScale: size.scale,
            visualReference: true },
        })
        // Each PDF page retains its pixel-perfect reference. Native text/shape
        // layers are hidden initially so fonts, masks, images, transparency and
        // unsupported effects never unexpectedly change the imported image.
        // Reveal desired edit layers and hide the reference to replace content.
        if (recoveredText + recoveredVectors < 512) try {
          const { items, styles } = await page.getTextContent({ disableNormalization: false })
          const recovered = pdfEditableText({ items, styles }, viewport.transform as
            [number, number, number, number, number, number], canvas.width, canvas.height, index + 1)
          const budget = Math.max(0, 512 - (recoveredText + recoveredVectors))
          const included = recovered.slice(0, budget)
          recoveredText += included.length
          if (included.length < recovered.length) truncatedObjects = true
          layers.push(...included)
        } catch {
          // A page's raster is still valid when semantic extraction fails.
        }
        if (recoveredText + recoveredVectors < 512) try {
          const operatorList = await page.getOperatorList()
          const recovered = pdfEditableVectors(operatorList, pdfjs.OPS,
            viewport.transform as [number, number, number, number, number, number],
            canvas.width, canvas.height, index + 1)
          const budget = Math.max(0, 512 - (recoveredText + recoveredVectors))
          const included = recovered.slice(0, budget)
          recoveredVectors += included.length
          if (included.length < recovered.length) truncatedObjects = true
          layers.push(...included)
        } catch {
          // Do not fail an otherwise correctly rendered PDF due to missing
          // operator list support or an unrepresentable PDF shape.
        }
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
        `Recovered ${recoveredText} editable text runs and ${recoveredVectors} editable vector paths. Hidden native layers can be revealed in Layers; hide the PDF visual reference to replace its contents.`,
        'Original PDF page renderings remain the authoritative visible reference. Native text uses substitute fonts where necessary; complex PDF effects, clipping, images and shapes may remain raster-only.',
        ...(truncatedObjects ? ['Editable PDF extraction exceeded the 512-object document limit. Remaining content stays in the original page reference.'] : []),
        ...(pdf.numPages > 1 ? [`Imported ${indices.length} of ${pdf.numPages} PDF pages. Only the first visual reference is initially visible.`] : []),
        ...(firstScale < 2 ? ['Page raster size was reduced to fit the safe import memory limit.'] : []),
      ],
    }
  } finally {
    try { await task.destroy() } catch { /* worker may have failed during loading */ }
  }
}
