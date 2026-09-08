// ============================================================
// Frame animation helpers + export orchestration (Task 9-c)
//  · frameThumb()  — cached per-frame mini composite for the timeline strip
//  · exportAnimation() — renders every frame via engine.getFrameComposite
//    (live doc never disturbed), optional downscale, GIF / APNG encode,
//    download + progress + toast
// ============================================================
import type { PsDocument } from '../types'
import type { Engine } from '../engine/engine'
import { resampleCanvas, downloadBlob } from '../utils/canvas'
import { useEditorStore } from '../store'
import { encodeGif } from './gif-encoder'
import { encodeApng } from './apng-encoder'

// ---------- thumbnail cache ------------------------------------------------------

interface ThumbEntry { canvas: HTMLCanvasElement; t: number }
const thumbCache = new Map<string, ThumbEntry>()
const THUMB_CACHE_MAX = 64

/** cheap content signature — stable across getFrameComposite's save/restore
 *  cycles (which restore the exact _v counters) but changes on any real
 *  pixel / geometry / epoch change */
function layerEpoch(doc: PsDocument): string {
  let k = `${doc._epoch}|${doc.width}x${doc.height}|`
  for (const l of doc.layers) k += `${l._v}.${l._mv},`
  return k
}

/** downscaled snapshot of frame i (64px default). Recomputed only when the
 *  doc pixels, frame overrides or size change — the engine's live layer
 *  state is left untouched (getFrameComposite restores everything). */
export function frameThumb(doc: PsDocument, engine: Engine, i: number, w = 64): HTMLCanvasElement | null {
  const frames = doc.frames ?? []
  const fr = frames[i]
  if (!fr) return null
  const key = `${doc.id}|${fr.id}|${w}|${layerEpoch(doc)}|${JSON.stringify(fr.layers)}`
  const hit = thumbCache.get(key)
  if (hit) {
    hit.t = performance.now()
    return hit.canvas
  }
  const flat = engine.getFrameComposite(i)
  if (!flat) return null
  const h = Math.max(8, Math.round((w * doc.height) / Math.max(1, doc.width)))
  const thumb = resampleCanvas(flat, w, h)
  thumbCache.set(key, { canvas: thumb, t: performance.now() })
  if (thumbCache.size > THUMB_CACHE_MAX) {
    let oldest: string | null = null
    let t = Infinity
    for (const [k, v] of thumbCache) if (v.t < t) { t = v.t; oldest = k }
    if (oldest) thumbCache.delete(oldest)
  }
  return thumb
}

// ---------- export ----------------------------------------------------------------

const yieldToUI = () => new Promise<void>(r => setTimeout(r, 0))

export interface AnimationExportOptions {
  /** output size multiplier (default 1) */
  scale?: number
  /** GIF palette size (GIF only) */
  colors?: number
  /** GIF Floyd–Steinberg dithering (GIF only) */
  dither?: boolean
}

/** Render every frame and export as animated GIF (.gif) or APNG (.png).
 *  The active frame / live layer state is preserved throughout (each frame
 *  is composited through engine.getFrameComposite's save/restore cycle). */
export async function exportAnimation(
  doc: PsDocument,
  engine: Engine,
  format: 'gif' | 'apng',
  opts: AnimationExportOptions = {},
): Promise<void> {
  const frames = doc.frames ?? []
  if (!frames.length) {
    useEditorStore.getState().pushToast('No frames to export — create a frame animation first', 'error')
    return
  }
  const scale = opts.scale ?? 1
  const total = frames.length
  const store = useEditorStore.getState()
  store.setProgress({ active: true, label: `Rendering frames (0/${total})…`, value: 0 })
  try {
    const rendered: { canvas: HTMLCanvasElement; delayMs: number }[] = []
    for (let i = 0; i < total; i++) {
      const flat = engine.getFrameComposite(i)
      if (!flat) continue
      const out = scale !== 1
        ? resampleCanvas(flat, Math.max(1, Math.round(doc.width * scale)), Math.max(1, Math.round(doc.height * scale)))
        : flat
      rendered.push({ canvas: out, delayMs: Math.max(10, frames[i].delayMs) })
      useEditorStore.getState().setProgress({
        active: true,
        label: `Rendering frames (${i + 1}/${total})…`,
        value: ((i + 1) / total) * 0.4,
      })
      await yieldToUI()
    }
    if (!rendered.length) {
      useEditorStore.getState().pushToast('Nothing to export — no frames could be rendered', 'error')
      return
    }

    if (format === 'gif') {
      useEditorStore.getState().setProgress({ active: true, label: 'Encoding GIF…', value: 0.45 })
      const blob = await encodeGif(rendered, {
        colors: opts.colors,
        dither: opts.dither,
        loopForever: true,
        transparentBg: true,
        onProgress: frac => useEditorStore.getState().setProgress({
          active: true,
          label: `Encoding GIF (${Math.round(frac * rendered.length)}/${rendered.length})…`,
          value: 0.45 + frac * 0.5,
        }),
      })
      downloadBlob(blob, `${doc.name}.gif`)
      useEditorStore.getState().pushToast(`GIF exported — ${rendered.length} frame${rendered.length > 1 ? 's' : ''}`, 'success')
    } else {
      useEditorStore.getState().setProgress({ active: true, label: 'Encoding APNG…', value: 0.45 })
      const blob = await encodeApng(rendered, {
        loopForever: true,
        onProgress: frac => useEditorStore.getState().setProgress({
          active: true,
          label: `Encoding APNG (${Math.max(1, Math.round(frac * rendered.length))}/${rendered.length})…`,
          value: 0.45 + frac * 0.5,
        }),
      })
      downloadBlob(blob, `${doc.name}.png`)
      useEditorStore.getState().pushToast(`APNG exported — ${rendered.length} frame${rendered.length > 1 ? 's' : ''}`, 'success')
    }
  } catch (err) {
    useEditorStore.getState().pushToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
  } finally {
    useEditorStore.getState().setProgress(null)
  }
}
