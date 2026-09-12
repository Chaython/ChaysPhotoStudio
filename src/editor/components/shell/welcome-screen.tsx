'use client'
// ============================================================
// Welcome screen — landing view when no document is open (TASK 2-E)
// Hero · drop-zone · 3 primary actions · 10-second tutorial ·
// capability grid. All handlers preserved: openFiles,
// openDialog('new-doc'), sample artwork generator, drag & drop.
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../../store'
import { engine } from '../../engine/engine'
import { openFiles } from '../../engine/io'
import { IMPORT_ACCEPT } from '../../formats'
import { setActiveTool } from '../../tools/registry'
import { aiGenerate, dataUrlToFile, AI_GEN_SIZES, loadCustomGenConfig, saveCustomGenConfig, type AiGenProvider, type CustomGenConfig } from '../../image-ops'
import { downloadBlob } from '../../utils/canvas'
import type { ToolId } from '../../types'
import {
  ImagePlus, FilePlus2, Sparkles, Layers, Lasso, ArrowRight, CloudUpload, Keyboard,
  ScanSearch, Bandage, Palette, Workflow, Timer, Sliders,
  Loader2, RefreshCw, Download, Ban, MonitorDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function WelcomeScreen() {
  const openDialog = useEditorStore(s => s.openDialog)
  const fileRef = useRef<HTMLInputElement>(null)
  const sourceZipRef = useRef<HTMLAnchorElement>(null)
  const [dragging, setDragging] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<(Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null>(null)

  // Source-zip link: static deployments (GitHub Pages, browser plugin)
  // don't ship the 1 MB project archive — fall back to GitHub's
  // auto-generated source archive of the default branch. That URL is
  // version-independent and always resolves (raw file URLs 404 for
  // build artifacts that are never committed).
  useEffect(() => {
    const a = sourceZipRef.current
    if (!a) return
    const probe = async () => {
      try {
        const res = await fetch(a.getAttribute('href') || '', { method: 'HEAD' })
        if (!res.ok) throw new Error('missing')
      } catch {
        a.setAttribute('href', 'https://github.com/Chaython/ChaysPhotoStudio/archive/refs/heads/main.zip')
      }
    }
    void probe()
  }, [])

  // PWA install offer — the browser only fires beforeinstallprompt on
  // https (or localhost) installs with a valid manifest + service worker.
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallPrompt(e as never) }
    const onInstalled = () => setInstallPrompt(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const installApp = async () => {
    const evt = installPrompt
    if (!evt) return
    setInstallPrompt(null)
    try {
      await evt.prompt()
      const { outcome } = await evt.userChoice
      if (outcome === 'accepted') useEditorStore.getState().pushToast("Installing Chay's Photo Studio — check your desktop.", 'success')
    } catch { /* user dismissed */ }
  }

  const selectTool = (id: ToolId) => {
    const s = useEditorStore.getState()
    s.setTool(id)
    setActiveTool(id)
    ;(engine as any)._activeToolId = id
  }

  const onDrop = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation() // the global window handler already opens drops — don't double-open
    setDragging(false)
    if (e.dataTransfer?.files?.length) openFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto zphoto-scroll">
      <div className="w-full max-w-2xl my-auto">

        {/* ================= hero ================= */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/90 to-primary text-primary-foreground shadow-lg shadow-primary/20 mb-3">
            <span className="text-2xl font-black tracking-tight">C</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Chay's Photo Studio</h1>
          <p className="text-xs text-muted-foreground mt-1">
            A Photoshop-class editor that runs entirely in your browser.
          </p>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
            <Badge>Layers &amp; masks</Badge>
            <Badge>Smart objects</Badge>
            <Badge>On-device</Badge>
          </div>
          {installPrompt && (
            <button
              type="button"
              onClick={() => void installApp()}
              className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-full border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
            >
              <MonitorDown size={12} aria-hidden />
              Install as an app
            </button>
          )}
          <p className="text-[9px] text-muted-foreground/60 mt-1.5">
            © Chaython Meredith 2026 · Free for consumer use · Commercial use requires a license
          </p>
        </div>

        {/* ================= drop zone ================= */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragEnter={() => setDragging(true)}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
          onDrop={onDrop}
          className={cn(
            'w-full h-20 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer',
            dragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40 hover:bg-accent/30'
          )}
          aria-label="Drop images here or click to browse"
        >
          <span className="flex items-center gap-2 text-xs">
            <CloudUpload size={16} className="text-primary" />
            <span className="font-medium">Drop images here — or click to browse</span>
          </span>
          <span className="text-[10px] text-muted-foreground">PNG · JPEG · WebP · .zproj.json</span>
        </button>

        {/* ================= AI generation ================= */}
        <AiGeneratorCard />

        {/* ================= primary actions ================= */}
        <div className="mt-3 grid sm:grid-cols-3 gap-2.5">
          <WelcomeAction
            icon={ImagePlus}
            title="Open Image"
            desc="From your device"
            onClick={() => fileRef.current?.click()}
            primary
          />
          <WelcomeAction
            icon={FilePlus2}
            title="New Document"
            desc="Presets & custom sizes"
            onClick={() => openDialog('new-doc')}
          />
          <WelcomeAction
            icon={Sparkles}
            title="Sample Artwork"
            desc="Generated demo canvas"
            onClick={() => {
              const w = 1600, h = 1000
              const doc = engine.newDocument({ name: 'Sample Artwork', width: w, height: h, fill: 'transparent' })
              // generate a gradient + shapes sample
              const layer = doc.layers[0]
              const c = layer.canvas!.getContext('2d')!
              const grad = c.createLinearGradient(0, 0, w, h)
              grad.addColorStop(0, '#1a1a24')
              grad.addColorStop(0.5, '#2d2a3a')
              grad.addColorStop(1, '#12131c')
              c.fillStyle = grad
              c.fillRect(0, 0, w, h)
              for (let i = 0; i < 60; i++) {
                const x = Math.random() * w, y = Math.random() * h
                const r = 20 + Math.random() * 140
                const hue = 20 + Math.random() * 60
                c.beginPath()
                c.arc(x, y, r, 0, Math.PI * 2)
                c.fillStyle = `hsla(${hue}, 70%, ${45 + Math.random() * 25}%, ${0.06 + Math.random() * 0.12})`
                c.fill()
              }
              c.fillStyle = '#e8a33d'
              c.font = '700 italic 72px Georgia, serif'
              c.fillText('Create.', 120, h / 2 - 40)
              c.fillStyle = '#f5f0e8'
              c.font = '300 30px Georgia, serif'
              c.fillText('Every pixel processed on-device.', 124, h / 2 + 14)
              layer._v++
              engine.pushHistory('Sample Artwork')
              engine.emit()
            }}
          />
        </div>

        {/* ================= 10-second tutorial ================= */}
        <div className="mt-6 rounded-xl border bg-panel p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-2.5">
            <Timer size={12} className="text-primary" />
            <span>Try it in 10 seconds</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-stretch gap-2">
            <TutorialStep n={1} icon={ImagePlus} title="Open an image" hint="Drop it above, or Ctrl+O" onClick={() => fileRef.current?.click()} />
            <ArrowRight size={14} className="hidden sm:block self-center shrink-0 text-muted-foreground/60" />
            <TutorialStep n={2} icon={Lasso} title="Lasso a subject" hint="Press L to cycle select tools" onClick={() => selectTool('lasso')} />
            <ArrowRight size={14} className="hidden sm:block self-center shrink-0 text-muted-foreground/60" />
            <TutorialStep n={3} icon={Sliders} title="Add a filter" hint="Filters menu or Adjustments panel" onClick={() => useEditorStore.getState().setRightPanelTab('adjustments')} />
          </div>
        </div>

        {/* ================= capability grid ================= */}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <Capability icon={ScanSearch} title="AI Selections" sub="Subject · Quick · Wand" />
          <Capability icon={Bandage} title="Retouch & Heal" sub="Clone · Patch · CAF" />
          <Capability icon={Layers} title="Non-Destructive" sub="Masks · Smart filters" />
          <Capability icon={Palette} title="Color Engineering" sub="Curves · Selective" />
          <Capability icon={Workflow} title="Automation" sub="Actions · Batch · Script" />
        </div>

        {/* ================= footer ================= */}
        <div className="mt-6 flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Keyboard size={11} className="text-primary/70" />
            <span className="font-mono">V · M · B · [ ] · X · Ctrl+Z</span>
          </span>
          <button className="underline underline-offset-2 hover:text-foreground transition-colors" onClick={() => openDialog('shortcuts')}>
            View all shortcuts
          </button>
          <span aria-hidden="true" className="opacity-40">·</span>
          <a
            ref={sourceZipRef}
            href="/chays-photo-studio-1.1.3-project.zip"
            download
            className="flex items-center gap-1 underline underline-offset-2 hover:text-foreground transition-colors"
          >
            <Download size={11} className="text-primary/70" aria-hidden="true" />
            Download source (ZIP)
          </a>
          <span aria-hidden="true" className="opacity-40">·</span>
          <a
            href="https://github.com/Chaython/ChaysPhotoStudio/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            Desktop &amp; plugin builds
          </a>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={`${IMPORT_ACCEPT},.zproj.json`}
          multiple
          className="hidden"
          onChange={e => { if (e.target.files?.length) openFiles(Array.from(e.target.files)); e.target.value = '' }}
        />
      </div>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="border rounded px-1.5 py-px bg-accent/50">{children}</span>
}

// ============================================================
// AI Generator card — text-to-image on the home screen. Generates
// via /api/ai-generate, previews the PNG, then hands it to the
// standard openFiles() pipeline (new document, history, viewport).
// ============================================================
const AI_HOME_SIZES = ['1024x1024', '864x1152', '768x1344', '1152x864', '1472x736']
const CHECKER = 'bg-[repeating-conic-gradient(#3a3a3a_0%_25%,#2c2c2c_0%_50%)] [background-size:12px_12px]'

function miniBox(w: number, h: number) {
  const scale = Math.min(18 / w, 14 / h)
  return { width: `${Math.round(w * scale)}px`, height: `${Math.round(h * scale)}px` }
}

function AiGeneratorCard() {
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState('1024x1024')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [engineId, setEngineId] = useState<AiGenProvider>('pollinations')
  const [customCfg, setCustomCfg] = useState<CustomGenConfig>({ baseUrl: '', apiKey: '', model: '' })
  const abortRef = useRef<AbortController | null>(null)

  // load persisted custom-endpoint config once
  useEffect(() => { setCustomCfg(loadCustomGenConfig()) }, [])
  const updateCustom = (patch: Partial<CustomGenConfig>) => {
    setCustomCfg(prev => { const next = { ...prev, ...patch }; saveCustomGenConfig(next); return next })
  }

  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [busy])

  useEffect(() => () => abortRef.current?.abort(), [])

  const generate = async () => {
    if (busy) return
    if (!prompt.trim()) { setError('Describe what you want to create first.'); return }
    if (engineId === 'custom' && !customCfg.baseUrl.trim()) { setError('Custom API needs a base URL — pick a different engine or fill in the endpoint.'); return }
    setError(null)
    setBusy(true)
    setElapsed(0)
    setImage(null)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const [url] = await aiGenerate({
        prompt: prompt.trim(), size, signal: ac.signal, provider: engineId,
        custom: engineId === 'custom' ? customCfg : undefined,
      })
      setImage(url)
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e?.message || 'Generation failed — try again')
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const fileName = () =>
    `ai-${prompt.trim().slice(0, 24).replace(/[^a-z0-9 _-]/gi, '').trim() || 'generated'}.png`

  const openInEditor = async () => {
    if (!image) return
    try {
      const file = await dataUrlToFile(image, fileName())
      await openFiles([file])
    } catch {
      setError('Could not open the generated image')
    }
  }

  const download = async () => {
    if (!image) return
    try {
      const file = await dataUrlToFile(image, fileName())
      downloadBlob(file, file.name)
    } catch {
      setError('Download failed')
    }
  }

  return (
    <div
      className="mt-3 rounded-xl border border-primary/30 bg-gradient-to-b from-primary/[0.08] to-transparent p-3.5 space-y-2.5"
      role="region"
      aria-label="AI image generation"
    >
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center flex-shrink-0">
          <Sparkles size={14} className="text-primary" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold leading-tight">Generate with AI</div>
          <div className="text-[10px] text-muted-foreground leading-tight">Describe an image — then open it as an editable document</div>
        </div>
        <span className="ml-auto text-[9px] text-primary/80 border border-primary/30 rounded px-1.5 py-px bg-primary/5 flex-shrink-0">text → image</span>
      </div>

      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value.slice(0, 600))}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void generate() }}
        rows={2}
        placeholder="A golden retriever astronaut floating over neon coral reefs, cinematic, ultra-detailed…"
        className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-xs resize-none focus:outline-none focus:border-primary/60 placeholder:text-muted-foreground/60"
        disabled={busy}
        aria-label="AI generation prompt"
      />

      {/* engine selector */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-muted-foreground">Engine</span>
        {([['pollinations', 'Free'], ['custom', 'My API']] as [AiGenProvider, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setEngineId(id)}
            disabled={busy}
            aria-pressed={engineId === id}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-[10px] transition-colors',
              engineId === id
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
            title={id === 'pollinations' ? 'Pollinations — free community engine, no API key' : 'Your own OpenAI-compatible endpoint (configured in the AI Generate dialog or below)'}
          >
            {label}
          </button>
        ))}
      </div>

      {/* custom endpoint fields (compact) */}
      {engineId === 'custom' && (
        <div className="space-y-1.5 rounded-lg border border-border bg-background/40 p-2">
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
          <div className="text-[9px] text-muted-foreground">OpenAI-compatible · POST <span className="font-mono">{'{base}'}/images/generations</span> · stored only in this browser</div>
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {AI_GEN_SIZES.filter(s => AI_HOME_SIZES.includes(s.size)).map(s => (
          <button
            key={s.size}
            onClick={() => setSize(s.size)}
            disabled={busy}
            title={`${s.label} — ${s.sub}`}
            aria-pressed={size === s.size}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors',
              size === s.size ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <span className={cn('block rounded-[2px] border', size === s.size ? 'border-primary bg-primary/20' : 'border-current')} style={miniBox(s.w, s.h)} />
            <span className="text-[10px]">{s.label}</span>
          </button>
        ))}
        <span className="flex-1" />
        {busy ? (
          <button
            onClick={() => abortRef.current?.abort()}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 h-8 text-[11px] text-muted-foreground hover:bg-accent transition-colors"
          >
            <Ban size={12} /> Cancel
          </button>
        ) : (
          <button
            onClick={() => void generate()}
            disabled={!prompt.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3.5 h-8 text-[11px] font-medium hover:bg-primary/90 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all"
          >
            <Sparkles size={12} /> Generate
          </button>
        )}
      </div>

      {busy && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 flex flex-col gap-1 text-[11px]">
          <div className="flex items-center gap-2">
            <Loader2 size={13} className="animate-spin text-primary" />
            <span className="text-primary">Painting your image…</span>
            <span className="ml-auto font-mono text-muted-foreground">{elapsed}s</span>
          </div>
          <div className="text-[9px] text-muted-foreground">
            {engineId === 'pollinations'
              ? 'The free engine is usually fast, sometimes queued.'
              : 'Your endpoint should answer in seconds.'}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[10px] text-destructive">
          {error}
        </div>
      )}

      {image && !busy && (
        <div className="space-y-2">
          <div className={cn('rounded-lg border p-1.5 flex items-center justify-center', CHECKER)}>
            <img src={image} alt="AI-generated result" draggable={false} className="max-h-56 w-auto rounded shadow" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void openInEditor()}
              className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3.5 h-8 text-[11px] font-medium hover:bg-primary/90 active:scale-95 transition-all"
            >
              Open in Editor <ArrowRight size={12} />
            </button>
            <button
              onClick={() => void generate()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 h-8 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <RefreshCw size={12} /> Regenerate
            </button>
            <button
              onClick={() => void download()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 h-8 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="Download generated PNG"
            >
              <Download size={12} /> PNG
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function WelcomeAction({ icon: Icon, title, desc, onClick, primary }: {
  icon: any
  title: string
  desc: string
  onClick(): void
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`group rounded-xl border p-3.5 text-left transition-all hover:-translate-y-0.5 ${
        primary ? 'border-primary/40 bg-primary/5 hover:bg-primary/10' : 'border-border hover:bg-accent/40'
      }`}
    >
      <Icon size={20} className={primary ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'} />
      <div className="mt-2 text-sm font-medium">{title}</div>
      <div className="text-[11px] text-muted-foreground">{desc}</div>
    </button>
  )
}

function TutorialStep({ n, icon: Icon, title, hint, onClick }: {
  n: number
  icon: any
  title: string
  hint: string
  onClick(): void
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 flex items-center gap-2.5 rounded-lg border border-border/70 bg-background/40 hover:bg-accent/40 hover:border-primary/30 p-2 text-left transition-colors group"
    >
      <span className="relative shrink-0">
        <Icon size={17} className="text-muted-foreground group-hover:text-primary transition-colors" />
        <span className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
          {n}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium leading-tight">{title}</span>
        <span className="block text-[10px] text-muted-foreground leading-tight mt-0.5 truncate">{hint}</span>
      </span>
    </button>
  )
}

function Capability({ icon: Icon, title, sub }: { icon: any; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-accent/25 p-2">
      <Icon size={15} className="text-primary shrink-0" strokeWidth={1.75} />
      <div className="min-w-0">
        <div className="text-[11px] font-medium leading-tight truncate">{title}</div>
        <div className="text-[10px] text-muted-foreground leading-tight truncate">{sub}</div>
      </div>
    </div>
  )
}
