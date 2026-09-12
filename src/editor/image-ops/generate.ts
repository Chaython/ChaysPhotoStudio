// ============================================================
// AI Image Generation — client-side helper for text-to-image.
// Server path: POST /api/ai-generate (providers):
//   pollinations  — free community engine (default, no key,
//                   auto-retries when busy)
//   custom        — user's own OpenAI-compatible endpoint
// When no server exists (static deployment, browser plugin,
// offline app) the free engine is called directly from the
// browser instead — pollinations accepts any origin.
// One image per request; this module loops so callers get
// progressive results (onImage) and can cancel mid-batch.
// ============================================================
import { fileToCanvas } from '../utils/canvas'

/**
 * Aspect presets — dimensions are multiples of 32 between 512 and
 * 2880 (≤ 4.2 MP) so every generation engine accepts them.
 */
export const AI_GEN_SIZES: { label: string; sub: string; size: string; w: number; h: number }[] = [
  { label: 'Square', sub: '1024 × 1024', size: '1024x1024', w: 1, h: 1 },
  { label: 'Portrait', sub: '768 × 1344', size: '768x1344', w: 9, h: 16 },
  { label: 'Portrait+', sub: '864 × 1152', size: '864x1152', w: 3, h: 4 },
  { label: 'Landscape', sub: '1344 × 768', size: '1344x768', w: 16, h: 9 },
  { label: 'Landscape+', sub: '1152 × 864', size: '1152x864', w: 4, h: 3 },
  { label: 'Wide', sub: '1472 × 736', size: '1472x736', w: 2, h: 1 },
  { label: 'Tall', sub: '736 × 1472', size: '736x1472', w: 1, h: 2 },
]

/** Style chips appended to the prompt (kept as modifiers, not overrides). */
export const AI_STYLE_PRESETS: { id: string; label: string; mod: string }[] = [
  { id: 'photo', label: 'Photorealistic', mod: 'photorealistic, professional photography, sharp focus, natural lighting, high detail' },
  { id: 'oil', label: 'Oil Painting', mod: 'oil painting, expressive brushwork, rich impasto texture, gallery quality' },
  { id: 'water', label: 'Watercolor', mod: 'delicate watercolor illustration, soft washes, paper grain, hand-painted' },
  { id: 'anime', label: 'Anime', mod: 'anime illustration, clean linework, cel shading, vibrant colors, studio quality' },
  { id: 'render', label: '3D Render', mod: '3D render, physically based materials, studio HDRI lighting, octane quality' },
  { id: 'concept', label: 'Concept Art', mod: 'cinematic concept art, dramatic composition, matte painting, epic scale' },
  { id: 'neon', label: 'Cyberpunk', mod: 'cyberpunk aesthetic, neon glow, rain-slick reflections, moody atmosphere' },
  { id: 'minimal', label: 'Minimalist', mod: 'minimalist design, clean composition, generous negative space, modern palette' },
]

export const AI_GEN_MAX_PROMPT = 600

export type AiGenProvider = 'pollinations' | 'custom'

/** User's own OpenAI-compatible endpoint config (persisted locally). */
export interface CustomGenConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const CUSTOM_LS_KEY = 'zphoto-ai-custom-provider'

export function loadCustomGenConfig(): CustomGenConfig {
  try {
    const raw = localStorage.getItem(CUSTOM_LS_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p && typeof p.baseUrl === 'string') {
        return { baseUrl: p.baseUrl, apiKey: String(p.apiKey ?? ''), model: String(p.model ?? '') }
      }
    }
  } catch { /* corrupted entry — fall through */ }
  return { baseUrl: '', apiKey: '', model: '' }
}

export function saveCustomGenConfig(cfg: CustomGenConfig) {
  try { localStorage.setItem(CUSTOM_LS_KEY, JSON.stringify(cfg)) } catch { /* storage unavailable */ }
}

export interface AiGenMeta {
  /** which engine actually produced the image: 'pollinations' | 'custom' */
  provider: string
  /** true when a fallback engine produced the image (reserved) */
  fallback?: boolean
}

export interface AiGenerateOptions {
  prompt: string
  /** one of AI_GEN_SIZES[].size — defaults to 1024x1024 */
  size?: string
  /** how many images to generate (sequential requests) */
  count?: number
  /** abort mid-batch */
  signal?: AbortSignal
  /** generation engine (default: free engine) */
  provider?: AiGenProvider
  /** custom endpoint config — required when provider === 'custom' */
  custom?: { baseUrl?: string; apiKey?: string; model?: string }
  /** fires as each image arrives (progressive UI) */
  onImage?: (dataUrl: string, index: number, total: number, meta?: AiGenMeta) => void
}

