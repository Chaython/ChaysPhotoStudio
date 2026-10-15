import { pdfEditableText, pdfEditableVectors, pdfEditableTextWidgets, pdfEditableButtonWidgets, type PdfOps } from '../src/editor/formats/pdf-native'

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
check(text[0].metadata?.sourceObjectKey === 'pdf:p2:text:0', 'text provenance key is page-scoped')
check(text[0].metadata?.sourceTextIndex === 0 && text[0].metadata?.sourceText === 'Editable PDF text',
  'PDF text keeps its source item index and original value')
check(JSON.stringify(text[0].metadata?.sourceTextTransform) === JSON.stringify([16, 0, 0, 16, 12, 44]),
  'PDF text keeps its original transform')

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
check(vector[0].metadata?.sourceObjectKey === 'pdf:p1:path:1', 'vector provenance key is page-scoped')
check(vector[0].metadata?.sourceOperatorIndex === 1 && vector[0].metadata?.sourcePaintOperator === 22,
  'PDF path keeps its operator location and original paint opcode')

// Packed PDF.js RGB channels must remain byte-valued even when a channel is 1.
const nearBlack = pdfEditableVectors({
  fnArray: [59, 91],
  argsArray: [[new Uint8Array([1, 2, 3])], [22, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(nearBlack[0]?.shape?.fill === '#010203',
  'packed Uint8 PDF colors must not promote low byte channels to white')
const clampedNearBlack = pdfEditableVectors({
  fnArray: [59, 91],
  argsArray: [[new Uint8ClampedArray([1, 2, 3])], [22, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(clampedNearBlack[0]?.shape?.fill === '#010203',
  'clamped packed PDF colors must retain low byte channels')
const normalizedRgb = pdfEditableVectors({
  fnArray: [59, 91],
  argsArray: [[1, 0.5, 0], [22, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(normalizedRgb[0]?.shape?.fill === '#ff8000',
  'normalized float PDF colors must remain normalized')


// Unsupported paint must remain in the authoritative raster reference.
const invalidFill = pdfEditableVectors({
  fnArray: [59, 91],
  argsArray: [[Number.NaN, 0, 0], [22, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(invalidFill.length === 0, 'invalid PDF fill color must not become an editable shape')
const invalidStroke = pdfEditableVectors({
  fnArray: [58, 91],
  argsArray: [[Number.NaN, 0, 0], [20, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(invalidStroke.length === 0, 'invalid PDF stroke color must not become an editable shape')

// Malformed PDF graphics states must never become misleading native shapes.
for (const malformed of [null, '1', Number.NaN, Infinity]) {
  const badColor = pdfEditableVectors({
    fnArray: [59, 91],
    argsArray: [[malformed, 0, 0], [22, [rect], [0, 0, 200, 120]]],
  }, ops, viewport, 400, 240, 1)
  check(badColor.length === 0, 'invalid channel must stay in the visual reference')
}
const badLineWidth = pdfEditableVectors({
  fnArray: [2, 91],
  argsArray: [[Infinity], [20, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(badLineWidth.length === 0, 'invalid PDF line width must not become a shape')
const overflowTransform = pdfEditableVectors({
  fnArray: [12, 91],
  argsArray: [[1e308, 0, 0, 1e308, 0, 0], [22, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(overflowTransform.length === 0, 'overflowing PDF transforms must not become shapes')
const inheritedPaint = pdfEditableVectors({
  fnArray: [10, 59, 11, 91],
  argsArray: [[], [1, 0, 0], [], [22, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(inheritedPaint[0]?.shape?.fill === '#000000', 'PDF save/restore must restore paint state')

// The native path model must not silently fill unclosed PDF contours.
const unclosed = new Float32Array([0, 0, 0, 1, 20, 0, 1, 20, 20])
const openFill = pdfEditableVectors({
  fnArray: [91], argsArray: [[22, [unclosed], [0, 0, 20, 20]]],
}, ops, viewport, 400, 240, 1)
check(openFill.length === 0, 'filled open PDF contours must stay in raster reference')
const openStroke = pdfEditableVectors({
  fnArray: [91], argsArray: [[20, [unclosed], [0, 0, 20, 20]]],
}, ops, viewport, 400, 240, 1)
check(openStroke.length === 1 && openStroke[0].shape?.pathClosed === false,
  'an open stroked PDF contour must remain editable')
const unmatchedRestore = pdfEditableVectors({
  fnArray: [11, 91], argsArray: [[], [22, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(unmatchedRestore.length === 0, 'unbalanced PDF graphics restore must not create shapes')
const unknownGroup = pdfEditableVectors({
  fnArray: [77, 91], argsArray: [[], [22, [rect], [0, 0, 200, 120]]],
}, ops, viewport, 400, 240, 1)
check(unknownGroup.length === 0, 'unbalanced transparency group must not create shapes')

// Control points outside the path endpoints must expand its editable bounds.
const longHandles = new Float32Array([
  0, 10, 10, 2, 100, 10, 120, 10, 20, 20, 1, 30, 30, 4,
])
const handledShape = pdfEditableVectors({
  fnArray: [91],
  argsArray: [[22, [longHandles], [10, 10, 120, 20]]],
}, ops, viewport, 400, 240, 1)
check(handledShape.length === 1 && (handledShape[0].shape?.w ?? 0) > 200,
  'PDF Bezier handles outside endpoints must contribute to shape bounds')

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

const textWidgets = pdfEditableTextWidgets([
  { subtype: 'Widget', fieldType: 'Tx', fieldName: 'Customer', fieldValue: 'Alice',
    rect: [10, 20, 210, 50], id: 'field-a' },
  { subtype: 'Widget', fieldType: 'Tx', fieldName: 'Secret', fieldValue: 'hidden',
    rect: [10, 20, 210, 50], password: true },
  { subtype: 'Widget', fieldType: 'Btn', fieldValue: 'on', rect: [10, 20, 210, 50] },
], [1, 0, 0, -1, 0, 240], 400, 240, 1)
check(textWidgets.length === 1, 'only supported visible text widgets become editable')
check(textWidgets[0].visible === false && textWidgets[0].text?.content === 'Alice',
  'PDF widget value is preserved without changing its visual reference')
check(textWidgets[0].metadata?.sourceObjectKey === 'pdf:p1:widget:0',
  'PDF widget source index and page must remain traceable')

const choiceWidgets = pdfEditableButtonWidgets([
  { subtype: 'Widget', fieldType: 'Btn', checkBox: true, fieldValue: 'Yes',
    fieldName: 'Subscribe', rect: [10, 10, 30, 30], id: 'cb-1' },
  { subtype: 'Widget', fieldType: 'Btn', radioButton: true, fieldValue: 'Off',
    fieldName: 'Preference', rect: [40, 10, 60, 30], id: 'rb-1' },
  { subtype: 'Widget', fieldType: 'Btn', fieldValue: 'Push',
    rect: [70, 10, 90, 30] },
  { subtype: 'Widget', fieldType: 'Btn', checkBox: true, fieldValue: 'Yes',
    rect: [10, 10, 30, 30], hidden: true },
], [1, 0, 0, -1, 0, 240], 400, 240, 3)
check(choiceWidgets.length === 2, 'checkbox/radio widgets recover; push and hidden buttons do not')
check(choiceWidgets[0].shape?.shape === 'rect' && choiceWidgets[1].shape?.shape === 'ellipse',
  'button widget geometry matches checkbox and radio categories')
check(choiceWidgets[0].metadata?.checked === true && choiceWidgets[1].metadata?.checked === false,
  'PDF choice field values and checked states remain available')
check(choiceWidgets[0].metadata?.sourceObjectKey === 'pdf:p3:widget:0',
  'PDF choice widget source identity is preserved')

const realPdfRect = pdfEditableVectors({
  fnArray: [59, 91, 22],
  argsArray: [[1, 0, 0], [[19], new Float32Array([0, 0, 200, 120]), new Float32Array([0, 0, 200, 120])], []],
}, ops, viewport, 400, 240, 1)
check(realPdfRect.length === 1 && realPdfRect[0].shape?.fill === '#ff0000' &&
  realPdfRect[0].shape?.pathAnchors?.length === 4,
  'separate real PDF.js rectangle and fill operators recover editable vector')

const packedRectangle = pdfEditableVectors({
  fnArray: [59, 91],
  argsArray: [[1, 0, 0], [22, [new Float32Array([5, 0, 0, 200, 120])], new Float32Array([0, 0, 200, 120])]],
}, ops, viewport, 400, 240, 1)
check(packedRectangle.length === 1 && packedRectangle[0].shape?.pathAnchors?.length === 4,
  'packed PDF.js rectangle opcode is recovered as four editable anchors')
