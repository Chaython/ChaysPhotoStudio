import { strict as assert } from 'node:assert'
import { canvasToPdf } from '../src/editor/formats/pdf-export'

// Mock only the browser image encoder; validate generated PDF structure and offsets.
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9])
const canvas = {
  width: 144, height: 72,
  toBlob(cb: (blob: Blob) => void, type: string) {
    assert.equal(type, 'image/jpeg')
    cb(new Blob([jpeg], { type: 'image/jpeg' }))
  },
} as unknown as HTMLCanvasElement
let filled = false
let drawn = false
const opaqueCanvas = {
  width: 0, height: 0,
  getContext: () => ({
    set fillStyle(_: string) {},
    fillRect: () => { filled = true },
    drawImage: () => { drawn = true },
  }),
  toBlob: (canvas as unknown as { toBlob: Function }).toBlob,
}
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement: (tag: string) => {
    assert.equal(tag, 'canvas')
    return opaqueCanvas
  } },
})
const pdf = new Uint8Array(await (await canvasToPdf(canvas, 72)).arrayBuffer())
assert.ok(filled && drawn, 'transparent source composited onto white before export')
const text = new TextDecoder('latin1').decode(pdf)
assert.ok(text.startsWith('%PDF-1.4'))
assert.ok(text.includes('/MediaBox [0 0 144 72]'))
assert.ok(text.includes('/Subtype /Image /Width 144 /Height 72'))
assert.ok(text.includes('/Filter /DCTDecode /Length 8'))
assert.ok(text.includes('/Contents 5 0 R'))
const xref = Number(text.match(/startxref\n(\d+)\n%%EOF/)?.[1])
assert.equal(text.slice(xref, xref + 4), 'xref')
const lines = text.slice(xref).split('\n')
assert.equal(lines[1], '0 6')
for (let id = 1; id <= 5; id++) {
  const byteOffset = Number(lines[id + 2].slice(0, 10))
  assert.ok(byteOffset > 0)
  assert.equal(text.slice(byteOffset, byteOffset + 8), `${id} 0 obj\n`)
}
assert.equal(pdf.findIndex((x, i) => x === 0xff && pdf[i + 1] === 0xd8), text.indexOf('stream\n') + 7)
await assert.rejects(canvasToPdf(canvas, 0), /resolution/)
console.log('PDF export validation passed')
