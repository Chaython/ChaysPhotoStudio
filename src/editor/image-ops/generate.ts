// ============================================================
// AI Image Generation — client-side helper for text-to-image.
// Talks to /api/ai-generate (server-only SDK / providers):
//   zai           — Z.AI neural engine (default, auto-retries,
//                   auto-falls-back to Pollinations when flaky)
//   pollinations  — free community engine, no key, any size
//   custom        — user's own OpenAI-compatible endpoint
// One image per request; this module loops so callers get
// progressive results (onImage) and can cancel mid-batch.
// ============================================================
import { fileToCanvas } from '../utils/canvas'

/**
 * Aspect presets. IMPORTANT: Z.AI rejects 1440x720 / 720x1440
 * (dimensions must be multiples of 32 — 720 is not; upstream error
 * code 1214). 2:1 / 1:2 use 1472x736 / 736x1472 instead.
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

export type AiGenProvider = 'zai' | 'pollinations' | 'custom'

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
  /** which engine actually produced the image: 'zai' | 'pollinations' | 'custom' */
  provider: string
  /** true when the primary engine failed and a fallback engine produced it */
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
  /** generation engine (default: zai with automatic pollinations fallback) */
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
    let res: Response
    try {
      res = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: clean, size, provider, custom }),
        signal,
      })
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e
      throw new Error('Could not reach the generation service — check your connection and try again')
    }
    let data: any = null
    try { data = await res.json() } catch { /* non-JSON error body */ }
    if (!res.ok || !data?.image) {
      throw new Error(data?.error || `Generation failed (HTTP ${res.status})`)
    }
    out.push(data.image as string)
    onImage?.(data.image as string, i, count, { provider: data.provider as string, fallback: !!data.fallback })
  }
  if (out.length === 0 && signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return out
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
