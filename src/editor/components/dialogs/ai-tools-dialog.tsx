'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Cpu, Sparkles, Upload, Wand2, Scissors, Eraser, Maximize2, Boxes, Plug, FileJson, ShieldCheck, Layers3, ScanLine, SunMedium, ScanFace, Palette } from 'lucide-react'
import { engine } from '../../engine/engine'
import { getFlatComposite } from '../../engine/document'
import { useEditorStore } from '../../store'
import { createCanvas, ctx2d, getImageData } from '../../utils/canvas'
import { dataUrlToCanvas } from '../../image-ops'
import { AI_PROVIDERS, inspectComfyWorkflow, loadComfyConfig, runComfyWorkflow, saveComfyConfig } from '../../ai/providers'
import type { AiCapability, ComfyUiConfig } from '../../ai/types'
import type { DialogProps } from './generic-dialogs'
import { localColorize, localDepthMap, localDenoise, localPortraitRestore, localRelight, localVectorGuide } from '../../ai/local'

function canvasDataUrl(canvas: HTMLCanvasElement) { return canvas.toDataURL('image/png') }

function aiResultToSelectionMask(canvas: HTMLCanvasElement, width: number, height: number): Uint8ClampedArray {
  const normalized = canvas.width === width && canvas.height === height
    ? canvas
    : (() => {
        const out = createCanvas(width, height)
        const oc = ctx2d(out)
        oc.imageSmoothingEnabled = true
        oc.imageSmoothingQuality = 'high'
        oc.drawImage(canvas, 0, 0, width, height)
        return out
      })()
  const d = getImageData(normalized).data
  let transparent = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { transparent++; if (transparent > 16) break }
  const useAlpha = transparent > 16
  const mask = new Uint8ClampedArray(width * height)
  for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
    mask[i] = useAlpha
      ? d[j + 3]
      : Math.round(d[j] * .2126 + d[j + 1] * .7152 + d[j + 2] * .0722)
  }
  return mask
}

function selectionMaskDataUrl(): string | undefined {
  const doc = engine.activeDoc
  if (!doc?.selection) return undefined
  const src = getImageData(doc.selection.mask)
  const c = createCanvas(doc.width, doc.height)
  const out = ctx2d(c).createImageData(doc.width, doc.height)
  for (let i = 0, j = 3; i < doc.width * doc.height; i++, j += 4) {
    const v = src.data[j]
    const o = i * 4
    out.data[o] = v; out.data[o + 1] = v; out.data[o + 2] = v; out.data[o + 3] = 255
  }
  ctx2d(c).putImageData(out, 0, 0)
  return canvasDataUrl(c)
}

function pickJson(cb: (text: string, name: string) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    cb(await file.text(), file.name)
  }
  input.click()
}

function ToolCard({ icon: Icon, title, body, disabled, onClick }: {
  icon: any; title: string; body: string; disabled?: boolean; onClick: () => void
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className="rounded-md border border-border bg-panel/40 p-2.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45">
      <div className="flex items-center gap-1.5 text-[11px] font-medium"><Icon size={13} className="text-primary" />{title}</div>
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{body}</p>
    </button>
  )
}

