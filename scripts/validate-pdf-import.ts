import { pdfRenderSize, selectedPdfPages, checkPdfPixelBudget,
  MAX_PDF_EDGE, MAX_PDF_PAGE_PIXELS, MAX_PDF_PAGES, MAX_PDF_TOTAL_PIXELS } from '../src/editor/formats/pdf-import-plan'

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error('PDF import regression: ' + message)
}
function rejects(fn: () => unknown, message: string): void {
  let failed = false
  try { fn() } catch { failed = true }
  check(failed, message)
}
check(selectedPdfPages(3, 'all').join(',') === '0,1,2', 'all page selection')
check(selectedPdfPages(500, 499).join(',') === '499', 'high individual page index')
check(selectedPdfPages(2, 0).join(',') === '0', 'first page')
rejects(() => selectedPdfPages(0, 'all'), 'empty PDF rejected')
rejects(() => selectedPdfPages(2, null), 'cancel rejected')
rejects(() => selectedPdfPages(3, -1), 'negative page rejected')
rejects(() => selectedPdfPages(3, 3), 'out-of-range page rejected')
rejects(() => selectedPdfPages(2, 1.5), 'fractional page rejected')
rejects(() => selectedPdfPages(MAX_PDF_PAGES + 1, 'all'), 'oversized all-pages import rejected')
check(selectedPdfPages(MAX_PDF_PAGES, 'all').length === MAX_PDF_PAGES, 'batch boundary accepted')
const letter = pdfRenderSize(612, 792)
check(letter.width === 1224 && letter.height === 1584 && letter.scale === 2, 'ordinary letter PDF at 144 DPI')
const huge = pdfRenderSize(100000, 100000)
check(huge.width <= MAX_PDF_EDGE && huge.height <= MAX_PDF_EDGE, 'huge page clipped to max edge')
check(huge.pixels <= MAX_PDF_PAGE_PIXELS, 'huge page clipped to pixel budget')
rejects(() => pdfRenderSize(0, 100), 'zero width rejected')
rejects(() => pdfRenderSize(NaN, 100), 'NaN rejected')
rejects(() => pdfRenderSize(Infinity, 100), 'infinite width rejected')
check(checkPdfPixelBudget(0, 123) === 123, 'increment budget')
check(checkPdfPixelBudget(MAX_PDF_TOTAL_PIXELS - 1, 1) === MAX_PDF_TOTAL_PIXELS, 'budget boundary')
rejects(() => checkPdfPixelBudget(MAX_PDF_TOTAL_PIXELS, 1), 'over budget rejected')
rejects(() => checkPdfPixelBudget(0, -1), 'negative pixels rejected')
console.log('PDF page selection, dimensions and raster memory budget: OK')
