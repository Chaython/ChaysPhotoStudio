import type { ParsedDocument, ParsedDocumentLayer } from './document-parser-types'
import { bytesToCanvas, finite, percentOpacity, safeName } from './parser-utils'
import type { PathAnchor } from '../types'

interface Matrix { a: number; b: number; c: number; d: number; e: number; f: number }
const ID: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

function mul(p: Matrix, q: Matrix): Matrix {
  return {
    a: p.a * q.a + p.c * q.b,
    b: p.b * q.a + p.d * q.b,
    c: p.a * q.c + p.c * q.d,
    d: p.b * q.c + p.d * q.d,
    e: p.a * q.e + p.c * q.f + p.e,
    f: p.b * q.e + p.d * q.f + p.f,
  }
}
function point(m: Matrix, x: number, y: number) {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
}
function parseTransform(text: string | null): Matrix {
  let out = ID
  const src = text ?? ''
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/ig
  let match: RegExpExecArray | null
  while ((match = re.exec(src))) {
    const nums = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number)
    let m = ID
    if (match[1].toLowerCase() === 'matrix' && nums.length >= 6) {
      m = { a: nums[0], b: nums[1], c: nums[2], d: nums[3], e: nums[4], f: nums[5] }
    } else if (match[1].toLowerCase() === 'translate') {
      m = { ...ID, e: nums[0] || 0, f: nums[1] || 0 }
    } else if (match[1].toLowerCase() === 'scale') {
      const sx = Number.isFinite(nums[0]) ? nums[0] : 1
      const sy = Number.isFinite(nums[1]) ? nums[1] : sx
      m = { ...ID, a: sx, d: sy }
    } else if (match[1].toLowerCase() === 'rotate') {
      const r = (nums[0] || 0) * Math.PI / 180
      const c = Math.cos(r), s = Math.sin(r)
      const rot = { a: c, b: s, c: -s, d: c, e: 0, f: 0 }
      if (nums.length >= 3) {
        const [cx, cy] = [nums[1], nums[2]]
        m = mul(mul({ ...ID, e: cx, f: cy }, rot), { ...ID, e: -cx, f: -cy })
      } else m = rot
    }
    out = mul(out, m)
  }
  return out
}

function styleMap(el: Element): Record<string, string> {
  const out: Record<string, string> = {}
  const inline = el.getAttribute('style') ?? ''
  for (const part of inline.split(';')) {
    const i = part.indexOf(':')
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim()
  }
  return out
}
function prop(el: Element, key: string, fallback = ''): string {
  return el.getAttribute(key) ?? styleMap(el)[key.toLowerCase()] ?? fallback
}
function paint(el: Element, key: 'fill' | 'stroke', fallback: string | null): string | null {
  const value = prop(el, key, fallback ?? '')
  if (!value || value === 'none' || /^url\(/i.test(value)) return null
  return value
}
function px(value: string | null, fallback = 0): number {
  if (value == null) return fallback
  const m = /^\s*(-?(?:\d+\.?\d*|\.\d+))/.exec(value)
  return m ? finite(m[1], fallback) : fallback
}

function rectBounds(root: Element): { width: number; height: number; minX: number; minY: number } {
  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if (vb.length >= 4 && vb.every(Number.isFinite)) {
    return { minX: vb[0], minY: vb[1], width: Math.max(1, vb[2]), height: Math.max(1, vb[3]) }
  }
  return {
    minX: 0, minY: 0,
    width: Math.max(1, px(root.getAttribute('width'), 1024)),
    height: Math.max(1, px(root.getAttribute('height'), 768)),
  }
}

function tokenizePath(d: string): (string | number)[] {
  const out: (string | number)[] = []
  const re = /([a-zA-Z])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/ig
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) out.push(m[1] ?? Number(m[2]))
  return out
}

