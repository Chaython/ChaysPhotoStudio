// AI Image Generation backend — multi-provider text-to-image.
//
// Providers:
//   zai           (default) z-ai-web-dev-sdk neural engine — retried hard
//                 (3 attempts, 70s cap each) because the upstream service is
//                 intermittently flaky (400/code-1214 load rejections, empty
//                 results, unreachable image host, hung requests).
//   pollinations  free community engine (no API key) — used directly on
//                 request AND as the automatic fallback when Z.AI fails.
//   custom        user-supplied OpenAI-compatible endpoint
//                 (baseUrl [/images/generations], optional Bearer key, model).
//
// Size rules (learned from upstream error code 1214, see worklog Task 10):
//   Z.AI requires both dimensions 512–2880, multiples of 32, ≤ 2^22 pixels.
//   The old 1440x720 / 720x1440 presets VIOLATED that (720 % 32 !== 0) and
//   failed instantly — presets now use 1472x736 / 736x1472.
//   Pollinations & custom endpoints accept any WxH.
import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

const MAX_PROMPT = 600

type Provider = 'zai' | 'pollinations' | 'custom'

interface CustomConfig {
  baseUrl?: string
  apiKey?: string
  model?: string
}

interface GenImage {
  image: string // data-URL
  provider: string
}

const ZAI_ATTEMPTS = 3
const ZAI_TIMEOUT_MS = 70_000
const ZAI_BACKOFF_MS = [2_500, 5_000]
const POLL_ATTEMPTS = 2
const POLL_TIMEOUT_MS = 75_000
const POLL_BACKOFF_MS = 5_000
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

/** Z.AI upstream constraints (error code 1214): 512–2880, ×32, ≤ 2^22 px. */
function zaiSizeValid(w: number, h: number): boolean {
  return (
    w >= 512 && w <= 2880 && h >= 512 && h <= 2880 &&
    w % 32 === 0 && h % 32 === 0 &&
    w * h <= 2 ** 22
  )
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

/** sniff the real image format from magic bytes — the Z.AI SDK returns JPEG
 *  bytes for some models while other paths label everything PNG. */
function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif'
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[8] === 0x57 && buffer[9] === 0x45) return 'image/webp'
  return null
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

// ---------- provider: Z.AI (with retries) ----------

interface UpstreamError {
  message: string
  status?: number
  permanent: boolean
}

function parseUpstreamError(err: unknown): UpstreamError {
  const raw = err instanceof Error ? err.message : String(err)
  const m = raw.match(/API request failed with status (\d+)\s*:\s*([\s\S]*)$/)
  if (m) {
    const status = Number(m[1])
    let body: any = null
    try { body = JSON.parse(m[2]) } catch { /* non-JSON body */ }
    const code = body?.code ?? body?.error?.code
    let detail = String(body?.message ?? body?.error?.message ?? m[2]).slice(0, 200)
    // translate known upstream messages (size constraint arrives in Chinese)
    if (/长宽|512px|2880|integer multiple|整数倍/i.test(detail) || code === 1214) {
      detail = 'the requested size is not supported by this engine (dimensions must be 512–2880px, multiples of 32, ≤ 4.2 MP)'
    }
    const permanent = status >= 400 && status < 500 && status !== 429
    return { message: `engine rejected the request (HTTP ${status}${code ? `, code ${code}` : ''}): ${detail}`, status, permanent }
  }
  if (/timeout|timed out|aborted|Terminate/i.test(raw)) {
    return { message: 'the generation engine timed out', permanent: false }
  }
  if (/Unable to connect|ECONNREFUSED|ConnectionRefused|ENOTFOUND|fetch failed|network|ConnectTimeout/i.test(raw)) {
    return { message: 'could not reach the generation engine', permanent: false }
  }
  return { message: raw.slice(0, 250) || 'unknown generation error', permanent: false }
}

async function generateWithZai(prompt: string, size: string): Promise<GenImage> {
  const zai = await ZAI.create()
  let last: UpstreamError | null = null
  for (let attempt = 1; attempt <= ZAI_ATTEMPTS; attempt++) {
    try {
      const response = await withTimeout(
        // SDK types declare a 7-size union (incl. the actually-invalid
        // 1440x720) — the real API accepts any 512–2880 ×32 size, so cast.
        zai.images.generations.create({ prompt, size } as never),
        ZAI_TIMEOUT_MS,
        `attempt ${attempt}`,
      )
      const base64 = (response as any)?.data?.[0]?.base64
      if (typeof base64 === 'string' && base64.length > 100) {
        // decode to sniff the real format (bytes are sometimes JPEG despite the SDK contract)
        let mime = 'image/png'
        try {
          const sniffed = sniffImageMime(Buffer.from(base64, 'base64'))
          if (sniffed) mime = sniffed
        } catch { /* keep png default */ }
        return { image: `data:${mime};base64,${base64}`, provider: 'zai' }
      }
      last = { message: 'the engine returned an empty result', permanent: false }
    } catch (err) {
      last = parseUpstreamError(err)
    }
    if (attempt === ZAI_ATTEMPTS) break
    await sleep(ZAI_BACKOFF_MS[attempt - 1] ?? 5_000)
  }
  throw Object.assign(new Error(last?.message ?? 'generation failed'), { upstream: last })
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
      const res = await withTimeout(fetch(url, { redirect: 'follow' }), POLL_TIMEOUT_MS, 'pollinations')
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

    const provider: Provider =
      body.provider === 'pollinations' || body.provider === 'custom' ? body.provider : 'zai'
    const { w, h } = parseSize(body.size)

    if (provider === 'zai' && !zaiSizeValid(w, h)) {
      return NextResponse.json({
        error: `Z.AI requires dimensions 512–2880px, multiples of 32, ≤ 4.2 MP — ${w}x${h} is not valid. Pick another aspect or use the Pollinations engine.`,
      }, { status: 400 })
    }

    let result: GenImage
    let fallback = false
    let primaryError: Error | null = null

    if (provider === 'zai') {
      try {
        result = await generateWithZai(prompt, body.size ?? '1024x1024')
      } catch (err) {
        primaryError = err instanceof Error ? err : new Error(String(err))
        // AUTO-FALLBACK: Z.AI is flaky — always give the free engine a shot
        try {
          result = await generateWithPollinations(prompt, w, h)
          fallback = true
        } catch {
          throw primaryError
        }
      }
    } else if (provider === 'pollinations') {
      result = await generateWithPollinations(prompt, w, h)
    } else {
      result = await generateWithCustom(body.custom ?? {}, prompt, w, h)
    }

    return NextResponse.json({
      image: result.image,
      provider: result.provider,
      fallback,
      size: body.size ?? '1024x1024',
    })
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err))
    const isSizeReject = /not supported by this engine/.test(e.message)
    const permanent = (e as any)?.permanent || (e as any)?.upstream?.permanent
    const friendly = isSizeReject || permanent
      ? e.message
      : `${e.message}. The engine may be busy — try again, or switch to the Pollinations engine.`
    const status = isSizeReject ? 400 : (e as any)?.upstream?.status === 400 ? 400 : 502
    return NextResponse.json({ error: friendly }, { status })
  }
}
