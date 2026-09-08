'use client'
// ============================================================
// plugin-manager-dialog.tsx — Plugin Manager (Task 7-A).
//
// WIDE dialog (registered 'plugin-manager' in dialog-registry.ts,
// added to the wide-dialog class list in dialog-manager.tsx).
// Three tabs:
//   Plugins   — install/enable/run/remove JS plugins (sandboxed
//               worker runtime) + API cheat sheet
//   Brushes   — imported GIMP .gbr brushes; Set Active paints
//               with the stamp (tools/brush.ts image dabs)
//   Gradients — imported GIMP .ggr gradients; "Open in Gradient
//               Map…" wires the stops straight into the existing
//               gradient-map adjustment (it accepts custom stops)
//
// Honest copy (kept front and center): true Photoshop .8bf
// plugins are x86 native DLLs and cannot run in a browser;
// GIMP Script-Fu is TinyScheme. GIMP ASSET formats (.gbr/.ggr)
// import natively, and JS plugins run in the sandboxed worker.
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Puzzle, Brush, Blend, Upload, Trash2, Play, Sparkles, BookOpen, Info, Check,
  FileJson, ChevronDown, Lock, CircleAlert,
} from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { pluginManager } from '../../plugins/plugin-manager'
import { SAMPLE_PLUGINS } from '../../plugins/sample-plugins'
import * as brushPresets from '../../plugins/brush-presets'
import * as gradientPresets from '../../plugins/gradient-presets'
import type { DialogProps } from './generic-dialogs'
import { cn } from '@/lib/utils'

// ---- the honest "what can/can't import" note ----
function CompatibilityNote() {
  return (
    <div className="flex items-start gap-2 rounded border border-border bg-panel/60 px-3 py-2">
      <CircleAlert size={13} className="mt-0.5 text-primary flex-shrink-0" />
      <p className="text-[10px] leading-snug text-muted-foreground">
        <span className="text-foreground font-medium">What can import:</span> GIMP brushes
        (<span className="font-mono">.gbr</span>) and gradients (<span className="font-mono">.ggr</span>) parse
        natively, and Chay's Photo JS plugins run in a sandboxed worker.
        <span className="text-foreground font-medium"> What can&apos;t:</span> Photoshop{' '}
        <span className="font-mono">.8bf</span> plugins are x86 native DLLs — impossible in a browser — and GIMP
        Script-Fu is TinyScheme. Plugins are arbitrary JavaScript with pixel access:{' '}
        <span className="text-foreground">run only plugins you trust.</span>
      </p>
    </div>
  )
}

// ---- minimal example shown in the cheat sheet ----
const CHEATSHEET_EXAMPLE = `/* @zphoto { "id": "com.example.tint", "name": "Tint" } */
zphoto.registerCommand('tint', 'Warm Tint', async () => {
  const img = await zphoto.layer.getPixels()      // { width, height, rgba }
  const d = new Uint8ClampedArray(img.rgba)       // view over the buffer
  for (let p = 0; p < d.length; p += 4) {
    d[p] += 18; d[p + 1] += 8                     // warm the reds/greens
  }
  await zphoto.layer.setPixels(d.buffer, img.width, img.height)
  zphoto.toast('Tint applied', 'success')
})`

const API_ROWS: [string, string][] = [
  ['zphoto.registerCommand(id, label, fn)', 'call at load — registers a runnable command'],
  ['await zphoto.document.info()', '→ { width, height, name }'],
  ['await zphoto.layer.getPixels()', '→ { width, height, rgba } — your own copy of the layer'],
  ['await zphoto.layer.setPixels(rgba, w, h)', 'commits pixels back (dims must match)'],
  ['await zphoto.applyAdjustment(img, type, params)', 'runs a built-in adjustment on img, in place'],
  ['await zphoto.applyFilter(img, type, params)', 'runs a built-in filter on img, in place'],
  ['await zphoto.toast(msg, type?)', 'toast on the main thread'],
  ['await zphoto.log(...args)', 'console.log, prefixed [zphoto-plugin]'],
]

