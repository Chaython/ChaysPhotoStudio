// Unified AI capability/provider types. UI code asks for a capability; the
// provider implementation decides whether it runs in-browser, in Electron, or
// through an external engine such as ComfyUI.
export type AiCapability =
  | 'select-subject'
  | 'remove-background'
  | 'smart-remove'
  | 'generate'
  | 'inpaint'
  | 'outpaint'
  | 'upscale'
  | 'depth'
  | 'caption'
  | 'denoise'
  | 'restore-face'
  | 'relight'
  | 'colorize'
  | 'vectorize'

export type AiProviderKind = 'builtin' | 'comfyui' | 'openai-compatible' | 'native'

export interface AiProviderDescriptor {
  id: string
  name: string
  kind: AiProviderKind
  description: string
  local: boolean
  capabilities: AiCapability[]
}

export interface ComfyUiConfig {
  baseUrl: string
  /** Default/custom workflow kept for backward compatibility. */
  workflow: string
  /** Optional saved API workflows by editing capability. */
  workflows?: Partial<Record<AiCapability, string>>
  negativePrompt: string
}

export interface ComfyRunInput {
  prompt: string
  negativePrompt?: string
  workflow?: string
  capability?: AiCapability
  imageDataUrl?: string
  maskDataUrl?: string
  signal?: AbortSignal
}

export interface ComfyRunResult {
  image: string
  promptId: string
  filename?: string
}
