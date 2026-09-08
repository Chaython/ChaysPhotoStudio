'use client'
// ============================================================
// AI Generate dialog — text-to-image generation via /api/ai-generate.
// Prompt + style presets + aspect tiles + variation count; progressive
// results stream in one-by-one; each result can be placed as a layer,
// opened as a document, placed as a Smart Object, or downloaded.
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Sparkles, Layers, FilePlus2, Boxes, Download, Loader2, Ban, Info, Wand2,
  Cloud, Flower2, Plug,
} from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import {
  aiGenerate, composePrompt, dataUrlToCanvas, dataUrlToFile,
  AI_GEN_SIZES, AI_STYLE_PRESETS, AI_GEN_MAX_PROMPT,
  loadCustomGenConfig, saveCustomGenConfig, type AiGenProvider, type AiGenMeta, type CustomGenConfig,
} from '../../image-ops'
import { downloadBlob } from '../../utils/canvas'
import type { DialogProps } from './generic-dialogs'
import { cn } from '@/lib/utils'

const CHECKER = 'bg-[repeating-conic-gradient(#3a3a3a_0%_25%,#2c2c2c_0%_50%)] [background-size:12px_12px]'
const COUNTS = [1, 2, 4]

const ENGINES: { id: AiGenProvider; label: string; sub: string; icon: any }[] = [
  { id: 'zai', label: 'Z.AI Cloud', sub: 'Neural · auto-fallback', icon: Cloud },
  { id: 'pollinations', label: 'Pollinations', sub: 'Free · no key', icon: Flower2 },
  { id: 'custom', label: 'Custom API', sub: 'Your endpoint', icon: Plug },
]

function aspectBox(w: number, h: number) {
  const scale = Math.min(24 / w, 20 / h)
  return { width: `${Math.round(w * scale)}px`, height: `${Math.round(h * scale)}px` }
}

