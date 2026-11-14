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
  FileJson, ChevronDown, ChevronUp, Lock, CircleAlert, Terminal, RefreshCw, ShieldCheck,
  Palette, FileText, FolderOpen, Layers, Film, Plus, Download,
} from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { pluginManager } from '../../plugins/plugin-manager'
import { SAMPLE_PLUGINS } from '../../plugins/sample-plugins'
import * as brushPresets from '../../plugins/brush-presets'
import * as gradientPresets from '../../plugins/gradient-presets'
import type { DialogProps } from './generic-dialogs'
import { cn } from '@/lib/utils'
import { nativeToolInfo, runNativeGegl, runNativeGmic } from '../../plugins/native-host'
import { GimpNativeCatalog } from './gimp-native-catalog'
import { GimpAnalysisTab } from './gimp-analysis-tab'
import { GimpRuntimeTab } from './gimp-runtime-tab'
import { dataUrlToCanvas } from '../../image-ops'
import { getFlatComposite } from '../../engine/document'
import type { PluginPermission } from '../../plugins/plugin-types'
import { listProcedures, getProcedure, runProcedure, getGeglOperations, getGeglOperation, type GeglOperation } from '../../plugins/gegl-ops'
import { runProcedure as runProcProcedure, listAllProcedures, runGimpPipeline } from '../../plugins/gimp-host'
import { runScriptFu, listBuiltInScripts, getBuiltInScript, registerScriptFu } from '../../plugins/gimp-script-fu'
import { parseBrush, importBrushPack, detectBrushFormat, brushToEngine } from '../../plugins/gimp-brush-import'
import { parseXcf, renderXcf } from '../../plugins/gimp-xcf'
import { runGimpProcedure, listAllProcedures as listAllGimpProcedures } from '../../plugins/gimp-host'
import { getGeglOperations, type GeglOperation } from '../../plugins/gegl-ops'
import { convertColorSpace, convertCanvasColorSpace, SRGB_PROFILE, listColorSpaces } from '../../plugins/gimp-color-management'
import { extractMetadataFromImage, parseExif, parseXmp, ImageMetadata } from '../../plugins/gimp-metadata'
import { getAllPipelines, executePipeline, createPipelineFromSteps, type FilterPipeline, type FilterStep } from '../../plugins/gimp-filter-pipeline'
import { createFrame, exportGif, exportAnimatedWebP, composeFrames, generateSpriteSheet, type AnimationFrame, type AnimationSettings, EASING } from '../../plugins/gimp-animation'

