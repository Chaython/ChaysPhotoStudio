// ============================================================
// APNG (animated PNG) encoder — from scratch, no npm (Task 9-c)
//  · per frame: canvas.toBlob('image/png') → parse raw chunks
//    (8-byte signature, then length+type+data+crc records)
//  · assembles: PNG signature + IHDR (frame 0) + acTL +
//    frame 0: fcTL + its IDATs · frames 1+: fcTL + fdATs
//    (IDAT data re-tagged with a 4-byte sequence number) + IEND
//  · fcTL: x/y = 0, full width/height, dispose_op 0, blend_op 0
//    (APNG_BLEND_OP_SOURCE — each frame fully replaces) and
//    delay as numerator = delayMs, denominator = 1000
//  · standard table-based CRC32 over chunk type+data
// ============================================================

import { canvasToBlob } from '../utils/canvas'

export interface ApngEncodeOptions {
  /** 0 = loop forever (default true) */
  loopForever?: boolean
  /** 0..1 encoding progress (called once per frame) */
  onProgress?: (frac: number) => void
}

export interface ApngFrameInput {
  canvas: HTMLCanvasElement
  delayMs: number
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

// ---------- CRC32 (table-based) -------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ---------- chunk helpers --------------------------------------------------------

interface PngChunk {
  type: string
  data: Uint8Array<ArrayBuffer>
  /** raw chunk bytes: length + type + data + crc */
  raw: Uint8Array<ArrayBuffer>
}

function makeChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function parseChunks(png: Uint8Array<ArrayBuffer>): PngChunk[] {
  const chunks: PngChunk[] = []
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let p = 8 // skip signature
  while (p + 8 <= png.length) {
    const len = dv.getUint32(p)
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7])
    const end = p + 12 + len
    if (end > png.length) break
    chunks.push({ type, data: png.subarray(p + 8, p + 8 + len), raw: png.subarray(p, end) })
    p = end
    if (type === 'IEND') break
  }
  return chunks
}

/** fcTL chunk — full-canvas frame control, SOURCE blend (full replace) */
function makeFctl(seq: number, w: number, h: number, delayMs: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(26)
  const dv = new DataView(data.buffer)
  dv.setUint32(0, seq)          // sequence_number
  dv.setUint32(4, w)            // width
  dv.setUint32(8, h)            // height
  dv.setUint32(12, 0)           // x_offset = 0
  dv.setUint32(16, 0)           // y_offset = 0
  dv.setUint16(20, Math.min(65535, Math.max(1, Math.round(delayMs)))) // delay_num (ms)
  dv.setUint16(22, 1000)        // delay_den → milliseconds
  data[24] = 0                  // dispose_op = APNG_DISPOSE_OP_NONE
  data[25] = 0                  // blend_op   = APNG_BLEND_OP_SOURCE
  return makeChunk('fcTL', data)
}

// ---------- main entry ------------------------------------------------------------

async function blobBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer())
}

export async function encodeApng(frames: ApngFrameInput[], opts: ApngEncodeOptions = {}): Promise<Blob> {
  if (!frames.length) throw new Error('No frames to encode')
  const loopForever = opts.loopForever !== false
  const onProgress = opts.onProgress

  // 1) rasterize every frame to a PNG and parse its chunks
  const parsed: { chunks: PngChunk[]; delayMs: number }[] = []
  for (let i = 0; i < frames.length; i++) {
    const blob = await canvasToBlob(frames[i].canvas, 'image/png')
    if (!blob) throw new Error(`Frame ${i + 1} could not be encoded to PNG`)
    parsed.push({ chunks: parseChunks(await blobBytes(blob)), delayMs: frames[i].delayMs })
    onProgress?.(((i + 1) / frames.length) * 0.6)
  }

  const first = parsed[0]
  const ihdr = first.chunks.find(c => c.type === 'IHDR')
  if (!ihdr) throw new Error('PNG stream missing IHDR')
  const W = frames[0].canvas.width
  const H = frames[0].canvas.height

  const out: Uint8Array<ArrayBuffer>[] = [PNG_SIGNATURE, ihdr.raw]

  // 2) acTL — animation control (num_frames, num_plays: 0 = forever)
  const actl = new Uint8Array(8)
  const actlDv = new DataView(actl.buffer)
  actlDv.setUint32(0, parsed.length)
  actlDv.setUint32(4, loopForever ? 0 : 1)
  out.push(makeChunk('acTL', actl))

  // 3) frames: fcTL + (frame 0 → IDATs verbatim, others → fdATs re-tagged
  //    with the next sequence number). Sequence numbers count every fcTL
  //    and fdAT in order of appearance.
  let seq = 0
  for (let f = 0; f < parsed.length; f++) {
    const { chunks, delayMs } = parsed[f]
    out.push(makeFctl(seq++, W, H, delayMs))
    for (const c of chunks) {
      if (c.type !== 'IDAT') continue
      if (f === 0) {
        out.push(c.raw)
      } else {
        const data = new Uint8Array(4 + c.data.length)
        const dv = new DataView(data.buffer)
        dv.setUint32(0, seq++)
        data.set(c.data, 4)
        out.push(makeChunk('fdAT', data))
      }
    }
    onProgress?.(0.6 + (0.4 * (f + 1)) / parsed.length)
  }

  // 4) IEND
  const iend = parsed.map(p => p.chunks.find(c => c.type === 'IEND')).find(Boolean)
  out.push(iend ? iend.raw : new Uint8Array([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]))

  return new Blob(out, { type: 'image/png' })
}
