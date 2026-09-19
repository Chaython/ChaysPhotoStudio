// ComfyUI bridge for the desktop/web server build.
// The proxy exists because browser-extension/static builds cannot reliably call
// localhost ComfyUI due to CORS. For safety, remote URLs are blocked unless the
// server owner explicitly opts in with CHAYS_ALLOW_REMOTE_AI=1.
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const TIMEOUT_MS = 5 * 60_000
const POLL_MS = 850
const MAX_BODY = 18 * 1024 * 1024

function normalizeBase(raw: string): string {
  const u = new URL(raw)
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('ComfyUI URL must use http or https')
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname)
  if (!local && process.env.CHAYS_ALLOW_REMOTE_AI !== '1') {
    throw new Error('Remote ComfyUI hosts are disabled by default. Use localhost, or set CHAYS_ALLOW_REMOTE_AI=1 on your own server.')
  }
  u.pathname = u.pathname.replace(/\/+$/, '')
  u.search = ''
  u.hash = ''
  return u.toString().replace(/\/$/, '')
}

function replaceTokens(value: any, vars: Record<string, string>): any {
  if (typeof value === 'string') {
    let out = value
    for (const [key, replacement] of Object.entries(vars)) out = out.split(key).join(replacement)
    return out
  }
  if (Array.isArray(value)) return value.map(v => replaceTokens(v, vars))
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) out[k] = replaceTokens(v, vars)
    return out
  }
  return value
}

function dataUrlToBlob(dataUrl: string): Blob {
  const m = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
  if (!m) throw new Error('Invalid input image data')
  const mime = m[1] || 'image/png'
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8')
  return new Blob([buf], { type: mime })
}

async function upload(base: string, dataUrl: string, filename: string): Promise<string> {
  const form = new FormData()
  form.append('image', dataUrlToBlob(dataUrl), filename)
  form.append('type', 'input')
  form.append('overwrite', 'true')
  const res = await fetch(`${base}/upload/image`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`ComfyUI image upload failed (HTTP ${res.status})`)
  const j: any = await res.json()
  return String(j?.name || filename)
}

async function fetchDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`ComfyUI output download failed (HTTP ${res.status})`)
  const mime = (res.headers.get('content-type') || 'image/png').split(';')[0]
  const bytes = Buffer.from(await res.arrayBuffer())
  return `data:${mime};base64,${bytes.toString('base64')}`
}

function firstImage(history: any): { filename: string; subfolder: string; type: string } | null {
  const outputs = history?.outputs ?? history
  if (!outputs || typeof outputs !== 'object') return null
  for (const node of Object.values(outputs) as any[]) {
    const imgs = node?.images
    if (Array.isArray(imgs) && imgs.length) {
      const im = imgs[0]
      if (im?.filename) return { filename: String(im.filename), subfolder: String(im.subfolder ?? ''), type: String(im.type ?? 'output') }
    }
  }
  return null
}

export async function POST(req: Request) {
  try {
    const len = Number(req.headers.get('content-length') || 0)
    if (len > MAX_BODY) return NextResponse.json({ error: 'AI edit request is too large' }, { status: 413 })
    const body = await req.json() as { baseUrl?: string; prompt?: string; negativePrompt?: string; workflow?: any; image?: string; mask?: string }
    const base = normalizeBase(String(body.baseUrl || 'http://127.0.0.1:8188'))
    if (!body.workflow || typeof body.workflow !== 'object') return NextResponse.json({ error: 'A ComfyUI API workflow is required' }, { status: 400 })

    const stamp = Date.now().toString(36)
    const imageName = body.image ? await upload(base, body.image, `chays-input-${stamp}.png`) : ''
    const maskName = body.mask ? await upload(base, body.mask, `chays-mask-${stamp}.png`) : ''
    const workflow = replaceTokens(body.workflow, {
      '{{PROMPT}}': String(body.prompt ?? ''),
      '{{NEGATIVE_PROMPT}}': String(body.negativePrompt ?? ''),
      '{{IMAGE}}': imageName,
      '{{MASK}}': maskName,
    })

    const clientId = `chays-${stamp}-${Math.random().toString(36).slice(2, 8)}`
    const queued = await fetch(`${base}/prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    })
    if (!queued.ok) {
      const detail = (await queued.text().catch(() => '')).slice(0, 500)
      throw new Error(`ComfyUI rejected the workflow (HTTP ${queued.status})${detail ? `: ${detail}` : ''}`)
    }
    const q: any = await queued.json()
    const promptId = String(q?.prompt_id ?? '')
    if (!promptId) throw new Error('ComfyUI did not return a prompt_id')

    const deadline = Date.now() + TIMEOUT_MS
    let image: ReturnType<typeof firstImage> = null
    while (Date.now() < deadline) {
      const hres = await fetch(`${base}/history/${encodeURIComponent(promptId)}`)
      if (hres.ok) {
        const all: any = await hres.json()
        const h = all?.[promptId] ?? all
        image = firstImage(h)
        if (image) break
        const status = h?.status
        if (status?.status_str === 'error' || status?.completed === false && status?.messages?.some?.((m: any) => m?.[0] === 'execution_error')) {
          throw new Error('ComfyUI workflow execution failed; check the ComfyUI console')
        }
      }
      await new Promise(r => setTimeout(r, POLL_MS))
    }
    if (!image) throw new Error('ComfyUI timed out before producing an image')

    const qs = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type })
    const dataUrl = await fetchDataUrl(`${base}/view?${qs}`)
    return NextResponse.json({ image: dataUrl, promptId, filename: image.filename })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'ComfyUI request failed' }, { status: 502 })
  }
}
