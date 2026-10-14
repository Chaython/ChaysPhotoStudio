import { MAX_PDF_PAGES, type PdfPageChoice } from './pdf-import-plan'

// Ask before decoding a potentially large multi-page PDF. The page picker
// uses no remote assets and is created only on demand.
export async function choosePdfPages(fileName: string, pageCount: number): Promise<PdfPageChoice> {
  if (pageCount <= 1) return 0
  if (typeof document === 'undefined' || typeof HTMLDialogElement === 'undefined') return 0
  return await new Promise<PdfPageChoice>(resolve => {
    const dialog = document.createElement('dialog')
    dialog.setAttribute('aria-label', 'Select PDF pages to import')
    dialog.style.cssText = 'background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:12px;padding:20px;width:min(460px,calc(100vw - 24px));box-shadow:0 20px 80px #0005'
    const title = document.createElement('h3')
    title.textContent = 'Import PDF pages'
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:8px'
    const description = document.createElement('p')
    description.textContent = `${fileName} has ${pageCount} pages. Each imported page becomes a raster layer. PDF vectors and fonts are not retained as editable objects.`
    description.style.cssText = 'font-size:12px;margin-bottom:12px;overflow-wrap:anywhere'
    const mode = document.createElement('select')
    mode.setAttribute('aria-label', 'PDF page import mode')
    mode.style.cssText = 'display:block;width:100%;background:var(--background);color:var(--foreground);padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px'
    for (const [id, label] of [
      ['first', 'First page only'],
      ['single', 'Choose one page'],
      ...(pageCount <= MAX_PDF_PAGES ? [['all', 'All pages as separate layers']] : []),
    ]) {
      const option = document.createElement('option')
      option.value = id; option.textContent = label; mode.add(option)
    }
    const page = document.createElement('input')
    page.type = 'number'; page.min = '1'; page.max = String(pageCount); page.step = '1'; page.value = '1'
    page.setAttribute('aria-label', 'PDF page number')
    page.disabled = true
    page.style.cssText = 'width:100%;background:var(--background);color:var(--foreground);padding:8px;border:1px solid var(--border);border-radius:6px'
    mode.addEventListener('change', () => { page.disabled = mode.value !== 'single' })
    const note = document.createElement('p')
    note.style.cssText = 'font-size:11px;opacity:.75;margin-top:8px'
    note.textContent = pageCount > MAX_PDF_PAGES
      ? `This PDF exceeds the ${MAX_PDF_PAGES}-page batch limit. Import one page at a time.`
      : `Up to ${MAX_PDF_PAGES} pages per import; large page batches can exceed the raster memory limit.`
    const buttons = document.createElement('div')
    buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:16px'
    const cancel = document.createElement('button')
    cancel.textContent = 'Cancel'; cancel.type = 'button'
    cancel.style.cssText = 'padding:7px 14px;border:1px solid var(--border);border-radius:6px'
    const apply = document.createElement('button')
    apply.textContent = 'Import'; apply.type = 'button'
    apply.style.cssText = 'padding:7px 14px;background:var(--primary);color:var(--primary-foreground);border-radius:6px'
    cancel.addEventListener('click', () => dialog.close('cancel'))
    apply.addEventListener('click', () => {
      if (mode.value === 'single' && (!Number.isInteger(page.valueAsNumber) ||
          page.valueAsNumber < 1 || page.valueAsNumber > pageCount)) {
        page.setCustomValidity(`Choose a page from 1 to ${pageCount}`)
        page.reportValidity()
        return
      }
      dialog.close('import')
    })
    page.addEventListener('input', () => page.setCustomValidity(''))
    buttons.append(cancel, apply)
    dialog.append(title, description, mode, page, note, buttons)
    const finish = () => {
      const choice: PdfPageChoice = dialog.returnValue !== 'import' ? null
        : mode.value === 'all' ? 'all'
          : mode.value === 'single' ? page.valueAsNumber - 1 : 0
      dialog.remove()
      resolve(choice)
    }
    dialog.addEventListener('close', finish, { once: true })
    document.body.append(dialog)
    try { dialog.showModal() }
    catch { dialog.removeEventListener('close', finish); dialog.remove(); resolve(0) }
  })
}
