import { createCanvas, ctx2d } from '../utils/canvas'

type PsValue = number | string | number[]

function latin1(bytes: Uint8Array): string {
  let out = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    const end = Math.min(bytes.length, i + chunk)
    let s = ''
    for (let j = i; j < end; j++) s += String.fromCharCode(bytes[j])
    out += s
  }
  return out
}

function boundingBox(text: string): [number, number, number, number] {
  const hi = /^%%HiResBoundingBox:\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/m.exec(text)
  const normal = /^%%BoundingBox:\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/m.exec(text)
  const m = hi ?? normal
  if (!m) return [0, 0, 612, 792]
  const values = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number, number]
  if (!values.every(Number.isFinite) || values[2] <= values[0] || values[3] <= values[1]) return [0, 0, 612, 792]
  return values
}

function tokenize(text: string): string[] {
  // Strip comments first. Parenthesized strings are retained as one token so
  // text-heavy EPS files do not explode the operand stack even though this
  // rasterizer intentionally focuses on vector artwork.
  const clean = text.replace(/%[^\r\n]*/g, '')
  const re = /\([^()]*(?:\\.[^()]*)*\)|\[[^\]]*\]|\{[^{}]*\}|\/[^\s\[\]{}()<>]+|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?|[^\s\[\]{}()<>]+/g
  return clean.match(re) ?? []
}

function parseArray(token: string): number[] {
  if (!token.startsWith('[')) return []
  return (token.slice(1, -1).match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [])
    .map(Number)
    .filter(Number.isFinite)
}

function rgbFromCmyk(c: number, m: number, y: number, k: number): [number, number, number] {
  return [
    1 - Math.min(1, c + k),
    1 - Math.min(1, m + k),
    1 - Math.min(1, y + k),
  ]
}

function cssRgb(r: number, g: number, b: number): string {
  return `rgb(${Math.round(Math.max(0, Math.min(1, r)) * 255)} ${Math.round(Math.max(0, Math.min(1, g)) * 255)} ${Math.round(Math.max(0, Math.min(1, b)) * 255)})`
}

const aliases: Record<string, string> = {
  m: 'moveto', M: 'moveto', _m: 'moveto',
  l: 'lineto', L: 'lineto', _l: 'lineto',
  c: 'curveto', C: 'curveto', _c: 'curveto',
  h: 'closepath', H: 'closepath', cp: 'closepath',
  n: 'newpath', N: 'newpath',
  s: 'stroke', S: 'stroke',
  f: 'fill', F: 'fill', _f: 'fill',
  fstar: 'eofill',
  q: 'gsave', Q: 'grestore',
  w: 'setlinewidth',
  J: 'setlinecap', j: 'setlinejoin', Miter: 'setmiterlimit',
  rg: 'setrgbcolor', RG: 'setrgbcolor',
  g: 'setgray', G: 'setgray',
  k: 'setcmykcolor', K: 'setcmykcolor',
}

/**
 * Safe client-side EPS / legacy Illustrator rasterizer.
 *
 * This intentionally interprets the common vector graphics subset used by EPS:
 * paths, fills/strokes, clipping, transforms, colors and line styles. It does
 * not execute arbitrary PostScript procedures, file/system operators, embedded
 * programs or external resources. That makes untrusted artwork substantially
 * safer than embedding a general PostScript VM while covering normal exported
 * vector shapes.
 */
