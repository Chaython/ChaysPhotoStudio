import { canvasPagesToPdf } from './pdf-multipage-export'
export { canvasPagesToPdf } from './pdf-multipage-export'
/** Flat single-page PDF export; retained for existing callers. */
export function canvasToPdf(canvas: HTMLCanvasElement, ppi = 72, quality = 0.92): Promise<Blob> {
  return canvasPagesToPdf([canvas], ppi, quality)
}
