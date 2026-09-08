// AI Object Detection backend — cloud vision bounding-box detection.
//
// Contract:
//   POST { image: "data:image/jpeg;base64,..." }   (png/webp also accepted)
//   → 200 { objects: [{ label, x, y, w, h }] }     coords normalized 0..1
//     (x,y = top-left corner, w/h as fractions of image width/height);
//     an empty array is a valid success ("no clear objects").
//   → 400 { error } on a missing/invalid/too-large (>9 MB) payload.
//   → 500 { error: "Detection failed: <reason>" } when both attempts fail.
//
// The z-ai-web-dev-sdk vision chat model runs SERVER-SIDE ONLY; its JSON is
// parsed defensively (markdown fences stripped, [ … ] slice, per-entry
// validation + clamping) and the whole call is retried once, each attempt
// capped at 90s so a hung upstream can never stall the editor.
import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

const MAX_BODY = 9 * 1024 * 1024 // total payload cap (data-URL included)
const MAX_OBJECTS = 24
const MIN_SIZE = 0.004 // min box w/h as a fraction of the image (0.4%)
const WHOLE_IMAGE = 0.9 // area above this ≈ whole-image box → dropped
const ATTEMPTS = 2
const ATTEMPT_TIMEOUT_MS = 90_000
const RETRY_BACKOFF_MS = 1_500

const PROMPT =
  'Detect the distinct visible objects in this image (main subjects plus salient ' +
  'secondary objects). Respond with ONLY a JSON array — no markdown fences, no ' +
  'commentary: [{"label":"<short object name>","box":[x,y,w,h]}] where x,y,w,h are ' +
  'decimal numbers between 0 and 1 — the tight bounding box as fractions of image ' +
  'width/height (x,y = top-left). Boxes must tightly cover each object. At most ' +
  '24 entries. If there are no clear objects, respond with [].'

interface DetectedObject {
  label: string
  x: number
  y: number
  w: number
  h: number
}

// ---------- helpers ----------

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ])
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** short, friendly English reason from an arbitrary failure */
function friendlyReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/timed out|timeout|aborted|Terminate/i.test(raw)) return 'the vision engine timed out'
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|network|Unable to connect|ConnectTimeout/i.test(raw)) {
    return 'could not reach the vision engine'
  }
  if (/no JSON array|could not be parsed/i.test(raw)) {
    return 'the vision engine returned an unreadable response'
  }
  return raw.slice(0, 180).replace(/\s+/g, ' ').trim() || 'unknown error'
}

/** pull the model's text out of the vision response (OpenAI-ish shape). */
function extractText(response: unknown): string {
  const r = response as any
  const content = r?.choices?.[0]?.message?.content ?? r?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : ''))
      .join('')
  }
  return ''
}

/** read the real pixel dimensions out of a data-URL (PNG / JPEG / WebP
 *  magic bytes) — needed to renormalize models that answer in pixels. */
function decodeImageSize(dataUrl: string): { w: number; h: number } | null {
  try {
    const comma = dataUrl.indexOf(',')
    if (comma === -1) return null
    const buf = Buffer.from(dataUrl.slice(comma + 1), 'base64')
    if (buf.length < 24) return null
    // PNG: 8-byte signature + (4 len + 4 'IHDR') → width BE @16, height BE @20
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    }
    // JPEG: walk the marker segments to the first SOF frame header
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue }
        const marker = buf[i + 1]
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
        const len = buf.readUInt16BE(i + 2)
        if (
          marker >= 0xc0 && marker <= 0xcf &&
          marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
        ) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
        }
        if (len <= 0) break
        i += 2 + len
      }
      return null
    }
    // WebP: 'RIFF'…'WEBP' + VP8X / VP8 (lossy) / VP8L (lossless) chunk
    if (
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
    ) {
      const fourcc = buf.toString('ascii', 12, 16)
      if (fourcc === 'VP8X' && buf.length >= 30) {
        return {
          w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
          h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
        }
      }
      if (fourcc === 'VP8 ' && buf.length >= 30) {
        return { w: buf.readUInt16LE(26), h: buf.readUInt16LE(28) }
      }
      if (fourcc === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
        const bits = buf.readUInt32LE(21)
        return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }
      }
      return null
    }
    return null
  } catch {
    return null
  }
}

/** strict-but-forgiving parse: fences stripped, [ … ] sliced, entries
 *  validated (label trimmed/shortened, box = 4 finite numbers, clamped).
 *
 *  COORDINATE SYSTEMS: the prompt asks for [x,y,w,h] fractions of 0..1, but
 *  the vision backend (glm-5v-turbo grounding) ignores that and answers in
 *  PIXELS as [x1,y1,x2,y2] corners. We detect pixels (>1.5), rescale by the
 *  real image dimensions (decoded from the payload magic bytes), and read
 *  corner boxes there; a fraction answer that can only be corners (x+w>1)
 *  is rescued the same way. Everything is clamped into the unit square. */
