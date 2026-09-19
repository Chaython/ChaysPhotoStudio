import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, combineMode, drawCross } from './shared'

export const magicWandTool: Tool = {
  id: 'magic-wand',
  cursor: 'crosshair',
  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const opts = getOptions('magic-wand')
    engine.magicWand(p.docX, p.docY, {
      tolerance: opts.tolerance ?? 32,
      contiguous: opts.contiguous !== false,
      diagonal: opts.diagonal === true,
      sample: opts.sample ?? 'composite',
      antiAlias: opts.antiAlias !== false,
      sampleRadius: opts.sampleRadius ?? 1,
      edgeAware: opts.edgeAware ?? 35,
      adaptive: opts.adaptive !== false,
      matchAlpha: opts.matchAlpha === true,
      exactPixels: opts.exactPixels === true,
      feather: opts.feather ?? 0,
      smooth: opts.smooth ?? 0,
      mode: combineMode(p, opts.mode ?? 'new'),
    })
  },
  renderOverlay(ctx, view, w, h, mouse) {
    void view; void w; void h
    drawCross(ctx, mouse)
    if (!mouse) return
    const opts = getOptions('magic-wand')
    const sample = opts.exactPixels ? 'Exact' : `Tol ${Math.round(opts.tolerance ?? 32)}`
    const source = opts.sample === 'layer' ? 'Layer' : 'Merged'
    const text = `${sample} · ${opts.contiguous === false ? 'Global' : 'Contig'} · ${source}`
    ctx.save()
    ctx.font = '10px ui-monospace, monospace'
    const tw = ctx.measureText(text).width + 10
    const x = mouse.x + 12, y = mouse.y + 14
    ctx.fillStyle = 'rgba(10,10,12,.78)'
    ctx.fillRect(x, y, tw, 17)
    ctx.fillStyle = '#f4c47c'
    ctx.fillText(text, x + 5, y + 12)
    ctx.restore()
  },
}