/** Generate `count` images for one prompt. Throws Error with .message on failure. */
export async function aiGenerate(opts: AiGenerateOptions): Promise<string[]> {
  const { prompt, size = '1024x1024', count = 1, signal, provider, custom, onImage } = opts
  const clean = prompt.trim()
  if (!clean) throw new Error('Enter a prompt first')
  if (clean.length > AI_GEN_MAX_PROMPT) throw new Error(`Prompt too long (max ${AI_GEN_MAX_PROMPT} chars)`)
  if (provider === 'custom' && !custom?.baseUrl?.trim()) {
    throw new Error('Custom API needs a base URL — fill in the endpoint fields first')
  }

  const out: string[] = []
  for (let i = 0; i < count; i++) {
    if (signal?.aborted) break
    let res: Response | null = null
    let serverApi = true
    try {
      res = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: clean, size, provider, custom }),
        signal,
      })
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e
      if (provider !== 'pollinations') {
        throw new Error('Could not reach the generation service — check your connection and try again')
      }
      // No server reachable (offline / static deployment / extension
      // context) — the free engine can be called directly from the
      // browser (it allows any origin).
      serverApi = false
    }
    if (serverApi && res && (res.status === 404 || res.status === 501)) {
      // The server app isn't there (static export / plugin build) —
      // fall back to the direct engine call below.
      serverApi = false
    }

    if (serverApi && res) {
      let data: any = null
      try { data = await res.json() } catch { /* non-JSON error body */ }
      if (res.ok && data?.image) {
        out.push(data.image as string)
        onImage?.(data.image as string, i, count, { provider: data.provider as string, fallback: !!data.fallback })
        continue
      }
      throw new Error(data?.error || `Generation failed (HTTP ${res.status})`)
    }

    // ---- direct engine fallback (no server) ----
    const dataUrl = await generateDirect(clean, size, signal)
    out.push(dataUrl)
    onImage?.(dataUrl, i, count, { provider: 'pollinations', fallback: true })
  }
  if (out.length === 0 && signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return out
}

/** Browser-direct Pollinations call — used when /api/ai-generate is
 *  unavailable (static hosting, browser plugin, or fully offline
 *  editor). Retries like the server route: the shared engine is often
 *  busy. Returns the image as a PNG data-URL. */
async function generateDirect(prompt: string, size: string, signal?: AbortSignal): Promise<string> {
  const m = size.match(/^(\d+)x(\d+)$/)
  const w = m ? Math.min(2880, Math.max(64, Number(m[1]))) : 1024
  const h = m ? Math.min(2880, Math.max(64, Number(m[2]))) : 1024
  const ATTEMPTS = 3
  let lastErr = ''
  for (let a = 0; a < ATTEMPTS; a++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const seed = Math.floor(Math.random() * 1e9)
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
      `?width=${w}&height=${h}&nologo=true&seed=${seed}`
    try {
      const res = await fetch(url, { signal, mode: 'cors' })
      if (!res.ok) { lastErr = `engine busy (HTTP ${res.status})`; await sleep(4000); continue }
      const blob = await res.blob()
      if (!blob.type.startsWith('image/')) { lastErr = 'engine busy (no image)'; await sleep(4000); continue }
      return await blobToDataUrl(blob)
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e
      lastErr = 'could not reach the free engine — check your connection'
      await sleep(3000)
    }
  }
  throw new Error(lastErr || 'generation failed')
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('could not read generated image'))
    fr.readAsDataURL(blob)
  })
}

/** data-URL → File (for openFiles(), drag-drop, downloads) — extension
 *  follows the data-URL's real mime (sniffed server-side). */
export async function dataUrlToFile(dataUrl: string, name = 'ai-generated.png'): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob()
  const mime = blob.type || 'image/png'
  if (mime === 'image/jpeg' && /\.png$/i.test(name)) name = name.replace(/\.png$/i, '.jpg')
  return new File([blob], name, { type: mime })
}

/** data-URL → HTMLCanvasElement (for engine.addLayerFromCanvas / addCanvasDocument) */
export async function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const blob = await (await fetch(dataUrl)).blob()
  return fileToCanvas(blob)
}

/** Combine prompt + active style modifiers. */
export function composePrompt(prompt: string, styleIds: string[]): string {
  const mods = AI_STYLE_PRESETS.filter(p => styleIds.includes(p.id)).map(p => p.mod)
  return [prompt.trim(), ...mods].filter(Boolean).join(', ')
}
