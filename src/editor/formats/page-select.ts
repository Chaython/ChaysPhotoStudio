// Small native browser dialog for containers that carry multiple images.
// Dialog is created only when importing a multi-page document.
export type PageSelection = 'all' | number | null
export async function chooseImagePages(
  fileName: string,
  pages: Array<{ name?: string; canvas?: HTMLCanvasElement | null }>,
): Promise<PageSelection> {
  if (pages.length < 2 || typeof document === 'undefined' || typeof HTMLDialogElement === 'undefined') return 'all'
  return await new Promise<PageSelection>(resolve => {
    const dialog = document.createElement('dialog')
    dialog.setAttribute('aria-label', 'Select image pages to import')
    dialog.style.cssText = [
      'border:1px solid var(--border)', 'border-radius:12px', 'padding:20px',
      'color:var(--card-foreground)', 'background:var(--card)',
      'box-shadow:0 20px 80px rgba(0,0,0,.35)',
      'width:min(440px,calc(100vw - 24px))',
    ].join(';')
    const title = document.createElement('h3')
    title.textContent = 'Import pages / frames'
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:6px'
    const details = document.createElement('p')
    details.textContent = fileName + ' contains ' + pages.length + ' importable pages.'
    details.style.cssText = 'font-size:12px;opacity:.8;margin-bottom:12px;overflow-wrap:anywhere'
    const select = document.createElement('select')
    select.setAttribute('aria-label', 'Import all pages or choose one')
    select.style.cssText = 'width:100%;padding:9px;border:1px solid var(--border);border-radius:6px;background:var(--background);color:var(--foreground)'
    const all = document.createElement('option')
    all.value = 'all'
    all.textContent = 'Import all as separate layers'
    select.append(all)
    for (let i = 0; i < pages.length; i++) {
      const option = document.createElement('option')
      option.value = String(i)
      option.textContent = 'Only ' + (pages[i].name || 'page ' + (i + 1))
      select.append(option)
    }
    const preview = document.createElement('canvas')
    preview.width = 320
    preview.height = 170
    preview.setAttribute('aria-label', 'Selected image page preview')
    preview.style.cssText = 'display:block;max-width:100%;height:auto;margin:12px auto;background:var(--muted);border:1px solid var(--border);border-radius:6px'
    const hint = document.createElement('p')
    hint.textContent = 'All pages remain editable as separate layers; only the first is visible initially.'
    hint.style.cssText = 'font-size:11px;opacity:.75;margin-bottom:14px'
    const buttons = document.createElement('div')
    buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px'
    const cancel = document.createElement('button')
    cancel.textContent = 'Cancel'
    cancel.type = 'button'
    cancel.style.cssText = 'padding:7px 14px;border:1px solid var(--border);border-radius:6px'
    const apply = document.createElement('button')
    apply.textContent = 'Import'
    apply.type = 'button'
    apply.style.cssText = 'padding:7px 14px;background:var(--primary);color:var(--primary-foreground);border-radius:6px'
    const paint = () => {
      const idx = select.value === 'all' ? 0 : Number(select.value)
      const canvas = pages[idx]?.canvas
      const ctx = preview.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, preview.width, preview.height)
      if (!canvas) return
      const scale = Math.min(preview.width / canvas.width, preview.height / canvas.height)
      const width = canvas.width * scale, height = canvas.height * scale
      ctx.drawImage(canvas, (preview.width - width) / 2, (preview.height - height) / 2, width, height)
    }
    select.addEventListener('change', paint)
    cancel.addEventListener('click', () => dialog.close('cancel'))
    apply.addEventListener('click', () => dialog.close('import'))
    buttons.append(cancel, apply)
    dialog.append(title, details, select, preview, hint, buttons)
    const finish = () => {
      const selection: PageSelection = dialog.returnValue !== 'import' ? null :
        select.value === 'all' ? 'all' : Number(select.value)
      dialog.remove()
      resolve(selection)
    }
    dialog.addEventListener('close', finish, { once: true })
    document.body.append(dialog)
    try {
      dialog.showModal()
      paint()
    } catch {
      dialog.removeEventListener('close', finish)
      dialog.remove()
      resolve('all')
    }
  })
}
