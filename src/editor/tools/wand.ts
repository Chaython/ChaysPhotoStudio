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
      mode: combineMode(p, opts.mode ?? 'new'),
    })
  },
  renderOverlay(ctx, view, w, h, mouse) { void view; void w; void h; drawCross(ctx, mouse) },
}
