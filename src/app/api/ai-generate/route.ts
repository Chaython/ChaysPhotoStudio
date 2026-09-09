// AI Image Generation backend — multi-provider text-to-image.
//
// Providers:
//   pollinations  (default) free community engine (no API key) —
//                 retried because the shared service is intermittently
//                 busy (rate limits, non-image responses, slow gens).
//   custom        user-supplied OpenAI-compatible endpoint
//                 (baseUrl [/images/generations], optional Bearer key, model).
//
// Dimensions: presets stick to multiples of 32 between 512 and 2880 and
// ≤ 4.2 MP so every engine accepts them; both providers also accept any
// reasonable WxH.
import { NextResponse } from 'next/server'

const MAX_PROMPT = 600

type Provider = 'pollinations' | 'custom'

interface CustomConfig {
  baseUrl?: string
  apiKey?: string
  model?: string
}

interface GenImage {
  image: string // data-URL
  provider: string
}

const POLL_ATTEMPTS = 3
const POLL_TIMEOUT_MS = 90_000
const POLL_BACKOFF_MS = 4_000
const CUSTOM_ATTEMPTS = 2
const CUSTOM_TIMEOUT_MS = 90_000
const CUSTOM_BACKOFF_MS = 3_000

// ---------- helpers ----------

function parseSize(size: string | undefined): { w: number; h: number } {
  const m = (size ?? '').match(/^(\d{2,5})x(\d{2,5})$/)
  if (m) {
    const w = Number(m[1]), h = Number(m[2])
    if (w > 0 && h > 0) return { w, h }
  }
  return { w: 1024, h: 1024 }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ])
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function toDataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString('base64')}`
}

/** fetch a result URL → data-URL with real content-type detection. */
async function downloadAsDataUrl(url: string, timeoutMs: number): Promise<string> {
  const res = await withTimeout(fetch(url, { redirect: 'follow' }), timeoutMs, 'image download')
  if (!res.ok) throw new Error(`image download failed (HTTP ${res.status})`)
  const ct = (res.headers.get('content-type') || '').split(';')[0].trim()
  if (!ct.startsWith('image/')) throw new Error('the endpoint returned a non-image response')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 100) throw new Error('the endpoint returned an empty image')
  return toDataUrl(buf, ct || 'image/png')
}

// ---------- provider: Pollinations (free, no key) ----------

async function generateWithPollinations(prompt: string, w: number, h: number): Promise<GenImage> {
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    try {
      const seed = Math.floor(Math.random() * 1e9)
      const url =
        `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
        `?width=${w}&height=${h}&nologo=true&seed=${seed}`
      const res = await withTimeout(fetch(url, { redirect: 'follow' }), POLL_TIMEOUT_MS, 'free engine')
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`free engine returned HTTP ${res.status}${text ? `: ${text.slice(0, 150)}` : ''}`)
      }
      const ct = (res.headers.get('content-type') || '').split(';')[0].trim()
      if (!ct.startsWith('image/')) {
        throw new Error('free engine returned a non-image response (it may be rate-limiting — try again)')
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 100) throw new Error('free engine returned an empty image')
      return { image: toDataUrl(buf, ct), provider: 'pollinations' }
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
    }
    if (attempt === POLL_ATTEMPTS) break
    await sleep(POLL_BACKOFF_MS)
  }
  throw lastErr ?? new Error('free engine failed')
}

// ---------- provider: custom (OpenAI-compatible) ----------

async function generateWithCustom(cfg: CustomConfig, prompt: string, w: number, h: number): Promise<GenImage> {
  const raw = (cfg.baseUrl ?? '').trim()
  if (!raw) throw Object.assign(new Error('Custom API needs a base URL (e.g. https://api.openai.com/v1)'), { permanent: true })
  const base = raw.replace(/\/+$/, '')
  const endpoint = /\/images\/generations$/.test(base) ? base : `${base}/images/generations`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.apiKey?.trim()) headers.Authorization = `Bearer ${cfg.apiKey.trim()}`

  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= CUSTOM_ATTEMPTS; attempt++) {
    try {
      let res: Response
      try {
        res = await withTimeout(
          fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: cfg.model?.trim() || 'dall-e-3',
              prompt,
              size: `${w}x${h}`,
              n: 1,
              response_format: 'url',
            }),
          }),
          CUSTOM_TIMEOUT_MS,
          'custom API',
        )
      } catch {
        // connection refused / DNS / TLS — point at the endpoint, not "fetch failed"
        throw Object.assign(
          new Error(`could not reach ${endpoint} — check the base URL (and that the endpoint allows cross-origin server requests)`),
          { permanent: true },
        )
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        let detail = text.slice(0, 200)
        try { const j = JSON.parse(text); detail = String(j?.error?.message ?? j?.message ?? detail).slice(0, 200) } catch { /* raw text */ }
        const permanent = res.status >= 400 && res.status < 500 && res.status !== 429
        throw Object.assign(new Error(`custom API returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`), { permanent })
      }
      const json = await res.json()
      const item = json?.data?.[0] ?? json?.images?.[0]
      const b64 = item?.b64_json ?? item?.image ?? (typeof item === 'string' ? item : null)
      if (typeof b64 === 'string' && b64.length > 100) {
        // some endpoints return bare base64, some a data-URL already
        const image = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`
        return { image, provider: 'custom' }
      }
      if (typeof item?.url === 'string') {
        const image = await downloadAsDataUrl(item.url, CUSTOM_TIMEOUT_MS)
        return { image, provider: 'custom' }
      }
      throw new Error('custom API response has no image (expected data[0].b64_json or data[0].url)')
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if ((lastErr as any)?.permanent && attempt === 1) break // config/auth errors won't heal
    }
    if (attempt === CUSTOM_ATTEMPTS) break
    await sleep(CUSTOM_BACKOFF_MS)
  }
  throw lastErr ?? new Error('custom API failed')
}

// ---------- main ----------

export async function POST(req: Request) {
  try {
    const bodyText = await req.text()
    if (bodyText.length > MAX_PROMPT * 4 + 4096) {
      return NextResponse.json({ error: 'Request too large' }, { status: 413 })
    }
    const body = JSON.parse(bodyText) as {
      prompt?: string
      size?: string
      provider?: string
      custom?: CustomConfig
    }

    const prompt = body.prompt?.trim() ?? ''
    if (!prompt) {
      return NextResponse.json({ error: 'A prompt is required' }, { status: 400 })
    }
    if (prompt.length > MAX_PROMPT) {
      return NextResponse.json({ error: `Prompt too long (max ${MAX_PROMPT} chars)` }, { status: 400 })
    }

    const provider: Provider = body.provider === 'custom' ? 'custom' : 'pollinations'
    const { w, h } = parseSize(body.size)

    const result: GenImage =
      provider === 'pollinations'
        ? await generateWithPollinations(prompt, w, h)
        : await generateWithCustom(body.custom ?? {}, prompt, w, h)

    return NextResponse.json({
      image: result.image,
      provider: result.provider,
      fallback: false,
      size: body.size ?? '1024x1024',
    })
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err))
    const permanent = (e as any)?.permanent
    const friendly = permanent
      ? e.message
      : `${e.message}. The free engine may be busy — try again, or configure your own endpoint under "My API".`
    return NextResponse.json({ error: friendly }, { status: permanent ? 400 : 502 })
  }
}
