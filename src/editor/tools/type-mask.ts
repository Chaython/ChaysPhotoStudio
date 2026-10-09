// Photoshop-style Type Mask tools: render glyphs into a selection mask rather
// than adding a text layer. The active pixels and high-bit-depth layers remain
// unchanged; the editor's existing selection/history engine owns the result.
import type { Tool, PointerInfo, ToolId } from '../types'
import { engine } from '../engine/engine'
import { combineMode, getOptions } from './shared'
import { createCanvas, ctx2d, clamp } from '../utils/canvas'

type Direction = 'horizontal' | 'vertical'

function maskOptions(id: ToolId) {
  const options = getOptions(id)
  return {
    text: String(options.text ?? 'TYPE').slice(0, 120),
    size: clamp(Number(options.size) || 64, 4, 1024),
    family: String(options.family ?? 'Arial, sans-serif'),
    bold: !!options.bold,
    italic: !!options.italic,
    lineSpacing: clamp(Number(options.lineSpacing) || 110, 50, 250) / 100,
    mode: options.mode ?? 'new',
  }
}

function textFont(options: ReturnType<typeof maskOptions>, size = options.size) {
  return `${options.italic ? 'italic ' : ''}${options.bold ? 'bold ' : ''}${size}px ${options.family}`
}

function drawTypeMask(c: CanvasRenderingContext2D, x: number, y: number, opts: ReturnType<typeof maskOptions>, direction: Direction, zoom = 1) {
  if (!opts.text.trim()) return
  const size = opts.size * zoom
  c.save()
  c.textBaseline = 'alphabetic'
  c.textAlign = 'left'
  c.font = textFont(opts, size)
  c.fillStyle = '#ffffff'
  const lines = opts.text.split(/\r?\n/).slice(0, 10)
  if (direction === 'horizontal') {
    lines.forEach((line, i) => c.fillText(line, x, y + i * size * opts.lineSpacing))
  } else {
    let column = 0
    for (const line of lines) {
      let row = 0
      for (const glyph of Array.from(line)) {
        c.fillText(glyph, x - column * size * opts.lineSpacing, y + row * size * opts.lineSpacing)
        row++
      }
      column++
    }
  }
  c.restore()
}

function makeTypeMask(id: 'type-mask-horizontal' | 'type-mask-vertical', direction: Direction): Tool {
  return {
    id,
    cursor: 'text',
    onPointerDown(p: PointerInfo) {
      if (p.button !== 0) return
      const doc = engine.activeDoc
      if (!doc) return
      const options = maskOptions(id)
      if (!options.text.trim()) return
      const mask = createCanvas(doc.width, doc.height)
      const c = ctx2d(mask)
      drawTypeMask(c, p.docX, p.docY, options, direction)
      engine.setSelectionMask(mask, combineMode(p, options.mode), direction === 'horizontal' ? 'Horizontal Type Mask' : 'Vertical Type Mask')
    },
    renderOverlay(ctx, view, w, h, mouse) {
      void w; void h
      if (!mouse || !engine.activeDoc) return
      const options = maskOptions(id)
      if (!options.text.trim()) return
      ctx.save()
      ctx.globalAlpha = 0.5
      drawTypeMask(ctx, mouse.x, mouse.y, options, direction, view.zoom)
      ctx.restore()
    },
  }
}

export const horizontalTypeMaskTool = makeTypeMask('type-mask-horizontal', 'horizontal')
export const verticalTypeMaskTool = makeTypeMask('type-mask-vertical', 'vertical')