function parsePath(d: string, transform: Matrix): { anchors: PathAnchor[]; closed: boolean } | null {
  const t = tokenizePath(d)
  const anchors: PathAnchor[] = []
  let i = 0, cmd = '', x = 0, y = 0, startX = 0, startY = 0, closed = false
  let lastC2: { x: number; y: number } | null = null
  const read = () => typeof t[i] === 'number' ? Number(t[i++]) : NaN
  const addPoint = (nx: number, ny: number, inAbs?: {x:number;y:number}, outAbs?: {x:number;y:number}) => {
    const p = point(transform, nx, ny)
    const ia = inAbs ? point(transform, inAbs.x, inAbs.y) : p
    const oa = outAbs ? point(transform, outAbs.x, outAbs.y) : p
    anchors.push({ x: p.x, y: p.y, inX: ia.x - p.x, inY: ia.y - p.y, outX: oa.x - p.x, outY: oa.y - p.y, pair: false })
  }
  const setPrevOut = (c: {x:number;y:number}) => {
    const prev = anchors[anchors.length - 1]
    if (!prev) return
    const tc = point(transform, c.x, c.y)
    prev.outX = tc.x - prev.x; prev.outY = tc.y - prev.y
  }

  while (i < t.length) {
    if (typeof t[i] === 'string') cmd = String(t[i++])
    if (!cmd) return null
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    if (C === 'Z') { closed = true; x = startX; y = startY; cmd = ''; lastC2 = null; continue }
    if (C === 'M' || C === 'L') {
      let nx = read(), ny = read()
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) break
      if (rel) { nx += x; ny += y }
      x = nx; y = ny
      if (!anchors.length || C === 'M') { startX = x; startY = y }
      addPoint(x, y)
      if (C === 'M') cmd = rel ? 'l' : 'L'
      lastC2 = null
      continue
    }
    if (C === 'H') {
      let nx = read(); if (!Number.isFinite(nx)) break
      if (rel) nx += x; x = nx; addPoint(x, y); lastC2 = null; continue
    }
    if (C === 'V') {
      let ny = read(); if (!Number.isFinite(ny)) break
      if (rel) ny += y; y = ny; addPoint(x, y); lastC2 = null; continue
    }
    if (C === 'C') {
      let x1=read(),y1=read(),x2=read(),y2=read(),nx=read(),ny=read()
      if (![x1,y1,x2,y2,nx,ny].every(Number.isFinite)) break
      if (rel) { x1+=x;y1+=y;x2+=x;y2+=y;nx+=x;ny+=y }
      setPrevOut({x:x1,y:y1}); x=nx;y=ny; addPoint(x,y,{x:x2,y:y2}); lastC2={x:x2,y:y2}; continue
    }
    if (C === 'S') {
      let x2=read(),y2=read(),nx=read(),ny=read()
      if (![x2,y2,nx,ny].every(Number.isFinite)) break
      if (rel) { x2+=x;y2+=y;nx+=x;ny+=y }
      const x1=lastC2 ? 2*x-lastC2.x : x, y1=lastC2 ? 2*y-lastC2.y : y
      setPrevOut({x:x1,y:y1}); x=nx;y=ny; addPoint(x,y,{x:x2,y:y2}); lastC2={x:x2,y:y2}; continue
    }
    if (C === 'Q') {
      let qx=read(),qy=read(),nx=read(),ny=read()
      if (![qx,qy,nx,ny].every(Number.isFinite)) break
      if (rel) { qx+=x;qy+=y;nx+=x;ny+=y }
      const c1={x:x+2/3*(qx-x),y:y+2/3*(qy-y)}
      const c2={x:nx+2/3*(qx-nx),y:ny+2/3*(qy-ny)}
      setPrevOut(c1); x=nx;y=ny; addPoint(x,y,c2); lastC2=c2; continue
    }
    // Arc and other commands need geometry conversion; fail this path only.
    return null
  }
  return anchors.length >= 2 ? { anchors, closed } : null
}

