'use client'
import type { AiProviderDescriptor, ComfyRunInput, ComfyRunResult, ComfyUiConfig } from './types'

const COMFY_KEY = 'zphoto-ai-comfy-provider-v1'

export const AI_PROVIDERS: AiProviderDescriptor[] = [
  {
    id: 'builtin', name: 'Built-in / Local', kind: 'builtin', local: true,
    description: 'Private on-device selections, masks, content-aware remove, smart upscale, depth, denoise, relight and vector-trace assists using the editor engine.',
    capabilities: ['select-subject', 'remove-background', 'smart-remove', 'upscale', 'depth', 'denoise', 'restore-face', 'relight', 'colorize', 'vectorize'],
  },
  {
    id: 'comfyui', name: 'ComfyUI', kind: 'comfyui', local: true,
    description: 'Run any local ComfyUI workflow for inpaint, outpaint, restoration, ControlNet, LoRA and more.',
    capabilities: ['generate', 'inpaint', 'outpaint', 'upscale', 'depth', 'caption', 'denoise', 'restore-face', 'relight', 'colorize', 'vectorize'],
  },
  {
    id: 'openai-compatible', name: 'OpenAI-compatible', kind: 'openai-compatible', local: false,
    description: 'Text-to-image through the existing configurable /images/generations API.',
    capabilities: ['generate'],
  },
]

export function loadComfyConfig(): ComfyUiConfig {
  try {
    const raw = localStorage.getItem(COMFY_KEY)
    if (raw) {
      const v = JSON.parse(raw)
      return {
        baseUrl: typeof v.baseUrl === 'string' ? v.baseUrl : 'http://127.0.0.1:8188',
        workflow: typeof v.workflow === 'string' ? v.workflow : '',
        workflows: v.workflows && typeof v.workflows === 'object' ? v.workflows : {},
        negativePrompt: typeof v.negativePrompt === 'string' ? v.negativePrompt : '',
      }
    }
  } catch { /* ignore corrupted settings */ }
  return { baseUrl: 'http://127.0.0.1:8188', workflow: '', workflows: {}, negativePrompt: '' }
}

export function saveComfyConfig(cfg: ComfyUiConfig) {
  try { localStorage.setItem(COMFY_KEY, JSON.stringify(cfg)) } catch { /* unavailable/quota */ }
}

export async function runComfyWorkflow(cfg: ComfyUiConfig, input: ComfyRunInput): Promise<ComfyRunResult> {
  if (!cfg.baseUrl.trim()) throw new Error('Set the ComfyUI base URL first')
  const workflow = (input.workflow ?? (input.capability ? cfg.workflows?.[input.capability] : undefined) ?? cfg.workflow).trim()
  if (!workflow) throw new Error('Import or paste a ComfyUI API workflow first')
  let parsed: unknown
  try { parsed = JSON.parse(workflow) } catch { throw new Error('ComfyUI workflow must be valid API-format JSON') }

  const res = await fetch('/api/ai-comfy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: input.signal,
    body: JSON.stringify({
      baseUrl: cfg.baseUrl,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt ?? cfg.negativePrompt,
      workflow: parsed,
      image: input.imageDataUrl,
      mask: input.maskDataUrl,
    }),
  })
  let body: any = null
  try { body = await res.json() } catch { /* no-op */ }
  if (!res.ok) throw new Error(body?.error || `ComfyUI request failed (HTTP ${res.status})`)
  if (!body?.image) throw new Error('ComfyUI completed without returning an image')
  return { image: body.image, promptId: String(body.promptId ?? ''), filename: body.filename }
}

/** Recursively list placeholder tokens a workflow uses so the UI can explain
 * why an imported workflow is not receiving the current image/mask/prompt. */
export function inspectComfyWorkflow(jsonText: string): string[] {
  const found = new Set<string>()
  let value: any
  try { value = JSON.parse(jsonText) } catch { return [] }
  const visit = (v: any) => {
    if (typeof v === 'string') {
      for (const token of ['{{PROMPT}}', '{{NEGATIVE_PROMPT}}', '{{IMAGE}}', '{{MASK}}']) if (v.includes(token)) found.add(token)
    } else if (Array.isArray(v)) v.forEach(visit)
    else if (v && typeof v === 'object') Object.values(v).forEach(visit)
  }
  visit(value)
  return [...found]
}