function parseObjects(raw: string, dims: { w: number; h: number } | null): DetectedObject[] {
  let text = raw.trim()
  // strip ```json fences if present (plus any stray fence markers)
  text = text.replace(/```[a-z]*\s*/gi, '').replace(/```/g, '').trim()

  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON array found in the model response')
  }
  let arr: unknown
  try {
    arr = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('the JSON array could not be parsed')
  }
  if (!Array.isArray(arr)) throw new Error('the model response was not a JSON array')

  // pass 1: collect validated label + 4-number quadruples
  const entries: { label: string; nums: number[] }[] = []
  for (const item of arr as any[]) {
    if (!item || typeof item !== 'object') continue
    // label: string, trimmed, ≤ 40 chars, with fallback
    let label = item.label ?? item.name
    if (typeof label !== 'string' || !label.trim()) label = 'Object'
    label = label.trim().slice(0, 40) || 'Object'
    // box: must be an array of 4 finite numbers
    const box = item.box ?? item.bbox
    if (!Array.isArray(box) || box.length < 4) continue
    const nums = box.slice(0, 4).map(Number)
    if (nums.some(n => !Number.isFinite(n))) continue
    entries.push({ label, nums })
    if (entries.length >= MAX_OBJECTS) break
  }

  // pass 2: renormalize the coordinate system + clamp into the unit square
  const pixelLike = entries.some(e => e.nums.some(v => v > 1.5))
  let sx = dims && dims.w > 0 ? dims.w : 0
  let sy = dims && dims.h > 0 ? dims.h : 0
  if (pixelLike && (!sx || !sy)) {
    // dimensions undecodable → approximate by the largest coordinate seen
    sx = Math.max(1, ...entries.map(e => Math.max(e.nums[0], e.nums[2])))
    sy = Math.max(1, ...entries.map(e => Math.max(e.nums[1], e.nums[3])))
  }

  const out: DetectedObject[] = []
  for (const { label, nums } of entries) {
    let [a, b, c, d] = nums
    let corner = false
    if (pixelLike && sx > 0 && sy > 0) {
      // pixel answer (grounding style [x1,y1,x2,y2]) → fractions
      a /= sx
      b /= sy
      c /= sx
      d /= sy
      corner = c > a && d > b
    }
    // rescue: fraction answer that can only be corner coords (x+w > 1)
    if (
      !corner && c > a && d > b && c <= 1.02 && d <= 1.02 &&
      (a + c > 1.02 || b + d > 1.02)
    ) {
      corner = true
    }

    const x = a
    const y = b
    const w = corner ? c - a : c
    const h = corner ? d - b : d
    if (!(w > 0) || !(h > 0)) continue // degenerate / malformed box

    let cx = Math.min(Math.max(x, 0), 1)
    let cy = Math.min(Math.max(y, 0), 1)
    let cw = Math.max(w, MIN_SIZE)
    let ch = Math.max(h, MIN_SIZE)
    if (cx + cw > 1) cw = Math.max(1 - cx, MIN_SIZE)
    if (cy + ch > 1) ch = Math.max(1 - cy, MIN_SIZE)

    out.push({ label, x: cx, y: cy, w: cw, h: ch })
    if (out.length >= MAX_OBJECTS) break
  }

  // drop whole-image boxes unless that's the only thing we got
  const tight = out.filter(o => o.w * o.h <= WHOLE_IMAGE)
  return tight.length > 0 ? tight.slice(0, MAX_OBJECTS) : out.slice(0, 1)
}

// ---------- main ----------

export async function POST(req: Request) {
  try {
    const bodyText = await req.text()
    if (bodyText.length > MAX_BODY) {
      return NextResponse.json({ error: 'Image payload too large (max 9 MB)' }, { status: 400 })
    }
    let body: { image?: unknown }
    try {
      body = JSON.parse(bodyText)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const image = body.image
    if (typeof image !== 'string' || !image.startsWith('data:image/')) {
      return NextResponse.json(
        { error: 'A base64 data-URL image (data:image/…) is required' },
        { status: 400 },
      )
    }

    const zai = await ZAI.create()
    const dims = decodeImageSize(image)
    let lastErr: unknown = null
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const response = await withTimeout(
          zai.chat.completions.createVision({
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: PROMPT },
                  { type: 'image_url', image_url: { url: image } },
                ],
              },
            ],
            thinking: { type: 'disabled' },
            // the SDK type demands `model`, but the vision endpoint picks its
            // own default when it is omitted (same pattern as the other ZAI
            // routes' union casts).
          } as never),
          ATTEMPT_TIMEOUT_MS,
          `attempt ${attempt}`,
        )
        const objects = parseObjects(extractText(response), dims)
        return NextResponse.json({ objects })
      } catch (err) {
        lastErr = err
      }
      if (attempt === ATTEMPTS) break
      await sleep(RETRY_BACKOFF_MS)
    }

    return NextResponse.json(
      { error: `Detection failed: ${friendlyReason(lastErr)}. The vision engine may be busy — try again.` },
      { status: 500 },
    )
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Detection failed: ${friendlyReason(err)}` },
      { status: 500 },
    )
  }
}