export function AiGenerateDialog({ onClose }: DialogProps) {
  const hasDoc = !!engine.activeDoc
  const [prompt, setPrompt] = useState('')
  const [styleIds, setStyleIds] = useState<string[]>([])
  const [size, setSize] = useState('1024x1024')
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [done, setDone] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [images, setImages] = useState<string[]>([])
  const [sel, setSel] = useState(0)
  const [placing, setPlacing] = useState(false)
  const [engineId, setEngineId] = useState<AiGenProvider>('zai')
  const [customCfg, setCustomCfg] = useState<CustomGenConfig>({ baseUrl: '', apiKey: '', model: '' })
  const [meta, setMeta] = useState<AiGenMeta | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // load persisted custom-endpoint config once
  useEffect(() => { setCustomCfg(loadCustomGenConfig()) }, [])
  const updateCustom = (patch: Partial<CustomGenConfig>) => {
    setCustomCfg(prev => { const next = { ...prev, ...patch }; saveCustomGenConfig(next); return next })
  }

  // elapsed timer while generating
  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [busy])

  useEffect(() => () => abortRef.current?.abort(), [])

  const generate = async () => {
    if (busy || placing) return
    if (!prompt.trim()) { setError('Describe what you want to generate.'); return }
    setError(null)
    setBusy(true)
    setElapsed(0)
    setDone(0)
    setImages([])
    setSel(0)
    setMeta(null)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const full = composePrompt(prompt, styleIds)
      const collected: string[] = []
      await aiGenerate({
        prompt: full, size, count, signal: ac.signal, provider: engineId,
        custom: engineId === 'custom' ? customCfg : undefined,
        onImage: (url, i, _total, m) => {
          collected.push(url)
          setImages([...collected])
          setSel(collected.length - 1)
          setDone(i + 1)
          if (m) setMeta(m)
        },
      })
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError(e?.message || 'Generation failed')
        useEditorStore.getState().pushToast('AI generation failed', 'error')
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const shortName = () => {
    const base = prompt.trim().slice(0, 28).replace(/[^a-z0-9 _-]/gi, '').trim() || 'Generated'
    return `AI — ${base}`
  }

  const place = async (mode: 'layer' | 'doc' | 'smart') => {
    const url = images[sel]
    if (!url || busy || placing) return
    if (mode !== 'doc' && !engine.activeDoc) {
      useEditorStore.getState().pushToast('No active document — use New Document instead', 'error')
      return
    }
    setPlacing(true)
    try {
      const canvas = await dataUrlToCanvas(url)
      const name = shortName()
      if (mode === 'doc') {
        engine.addCanvasDocument(canvas, name)
        useEditorStore.getState().pushToast(`Opened ${name} (${canvas.width} × ${canvas.height})`, 'success')
      } else if (mode === 'layer') {
        engine.addLayerFromCanvas(canvas, name)
        useEditorStore.getState().pushToast(`Added layer “${name}”`, 'success')
      } else {
        engine.placeSmartLayer(canvas, name)
        useEditorStore.getState().pushToast(`Placed “${name}” as Smart Object`, 'success')
      }
      onClose()
    } catch {
      useEditorStore.getState().pushToast('Failed to place the generated image', 'error')
    } finally {
      setPlacing(false)
    }
  }

  const download = async () => {
    const url = images[sel]
    if (!url) return
    try {
      const file = await dataUrlToFile(url, `${shortName()}.png`)
      downloadBlob(file, file.name)
    } catch {
      useEditorStore.getState().pushToast('Download failed', 'error')
    }
  }

  const toggleStyle = (id: string) =>
    setStyleIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])

  const current = images[sel]

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles size={15} className="text-primary" /> AI Generate
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-3 py-1">
        {/* engine */}
        <div className="space-y-1">
          <Label className="text-[11px]">Engine</Label>
          <div className="grid grid-cols-3 gap-1">
            {ENGINES.map(en => (
              <button
                key={en.id}
                className={cn('flex items-center gap-1.5 rounded border px-2 py-1.5 text-left text-[10px] transition-colors',
                  engineId === en.id ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent')}
                onClick={() => setEngineId(en.id)}
                disabled={busy}
                aria-pressed={engineId === en.id}
              >
                <en.icon size={13} className={engineId === en.id ? 'text-primary' : 'text-muted-foreground'} />
                <span className="min-w-0">
                  <span className="block font-medium leading-tight truncate">{en.label}</span>
                  <span className="block text-[9px] text-muted-foreground leading-tight truncate">{en.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* custom endpoint fields */}
        {engineId === 'custom' && (
          <div className="space-y-1.5 rounded border border-border bg-background/40 p-2">
            <div className="text-[10px] text-muted-foreground">
              OpenAI-compatible endpoint (POST <span className="font-mono">{'{base}'}/images/generations</span>). Stored only in this browser.
            </div>
            <input
              value={customCfg.baseUrl}
              onChange={e => updateCustom({ baseUrl: e.target.value })}
              placeholder="Base URL — e.g. https://api.openai.com/v1"
              className="w-full rounded border border-border bg-background/60 px-2 py-1.5 text-[11px] focus:outline-none focus:border-primary/60 placeholder:text-muted-foreground/60"
              disabled={busy}
              aria-label="Custom API base URL"
              spellCheck={false}
            />
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="password"
                value={customCfg.apiKey}
                onChange={e => updateCustom({ apiKey: e.target.value })}
                placeholder="API key (optional)"
                className="w-full rounded border border-border bg-background/60 px-2 py-1.5 text-[11px] focus:outline-none focus:border-primary/60 placeholder:text-muted-foreground/60"
                disabled={busy}
                aria-label="Custom API key"
                spellCheck={false}
              />
              <input
                value={customCfg.model}
                onChange={e => updateCustom({ model: e.target.value })}
                placeholder="Model (optional)"
                className="w-full rounded border border-border bg-background/60 px-2 py-1.5 text-[11px] focus:outline-none focus:border-primary/60 placeholder:text-muted-foreground/60"
                disabled={busy}
                aria-label="Custom API model"
                spellCheck={false}
              />
            </div>
          </div>
        )}

        {/* prompt */}
        <div className="space-y-1">
          <Label className="text-[11px] flex items-center justify-between">
            <span className="flex items-center gap-1.5"><Wand2 size={11} /> Prompt</span>
            <span className="text-muted-foreground font-mono">{prompt.length}/{AI_GEN_MAX_PROMPT}</span>
          </Label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value.slice(0, AI_GEN_MAX_PROMPT))}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void generate() }}
            rows={3}
            placeholder="A misty mountain lake at dawn, pine silhouettes, soft golden light…"
            className="w-full rounded border border-border bg-background/60 px-2.5 py-2 text-xs resize-none focus:outline-none focus:border-primary/60 placeholder:text-muted-foreground/60"
            disabled={busy}
            aria-label="Image generation prompt"
          />
        </div>

        {/* style presets */}
        <div className="space-y-1">
          <Label className="text-[11px]">Style <span className="text-muted-foreground font-normal">(optional modifiers)</span></Label>
          <div className="flex flex-wrap gap-1">
            {AI_STYLE_PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => toggleStyle(p.id)}
                disabled={busy}
                aria-pressed={styleIds.includes(p.id)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                  styleIds.includes(p.id)
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* aspect + count */}
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div className="space-y-1">
            <Label className="text-[11px]">Aspect</Label>
            <div className="grid grid-cols-7 gap-1">
              {AI_GEN_SIZES.map(s => (
                <button
                  key={s.size}
                  onClick={() => setSize(s.size)}
                  disabled={busy}
                  title={`${s.label} — ${s.sub}`}
                  aria-pressed={size === s.size}
                  className={cn(
                    'rounded border p-1.5 flex flex-col items-center gap-1 transition-colors',
                    size === s.size ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent',
                  )}
                >
                  <span className="flex items-center justify-center h-5">
                    <span className={cn('block rounded-[2px] border', size === s.size ? 'border-primary bg-primary/20' : 'border-current')} style={aspectBox(s.w, s.h)} />
                  </span>
                  <span className="text-[9px] leading-none truncate max-w-full">{s.label}</span>
                </button>
              ))}
            </div>
            <div className="text-[9px] text-muted-foreground font-mono">{AI_GEN_SIZES.find(s => s.size === size)?.sub}</div>
          </div>
          <div className="space-y-1 w-24">
            <Label className="text-[11px]">Variations</Label>
            <div className="grid grid-cols-3 gap-1">
              {COUNTS.map(c => (
                <button
                  key={c}
                  onClick={() => setCount(c)}
                  disabled={busy}
                  aria-pressed={count === c}
                  className={cn(
                    'h-7 rounded border text-[11px] font-mono transition-colors',
                    count === c ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent',
                  )}
                >
                  ×{c}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* generate / progress */}
        {busy ? (
          <div className="rounded border border-primary/40 bg-primary/5 px-2.5 py-2 space-y-1.5">
            <div className="flex items-center gap-2 text-[11px]">
              <Loader2 size={13} className="animate-spin text-primary" />
              <span className="text-primary">
                Generating image {done + 1} of {count}{engineId === 'zai' ? ' — neural engine' : engineId === 'pollinations' ? ' — free engine' : ' — your API'}…
              </span>
              <span className="ml-auto font-mono text-muted-foreground">{elapsed}s</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => abortRef.current?.abort()}>
                <Ban size={11} className="mr-1" /> Cancel
              </Button>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${(done / count) * 100}%` }} />
            </div>
            <div className="text-[9px] text-muted-foreground">
              {engineId === 'zai'
                ? 'Each image usually takes 30–60s. Z.AI auto-retries and falls back to the free Pollinations engine when busy.'
                : engineId === 'pollinations'
                  ? 'The free community engine — usually fast, sometimes queued. Output resolution is chosen by the engine.'
                  : 'Your endpoint — usually seconds. Requests retry once on transient errors.'}
            </div>
          </div>
        ) : (
          <Button size="sm" className="w-full" onClick={generate} disabled={!prompt.trim()}>
            <Sparkles size={13} className="mr-1.5" />
            Generate{count > 1 ? ` ${count} Images` : ' Image'}
          </Button>
        )}

        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {/* results */}
        {images.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-[11px] flex items-center justify-between">
              <span>Results</span>
              <span className="text-muted-foreground font-mono text-[10px]">
                {sel + 1}/{images.length}{meta?.provider === 'pollinations' ? ' · Pollinations' : meta?.provider === 'custom' ? ' · your API' : ''}
              </span>
            </Label>
            {meta?.fallback && (
              <div className="flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                <Info size={11} className="mt-0.5 flex-shrink-0" />
                <span>Z.AI was busy — this image came from the free Pollinations engine. Regenerate later for the neural engine, or upscale it with AI Upscale.</span>
              </div>
            )}
            <div className={cn('rounded border p-1.5 flex items-center justify-center', CHECKER)}>
              {current && (
                <img
                  src={current}
                  alt={`Generated result ${sel + 1} of ${images.length}`}
                  className="max-h-60 w-auto rounded-sm shadow"
                />
              )}
            </div>
            {images.length > 1 && (
              <div className="flex gap-1.5 flex-wrap">
                {images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setSel(i)}
                    aria-label={`Select result ${i + 1}`}
                    className={cn(
                      'w-12 h-12 rounded overflow-hidden border transition-all',
                      i === sel ? 'border-primary ring-1 ring-primary/60' : 'border-border hover:border-primary/40 opacity-80 hover:opacity-100',
                    )}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <Info size={11} className="mt-0.5 flex-shrink-0" />
          <span>Results arrive as lossless PNGs — place them as layers, Smart Objects or new documents. Ctrl+Enter generates.</span>
        </div>
      </div>

      <DialogFooter className="gap-1 flex-wrap sm:flex-nowrap">
        <div className="flex gap-1.5 flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => place('layer')} disabled={!current || busy || placing || !hasDoc}>
            {placing ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Layers size={13} className="mr-1.5" />}
            Layer
          </Button>
          <Button variant="secondary" size="sm" onClick={() => place('doc')} disabled={!current || busy || placing}>
            <FilePlus2 size={13} className="mr-1.5" /> New Doc
          </Button>
          <Button variant="secondary" size="sm" onClick={() => place('smart')} disabled={!current || busy || placing || !hasDoc}>
            <Boxes size={13} className="mr-1.5" /> Smart
          </Button>
          <Button variant="secondary" size="sm" onClick={download} disabled={!current || busy}>
            <Download size={13} className="mr-1.5" /> PNG
          </Button>
        </div>
        <Button size="sm" onClick={onClose} disabled={busy}>Close</Button>
      </DialogFooter>
    </>
  )
}