async function dataImageLayer(el: Element, m: Matrix, warnings: string[]): Promise<ParsedDocumentLayer | null> {
  const href = el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? ''
  if (!href.startsWith('data:image/')) {
    warnings.push('SVG external <image> references are not fetched during local import')
    return null
  }
  const comma = href.indexOf(',')
  if (comma < 0) return null
  const header = href.slice(5, comma)
  const mime = header.split(';')[0] || 'image/png'
  let bytes: Uint8Array
  try {
    if (/;base64/i.test(header)) {
      const raw = atob(href.slice(comma + 1))
      bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    } else bytes = new TextEncoder().encode(decodeURIComponent(href.slice(comma + 1)))
    const source = await bytesToCanvas(bytes, mime)
    const p = point(m, px(el.getAttribute('x')), px(el.getAttribute('y')))
    return {
      kind: 'raster', name: safeName(el.getAttribute('id'), 'Image'),
      left: p.x, top: p.y, canvas: source,
      opacity: percentOpacity(prop(el, 'opacity', '1'), 100),
      metadata: { sourceFormat: 'svg', sourceTag: 'image' },
    }
  } catch { return null }
}

async function walk(
  parent: Element, parentM: Matrix, out: ParsedDocumentLayer[], warnings: string[],
  originX: number, originY: number,
): Promise<void> {
  for (const el of Array.from(parent.children)) {
    const tag = el.tagName.toLowerCase().replace(/^.*:/, '')
    if (tag === 'defs' || tag === 'metadata' || tag === 'title' || tag === 'desc') continue
    const m0 = mul(parentM, parseTransform(el.getAttribute('transform')))
    const m = { ...m0, e: m0.e - originX, f: m0.f - originY }
    if (tag === 'g' || tag === 'svg' || tag === 'a' || tag === 'switch') {
      await walk(el, m0, out, warnings, originX, originY)
      continue
    }
    const fill = paint(el, 'fill', '#000000')
    const stroke = paint(el, 'stroke', null)
    const strokeWidth = Math.max(0, px(prop(el, 'stroke-width', '0')))
    const opacity = percentOpacity(prop(el, 'opacity', '1'), 100)
    const visible = prop(el, 'display', '') !== 'none' && prop(el, 'visibility', '') !== 'hidden'
    const name = safeName(el.getAttribute('id'), tag)

    if (tag === 'text') {
      const p = point(m, px(el.getAttribute('x')), px(el.getAttribute('y')))
      out.push({
        kind: 'text', name, visible, opacity,
        text: {
          content: el.textContent ?? '',
          fontFamily: prop(el, 'font-family', 'Arial').replace(/^['"]|['"]$/g, ''),
          fontSize: Math.max(1, px(prop(el, 'font-size', '16'), 16)),
          color: fill ?? '#000000',
          bold: /bold|[6-9]00/.test(prop(el, 'font-weight', '400')),
          italic: /italic|oblique/.test(prop(el, 'font-style', 'normal')),
          align: prop(el, 'text-anchor', 'start') === 'middle' ? 'center' : prop(el, 'text-anchor', 'start') === 'end' ? 'right' : 'left',
          lineHeight: 1.2, tracking: px(prop(el, 'letter-spacing', '0'), 0),
          x: p.x, y: p.y,
        },
        metadata: { sourceFormat: 'svg', sourceTag: tag },
      })
      continue
    }

    if (tag === 'image') {
      const l = await dataImageLayer(el, m, warnings)
      if (l) { l.visible = visible; out.push(l) }
      continue
    }

    let shape: any = null
    if (tag === 'rect') {
      const p = point(m, px(el.getAttribute('x')), px(el.getAttribute('y')))
      const w = Math.abs(px(el.getAttribute('width')) * m.a), h = Math.abs(px(el.getAttribute('height')) * m.d)
      const r = Math.max(px(el.getAttribute('rx')), px(el.getAttribute('ry')))
      shape = { shape: r > 0 ? 'rounded-rect' : 'rect', x:p.x,y:p.y,w,h,radius:r, sides:5,starInset:50 }
    } else if (tag === 'circle' || tag === 'ellipse') {
      const cx=px(el.getAttribute('cx')), cy=px(el.getAttribute('cy'))
      const rx=tag==='circle'?px(el.getAttribute('r')):px(el.getAttribute('rx'))
      const ry=tag==='circle'?rx:px(el.getAttribute('ry'))
      const p=point(m,cx-rx,cy-ry)
      shape={shape:'ellipse',x:p.x,y:p.y,w:Math.abs(rx*2*m.a),h:Math.abs(ry*2*m.d),radius:0,sides:5,starInset:50}
    } else if (tag === 'line') {
      const a=point(m,px(el.getAttribute('x1')),px(el.getAttribute('y1')))
      const b=point(m,px(el.getAttribute('x2')),px(el.getAttribute('y2')))
      shape={shape:'line',x:a.x,y:a.y,w:b.x-a.x,h:b.y-a.y,radius:0,sides:5,starInset:50}
    } else if (tag === 'polygon' || tag === 'polyline') {
      const pts=(el.getAttribute('points')??'').trim().split(/[\s,]+/).map(Number)
      const anchors: PathAnchor[]=[]
      for(let i=0;i+1<pts.length;i+=2){const p=point(m,pts[i],pts[i+1]);anchors.push({x:p.x,y:p.y,inX:0,inY:0,outX:0,outY:0,pair:false})}
      if(anchors.length>=2) shape={shape:'path',x:0,y:0,w:1,h:1,radius:0,sides:5,starInset:50,pathAnchors:anchors,pathClosed:tag==='polygon'}
    } else if (tag === 'path') {
      const parsed=parsePath(el.getAttribute('d')??'',m)
      if(parsed) shape={shape:'path',x:0,y:0,w:1,h:1,radius:0,sides:5,starInset:50,pathAnchors:parsed.anchors,pathClosed:parsed.closed}
      else warnings.push(`SVG path “${name}” uses commands not yet convertible to editable Bézier anchors`)
    }

    if (shape) {
      out.push({
        kind:'shape', name, visible, opacity,
        shape:{...shape,fill,fillOpacity:100,stroke,strokeWidth,strokeOpacity:100},
        metadata:{sourceFormat:'svg',sourceTag:tag},
      })
    } else if (!['clipPath','mask','filter','linearGradient','radialGradient','pattern','use'].includes(tag)) {
      warnings.push(`SVG <${tag}> is not yet mapped to an editable native layer`)
    }
  }
}

export async function parseSvgDocument(bytes: Uint8Array, fileName='SVG document'): Promise<ParsedDocument> {
  const xml=new TextDecoder('utf-8',{fatal:false}).decode(bytes)
  const dom=new DOMParser().parseFromString(xml,'image/svg+xml')
  if(dom.querySelector('parsererror')) throw new Error('Malformed SVG document')
  const root=dom.documentElement
  if(root.tagName.toLowerCase().replace(/^.*:/,'')!=='svg') throw new Error('Not an SVG document')
  const b=rectBounds(root)
  const layers:ParsedDocumentLayer[]=[]
  const warnings:string[]=[]
  await walk(root,ID,layers,warnings,b.minX,b.minY)
  let composite:HTMLCanvasElement|null=null
  try{composite=await bytesToCanvas(bytes,'image/svg+xml')}catch{/* native layers can still open */}
  if(!layers.length && composite) layers.push({kind:'raster',name:fileName.replace(/\.[^.]+$/,''),canvas:composite,left:0,top:0})
  if(!layers.length) throw new Error('SVG contains no decodable visual content')
  return {width:Math.ceil(b.width),height:Math.ceil(b.height),name:fileName,sourceBitDepth:8,layers,composite,warnings}
}