export function AiToolsDialog({ onClose }: DialogProps) {
  const pushToast = useEditorStore(s => s.pushToast)
  const hasSelection = useEditorStore(s => s.hasSelection)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [cfg, setCfg] = useState<ComfyUiConfig>({ baseUrl: 'http://127.0.0.1:8188', workflow: '', workflows: {}, negativePrompt: '' })
  const [capability, setCapability] = useState<AiCapability | 'custom'>('inpaint')
  const [prompt, setPrompt] = useState('')
  const [useImage, setUseImage] = useState(true)
  const [useMask, setUseMask] = useState(true)
  const [resultMode, setResultMode] = useState<'layer' | 'smart' | 'document'>('layer')
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => { setCfg(loadComfyConfig()) }, [])
  useEffect(() => () => abortRef.current?.abort(), [])
  const activeWorkflow = capability === 'custom' ? cfg.workflow : (cfg.workflows?.[capability] || '')
  const tokens = useMemo(() => inspectComfyWorkflow(activeWorkflow), [activeWorkflow])
  const updateCfg = (patch: Partial<ComfyUiConfig>) => setCfg(prev => {
    const next = { ...prev, ...patch }
    saveComfyConfig(next)
    return next
  })

  const builtIn = async (op: 'subject' | 'background' | 'remove' | 'upscale' | 'depth' | 'denoise' | 'relight' | 'vector-guide' | 'restore' | 'colorize') => {
    const doc = engine.activeDoc
    if (!doc) { pushToast('Open an image first', 'error'); return }
    setBusy(true); setProgress(0)
    try {
      if (op === 'subject') {
        engine.selectSubject()
      } else if (op === 'background') {
        const layer = engine.activeLayer
        if (!layer) throw new Error('Select a layer first')
        engine.selectSubject()
        engine.addLayerMask(layer.id, true)
        pushToast('Background hidden with an editable layer mask', 'success')
      } else if (op === 'remove') {
        if (!doc.selection) throw new Error('Make a selection around the object to remove first')
        await engine.contentAwareFill(p => setProgress(Math.round(p * 100)))
        pushToast('Selected object removed using local content-aware synthesis', 'success')
      } else if (op === 'upscale') {
        await engine.aiUpscale({ scale: 2, detail: 60, denoise: 18, onProgress: p => setProgress(Math.round(p * 100)) })
      } else {
        const flat = getFlatComposite(doc)
        if (op === 'depth') engine.addLayerFromCanvas(localDepthMap(flat), 'Local Depth Map')
        else if (op === 'denoise') engine.addLayerFromCanvas(localDenoise(flat, 42), 'AI Assist — Denoised')
        else if (op === 'relight') { const depth = localDepthMap(flat); engine.addLayerFromCanvas(localRelight(flat, depth, 38), 'AI Assist — Relit') }
        else if (op === 'restore') engine.addLayerFromCanvas(localPortraitRestore(flat, 58), 'AI Assist — Portrait Restore')
        else if (op === 'colorize') engine.addLayerFromCanvas(localColorize(flat, 58), 'AI Assist — Colorized')
        else engine.addLayerFromCanvas(localVectorGuide(flat), 'Vector Trace Guide')
      }
    } catch (err: any) {
      pushToast(err?.message || 'AI tool failed', 'error')
    } finally { setBusy(false); setProgress(0) }
  }

  const comfyRun = async () => {
    const doc = engine.activeDoc
    if (!doc) { pushToast('Open an image first', 'error'); return }
    setBusy(true); setProgress(15)
    const ac = new AbortController(); abortRef.current = ac
    try {
      const input = useImage ? canvasDataUrl(getFlatComposite(doc)) : undefined
      const mask = useMask ? selectionMaskDataUrl() : undefined
      setProgress(30)
      const result = await runComfyWorkflow(cfg, { prompt, capability: capability === 'custom' ? undefined : capability, workflow: activeWorkflow, imageDataUrl: input, maskDataUrl: mask, signal: ac.signal })
      setProgress(90)
      const canvas = await dataUrlToCanvas(result.image)
      const activeCapability = capability === 'custom' ? null : capability

      if (activeCapability === 'select-subject') {
        const mask = aiResultToSelectionMask(canvas, doc.width, doc.height)
        engine.setSelectionAlpha(mask, 'new', 'AI Select Subject')
        pushToast('ComfyUI segmentation applied as an editable selection', 'success')
      } else {
        const fallbackTitle = activeCapability === 'remove-background'
          ? 'Background Removed'
          : activeCapability === 'smart-remove'
            ? 'Smart Remove'
            : 'ComfyUI Result'
        const name = `AI — ${prompt.trim().slice(0, 28) || fallbackTitle}`
        if (resultMode === 'document') engine.addCanvasDocument(canvas, name)
        else if (resultMode === 'smart') engine.placeSmartLayer(canvas, name)
        else engine.addLayerFromCanvas(canvas, name)
        pushToast(`ComfyUI result added (${canvas.width} × ${canvas.height})`, 'success')
      }
      setProgress(100)
    } catch (err: any) {
      if (err?.name !== 'AbortError') pushToast(err?.message || 'ComfyUI workflow failed', 'error')
    } finally { setBusy(false); abortRef.current = null; setTimeout(() => setProgress(0), 400) }
  }

  return (
    <>
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles size={15} className="text-primary" />AI Tools</DialogTitle></DialogHeader>
      <Tabs defaultValue="local" className="min-h-[420px]">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="local" className="text-[11px]"><Cpu size={12} className="mr-1" />Local</TabsTrigger>
          <TabsTrigger value="comfy" className="text-[11px]"><Plug size={12} className="mr-1" />ComfyUI</TabsTrigger>
          <TabsTrigger value="providers" className="text-[11px]"><Boxes size={12} className="mr-1" />Providers</TabsTrigger>
        </TabsList>

        <TabsContent value="local" className="space-y-3 pt-2">
          <div className="rounded border border-primary/25 bg-primary/5 p-2 text-[10px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">Private by default.</span> These operations run in the editor and do not upload the image. AI outputs stay editable as selections, masks or layers.
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ToolCard icon={Wand2} title="Select Subject" body="Build an editable grayscale selection from local saliency, edge and color analysis." disabled={busy} onClick={() => void builtIn('subject')} />
            <ToolCard icon={Scissors} title="Remove Background" body="Select the subject and attach the result as a non-destructive layer mask." disabled={busy || !engine.activeLayer} onClick={() => void builtIn('background')} />
            <ToolCard icon={Eraser} title="Smart Remove" body="Use the current selection as an object-removal region and synthesize replacement texture locally." disabled={busy || !hasSelection} onClick={() => void builtIn('remove')} />
            <ToolCard icon={Maximize2} title="2× Smart Upscale" body="Lanczos reconstruction plus denoise and edge-adaptive detail enhancement while preserving layers." disabled={busy} onClick={() => void builtIn('upscale')} />
            <ToolCard icon={Layers3} title="Depth Map" body="Create an editable local depth-like grayscale layer for blur, masks and relighting. Neural depth can override this via ComfyUI." disabled={busy} onClick={() => void builtIn('depth')} />
            <ToolCard icon={ScanLine} title="Denoise Assist" body="Create a cleaned layer using robust median + light Gaussian suppression without touching the source." disabled={busy} onClick={() => void builtIn('denoise')} />
            <ToolCard icon={SunMedium} title="Depth Relight" body="Estimate depth locally and create a relit result on a new layer for further masking and blending." disabled={busy} onClick={() => void builtIn('relight')} />
            <ToolCard icon={ScanFace} title="Portrait Restore Assist" body="Locally suppress flat-region noise and recover edge/detail contrast with a portrait-aware heuristic. Output stays on a new editable layer." disabled={busy} onClick={() => void builtIn('restore')} />
            <ToolCard icon={Palette} title="Colorize Assist" body="Add restrained color to grayscale or low-chroma photos with a deterministic local luminance/spatial prior. Use ComfyUI for semantic neural colorization." disabled={busy} onClick={() => void builtIn('colorize')} />
            <ToolCard icon={Wand2} title="Vector Trace Guide" body="Generate a high-contrast edge layer that is easy to convert to selections or trace with the Pen tool." disabled={busy} onClick={() => void builtIn('vector-guide')} />
          </div>
          <p className="text-[10px] text-muted-foreground">Local restore/colorize are deterministic editing assists rather than semantic neural models. For neural inpainting, face restoration, semantic colorization, ControlNet, depth models, LoRAs and diffusion upscalers, use the ComfyUI tab with your local workflow.</p>
        </TabsContent>

        <TabsContent value="comfy" className="space-y-2.5 pt-2">
          <div className="grid grid-cols-[1fr_auto] gap-1.5">
            <input value={cfg.baseUrl} onChange={e => updateCfg({ baseUrl: e.target.value })} disabled={busy}
              className="h-8 rounded border border-border bg-background px-2 text-[11px] font-mono" placeholder="http://127.0.0.1:8188" />
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => pickJson((text, name) => {
              try {
                JSON.parse(text)
                if (capability === 'custom') updateCfg({ workflow: text })
                else updateCfg({ workflows: { ...(cfg.workflows || {}), [capability]: text } })
                pushToast(`Loaded ${name} for ${capability}`, 'success')
              } catch { pushToast('That file is not valid JSON', 'error') }
            })}><Upload size={12} className="mr-1" />Workflow</Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {(['select-subject','remove-background','smart-remove','inpaint','outpaint','upscale','depth','denoise','restore-face','relight','colorize','vectorize','caption','custom'] as const).map(c => <button key={c} type="button" onClick={() => setCapability(c)} className={`rounded border px-1.5 py-1 text-[9px] ${capability === c ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>{c}</button>)}
          </div>
          <div className="rounded border border-border p-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[10px] flex items-center gap-1"><FileJson size={11} />API workflow placeholders</Label>
              <span className="text-[9px] text-muted-foreground">{activeWorkflow ? `${Math.max(1, Math.round(activeWorkflow.length / 1024))} KB · ${capability}` : `no ${capability} workflow`}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {['{{PROMPT}}', '{{NEGATIVE_PROMPT}}', '{{IMAGE}}', '{{MASK}}'].map(t => <code key={t} className={`rounded px-1 py-0.5 text-[9px] ${tokens.includes(t) ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{t}</code>)}
            </div>
            <p className="mt-1 text-[9px] leading-snug text-muted-foreground">Export a workflow in ComfyUI API format and replace the appropriate text/image-loader values with these tokens. The editor uploads the current composite and selection mask before queuing it.</p>
          </div>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} disabled={busy} rows={3} placeholder="Prompt / edit instruction…"
            className="w-full rounded border border-border bg-background p-2 text-[11px]" />
          <input value={cfg.negativePrompt} onChange={e => updateCfg({ negativePrompt: e.target.value })} disabled={busy}
            className="h-8 w-full rounded border border-border bg-background px-2 text-[11px]" placeholder="Negative prompt (optional)" />
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <label className="flex items-center gap-2"><Checkbox checked={useImage} onCheckedChange={v => setUseImage(v === true)} />Send current composite</label>
            <label className="flex items-center gap-2"><Checkbox checked={useMask} onCheckedChange={v => setUseMask(v === true)} />Send current selection mask</label>
          </div>
          {capability === 'select-subject' ? (
            <div className="rounded border border-primary/20 bg-primary/5 px-2 py-1.5 text-[10px] text-muted-foreground">
              Result is interpreted as a segmentation mask: transparency is used when present, otherwise grayscale luminance becomes the editable selection.
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="text-muted-foreground">Result:</span>
              {(['layer', 'smart', 'document'] as const).map(v => <button key={v} type="button" onClick={() => setResultMode(v)} className={`rounded border px-2 py-1 ${resultMode === v ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>{v === 'smart' ? 'Smart Object' : v === 'document' ? 'New Document' : 'New Layer'}</button>)}
            </div>
          )}
          {progress > 0 && <Progress value={progress} className="h-1.5" />}
          <div className="flex justify-between gap-2">
            <Button variant="secondary" size="sm" disabled={!busy} onClick={() => abortRef.current?.abort()}>Cancel Run</Button>
            <Button size="sm" disabled={busy || !activeWorkflow.trim()} onClick={() => void comfyRun()}><Sparkles size={12} className="mr-1" />Run Workflow</Button>
          </div>
        </TabsContent>

        <TabsContent value="providers" className="space-y-2 pt-2">
          {AI_PROVIDERS.map(p => <div key={p.id} className="rounded border border-border bg-panel/30 p-2.5">
            <div className="flex items-center gap-2"><span className="text-[11px] font-medium">{p.name}</span>{p.local && <span className="rounded bg-emerald-500/10 px-1 text-[9px] text-emerald-400">local</span>}</div>
            <p className="mt-1 text-[10px] text-muted-foreground">{p.description}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">{p.capabilities.map(c => <span key={c} className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{c}</span>)}</div>
          </div>)}
          <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground"><ShieldCheck size={12} className="mt-0.5 text-primary" />The desktop ComfyUI bridge accepts localhost by default. Remote AI hosts require an explicit server opt-in, preventing a public web deployment from becoming an unrestricted network proxy.</p>
        </TabsContent>
      </Tabs>
      <DialogFooter><Button variant="secondary" size="sm" onClick={onClose}>Close</Button></DialogFooter>
    </>
  )
}