function CheatSheet() {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <BookOpen size={12} />
          <span className="flex-1 text-left">Plugin API cheat sheet — contract + minimal example</span>
          <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 space-y-2 rounded border border-border bg-panel/60 p-2.5">
          <p className="text-[10px] leading-snug text-muted-foreground">
            A plugin is a JS file: optional leading{' '}
            <span className="font-mono">{'/* @zphoto { "id": …, "name": … } */'}</span> manifest comment, then code
            that receives <span className="font-mono">zphoto</span> and registers commands.{' '}
            <span className="font-mono">.zpplugin.json</span> files carry
            <span className="font-mono"> {'{ manifest: {…}, code: "…" }'}</span>. Commands run against the active
            raster layer; history gets one step per run (undo restores).
          </p>
          <div className="space-y-1">
            {API_ROWS.map(([sig, desc]) => (
              <div key={sig} className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-2">
                <code className="font-mono text-[10px] text-primary whitespace-pre-wrap">{sig}</code>
                <span className="text-[10px] text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
          <pre className="overflow-x-auto rounded bg-workspace p-2 font-mono text-[10px] leading-relaxed text-foreground/90 zphoto-scroll">
            {CHEATSHEET_EXAMPLE}
          </pre>
          <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
            <Lock size={11} className="mt-0.5 flex-shrink-0" />
            Trust model: plugin code is evaluated inside a dedicated worker with only the zphoto API — no DOM, no
            engine access — but it is still arbitrary JavaScript with your pixels. Run only plugins you trust.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ============================================================
// Plugins tab
// ============================================================

function pickPluginFile(onPick: (file: File) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.zpplugin.json,.js'
  input.onchange = () => { if (input.files?.[0]) onPick(input.files[0]) }
  input.click()
}

function PluginsTab() {
  const [tick, setTick] = useState(0)
  const [running, setRunning] = useState<string | null>(null)
  useEffect(() => pluginManager.onChange(() => setTick(t => t + 1)), [])
  void tick
  const plugins = pluginManager.list()
  const pushToast = useEditorStore(s => s.pushToast)

  const installSamples = async () => {
    let installed = 0
    for (const s of SAMPLE_PLUGINS) {
      try {
        await pluginManager.install(s.manifest, s.code)
        installed++
      } catch { /* already installed / worker hiccup — skip quietly */ }
    }
    pushToast(
      installed > 0 ? `Installed ${installed} sample plugin${installed === 1 ? '' : 's'}` : 'Sample plugins already installed',
      installed > 0 ? 'success' : 'info',
    )
  }

  const installFile = async (file: File) => {
    try {
      const p = await pluginManager.installFromFile(file)
      if (p) {
        pushToast(`Installed “${p.manifest.name}” (${p.commands.length} command${p.commands.length === 1 ? '' : 's'})`, 'success')
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Plugin install failed', 'error')
    }
  }

  if (!plugins.length) {
    return (
      <div className="space-y-3">
        <CompatibilityNote />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => pickPluginFile(installFile)}>
            <Upload size={13} className="mr-1.5" /> Install from File…
          </Button>
          <Button size="sm" onClick={installSamples}>
            <Sparkles size={13} className="mr-1.5" /> Install Sample Plugins
          </Button>
        </div>
        <div className="rounded border border-dashed border-border px-3 py-5 text-center">
          <Puzzle size={18} className="mx-auto mb-1.5 text-muted-foreground/60" />
          <p className="text-[11px] text-muted-foreground">No plugins installed yet.</p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
            Try the three samples — Golden Hour, Auto Vignette, Duotone Print.
          </p>
        </div>
        <CheatSheet />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <CompatibilityNote />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => pickPluginFile(installFile)}>
          <Upload size={13} className="mr-1.5" /> Install from File…
        </Button>
        <Button size="sm" variant="secondary" onClick={installSamples}>
          <Sparkles size={13} className="mr-1.5" /> Install Sample Plugins
        </Button>
      </div>

      <div className="max-h-80 space-y-2 overflow-y-auto zphoto-scroll pr-0.5">
        {plugins.map(p => (
          <div key={p.manifest.id} className="rounded border border-border bg-panel/40 p-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[12px] font-medium text-foreground">{p.manifest.name}</span>
                  <span className="font-mono text-[9px] text-muted-foreground">v{p.manifest.version}</span>
                  {!p.enabled && <span className="rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">disabled</span>}
                </div>
                {p.manifest.description && (
                  <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{p.manifest.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Switch
                  checked={p.enabled}
                  aria-label={`Enable ${p.manifest.name}`}
                  onCheckedChange={v => {
                    void pluginManager.setEnabled(p.manifest.id, v).catch(err => {
                      pushToast(err instanceof Error ? err.message : 'Could not enable plugin', 'error')
                    })
                  }}
                />
                <Button
                  size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${p.manifest.name}`}
                  onClick={() => void pluginManager.uninstall(p.manifest.id)}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
            {p.commands.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.commands.map(c => (
                  <Button
                    key={c.id}
                    size="sm" variant="secondary" className="h-7 px-2.5 text-[11px]"
                    disabled={!p.enabled || running !== null}
                    onClick={() => {
                      const key = `${p.manifest.id}:${c.id}`
                      setRunning(key)
                      void pluginManager.runCommand(p.manifest.id, c.id).finally(() => setRunning(null))
                    }}
                  >
                    <Play size={11} className="mr-1" />
                    {running === `${p.manifest.id}:${c.id}` ? 'Running…' : c.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <CheatSheet />
    </div>
  )
}

// ============================================================
// Brushes tab
// ============================================================

function BrushesTab() {
  const [tick, setTick] = useState(0)
  useEffect(() => brushPresets.onChange(() => setTick(t => t + 1)), [])
  void tick
  const presets = brushPresets.list()
  const activeId = brushPresets.getActiveId()
  const thumbRefs = useRef<Map<string, HTMLCanvasElement | null>>(new Map())

  // draw thumbnails (async stamp decode)
  useEffect(() => {
    let cancelled = false
    for (const p of presets) {
      brushPresets.getStampCanvas(p.id).then(cv => {
        if (cancelled || !cv) return
        const el = thumbRefs.current.get(p.id)
        if (!el) return
        el.width = 56
        el.height = 56
        const ctx = el.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, 56, 56)
        const s = Math.min(48 / cv.width, 48 / cv.height)
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(cv, (56 - cv.width * s) / 2, (56 - cv.height * s) / 2, cv.width * s, cv.height * s)
      }).catch(() => { /* skip failed decodes */ })
    }
    return () => { cancelled = true }
  }, [tick])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void brushPresets.importGimpBrushFile()}>
          <Upload size={13} className="mr-1.5" /> Import GIMP Brush…
        </Button>
        <Button size="sm" variant="secondary" disabled={!activeId} onClick={() => brushPresets.setActive(null)}>
          <Brush size={13} className="mr-1.5" /> Use Procedural Brush
        </Button>
      </div>

      {presets.length === 0 ? (
        <div className="rounded border border-dashed border-border px-3 py-5 text-center">
          <Brush size={18} className="mx-auto mb-1.5 text-muted-foreground/60" />
          <p className="text-[11px] text-muted-foreground">No image brushes imported.</p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
            Import a <span className="font-mono">.gbr</span> from your GIMP brushes folder — gray and RGBA tips both
            import; the active stamp paints through the Brush tool.
          </p>
        </div>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto zphoto-scroll pr-0.5">
          {presets.map(p => {
            const active = p.id === activeId
            return (
              <div
                key={p.id}
                className={cn(
                  'flex items-center gap-3 rounded border p-2.5',
                  active ? 'border-primary/50 bg-primary/10' : 'border-border bg-panel/40',
                )}
              >
                <canvas
                  ref={el => { thumbRefs.current.set(p.id, el) }}
                  className="h-14 w-14 flex-shrink-0 rounded border bg-[repeating-conic-gradient(#3a3a3a_0%_25%,#2c2c2c_0%_50%)] [background-size:10px_10px]"
                  aria-label={`${p.name} thumbnail`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12px] font-medium text-foreground">{p.name}</span>
                    {active && (
                      <span className="flex items-center gap-0.5 rounded bg-primary/20 px-1.5 py-px text-[9px] text-primary">
                        <Check size={9} /> active stamp
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    image brush · spacing {p.spacing}% of size · painted at the Brush tool&apos;s size
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm" variant={active ? 'default' : 'secondary'} className="h-7 px-2.5 text-[11px]"
                    disabled={active}
                    onClick={() => {
                      brushPresets.setActive(p.id)
                      // switch to the brush tool so the stamp is immediately usable
                      useEditorStore.getState().setTool('brush')
                    }}
                  >
                    {active ? 'Active' : 'Set Active'}
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => brushPresets.removePreset(p.id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
        <Info size={11} className="mt-0.5 flex-shrink-0" />
        <span>
          Stamps scale to the Brush tool size (largest dimension ≈ 2×radius), axis-aligned for v1, and respect flow /
          pressure / opacity through the brush engine. The Eraser keeps its procedural dabs.
        </span>
      </div>
    </div>
  )
}

// ============================================================
// Gradients tab
// ============================================================

function drawGradientBar(canvas: HTMLCanvasElement, stops: { pos: number; r: number; g: number; b: number; a: number }[]): void {
  canvas.width = 220
  canvas.height = 14
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, 220, 14)
  if (!stops.length) return
  const grad = ctx.createLinearGradient(0, 0, 220, 0)
  const sorted = [...stops].sort((a, b) => a.pos - b.pos)
  for (const s of sorted) {
    const c = `rgba(${Math.round(s.r * 255)},${Math.round(s.g * 255)},${Math.round(s.b * 255)},${s.a.toFixed(3)})`
    try { grad.addColorStop(Math.min(1, Math.max(0, s.pos)), c) } catch { /* skip invalid stops */ }
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 220, 14)
}

function GradientsTab() {
  const [tick, setTick] = useState(0)
  useEffect(() => gradientPresets.onChange(() => setTick(t => t + 1)), [])
  const renderTick = useEditorStore(s => s.renderTick)
  void renderTick // refresh the active-layer availability for "Open in Gradient Map"
  void tick
  const gradients = gradientPresets.list()
  const barRefs = useRef<Map<string, HTMLCanvasElement | null>>(new Map())
  const layer = engine.activeLayer

  useEffect(() => {
    for (const g of gradients) {
      const el = barRefs.current.get(g.id)
      if (el) drawGradientBar(el, g.stops)
    }
  })

  const openInGradientMap = (id: string) => {
    const params = gradientPresets.gradientMapParams(id)
    if (!params) return
    if (!layer) {
      useEditorStore.getState().pushToast('No active layer for the Gradient Map', 'error')
      return
    }
    // the generic gradient-map dialog accepts params via dialog props (live preview included)
    useEditorStore.getState().openDialog('gradient-map', { layerId: layer.id, mode: 'direct', params })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void gradientPresets.importGimpGradientFile()}>
          <Upload size={13} className="mr-1.5" /> Import GIMP Gradient…
        </Button>
      </div>

      {gradients.length === 0 ? (
        <div className="rounded border border-dashed border-border px-3 py-5 text-center">
          <Blend size={18} className="mx-auto mb-1.5 text-muted-foreground/60" />
          <p className="text-[11px] text-muted-foreground">No gradients imported.</p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
            Import a <span className="font-mono">.ggr</span> from your GIMP gradients folder, then map it onto the
            active layer&apos;s luminance.
          </p>
        </div>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto zphoto-scroll pr-0.5">
          {gradients.map(g => (
            <div key={g.id} className="flex items-center gap-3 rounded border border-border bg-panel/40 p-2.5">
              <canvas
                ref={el => { barRefs.current.set(g.id, el) }}
                className="h-3.5 w-56 flex-shrink-0 rounded border"
                aria-label={`${g.name} preview`}
              />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-foreground">{g.name}</span>
                <span className="text-[10px] text-muted-foreground">{g.stops.length} stops</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="secondary" className="h-7 px-2.5 text-[11px]" onClick={() => openInGradientMap(g.id)}>
                  <FileJson size={11} className="mr-1" /> Open in Gradient Map…
                </Button>
                <Button
                  size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${g.name}`}
                  onClick={() => gradientPresets.removeGradient(g.id)}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
        <Info size={11} className="mt-0.5 flex-shrink-0" />
        <span>
          Each imported gradient opens in the built-in Gradient Map adjustment with its stops pre-loaded — preview,
          dither and reverse included. Curved / sinusoidal GGR blend modes are approximated by their stop positions.
        </span>
      </div>
    </div>
  )
}

// ============================================================
// dialog
// ============================================================

export function PluginManagerDialog({ onClose }: DialogProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Puzzle size={15} className="text-primary" /> Plugin Manager
        </DialogTitle>
      </DialogHeader>
      <Tabs defaultValue="plugins" className="py-1">
        <TabsList className="grid w-full grid-cols-3 h-8">
          <TabsTrigger value="plugins" className="text-[11px] gap-1.5">
            <Puzzle size={11} /> Plugins
          </TabsTrigger>
          <TabsTrigger value="brushes" className="text-[11px] gap-1.5">
            <Brush size={11} /> Brushes
          </TabsTrigger>
          <TabsTrigger value="gradients" className="text-[11px] gap-1.5">
            <Blend size={11} /> Gradients
          </TabsTrigger>
        </TabsList>
        <TabsContent value="plugins" className="mt-3">
          <PluginsTab />
        </TabsContent>
        <TabsContent value="brushes" className="mt-3">
          <BrushesTab />
        </TabsContent>
        <TabsContent value="gradients" className="mt-3">
          <GradientsTab />
        </TabsContent>
      </Tabs>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  )
}

/** re-exported helper so menus.ts can share the file-picker flow */
export function pickAndInstallPluginFile(): void {
  pickPluginFile(file => {
    void pluginManager.installFromFile(file).catch(() => { /* toasts come from the dialog flow */ })
  })
}
