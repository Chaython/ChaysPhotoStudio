import { pdfEditableText, pdfEditableVectors, type PdfOps } from '../src/editor/formats/pdf-native'

function check(ok: unknown, message: string) {
  if (!ok) throw new Error('PDF native editable-object validation: ' + message)
}
const viewport = [2, 0, 0, -2, 0, 240] as const
const text = pdfEditableText({
  styles: { F1: { fontFamily: 'Helvetica' } },
  items: [
    { str: 'Editable PDF text', transform: [16, 0, 0, 16, 12, 44], fontName: 'F1', dir: 'ltr' },
    { str: 'Rotated', transform: [0, 16, -16, 0, 50, 60], fontName: 'F1' },
    { str: '', transform: [16, 0, 0, 16, 50, 60], fontName: 'F1' },
  ],
}, viewport, 400, 240, 2)
check(text.length === 1, 'skip empty/rotated text while retaining horizontal text')
check(text[0].kind === 'text' && text[0].text?.content === 'Editable PDF text', 'text remains native editable')
check(text[0].text?.fontSize === 32, 'font size follows page zoom')
check(Math.abs((text[0].text?.x ?? -1) - 24) < .01, 'text X placement')
check(text[0].visible === false, 'visual-reference appearance preserved')
check(text[0].metadata?.pageNumber === 2, 'page provenance retained')

const ops: PdfOps = {
  save: 10, restore: 11, transform: 12,
  setLineWidth: 2, setFillRGBColor: 59, setStrokeRGBColor: 58,
  setFillGray: 57, setStrokeGray: 56, setFillCMYKColor: 61,
  setStrokeCMYKColor: 60, constructPath: 91, clip: 29, eoClip: 30,
  setGState: 9, beginGroup: 76, endGroup: 77,
}
const rect = new Float32Array([
  0, 0, 0, 1, 200, 0, 1, 200, 120, 1, 0, 120, 4,
])
const vector = pdfEditableVectors({
  fnArray: [59, 91], argsArray: [[1, 0, 0], [22, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(vector.length === 1, 'filled PDF rectangle becomes editable vector')
const shape = vector[0].shape
check(shape?.shape === 'path' && shape.pathClosed && shape.pathAnchors?.length === 4, 'closed native Bezier path')
check(shape?.fill === '#ff0000' && shape?.stroke === null, 'PDF RGB fill preserved')
check(shape?.pathAnchors?.[0].x === 0 && shape.pathAnchors[0].y === 240, 'PDF coordinates mapped from bottom-left')
check(shape?.pathAnchors?.[2].x === 400 && shape.pathAnchors[2].y === 0, 'vector scaled to page pixels')
check(vector[0].visible === false, 'original raster remains visual authority')

// Packed PDF.js RGB channels must remain byte-valued even when a channel is 1.
const nearBlack = pdfEditableVectors({
  fnArray: [59, 91],
  argsArray: [[new Uint8Array([1, 2, 3])], [22, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(nearBlack[0]?.shape?.fill === '#010203',
  'packed Uint8 PDF colors must not promote low byte channels to white')
const normalizedRgb = pdfEditableVectors({
  fnArray: [59, 91],
  argsArray: [[1, 0.5, 0], [22, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(normalizedRgb[0]?.shape?.fill === '#ff8000',
  'normalized float PDF colors must remain normalized')


const complex = pdfEditableVectors({
  fnArray: [29, 91], argsArray: [[], [22, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(complex.length === 0, 'clipped paths not misrepresented as unmasked vectors')
const multiple = pdfEditableVectors({
  fnArray: [91], argsArray: [[22, [new Float32Array([
    0, 0, 0, 1, 10, 10, 0, 20, 20, 1, 30, 30,
  ])], [0, 0, 30, 30]]],
}, ops, viewport, 400, 240, 1)
check(multiple.length === 0, 'compound paths cannot become a mismatched single shape')
console.log('PDF native text and vector conversions: OK')