export function decodeEpsPostScript(bytes: Uint8Array): HTMLCanvasElement {
  const text = latin1(bytes)
  if (!/^%!PS-Adobe/m.test(text) && !/^%!PS/m.test(text)) throw new Error('Not an EPS/PostScript file')
  const [llx, lly, urx, ury] = boundingBox(text)
  const widthPt = Math.max(1, urx - llx)
  const heightPt = Math.max(1, ury - lly)
  const scale = Math.min(4, Math.max(1, 2)) // 144 dpi default from 72-point PostScript units.
  let width = Math.max(1, Math.ceil(widthPt * scale))
  let height = Math.max(1, Math.ceil(heightPt * scale))
  const maxSide = 16384
  const maxPixels = 80_000_000
  const shrink = Math.min(1, maxSide / Math.max(width, height), Math.sqrt(maxPixels / (width * height)))
  width = Math.max(1, Math.floor(width * shrink))
  height = Math.max(1, Math.floor(height * shrink))
  const sx = width / widthPt
  const sy = height / heightPt

  const canvas = createCanvas(width, height, { bitDepth: 8, colorSpace: 'srgb' })
  const ctx = ctx2d(canvas)
  ctx.setTransform(sx, 0, 0, -sy, -llx * sx, ury * sy)
  ctx.lineWidth = 1
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  ctx.fillStyle = '#000'
  ctx.strokeStyle = '#000'
  ctx.beginPath()

  const tokens = tokenize(text)
  if (tokens.length > 2_000_000) throw new Error('EPS program is too large')
  const stack: PsValue[] = []
  const popNum = (): number => {
    const v = stack.pop()
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  const popArray = (): number[] => {
    const v = stack.pop()
    return Array.isArray(v) ? v : []
  }

  let ops = 0
  for (let ti = 0; ti < tokens.length; ti++) {
    if (++ops > 2_500_000) throw new Error('EPS operation limit exceeded')
    const token = tokens[ti]
    const number = Number(token)
    if (token && Number.isFinite(number) && /^[-+\d.]/.test(token)) {
      if (stack.length < 4096) stack.push(number)
      continue
    }
    if (token.startsWith('[')) {
      if (stack.length < 4096) stack.push(parseArray(token))
      continue
    }
    if (token.startsWith('(')) {
      // Keep the operand stack balanced for show/stringwidth operations; text
      // rendering is deliberately not attempted without the original fonts.
      if (stack.length < 4096) stack.push(token)
      continue
    }
    if (token.startsWith('/') || token.startsWith('{')) continue

    const op = aliases[token] ?? token
    switch (op) {
      case 'moveto': {
        const y = popNum(), x = popNum()
        ctx.moveTo(x, y)
        break
      }
      case 'rmoveto': {
        const y = popNum(), x = popNum()
        ctx.translate(x, y)
        break
      }
      case 'lineto': {
        const y = popNum(), x = popNum()
        ctx.lineTo(x, y)
        break
      }
      case 'curveto': {
        const y3 = popNum(), x3 = popNum(), y2 = popNum(), x2 = popNum(), y1 = popNum(), x1 = popNum()
        ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3)
        break
      }
      case 'closepath': ctx.closePath(); break
      case 'newpath': ctx.beginPath(); break
      case 'stroke':
        ctx.stroke()
        ctx.beginPath()
        break
      case 'fill':
        ctx.fill('nonzero')
        ctx.beginPath()
        break
      case 'eofill':
      case 'f*':
        ctx.fill('evenodd')
        ctx.beginPath()
        break
      case 'clip':
        ctx.clip('nonzero')
        ctx.beginPath()
        break
      case 'eoclip':
        ctx.clip('evenodd')
        ctx.beginPath()
        break
      case 'setrgbcolor': {
        const b = popNum(), g = popNum(), r = popNum()
        const css = cssRgb(r, g, b)
        ctx.fillStyle = css; ctx.strokeStyle = css
        break
      }
      case 'setgray': {
        const v = popNum()
        const css = cssRgb(v, v, v)
        ctx.fillStyle = css; ctx.strokeStyle = css
        break
      }
      case 'setcmykcolor': {
        const k = popNum(), y = popNum(), m = popNum(), cc = popNum()
        const [r, g, b] = rgbFromCmyk(cc, m, y, k)
        const css = cssRgb(r, g, b)
        ctx.fillStyle = css; ctx.strokeStyle = css
        break
      }
      case 'setlinewidth': ctx.lineWidth = Math.max(0.01, Math.abs(popNum())); break
      case 'setlinecap': ctx.lineCap = (['butt', 'round', 'square'][Math.max(0, Math.min(2, Math.round(popNum())))]) as CanvasLineCap; break
      case 'setlinejoin': ctx.lineJoin = (['miter', 'round', 'bevel'][Math.max(0, Math.min(2, Math.round(popNum())))]) as CanvasLineJoin; break
      case 'setmiterlimit': ctx.miterLimit = Math.max(1, popNum()); break
      case 'setdash': {
        const phase = popNum()
        const dash = popArray()
        ctx.setLineDash(dash.map(x => Math.max(0, x)))
        ctx.lineDashOffset = phase
        break
      }
      case 'gsave': ctx.save(); break
      case 'grestore': ctx.restore(); break
      case 'translate': {
        const y = popNum(), x = popNum()
        ctx.translate(x, y)
        break
      }
      case 'scale': {
        const y = popNum(), x = popNum()
        ctx.scale(x, y)
        break
      }
      case 'rotate': ctx.rotate((popNum() * Math.PI) / 180); break
      case 'concat': {
        const f = popNum(), e = popNum(), d = popNum(), cc = popNum(), b = popNum(), a = popNum()
        ctx.transform(a, b, cc, d, e, f)
        break
      }
      case 'rectfill': {
        const h = popNum(), w = popNum(), y = popNum(), x = popNum()
        ctx.fillRect(x, y, w, h)
        break
      }
      case 'rectstroke': {
        const h = popNum(), w = popNum(), y = popNum(), x = popNum()
        ctx.strokeRect(x, y, w, h)
        break
      }
      case 'show':
      case 'ashow':
      case 'widthshow':
      case 'awidthshow':
      case 'stringwidth':
        stack.length = Math.max(0, stack.length - 1)
        break
      case 'showpage':
      case 'copypage':
      case 'bind':
      case 'def':
      case 'dict':
      case 'begin':
      case 'end':
      case 'findfont':
      case 'scalefont':
      case 'setfont':
      case 'save':
      case 'restore':
        break
      default:
        // Unknown operators are ignored; arbitrary PostScript execution is not
        // supported by design. Bound the stack so malformed input stays cheap.
        if (stack.length > 2048) stack.splice(0, stack.length - 1024)
        break
    }
  }
  return canvas
}