// ---- the honest "what can/can't import" note ----
function CompatibilityNote() {
  return (
    <div className="flex items-start gap-2 rounded border border-border bg-panel/60 px-3 py-2">
      <CircleAlert size={13} className="mt-0.5 text-primary flex-shrink-0" />
      <p className="text-[10px] leading-snug text-muted-foreground">
        <span className="text-foreground font-medium">What can import:</span> Chay JS plugins, Photoshop UXP manifests, GIMP Script-Fu/Python scripts, and G’MIC/GEGL compatibility clues all get classified for review; GIMP brushes
        (<span className="font-mono">.gbr</span>), patterns (<span className="font-mono">.pat</span>), palettes (<span className="font-mono">.gpl</span>) and gradients (<span className="font-mono">.ggr</span>) parse
        natively as assets, while Chay JS and UXP plugins run in the sandboxed worker when executable.
        <span className="text-foreground font-medium">Desktop bridges:</span> Electron can run installed G’MIC/GEGL filters and invoke installed GIMP 3 procedures or trusted Python/Script-Fu source on demand. GIMP runs with your OS account permissions; results return as a new 8-bit PNG layer.{' '}
        <span className="text-foreground font-medium"> Legacy limits:</span> Photoshop <span className="font-mono">.8bf</span> still requires Photoshop’s native host; browser builds cannot launch native runtimes. Plugins are arbitrary JavaScript with pixel access:{' '}
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
  input.accept = '.zpplugin.json,.js,.mjs,.ts,.scm,.py,.gmic,.gegl,.json'
  input.onchange = () => { if (input.files?.[0]) onPick(input.files[0]) }
  input.click()
}

function pickUxpPlugin(onPick: (manifest: File, code: File) => void): void {
  const input = document.createElement('input')
  input.type = 'file'; input.multiple = true; input.accept = '.json,.js'
  input.onchange = () => {
    const files = [...(input.files ?? [])]
    const manifest = files.find(f => f.name.toLowerCase() === 'manifest.json') || files.find(f => f.name.toLowerCase().endsWith('.json'))
    const code = files.find(f => f.name.toLowerCase().endsWith('.js'))
    if (manifest && code) onPick(manifest, code)
    else useEditorStore.getState().pushToast('Select the UXP manifest.json and its main JavaScript file together', 'error')
  }
  input.click()
}

const ALL_PLUGIN_PERMISSIONS: PluginPermission[] = ['document.read','document.write','layer.read','layer.write','selection.read','selection.write','editor.commands','ui.toast','storage','network','native.process']

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

  const installUxp = async (manifest: File, code: File) => {
    try {
      const p = await pluginManager.installUxp(await manifest.text(), await code.text(), code.name.replace(/\.js$/i, ''))
      if (p) pushToast(`Imported Photoshop UXP plugin “${p.manifest.name}”`, 'success')
    } catch (err) { pushToast(err instanceof Error ? err.message : 'UXP import failed', 'error') }
  }

  if (!plugins.length) {
    return (
      <div className="space-y-3">
        <CompatibilityNote />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => pickPluginFile(installFile)}>
            <Upload size={13} className="mr-1.5" /> Install Chay Plugin…
          </Button>
          <Button size="sm" variant="secondary" onClick={() => pickUxpPlugin(installUxp)}>
            <FileJson size={13} className="mr-1.5" /> Import Photoshop UXP…
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
            {p.compatibility && (
              <div className="mt-2 rounded border border-border/70 bg-background/30 p-2 text-[9px]">
                <div className="flex items-center justify-between"><span className="font-medium uppercase tracking-wide text-muted-foreground">{p.compatibility.ecosystem}</span><span className="text-primary">API coverage estimate {p.compatibility.coverage}%</span></div>
                {p.compatibility.supported.length > 0 && <div className="mt-1 text-emerald-400">Supported: {p.compatibility.supported.join(', ')}</div>}
                {p.compatibility.unsupported.length > 0 && <div className="mt-1 text-amber-400">Unsupported: {p.compatibility.unsupported.join(', ')}</div>}
                {p.compatibility.warnings.map((w, i) => <div key={i} className="mt-1 text-muted-foreground">{w}</div>)}
              </div>
            )}
            <Collapsible>
              <CollapsibleTrigger className="mt-2 flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground"><ShieldCheck size={10}/>Permissions</CollapsibleTrigger>
              <CollapsibleContent className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 rounded border border-border/60 p-2">
                {ALL_PLUGIN_PERMISSIONS.map(perm => { const checked = (p.grantedPermissions ?? p.manifest.permissions ?? []).includes(perm); return <label key={perm} className="flex items-center gap-1 text-[9px]"><input type="checkbox" checked={checked} onChange={e => { const cur = new Set(p.grantedPermissions ?? p.manifest.permissions ?? []); if (e.target.checked) cur.add(perm); else cur.delete(perm); void pluginManager.setPermissions(p.manifest.id, [...cur] as PluginPermission[]) }}/><span className={perm === 'native.process' || perm === 'network' ? 'text-amber-400' : ''}>{perm}</span></label> })}
              </CollapsibleContent>
            </Collapsible>
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
// Desktop native filters — optional G'MIC / GEGL bridges
// ============================================================
function NativeFiltersTab() {
  const [info, setInfo] = useState<{ electron:boolean; gmic:boolean; gegl:boolean; gmicVersion?:string; geglVersion?:string }>({ electron:false, gmic:false, gegl:false })
  const [gmicArgs, setGmicArgs] = useState('-fx_sharpen 1')
  const [geglOp, setGeglOp] = useState('unsharp-mask')
  const [geglArgs, setGeglArgs] = useState('')
  const [busy, setBusy] = useState(false)
  const pushToast = useEditorStore(s => s.pushToast)
  const refresh = () => void nativeToolInfo(true).then(setInfo).catch(() => {})
  useEffect(() => { refresh() }, [])

  const applyResult = async (dataUrl: string, name: string) => {
    const c = await dataUrlToCanvas(dataUrl)
    engine.addLayerFromCanvas(c, name)
  }
  const source = () => {
    const doc = engine.activeDoc
    if (!doc) throw new Error('Open a document first')
    return getFlatComposite(doc).toDataURL('image/png')
  }
  const split = (text: string) => text.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(v => v.replace(/^"|"$/g,'')) ?? []
  const runGmic = async () => { setBusy(true); try { const out = await runNativeGmic(source(), split(gmicArgs)); await applyResult(out, 'G’MIC Result'); pushToast('G’MIC result added as a new layer', 'success') } catch (e) { pushToast(e instanceof Error ? e.message : 'G’MIC failed', 'error') } finally { setBusy(false) } }
  const runGegl = async () => { setBusy(true); try { const out = await runNativeGegl(source(), geglOp.trim(), split(geglArgs)); await applyResult(out, `GEGL — ${geglOp}`); pushToast('GEGL result added as a new layer', 'success') } catch (e) { pushToast(e instanceof Error ? e.message : 'GEGL failed', 'error') } finally { setBusy(false) } }

  return <div className="space-y-3">
    <div className="flex items-center justify-between rounded border border-border bg-panel/40 p-2.5"><div><div className="text-[11px] font-medium">Desktop native filter host</div><div className="text-[9px] text-muted-foreground">Available only in Electron. Commands execute in the main process with argv isolation and temporary PNG files.</div></div><Button size="sm" variant="ghost" onClick={refresh}><RefreshCw size={12}/></Button></div>
    {!info.electron && <div className="rounded border border-dashed border-border p-3 text-[10px] text-muted-foreground">Open the Electron build to use installed G’MIC/GEGL binaries. Browser and extension builds keep these controls disabled.</div>}
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div className="rounded border border-border p-2.5"><div className="flex items-center justify-between"><span className="text-[11px] font-medium">G’MIC</span><span className={info.gmic?'text-emerald-400 text-[9px]':'text-muted-foreground text-[9px]'}>{info.gmic ? 'detected' : 'not found'}</span></div><div className="mt-1 truncate text-[9px] text-muted-foreground" title={info.gmicVersion}>{info.gmicVersion || 'Install gmic or set CHAYS_GMIC_PATH'}</div><input value={gmicArgs} onChange={e=>setGmicArgs(e.target.value)} className="mt-2 h-8 w-full rounded border border-border bg-background px-2 font-mono text-[10px]" placeholder="-fx_sharpen 1"/><Button className="mt-2" size="sm" disabled={!info.gmic||busy} onClick={()=>void runGmic()}><Play size={11} className="mr-1"/>Apply to composite</Button><GimpNativeCatalog kind="gmic" available={info.gmic} onSelect={setGmicArgs}/></div>
      <div className="rounded border border-border p-2.5"><div className="flex items-center justify-between"><span className="text-[11px] font-medium">GEGL</span><span className={info.gegl?'text-emerald-400 text-[9px]':'text-muted-foreground text-[9px]'}>{info.gegl ? 'detected' : 'not found'}</span></div><div className="mt-1 truncate text-[9px] text-muted-foreground" title={info.geglVersion}>{info.geglVersion || 'Install gegl or set CHAYS_GEGL_PATH'}</div><input value={geglOp} onChange={e=>setGeglOp(e.target.value)} className="mt-2 h-8 w-full rounded border border-border bg-background px-2 font-mono text-[10px]" placeholder="unsharp-mask"/><input value={geglArgs} onChange={e=>setGeglArgs(e.target.value)} className="mt-1 h-8 w-full rounded border border-border bg-background px-2 font-mono text-[10px]" placeholder="radius=2 amount=0.7"/><Button className="mt-2" size="sm" disabled={!info.gegl||busy||!geglOp.trim()} onClick={()=>void runGegl()}><Play size={11} className="mr-1"/>Apply to composite</Button><GimpNativeCatalog kind="gegl" available={info.gegl} onSelect={setGeglOp}/></div>
    </div>
    <div className="flex items-start gap-1.5 text-[9px] text-muted-foreground"><Terminal size={11} className="mt-0.5"/>Results are imported as a new layer, so native filters remain undoable/non-destructive to the source layer. Argument text is split into argv and never passed through a shell.</div>
  </div>
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
        <TabsList className="relative z-20 flex w-full flex-wrap items-center justify-start gap-1 !h-auto min-h-8 p-1">
          <TabsTrigger value="plugins" className="text-[11px] gap-1.5">
            <Puzzle size={11} /> Plugins
          </TabsTrigger>
          <TabsTrigger value="brushes" className="text-[11px] gap-1.5">
            <Brush size={11} /> Brushes
          </TabsTrigger>
          <TabsTrigger value="gradients" className="text-[11px] gap-1.5">
            <Blend size={11} /> Gradients
          </TabsTrigger>
          <TabsTrigger value="gimp-analysis" className="text-[11px] gap-1.5">
            <FileJson size={11} /> GIMP Scripts
          </TabsTrigger>
          <TabsTrigger value="gimp-runtime" className="text-[10px] gap-1">
            <Terminal size={11} /> GIMP Runtime
          </TabsTrigger>
          <TabsTrigger value="native" className="text-[11px] gap-1.5">
            <Terminal size={11} /> Desktop Filters
          </TabsTrigger>
          <TabsTrigger value="gimp-procedural" className="text-[11px] gap-1.5">
            <Sparkles size={11} /> GIMP Procedural
          </TabsTrigger>
          <TabsTrigger value="gimp-scriptfu" className="text-[11px] gap-1.5">
            <BookOpen size={11} /> Script-Fu
          </TabsTrigger>
          <TabsTrigger value="gimp-colors" className="text-[11px] gap-1.5">
            <Palette size={11} /> Color Mgmt
          </TabsTrigger>
          <TabsTrigger value="gimp-metadata" className="text-[11px] gap-1.5">
            <FileText size={11} /> Metadata
          </TabsTrigger>
          <TabsTrigger value="gimp-xcf" className="text-[11px] gap-1.5">
            <FolderOpen size={11} /> XCF Import
          </TabsTrigger>
          <TabsTrigger value="gimp-pipelines" className="text-[11px] gap-1.5">
            <Layers size={11} /> Filter Pipelines
          </TabsTrigger>
          <TabsTrigger value="gimp-animation" className="text-[11px] gap-1.5">
            <Film size={11} /> Animation
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
        <TabsContent value="gimp-analysis" className="mt-3">
          <GimpAnalysisTab />
        </TabsContent>
        <TabsContent value="gimp-runtime" className="mt-3">
          <GimpRuntimeTab />
        </TabsContent>
        <TabsContent value="native" className="mt-3">
          <NativeFiltersTab />
        </TabsContent>
        <TabsContent value="gimp-procedural" className="mt-3">
          <GimpProceduralTab />
        </TabsContent>
        <TabsContent value="gimp-scriptfu" className="mt-3">
          <GimpScriptFuTab />
        </TabsContent>
        <TabsContent value="gimp-colors" className="mt-3">
          <GimpColorManagementTab />
        </TabsContent>
        <TabsContent value="gimp-metadata" className="mt-3">
          <GimpMetadataTab />
        </TabsContent>
        <TabsContent value="gimp-xcf" className="mt-3">
          <GimpXcfImportTab />
        </TabsContent>
        <TabsContent value="gimp-pipelines" className="mt-3">
          <GimpFilterPipelinesTab />
        </TabsContent>
        <TabsContent value="gimp-animation" className="mt-3">
          <GimpAnimationTab />
        </TabsContent>
      </Tabs>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  )
}

// ============================================================
// GIMP Procedural tab — browse and run PDB procedures / GEGL ops
// ============================================================

function GimpProceduralTab() {
  const [filter, setFilter] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [running, setRunning] = useState<string | null>(null)
  const pushToast = useEditorStore(s => s.pushToast)

  const procedures = useMemo(() => listProcedures(), [])
  const geglOps = useMemo(() => getGeglOperations(), [])

  const filteredProcedures = useMemo(() => {
    let list = procedures
    if (filter) {
      const f = filter.toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(f) || p.title.toLowerCase().includes(f) || p.blurb.toLowerCase().includes(f))
    }
    if (category !== 'all') {
      list = list.filter(p => p.categories.includes(category))
    }
    return list
  }, [procedures, filter, category])

  const categories = useMemo(() => {
    const cats = new Set<string>()
    for (const p of procedures) for (const c of p.categories) cats.add(c)
    return ['all', ...Array.from(cats).sort()]
  }, [procedures])

  const runProc = async (procName: string) => {
    setRunning(procName)
    try {
      const proc = getProcedure(procName)
      if (!proc) throw new Error('Procedure not found')

      // Get the active layer as input image
      const doc = engine.activeDoc
      if (!doc) throw new Error('No active document')
      const layer = doc.layers[doc.activeLayerIndex]
      if (!layer) throw new Error('No active layer')

      const canvas = layer.canvas
      const inputDataUrl = canvas.toDataURL('image/png')

      // For GEGL ops, we'd use the GEGL graph processor
      // For procedural, we run the procedure
      const result = await runProcProcedure(procName, { image: inputDataUrl })

      if (result.status === 'success') {
        pushToast(`${proc.title} completed`, 'success')
        // Apply result to layer
        if (result.values[0]?.startsWith('data:image/')) {
          const img = new Image()
          img.src = result.values[0]
          await new Promise(r => img.onload = r)
          const ctx = canvas.getContext('2d')!
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(img, 0, 0)
          engine.requestRedraw()
        }
      } else {
        pushToast(`${proc.title} failed: ${result.error}`, 'error')
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Procedure failed', 'error')
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Filter procedures… (name, description, category)"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="flex-1 min-w-[200px] h-8 rounded border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="h-8 rounded border border-border bg-background px-2 text-sm text-foreground"
        >
          {categories.map(c => <option key={c} value={c}>{c === 'all' ? 'All Categories' : c}</option>)}
        </select>
        <Button size="sm" variant="secondary" onClick={async () => {
          const all = await listAllProcedures()
          pushToast(`Found ${all.length} procedures (${procedures.length} browser, ${all.length - procedures.length} native)`, 'info')
        }}>
          <RefreshCw size={13} className="mr-1.5" /> Refresh from Native
        </Button>
      </div>

      <div className="rounded border border-border/70 bg-panel/40 max-h-[500px] overflow-y-auto zphoto-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/70 bg-background/50">
              <th className="text-left p-2 font-medium text-[11px] text-muted-foreground">Name</th>
              <th className="text-left p-2 font-medium text-[11px] text-muted-foreground">Title</th>
              <th className="text-left p-2 font-medium text-[11px] text-muted-foreground">Category</th>
              <th className="text-right p-2 font-medium text-[11px] text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredProcedures.slice(0, 100).map(p => (
              <tr key={p.name} className="border-b border-border/40 hover:bg-accent/30">
                <td className="p-2 font-mono text-[10px] text-foreground/80">{p.name}</td>
                <td className="p-2 text-[11px] text-foreground">{p.title}</td>
                <td className="p-2 text-[10px] text-muted-foreground">{p.categories.join(', ')}</td>
                <td className="p-2 text-right">
                  <Button
                    size="sm"
                    variant={running === p.name ? 'default' : 'secondary'}
                    className="h-7 px-2.5 text-[10px]"
                    disabled={running !== null && running !== p.name}
                    onClick={() => runProc(p.name)}
                  >
                    {running === p.name ? 'Running…' : 'Run'}
                  </Button>
                </td>
              </tr>
            ))}
            {filteredProcedures.length > 100 && (
              <tr>
                <td colSpan={4} className="p-2 text-center text-[10px] text-muted-foreground">
                  Showing first 100 of {filteredProcedures.length} — filter to narrow
                </td>
              </tr>
            )}
            {filteredProcedures.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-muted-foreground">No procedures match filter</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded border border-border/70 bg-panel/40 p-3 space-y-2">
        <h4 className="text-[11px] font-medium text-foreground">GEGL Operations (Pipeline Builder)</h4>
        <p className="text-[10px] text-muted-foreground">Chain multiple GEGL ops into a non-destructive filter pipeline.</p>
        <div className="flex flex-wrap gap-2">
          {geglOps.slice(0, 20).map(op => (
            <Button
              key={op.name}
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[10px] text-left"
              onClick={() => pushToast(`${op.title} — use in pipeline builder`, 'info')}
            >
              {op.title}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// GIMP Filter Pipelines Tab
// ============================================================
function GimpFilterPipelinesTab() {
  const [filter, setFilter] = useState('')
  const [running, setRunning] = useState<string | null>(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [builderSteps, setBuilderSteps] = useState<FilterStep[]>([])
  const [builderName, setBuilderName] = useState('')
  const pushToast = useEditorStore(s => s.pushToast)

  const pipelines = useMemo(() => getAllPipelines(), [])
  const filteredPipelines = useMemo(() => pipelines.filter(p =>
    p.name.toLowerCase().includes(filter.toLowerCase()) ||
    p.description.toLowerCase().includes(filter.toLowerCase()) ||
    p.tags.some(t => t.toLowerCase().includes(filter.toLowerCase()))
  ), [pipelines, filter])

  const runPipeline = async (pipeline: FilterPipeline) => {
    setRunning(pipeline.id)
    try {
      const doc = engine.activeDoc
      if (!doc) { pushToast('No active document', 'error'); return }
      const layer = doc.layers[doc.activeLayerIndex]
      if (!layer) { pushToast('No active layer', 'error'); return }

      const result = await executePipeline(pipeline, layer.canvas, (step, progress) => {
        pushToast(`Running ${step.label}... ${Math.round(progress * 100)}%`, 'info')
      })

      if (result.success && result.output) {
        const ctx = layer.canvas.getContext('2d')!
        ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
        ctx.drawImage(result.output, 0, 0)
        engine.requestRedraw()
        pushToast(`${pipeline.name} completed`, 'success')
      } else {
        const failed = result.stepResults.find(r => !r.success)
        pushToast(`Failed at ${failed?.stepId}: ${failed?.error}`, 'error')
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Pipeline failed', 'error')
    } finally {
      setRunning(null)
    }
  }

  const saveCustomPipeline = () => {
    if (!builderName.trim() || builderSteps.length === 0) return
    const pipeline = createPipelineFromSteps(builderName, builderSteps)
    savePipeline(pipeline)
    pushToast(`Saved pipeline "${builderName}"`, 'success')
    setShowBuilder(false)
    setBuilderSteps([])
    setBuilderName('')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Filter pipelines… (name, description, tags)"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="flex-1 min-w-[200px] h-8 rounded border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
        <Button size="sm" variant="secondary" onClick={() => { setShowBuilder(!showBuilder); setBuilderSteps([]); setBuilderName('') }}>
          <Plus size={13} className="mr-1.5" /> {showBuilder ? 'Close Builder' : 'New Pipeline'}
        </Button>
      </div>

      {showBuilder && (
        <div className="rounded border border-primary/30 bg-primary/5 p-3 space-y-3">
          <h4 className="text-[11px] font-medium text-foreground">Pipeline Builder</h4>
          <input
            type="text"
            placeholder="Pipeline name"
            value={builderName}
            onChange={e => setBuilderName(e.target.value)}
            className="w-full h-8 rounded border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {builderSteps.map((step, idx) => (
              <div key={step.id} className="flex items-center gap-1.5 p-1.5 rounded border border-border/50 bg-background/50">
                <span className="text-[10px] text-muted-foreground w-5">{idx + 1}.</span>
                <input type="text" value={step.operation} readOnly className="flex-1 text-[11px] bg-transparent border-0 focus:outline-none" />
                <Button size="sm" variant="ghost" className="h-6 p-0" onClick={() => setBuilderSteps(s => s.filter((_, i) => i !== idx))}>
                  <Trash2 size={11} />
                </Button>
              </div>
            ))}
            {builderSteps.length === 0 && <p className="text-[10px] text-muted-foreground text-center py-2">Add steps from the list below</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => {
              const ops = getGeglOperations()
              const step: FilterStep = { id: `step-${builderSteps.length + 1}`, operation: ops[0]?.name || '', label: ops[0]?.title || '', params: {}, enabled: true }
              setBuilderSteps(s => [...s, step])
            }}>
              <Plus size={11} className="mr-1" /> Add GEGL Op
            </Button>
            <Button size="sm" variant="secondary" onClick={() => {
              // Could add procedural steps
              pushToast('Add procedural step from GIMP Procedural tab', 'info')
            }}>
              <Plus size={11} className="mr-1" /> Add Procedure
            </Button>
            <Button size="sm" onClick={saveCustomPipeline} disabled={!builderName.trim() || builderSteps.length === 0}>
              <Check size={11} className="mr-1" /> Save Pipeline
            </Button>
          </div>
        </div>
      )}

      <div className="rounded border border-border/70 bg-panel/40 max-h-[500px] overflow-y-auto zphoto-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/70 bg-background/50">
              <th className="text-left p-2 font-medium text-[11px] text-muted-foreground">Name</th>
              <th className="text-left p-2 font-medium text-[11px] text-muted-foreground">Description</th>
              <th className="text-left p-2 font-medium text-[11px] text-muted-foreground">Steps</th>
              <th className="text-left p-2 font-medium text-[11px] text-muted-foreground">Tags</th>
              <th className="text-right p-2 font-medium text-[11px] text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredPipelines.map(p => (
              <tr key={p.id} className="border-b border-border/40 hover:bg-accent/30">
                <td className="p-2 font-medium text-[11px] text-foreground">{p.name}</td>
                <td className="p-2 text-[10px] text-muted-foreground truncate max-w-[200px]">{p.description}</td>
                <td className="p-2 text-[10px] text-muted-foreground">{p.steps.length}</td>
                <td className="p-2 text-[10px] text-muted-foreground">{p.tags.join(', ')}</td>
                <td className="p-2 text-right">
                  <Button
                    size="sm"
                    variant={running === p.id ? 'default' : 'secondary'}
                    className="h-7 px-2.5 text-[10px]"
                    disabled={running !== null && running !== p.id}
                    onClick={() => runPipeline(p)}
                  >
                    {running === p.id ? 'Running…' : 'Run'}
                  </Button>
                </td>
              </tr>
            ))}
            {filteredPipelines.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-muted-foreground">No pipelines match filter</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded border border-border/70 bg-panel/40 p-3 space-y-2">
        <h4 className="text-[11px] font-medium text-foreground">Available GEGL Operations</h4>
        <p className="text-[10px] text-muted-foreground">Click to add to pipeline builder above.</p>
        <div className="flex flex-wrap gap-1.5">
          {getGeglOperations().slice(0, 30).map(op => (
            <Button
              key={op.name}
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[9px] text-left"
              onClick={() => {
                if (!showBuilder) setShowBuilder(true)
                const step: FilterStep = { id: `step-${builderSteps.length + 1}`, operation: op.name, label: op.title, params: {}, enabled: true }
                setBuilderSteps(s => [...s, step])
              }}
            >
              {op.title}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// GIMP Animation Tab
// ============================================================
function GimpAnimationTab() {
  const [frames, setFrames] = useState<AnimationFrame[]>([])
  const [settings, setSettings] = useState<AnimationSettings>(DEFAULT_ANIMATION_SETTINGS)
  const [onionSkinSettings, setOnionSkinSettings] = useState({ prevFrames: 2, nextFrames: 1, opacity: 0.4, colorPrev: 'red', colorNext: 'blue' })
  const [exportFormat, setExportFormat] = useState<'gif' | 'webp' | 'apng' | 'spritesheet'>('gif')
  const [running, setRunning] = useState(false)
  const pushToast = useEditorStore(s => s.pushToast)

  const addFrame = () => {
    const doc = engine.activeDoc
    if (!doc) { pushToast('No active document', 'error'); return }
    const layer = doc.layers[doc.activeLayerIndex]
    if (!layer) { pushToast('No active layer', 'error'); return }
    setFrames(f => [...f, createFrame(layer.canvas, { name: `Frame ${f.length + 1}` })])
  }

  const removeFrame = (id: string) => setFrames(f => f.filter(frame => frame.id !== id))
  const duplicateFrameFn = (id: string) => setFrames(f => {
    const idx = f.findIndex(frame => frame.id === id)
    if (idx < 0) return f
    const newFrames = [...f]
    newFrames.splice(idx + 1, 0, duplicateFrame(f[idx]))
    return newFrames
  })

  const moveFrame = (id: string, dir: -1 | 1) => setFrames(f => {
    const idx = f.findIndex(frame => frame.id === id)
    if (idx < 0 || idx + dir < 0 || idx + dir >= f.length) return f
    const newFrames = [...f]
    ;[newFrames[idx], newFrames[idx + dir]] = [newFrames[idx + dir], newFrames[idx]]
    return newFrames
  })

  const exportAnimation = async () => {
    if (frames.length === 0) { pushToast('No frames to export', 'error'); return }
    setRunning(true)
    try {
      let blob: Blob
      if (exportFormat === 'gif') {
        blob = await exportGif(frames, settings)
      } else if (exportFormat === 'webp') {
        blob = await exportAnimatedWebP(frames, settings)
      } else if (exportFormat === 'apng') {
        blob = await exportAnimatedWebP(frames, settings) // fallback
      } else {
        // Sprite sheet
        const canvas = generateSpriteSheet(frames, Math.ceil(Math.sqrt(frames.length)))
        blob = await new Promise(resolve => canvas.toBlob(b => resolve(b || new Blob()), 'image/png'))
      }

      // Download
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `animation.${exportFormat === 'spritesheet' ? 'png' : exportFormat}`
      a.click()
      URL.revokeObjectURL(url)
      pushToast(`Exported ${frames.length} frames as ${exportFormat.toUpperCase()}`, 'success')
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Export failed', 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={addFrame} disabled={running}>
          <Plus size={13} className="mr-1.5" /> Add Frame from Active Layer
        </Button>
        <Button size="sm" variant="secondary" onClick={() => {
          const doc = engine.activeDoc
          if (!doc) { pushToast('No active document', 'error'); return }
          const layer = doc.layers[doc.activeLayerIndex]
          if (!layer) { pushToast('No active layer', 'error'); return }
          // Add multiple frames with slight variations (for animation)
          const newFrames = []
          for (let i = 0; i < 5; i++) {
            newFrames.push(createFrame(layer.canvas, { name: `Frame ${frames.length + i + 1}` }))
          }
          setFrames(f => [...f, ...newFrames])
        }} disabled={running}>
          <Film size={13} className="mr-1.5" /> Add 5 Frames
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setFrames([])} disabled={running || frames.length === 0}>
          <Trash2 size={13} className="mr-1.5" /> Clear All
        </Button>
      </div>

      <div className="rounded border border-border/70 bg-panel/40 p-3 space-y-2">
        <h4 className="text-[11px] font-medium text-foreground">Animation Settings</h4>
        <div className="grid grid-cols-4 gap-2 text-sm">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-muted-foreground">FPS:</label>
            <input type="number" value={settings.fps} onChange={e => setSettings(s => ({ ...s, fps: parseInt(e.target.value) || 12 }))} className="w-16 h-7 rounded border border-border bg-background px-2 text-sm text-foreground" min="1" max="60" />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-muted-foreground">Loop:</label>
            <input type="number" value={settings.loopCount} onChange={e => setSettings(s => ({ ...s, loopCount: parseInt(e.target.value) || 0 }))} className="w-16 h-7 rounded border border-border bg-background px-2 text-sm text-foreground" min="0" />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-muted-foreground">Frame Duration (ms):</label>
            <input type="number" value={settings.defaultFrameDuration} onChange={e => setSettings(s => ({ ...s, defaultFrameDuration: parseInt(e.target.value) || 100 }))} className="w-24 h-7 rounded border border-border bg-background px-2 text-sm text-foreground" min="10" />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-muted-foreground">BG:</label>
            <input type="color" value={settings.backgroundColor} onChange={e => setSettings(s => ({ ...s, backgroundColor: e.target.value }))} className="w-7 h-7 rounded border border-border" />
          </div>
        </div>
      </div>

      <div className="rounded border border-border/70 bg-panel/40 p-3 space-y-2">
        <h4 className="text-[11px] font-medium text-foreground">Onion Skinning</h4>
        <div className="grid grid-cols-4 gap-2 text-sm">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-muted-foreground">Prev Frames:</label>
            <input type="number" value={onionSkinSettings.prevFrames} onChange={e => setOnionSkinSettings(s => ({ ...s, prevFrames: Math.max(0, Math.min(5, parseInt(e.target.value) || 0)) }))} className="w-12 h-7 rounded border border-border bg-background px-2 text-sm text-foreground" min="0" max="5" />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-muted-foreground">Next Frames:</label>
            <input type="number" value={onionSkinSettings.nextFrames} onChange={e => setOnionSkinSettings(s => ({ ...s, nextFrames: Math.max(0, Math.min(5, parseInt(e.target.value) || 0)) }))} className="w-12 h-7 rounded border border-border bg-background px-2 text-sm text-foreground" min="0" max="5" />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-muted-foreground">Opacity:</label>
            <input type="range" value={onionSkinSettings.opacity} onChange={e => setOnionSkinSettings(s => ({ ...s, opacity: parseFloat(e.target.value) }))} className="flex-1 h-7" min="0" max="1" step="0.1" />
          </div>
        </div>
      </div>

      <div className="rounded border border-border/70 bg-panel/40 max-h-[300px] overflow-y-auto zphoto-scroll">
        {frames.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Film size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No frames yet. Add frames from the active layer.</p>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-2">
            {frames.map((frame, idx) => (
              <div key={frame.id} className="relative group">
                <canvas
                  width={80}
                  height={60}
                  className="w-full aspect-video rounded border border-border/50 bg-[repeating-conic-gradient(#3a3a3a_0%_25%,#2c2c2c_0%_50%)] [background-size:8px_8px]"
                  ref={el => {
                    if (el) {
                      const ctx = el.getContext('2d')!
                      ctx.clearRect(0, 0, 80, 60)
                      const s = Math.min(80 / frame.canvas.width, 60 / frame.canvas.height)
                      ctx.drawImage(frame.canvas, (80 - frame.canvas.width * s) / 2, (60 - frame.canvas.height * s) / 2, frame.canvas.width * s, frame.canvas.height * s)
                    }
                  }}
                />
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[9px] px-1 py-0.5 flex justify-between">
                  <span>{frame.name}</span>
                  <span>{frame.duration}ms</span>
                </div>
                <div className="absolute top-0 right-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={e => { e.stopPropagation(); duplicateFrameFn(frame.id) }} className="p-0.5 rounded bg-background/90 hover:bg-primary/20" title="Duplicate"><Plus size={10} /></button>
                  <button onClick={e => { e.stopPropagation(); removeFrame(frame.id) }} className="p-0.5 rounded bg-background/90 hover:bg-destructive/20 text-destructive" title="Delete"><Trash2 size={10} /></button>
                  <button onClick={e => { e.stopPropagation(); moveFrame(frame.id, -1) }} className="p-0.5 rounded bg-background/90" title="Move Up" disabled={idx === 0}><ChevronUp size={10} /></button>
                  <button onClick={e => { e.stopPropagation(); moveFrame(frame.id, 1) }} className="p-0.5 rounded bg-background/90" title="Move Down" disabled={idx === frames.length - 1}><ChevronDown size={10} /></button>
                </div>
                <input type="number" value={frame.duration} onChange={e => setFrames(f => f.map((fr, i) => i === idx ? { ...fr, duration: parseInt(e.target.value) || 100 } : fr))} className="absolute bottom-0 left-0 w-full h-6 bg-black/50 text-white text-[9px] px-1 border-none focus:outline-none focus:bg-black/70" min="10" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded border border-border/70 bg-panel/40 p-3 space-y-2">
        <h4 className="text-[11px] font-medium text-foreground">Export</h4>
        <div className="flex flex-wrap gap-2">
          <select value={exportFormat} onChange={e => setExportFormat(e.target.value as any)} className="h-8 rounded border border-border bg-background px-2 text-sm text-foreground">
            <option value="gif">GIF (animated)</option>
            <option value="webp">WebP (animated)</option>
            <option value="apng">APNG (animated)</option>
            <option value="spritesheet">Sprite Sheet (PNG)</option>
          </select>
          <Button size="sm" onClick={exportAnimation} disabled={running || frames.length === 0}>
            <Download size={13} className="mr-1.5" /> {running ? 'Exporting…' : `Export as ${exportFormat.toUpperCase()}`}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">{frames.length} frame{frames.length !== 1 ? 's' : ''} · {Math.round(frames.reduce((sum, f) => sum + f.duration, 0) / 1000 * 10) / 10}s total</p>
      </div>
    </div>
  )
}

/** re-exported helper so menus.ts can share the file-picker flow */
export function pickAndInstallPluginFile(): void {
  pickPluginFile(file => {
    void pluginManager.installFromFile(file).catch(() => { /* toasts come from the dialog flow */ })
  })
}
