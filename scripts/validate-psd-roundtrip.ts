import assert from 'node:assert/strict'
import { readPsdGuides, writePsdGuides } from '../src/editor/formats/psd-guides'
import { readPsdPaths, writePsdPaths } from '../src/editor/formats/psd-paths'
import { buildPsd, decodePsd, decodePackBitsRow, restorePsdPrediction, psdBlendKeyToMode, blendModeToPsdKey, psdPixelFingerprint, psdNativeObjectKind, stripPsdNativeObjectBlocks, psdImportedSmartIsUnchanged, psdGroupPaths, psdWillReplaceSourceFx, normalizePsdTaggedBlock, parsePsdBlendIfRanges, encodePsdBlendIfRanges, psdHasAdditionalBlendIfRanges } from '../src/editor/formats/psd'

// Minimal 8-bit Canvas2D fixture; tests the real binary writer and reader
// without requiring a graphics stack or a browser installation.
class TestImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    // Canvas ImageData supports both (typedArray, width, height) and
    // (width, height). The latter is used by Photoshop mask reconstruction.
    this.width = typeof dataOrWidth === 'number' ? dataOrWidth : widthOrHeight
    this.height = typeof dataOrWidth === 'number' ? widthOrHeight : height!
    this.data = typeof dataOrWidth === 'number'
      ? new Uint8ClampedArray(this.width * this.height * 4)
      : dataOrWidth
  }
}
class TestCanvas {
  width = 1
  height = 1
  pixels = new Uint8ClampedArray(0)
  getContext() {
    const canvas = this
    return {
      getContextAttributes: () => ({ colorType: 'unorm8', colorSpace: 'srgb' }),
      getImageData(x: number, y: number, w: number, h: number) {
        const data = new Uint8ClampedArray(w * h * 4)
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const source = ((y + j) * canvas.width + x + i) * 4
          const dest = (j * w + i) * 4
          data.set(canvas.pixels.subarray(source, source + 4), dest)
        }
        return new TestImageData(data, w, h)
      },
      putImageData(img: TestImageData, x: number, y: number) {
        if (canvas.pixels.length !== canvas.width * canvas.height * 4) canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4)
        for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) {
          const source = (j * img.width + i) * 4
          const dest = ((y + j) * canvas.width + x + i) * 4
          canvas.pixels.set(img.data.subarray(source, source + 4), dest)
        }
      },
      drawImage() { throw new Error('Unexpected Canvas2D flattening in PSD round-trip test') },
    }
  }
}
;(globalThis as any).ImageData = TestImageData
;(globalThis as any).document = { createElement: (tag: string) => {
  assert.equal(tag, 'canvas')
  return new TestCanvas()
} }

function canvas(r: number, g: number, b: number, a = 255): HTMLCanvasElement {
  const c = new TestCanvas()
  c.width = 2
  c.height = 2
  c.pixels = new Uint8ClampedArray(Array.from({ length: 4 }, () => [r, g, b, a]).flat())
  return c as unknown as HTMLCanvasElement
}


// Adobe resource 1032 stores movable horizontal/vertical guides in units of
// 1/32 pixel. Preserve untouched resource bytes, including grid spacing.
const originalGuides = [
  { orientation: 'v' as const, pos: 13.25 },
  { orientation: 'h' as const, pos: 21.5 },
]
const photoshopGuideBlock = writePsdGuides([], originalGuides)[0]
assert.equal((photoshopGuideBlock[4] << 8) | photoshopGuideBlock[5], 1032)
assert.deepEqual(readPsdGuides([photoshopGuideBlock]), originalGuides)
assert.equal(writePsdGuides([photoshopGuideBlock], originalGuides)[0],
  photoshopGuideBlock, 'Untouched guides must preserve the exact Photoshop resource object')
const customGrid = photoshopGuideBlock.slice()
new DataView(customGrid.buffer).setUint32(12 + 4, 9876)
new DataView(customGrid.buffer).setUint32(12 + 8, 4321)
assert.equal(writePsdGuides([customGrid], originalGuides)[0], customGrid,
  'Unchanged custom Photoshop grid cycles must be byte-preserved')
const shiftedGuides = [
  { orientation: 'v' as const, pos: 29.75 },
  { orientation: 'h' as const, pos: 21.5 },
  { orientation: 'v' as const, pos: 5.125 },
]
const changedGuideResource = writePsdGuides([customGrid], shiftedGuides)[0]
assert.deepEqual(readPsdGuides([changedGuideResource]), shiftedGuides,
  'Edited Studio guides must round-trip through Photoshop fixed-point coordinates')
const changedGrid = new DataView(changedGuideResource.buffer)
assert.equal(changedGrid.getUint32(16), 9876)
assert.equal(changedGrid.getUint32(20), 4321)
const clearedGuideResource = writePsdGuides([customGrid], [])[0]
assert.deepEqual(readPsdGuides([clearedGuideResource]), [],
  'Deleting all native Studio guides must clear the Photoshop guide list')
assert.equal(new DataView(clearedGuideResource.buffer).getUint32(16), 9876,
  'Deleting all guides must retain the original horizontal grid cycle')
assert.equal(new DataView(clearedGuideResource.buffer).getUint32(20), 4321,
  'Deleting all guides must retain the original vertical grid cycle')
assert.throws(() => writePsdGuides([], [{ orientation: 'h', pos: -1 }]),
  /nonnegative document coordinates/, 'Invalid negative guide positions must not be silently exported')
const corruptedGuide = customGrid.slice(0, -3)
assert.deepEqual(readPsdGuides([corruptedGuide]), [],
  'Malformed guide resource is not misinterpreted')
assert.equal(writePsdGuides([corruptedGuide], [])[0], corruptedGuide,
  'Malformed source resources must survive unchanged when no native guides are edited')
assert.throws(() => writePsdGuides([corruptedGuide], shiftedGuides),
  /malformed or duplicate Photoshop guide resources/, 'Editing an unparseable original resource must fail safely')
assert.throws(() => writePsdGuides([customGrid, customGrid], shiftedGuides),
  /malformed or duplicate Photoshop guide resources/, 'Duplicate guide resources must not be silently overwritten')
const guidesWithUnknownTail = new Uint8Array(customGrid.length + 2)
guidesWithUnknownTail.set(customGrid)
guidesWithUnknownTail.set([0x7a, 0x4d], customGrid.length)
new DataView(guidesWithUnknownTail.buffer).setUint32(8, customGrid.length - 12 + 2)
assert.deepEqual(readPsdGuides([guidesWithUnknownTail]), originalGuides)
assert.equal(writePsdGuides([guidesWithUnknownTail], originalGuides)[0], guidesWithUnknownTail,
  'Unchanged guide resources with unknown trailing Adobe data remain byte-identical')
assert.throws(() => writePsdGuides([guidesWithUnknownTail], shiftedGuides),
  /unknown trailing metadata/, 'Editing must not discard unrecognized Photoshop guide metadata')
for (const format of ['psd', 'psb'] as const) {
  const rgb = canvas(50, 110, 170)
  const binary = buildPsd(2, 2, [{
    name: 'Guide markers', canvas: rgb, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
  }], rgb, { format, imageResources: [customGrid] })
  const decoded = await decodePsd(new Uint8Array(await binary.arrayBuffer()))
  assert.deepEqual(decoded.guides, originalGuides, 'PSD and PSB must both decode native ruler guides')
  const resource = decoded.imageResources.find(block => ((block[4] << 8) | block[5]) === 1032)
  assert.deepEqual(Array.from(resource!), Array.from(customGrid),
    'Untouched PSD/PSB must retain the byte-identical Photoshop guide resource')
  const movedResource = writePsdGuides(decoded.imageResources, shiftedGuides)
  const updated = buildPsd(2, 2, [{
    name: 'Guide markers', canvas: decoded.layers[0].canvas, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
  }], decoded.canvas, { format, imageResources: movedResource })
  const reread = await decodePsd(new Uint8Array(await updated.arrayBuffer()))
  assert.deepEqual(reread.guides, shiftedGuides, 'Edited ruler guides survive PSD/PSB export and reimport')
}


// Photoshop saved paths use 26-byte Bézier knot records and document-relative
// signed 8.24 coordinates. Paths must remain editable without destroying
// compound/unknown opaque Photoshop image resources.
const photoshopSavedPath = {
  id: 'studio-path', name: 'Clipping outline', closed: true, visible: true,
  anchors: [
    { x: 10, y: 20, inX: -2, inY: -2, outX: 2, outY: 2, pair: true },
    { x: 90, y: 65, inX: -2, inY: -5, outX: 2, outY: 4, pair: false },
    { x: 70, y: 140, inX: -5, inY: -10, outX: 1, outY: 5, pair: false },
  ],
}
const photoshopPathResources = writePsdPaths([], [photoshopSavedPath], [], 120, 200)
assert.equal(photoshopPathResources.length, 1)
assert.equal((photoshopPathResources[0][4] << 8) | photoshopPathResources[0][5], 2000)
const recognizedPsdPath = readPsdPaths(photoshopPathResources, 120, 200)[0]
assert.ok(recognizedPsdPath)
assert.equal(recognizedPsdPath.name, photoshopSavedPath.name)
assert.equal(recognizedPsdPath.closed, true)
assert.deepEqual(recognizedPsdPath.anchors.map(a => a.pair), [true, false, false])
const rawPhotoshopKnot = photoshopPathResources[0]
const resourceNameBytes = (rawPhotoshopKnot[6] + 2) & ~1
const firstKnotAt = 6 + resourceNameBytes + 4 + 2 * 26
const photoshopControlView = new DataView(rawPhotoshopKnot.buffer)
assert.equal(photoshopControlView.getInt32(firstKnotAt + 6),
  Math.round(8 / 120 * 16777216),
  'Photoshop incoming Bézier handle is an absolute coordinate, not a Studio offset')
assert.equal(photoshopControlView.getInt32(firstKnotAt + 14),
  Math.round(10 / 120 * 16777216),
  'Photoshop Bézier anchor retains its independent absolute X coordinate')
assert.ok(Math.abs(recognizedPsdPath.anchors[0].inX + 2) < 0.0001,
  'Studio imports Adobe absolute controls as offsets from their anchor')
assert.ok(Math.abs(recognizedPsdPath.anchors[0].outY - 2) < 0.0001,
  'Studio imported path handles render correctly with relative Y offsets')

for (const key of ['x', 'y', 'inX', 'inY', 'outX', 'outY'] as const) {
  for (let i = 0; i < 3; i++) assert.ok(
    Math.abs(recognizedPsdPath.anchors[i][key] - photoshopSavedPath.anchors[i][key]) < 0.0001,
    'Photoshop path fixed-point coordinates must reconstruct real document-space Bézier points',
  )
}
assert.equal(writePsdPaths(photoshopPathResources,
  [{ ...photoshopSavedPath, psdPathResourceId: 2000 }], [2000], 120, 200)[0],
  photoshopPathResources[0], 'Unedited Photoshop path must preserve original byte buffer')
const movedPath = {
  ...photoshopSavedPath, psdPathResourceId: 2000,
  anchors: photoshopSavedPath.anchors.map(a => ({ ...a })),
}
movedPath.anchors[1].x = 95
const movedPsdResources = writePsdPaths(photoshopPathResources, [movedPath], [2000], 120, 200)
assert.ok(movedPsdResources[0] !== photoshopPathResources[0])
assert.ok(Math.abs(readPsdPaths(movedPsdResources, 120, 200)[0].anchors[1].x - 95) < 0.0001)
assert.deepEqual(writePsdPaths(photoshopPathResources, [], [2000], 120, 200), [],
  'Removing an imported editable Studio path deletes only its original Photoshop resource')
const unsupportedPath = photoshopPathResources[0].slice()
const pascalNameLength = (unsupportedPath[6] + 2) & ~1
const dataOffset = 6 + pascalNameLength + 4
new DataView(unsupportedPath.buffer).setUint16(dataOffset + 26, 7) // clipboard path record
assert.deepEqual(readPsdPaths([unsupportedPath], 120, 200), [],
  'Unknown Photoshop path records must never become partially editable native paths')
const duplicatePathBlocks = [photoshopPathResources[0], photoshopPathResources[0].slice()]
assert.deepEqual(readPsdPaths(duplicatePathBlocks, 120, 200), [],
  'Duplicate Photoshop path resource IDs must not be exposed as editable objects')
assert.deepEqual(writePsdPaths(duplicatePathBlocks, [], [], 120, 200),
  duplicatePathBlocks, 'Duplicate opaque Photoshop paths are retained unchanged')
const legacyNonAsciiPath = photoshopPathResources[0].slice()
legacyNonAsciiPath[7] = 0xe9
assert.deepEqual(readPsdPaths([legacyNonAsciiPath], 120, 200), [],
  'Legacy Photoshop path names must not be decoded into mojibake')
assert.equal(writePsdPaths([legacyNonAsciiPath], [], [], 120, 200)[0],
  legacyNonAsciiPath, 'Unrecognized legacy path names are preserved byte-for-byte')
const preservedUnknown = writePsdPaths([unsupportedPath], [], [], 120, 200)
assert.equal(preservedUnknown[0], unsupportedPath,
  'Unsupported path resource must remain byte-identical during a no-op export')
assert.equal(writePsdPaths([unsupportedPath], [photoshopSavedPath], [], 120, 200).length, 2,
  'Adding a Studio path must choose a free ID instead of replacing an unknown Photoshop path')
assert.throws(() => writePsdPaths([unsupportedPath],
  [{ ...photoshopSavedPath, psdPathResourceId: 2000 }], [], 120, 200),
  /unsupported or duplicate Photoshop path/, 'Editing unknown Photoshop path data must be rejected')
assert.throws(() => writePsdPaths([], [{ ...photoshopSavedPath, name: '路径' }], [], 120, 200),
  /printable ASCII/, 'Native exports must not misencode Unicode path names as Photoshop Pascal ASCII')
assert.throws(() => writePsdPaths([], [{
  ...photoshopSavedPath, anchors: [{ ...photoshopSavedPath.anchors[0], x: Infinity }, photoshopSavedPath.anchors[1]],
}], [], 120, 200), /coordinate/, 'Nonfinite Bézier points must fail without corrupting the PSD')
for (const format of ['psd', 'psb'] as const) {
  const flat = canvas(25, 90, 165)
  const saved = buildPsd(2, 2, [{
    name: 'Has saved path', canvas: flat, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
  }], flat, { format, imageResources: writePsdPaths([], [{
    ...photoshopSavedPath,
    anchors: photoshopSavedPath.anchors.map(a => ({
      ...a, x: a.x / 60, y: a.y / 100,
      inX: a.inX / 60, inY: a.inY / 100,
      outX: a.outX / 60, outY: a.outY / 100,
    })),
  }], [], 2, 2) })
  const decoded = await decodePsd(new Uint8Array(await saved.arrayBuffer()))
  assert.equal(decoded.paths.length, 1, 'Real PSD/PSB decoder must expose Photoshop saved paths')
  assert.equal(decoded.paths[0].name, 'Clipping outline')
  const roundTripped = buildPsd(2, 2, [{
    name: 'Has saved path', canvas: decoded.layers[0].canvas, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
  }], decoded.canvas, { format, imageResources: writePsdPaths(decoded.imageResources, [{
    ...decoded.paths[0], id: 'editable-path', name: 'Edited outline',
  }], [decoded.paths[0].psdPathResourceId], 2, 2) })
  const reread = await decodePsd(new Uint8Array(await roundTripped.arrayBuffer()))
  assert.equal(reread.paths[0].name, 'Edited outline',
    'Edited Adobe path names must survive both PSD and PSB export/reimport')
}

const photoshopGrayRange = Uint8Array.from([
  12, 36, 202, 228, // This Layer, split black and white
  8, 25, 225, 242, // Underlying Layer, split black and white
])
const photoshopRedRange = Uint8Array.from([
  0, 0, 255, 255, 24, 48, 218, 240,
])
const photoshopDefault = Uint8Array.from([0, 0, 255, 255, 0, 0, 255, 255])
const importedBlendIf = parsePsdBlendIfRanges(photoshopGrayRange)
assert.deepEqual(importedBlendIf, {
  channel: 'gray',
  thisLayer: { lo: 36, loSoft: 24, hi: 202, hiSoft: 26 },
  underLayer: { lo: 25, loSoft: 17, hi: 225, hiSoft: 17 },
}, 'Photoshop split Blend If values map to native sliders')
assert.deepEqual(Array.from(encodePsdBlendIfRanges(photoshopGrayRange, importedBlendIf)),
  Array.from(photoshopGrayRange), 'unchanged Photoshop Blend If retains original bytes')
assert.deepEqual(Array.from(encodePsdBlendIfRanges(photoshopGrayRange, null)),
  Array.from(photoshopDefault), 'clearing imported Blend If resets its Photoshop range')
assert.equal(parsePsdBlendIfRanges(photoshopDefault), null, 'default Blend If stays inactive')
assert.equal(parsePsdBlendIfRanges(Uint8Array.from([1, 2, 3])), null, 'truncated blending range stays opaque')
assert.deepEqual(Array.from(encodePsdBlendIfRanges(Uint8Array.from([1, 2, 3]), null)), [1, 2, 3],
  'unsupported blending range bytes are not silently discarded')
assert.throws(() => encodePsdBlendIfRanges(Uint8Array.from([1, 2, 3]), importedBlendIf),
  /malformed Photoshop blending ranges/, 'editing invalid data fails safely')

const multiBlendRange = Uint8Array.from([...photoshopGrayRange, ...photoshopRedRange, ...photoshopDefault, ...photoshopDefault])
assert.equal(psdHasAdditionalBlendIfRanges(multiBlendRange), true, 'multiple active Photoshop ranges must be warned about')
const greenBlendIf = {
  channel: 'g' as const,
  thisLayer: { lo: 40, loSoft: 10, hi: 210, hiSoft: 5 },
  underLayer: { lo: 6, loSoft: 6, hi: 250, hiSoft: 5 },
}
const movedBlendRange = encodePsdBlendIfRanges(multiBlendRange, greenBlendIf)
assert.deepEqual(Array.from(movedBlendRange.slice(0, 8)), Array.from(photoshopDefault),
  'switching a slider to another channel clears the prior represented channel')
assert.deepEqual(Array.from(movedBlendRange.slice(8, 16)), Array.from(photoshopRedRange),
  'unsupported simultaneous Photoshop channel ranges remain untouched')
assert.deepEqual(Array.from(movedBlendRange.slice(16, 24)),
  [30, 40, 210, 215, 0, 6, 250, 255], 'edited RGB Blend If writes split slider bytes')
assert.deepEqual(parsePsdBlendIfRanges(movedBlendRange)?.underLayer,
  { lo: 48, loSoft: 24, hi: 218, hiSoft: 22 },
  'the remaining original red destination range is chosen for preview when multiple are active')

for (const format of ['psd', 'psb'] as const) {
  const image = canvas(110, 160, 230)
  const blob = buildPsd(2, 2, [{
    name: 'Blend If editable', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    blendIf: greenBlendIf,
    blendingRanges: Uint8Array.from([...photoshopGrayRange, ...photoshopRedRange, ...photoshopDefault, ...photoshopDefault]),
  }], image, { format })
  const decoded = await decodePsd(new Uint8Array(await blob.arrayBuffer()))
  assert.deepEqual(Array.from(decoded.layers[0].blendingRanges.slice(8, 16)),
    Array.from(photoshopRedRange), 'PSD/PSB exporter must retain unrelated Photoshop range bytes')
  assert.deepEqual(Array.from(decoded.layers[0].blendingRanges.slice(16, 24)),
    [30, 40, 210, 215, 0, 6, 250, 255], 'PSD/PSB exports edited green-channel slider bytes')
  assert.ok(decoded.warnings.some(w => w.includes('multiple active channel ranges')),
    'lossy native preview of multiple Photoshop Blend If channels must be disclosed')
  const single = await decodePsd(new Uint8Array(await buildPsd(2, 2, [{
    name: 'Only gray', canvas: image, left: 0, top: 0, opacity: 100,
    blendMode: 'normal', visible: true, blendIf: importedBlendIf,
  }], image, { format }).arrayBuffer()))
  assert.deepEqual(single.layers[0].blendIf, importedBlendIf,
    'editable Blend If must survive an end-to-end PSD/PSB round trip')
  assert.deepEqual(Array.from(single.layers[0].blendingRanges), Array.from(photoshopGrayRange),
    'new Blend If settings must export Adobe-compatible split-slider range bytes')
}

for (const format of ['psd', 'psb'] as const) {
  const bottom = canvas(200, 0, 0)
  const hidden = canvas(0, 180, 0, 127)
  const blob = buildPsd(2, 2, [
    { name: 'Base', canvas: bottom, left: 0, top: 0, opacity: 100, blendMode: 'normal', visible: true,
      blendingRanges: Uint8Array.from([0, 0, 255, 255, 0, 0, 255, 255]) },
    { name: 'Hidden ✓', canvas: hidden, left: 0, top: 0, opacity: 30, blendMode: 'normal', visible: false },
  ], bottom, { format, depth: 8, resolutionPpi: 300 })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  // Photoshop's canonical 1005/0x03ED ResolutionInfo resource.
  const marker = Uint8Array.from([0x38, 0x42, 0x49, 0x4d, 0x03, 0xed])
  assert.ok(bytes.some((_, at) => at + marker.length <= bytes.length &&
    marker.every((value, i) => bytes[at + i] === value)), 'Photoshop ResolutionInfo must use resource ID 1005')
  const view = new DataView(bytes.buffer)
  assert.equal(view.getUint16(4), format === 'psb' ? 2 : 1, 'version matches export format')
  assert.equal(view.getUint16(22), 8)
  assert.equal(view.getUint16(24), 3)
  const decoded = await decodePsd(bytes)
  assert.equal(decoded.layers.length, 2)
  assert.deepEqual(Array.from(decoded.layers[0].blendingRanges), [0,0,255,255,0,0,255,255], 'Photoshop Blend If ranges retained')
  assert.deepEqual(decoded.layers.map(l => l.name), ['Base', 'Hidden ✓'])
  assert.deepEqual(decoded.layers.map(l => l.visible), [true, false], 'Photoshop hidden flag is inverted')
  assert.equal(decoded.layers[1].opacity, 30)
  assert.equal(decoded.layers[0].canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[0], 200)
  assert.equal(decoded.layers[1].canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[3], 127)
  assert.ok(Math.abs(decoded.resolutionPpi - 300) < 0.01)
  const oldBytes = bytes.slice()
  const oldMarker = oldBytes.findIndex((_, at) => at + 5 < oldBytes.length &&
    marker.every((value, i) => oldBytes[at + i] === value))
  assert.ok(oldMarker >= 0)
  oldBytes[oldMarker + 4] = 0x04
  oldBytes[oldMarker + 5] = 0x00
  const oldDecoded = await decodePsd(oldBytes)
  assert.ok(Math.abs(oldDecoded.resolutionPpi - 300) < 0.01, 'old Studio PPI metadata remains readable')
}

for (const format of ['psd', 'psb'] as const) {
  const image = canvas(84, 173, 246, 200)
  const samples = new Float32Array([
    2.5, 0.5, 0.25, 1,
    1.25, 0.125, 0, 0.75,
    0, 0.5, 3.75, 1,
    0.25, 0.25, 0.25, 0.5,
  ])
  // Synthetic hdrt bytes validate preservation; Photoshop-authored fixtures remain necessary.
  const toneMetadata = Uint8Array.from([0x68, 0x64, 0x72, 0x74, 0, 0, 0, 1])
  const blob = buildPsd(2, 2, [{
    name: 'HDR layer', canvas: image, left: 0, top: 0, opacity: 100,
    blendMode: 'normal', visible: true, hdrPixels: samples,
  }], image, { format, depth: 32, compositeHdrPixels: samples, colorModeData: toneMetadata })
  const data = new Uint8Array(await blob.arrayBuffer())
  assert.equal(new DataView(data.buffer).getUint16(22), 32)
  const decoded = await decodePsd(data)
  assert.equal(decoded.depth, 32)
  assert.deepEqual(Array.from(decoded.colorModeData), Array.from(toneMetadata), 'HDR tone metadata survives export/import')
  assert.ok(decoded.hdrPixels)
  assert.deepEqual(Array.from(decoded.hdrPixels), Array.from(samples), 'HDR composite survives Photoshop float round-trip')
  assert.ok(decoded.layers[0].hdrPixels)
  assert.deepEqual(Array.from(decoded.layers[0].hdrPixels), Array.from(samples), 'HDR layer survives Photoshop float round-trip')
  assert.throws(() => buildPsd(2, 2, [{
    name: 'Missing HDR', canvas: image, left: 0, top: 0, opacity: 100,
    blendMode: 'normal', visible: true,
  }], image, { format, depth: 32, compositeHdrPixels: samples, colorModeData: toneMetadata }), /full-resolution Float32/)
  assert.throws(() => buildPsd(2, 2, [{
    name: 'HDR layer', canvas: image, left: 0, top: 0, opacity: 100,
    blendMode: 'normal', visible: true, hdrPixels: samples,
  }], image, { format, depth: 32, compositeHdrPixels: samples }), /requires Photoshop-origin HDR color-mode data/)
}


for (const format of ['psd', 'psb'] as const) {
  const image = canvas(50, 100, 150, 255)
  const blob = buildPsd(2, 2, [{
    name: '16-bit RGB', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
  }], image, { format, depth: 16 })
  const data = new Uint8Array(await blob.arrayBuffer())
  assert.ok(Buffer.from(data).includes(Buffer.from('Lr16')), 'Photoshop high-depth layer section is present')
  const decoded = await decodePsd(data)
  assert.equal(decoded.depth, 16)
  assert.equal(decoded.layers.length, 1, 'Lr16 contains editable layer records')
  assert.equal(decoded.layers[0].name, '16-bit RGB')
  assert.ok(decoded.warnings.some(w => w.includes('16-bit PSD') && w.includes('8-bit canvas')),
    'Canvas2D runtimes without float16 support must warn when Photoshop precision is reduced')
  assert.equal(decoded.layers[0].canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[0], 50)
}
assert.deepEqual(Array.from(restorePsdPrediction(Uint8Array.from([10,10,10]), 3, 1, 8)), [10,20,30])
assert.deepEqual(Array.from(restorePsdPrediction(Uint8Array.from([0,10,0,10]), 2, 1, 16)), [0,10,0,20])
const floats = new Uint8Array(8)
const floatsView = new DataView(floats.buffer)
floatsView.setFloat32(0, 2.5, false)
floatsView.setFloat32(4, 0.125, false)
const shuffled = Uint8Array.from([floats[0],floats[4],floats[1],floats[5],floats[2],floats[6],floats[3],floats[7]])
for (let i = shuffled.length - 1; i > 0; i--) shuffled[i] = (shuffled[i] - shuffled[i - 1] + 256) & 255
assert.deepEqual(Array.from(restorePsdPrediction(shuffled, 2, 1, 32)), Array.from(floats))
assert.throws(() => restorePsdPrediction(Uint8Array.from([1,2,3]), 2, 1, 32), /Invalid PSD predicted/)


function photoshopTaggedBlock(blocks: readonly Uint8Array[], key: string): Uint8Array {
  const block = blocks.find(b => b.length >= 12 &&
    new TextDecoder().decode(b.subarray(4, 8)) === key)
  assert.ok(block, `Expected Photoshop additional-info block ${key}`)
  return block
}

function sectionDivider(type: 1 | 2 | 3): Uint8Array {
  const block = new Uint8Array(16)
  block.set(new TextEncoder().encode('8BIMlsct'), 0)
  new DataView(block.buffer).setUint32(8, 4)
  new DataView(block.buffer).setUint32(12, type)
  return block
}

for (const format of ['psd', 'psb'] as const) {
  const image = canvas(80, 130, 180)
  const open = sectionDivider(1)
  const close = sectionDivider(3)
  const blob = buildPsd(2, 2, [
    { name: 'Folder A', canvas: image, left: 0, top: 0, opacity: 100,
      blendMode: 'normal', rawBlendKey: 'pass', visible: true,
      sectionMarker: true, additionalInfo: [open] },
    { name: 'Artwork', canvas: image, left: 0, top: 0, opacity: 100,
      blendMode: 'normal', visible: true },
    { name: '</Layer group>', canvas: image, left: 0, top: 0, opacity: 100,
      blendMode: 'normal', visible: true, sectionMarker: true,
      additionalInfo: [close] },
  ], image, { format, depth: 8 })
  const decoded = await decodePsd(new Uint8Array(await blob.arrayBuffer()))
  assert.equal(decoded.layers.length, 1, 'group boundaries must not become drawable layers')
  assert.deepEqual(decoded.sectionMarkers.map(m => m.beforeLayerIndex), [0, 1],
    'group marker positions are stable relative to drawable layers')
  assert.deepEqual(decoded.sectionMarkers.map(m => m.name), ['Folder A', '</Layer group>'])
  assert.equal(decoded.sectionMarkers[0].blendKey, 'pass', 'folder pass-through blending survives')
  assert.deepEqual(Array.from(photoshopTaggedBlock(decoded.sectionMarkers[0].additionalInfo, 'lsct')), Array.from(open))
  assert.deepEqual(Array.from(photoshopTaggedBlock(decoded.sectionMarkers[1].additionalInfo, 'lsct')), Array.from(close))
}


// Genuine Photoshop folder markers sometimes include channel table entries
// containing only the two-byte compression code (no pixels). Emulate exactly
// this variant in both PSD and PSB by adding a zero-area channel to the
// folder record, not by changing the decoder's in-memory record objects.
for (const format of ['psd', 'psb'] as const) {
  const image = canvas(47, 83, 151)
  const source = new Uint8Array(await buildPsd(2, 2, [
    { name: '</Adobe folder>', canvas: image, left: 0, top: 0,
      opacity: 100, blendMode: 'normal', visible: true, sectionMarker: true,
      additionalInfo: [sectionDivider(3)] },
    { name: 'Child', canvas: image, left: 0, top: 0,
      opacity: 100, blendMode: 'normal', visible: true },
    { name: 'Adobe folder', canvas: image, left: 0, top: 0,
      opacity: 100, blendMode: 'normal', visible: true, sectionMarker: true,
      additionalInfo: [sectionDivider(1)] },
  ], image, { format }).arrayBuffer())
  const sourceView = new DataView(source.buffer)
  const lenSize = format === 'psb' ? 8 : 4
  let pos = 26
  pos += 4 + sourceView.getUint32(pos)
  pos += 4 + sourceView.getUint32(pos)
  const lmLengthAt = pos
  pos += lenSize
  const layerLengthAt = pos
  pos += lenSize
  assert.equal(Math.abs(sourceView.getInt16(pos)), 3)
  const markerAt = pos + 2
  assert.equal(sourceView.getUint16(markerAt + 16), 0)
  const addedChannelTableBytes = 2 + lenSize
  let nextRecordAt = markerAt
  for (let record = 0; record < 3; record++) {
    const channelCount = sourceView.getUint16(nextRecordAt + 16)
    const extraAt = nextRecordAt + 18 + channelCount * (2 + lenSize) + 12
    nextRecordAt = extraAt + 4 + sourceView.getUint32(extraAt)
  }
  const channelDataAt = nextRecordAt
  assert.ok(channelDataAt < source.length, 'Synthetic PSD has layer channel data')

  // Insert channel id 0, length 2 into the group record, followed by its
  // RAW compression code before the child's genuine pixel-channel payload.
  const entry = new Uint8Array(addedChannelTableBytes)
  new DataView(entry.buffer).setUint32(addedChannelTableBytes - 4, 2)
  const extended = new Uint8Array(source.length + entry.length + 2)
  extended.set(source.subarray(0, markerAt + 18))
  extended.set(entry, markerAt + 18)
  extended.set(source.subarray(markerAt + 18, channelDataAt), markerAt + 18 + entry.length)
  extended.set([0, 0], channelDataAt + entry.length)
  extended.set(source.subarray(channelDataAt), channelDataAt + entry.length + 2)
  const finalView = new DataView(extended.buffer)
  finalView.setUint16(markerAt + 16, 1)
  for (const lengthAt of [lmLengthAt, layerLengthAt]) {
    const lengthLowAt = lengthAt + lenSize - 4
    finalView.setUint32(lengthLowAt, sourceView.getUint32(lengthLowAt) + entry.length + 2)
  }
  const decoded = await decodePsd(extended)
  assert.equal(decoded.layers.length, 1, 'Empty folder channels must not become drawable layers')
  assert.deepEqual(decoded.sectionMarkers.map(m => m.name), ['</Adobe folder>', 'Adobe folder'],
    'Photoshop folder boundaries with empty channel headers must be retained')
  assert.deepEqual(decoded.layers[0].groupPath, ['Adobe folder'],
    'Real-world empty-channel folder delimiters must preserve child ancestry')
  assert.ok(!decoded.warnings.some(w => w.includes('non-raster Photoshop layer records could not be preserved')),
    'Safe empty-channel folder records should not trigger a destructive loss warning')
}


// Real Photoshop combined user/vector-mask channels (-3) must not be erased
// by an unchanged PSD/PSB export. Their compressed channel bytes and mask
// metadata are independent from the editable Studio raster mask.
for (const format of ['psd', 'psb'] as const) {
  const image = canvas(70, 90, 110)
  const metadata = new Uint8Array(36)
  const metaView = new DataView(metadata.buffer)
  metaView.setInt32(8, 2)
  metaView.setInt32(12, 2)
  metadata[16] = 255 // outside user-mask default
  const real = Uint8Array.from([0, 0, 7, 18, 39, 63])
  const user = Uint8Array.from([0, 0, 40, 80, 120, 160])
  const preserved = {
    metadata, real, user, sourceFormat: format, depth: 8 as const,
    docWidth: 2, docHeight: 2, left: 0, top: 0, width: 2, height: 2,
  }
  const encoded = buildPsd(2, 2, [{
    name: 'Adobe real mask', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    preservedMaskChannels: preserved,
  }], image, { format })
  const decoded = await decodePsd(new Uint8Array(await encoded.arrayBuffer()))
  const retained = decoded.layers[0].preservedMaskChannels
  assert.ok(retained, 'Combined mask data must survive a PSD/PSB binary read')
  assert.equal(decoded.layers[0].unsupportedRealMask, true)
  assert.deepEqual(Array.from(retained.metadata), Array.from(metadata))
  assert.deepEqual(Array.from(retained.real), Array.from(real))
  assert.deepEqual(Array.from(retained.user!), Array.from(user))
  assert.equal(retained.sourceFormat, format)
  assert.equal(retained.depth, 8)
  assert.ok(decoded.layers[0].mask, 'Conventional -2 user mask remains independently editable')
  const exported = buildPsd(2, 2, [{
    name: decoded.layers[0].name, canvas: decoded.layers[0].canvas,
    left: decoded.layers[0].left, top: decoded.layers[0].top,
    opacity: decoded.layers[0].opacity, blendMode: decoded.layers[0].blendMode,
    visible: true, preservedMaskChannels: retained,
  }], decoded.canvas, { format })
  const again = await decodePsd(new Uint8Array(await exported.arrayBuffer()))
  assert.deepEqual(Array.from(again.layers[0].preservedMaskChannels!.metadata), Array.from(metadata))
  assert.deepEqual(Array.from(again.layers[0].preservedMaskChannels!.real), Array.from(real))
  assert.deepEqual(Array.from(again.layers[0].preservedMaskChannels!.user!), Array.from(user))
  const input = {
    name: 'Unsafe converted mask', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    preservedMaskChannels: preserved,
  }
  assert.throws(() => buildPsd(2, 2, [input], image, {
    format: format === 'psd' ? 'psb' : 'psd',
  }), /combined mask passthrough requires original/,
  'Compressed Photoshop RLE mask data must not be copied between PSD and PSB formats')
  assert.throws(() => buildPsd(2, 2, [{ ...input, left: 1 }], image, { format }),
    /combined mask passthrough requires original/,
    'Combined mask channel geometry cannot survive unadjusted layer translation')
  assert.throws(() => buildPsd(2, 2, [input], image, { format, depth: 16 }),
    /combined mask passthrough requires original/,
    'Combined mask compression must not be reinterpreted at a new bit depth')
}


function cmykComposite(c: number, m: number, y: number, k: number): Uint8Array {
  // PSD: 26-byte header, three empty sections, raw planar CMYK composite.
  const bytes = new Uint8Array(26 + 4 + 4 + 4 + 2 + 4)
  bytes.set(new TextEncoder().encode('8BPS'))
  const view = new DataView(bytes.buffer)
  view.setUint16(4, 1)
  view.setUint16(12, 4)
  view.setUint32(14, 1)
  view.setUint32(18, 1)
  view.setUint16(22, 8)
  view.setUint16(24, 4)
  view.setUint16(38, 0)
  bytes.set([c, m, y, k], 40)
  return bytes
}
for (const [planes, expected] of [
  [[255, 255, 255, 255], [255, 255, 255]],
  [[0, 255, 255, 255], [0, 255, 255]],
  [[255, 255, 255, 0], [0, 0, 0]],
  [[128, 255, 255, 255], [128, 255, 255]],
] as const) {
  const decoded = await decodePsd(cmykComposite(planes[0], planes[1], planes[2], planes[3]))
  assert.deepEqual(Array.from(decoded.canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data.slice(0, 3)),
    Array.from(expected), 'PSD CMYK channels must use Photoshop inverted ink storage')
}


for (const format of ['psd', 'psb'] as const) {
  const pixels = canvas(90, 80, 70)
  const adjustmentBlock = new Uint8Array(16)
  adjustmentBlock.set(new TextEncoder().encode('8BIMlevl'))
  new DataView(adjustmentBlock.buffer).setUint32(8, 4)
  const encoded = buildPsd(2, 2, [
    { name: 'Artwork', canvas: pixels, left: 0, top: 0, opacity: 100, visible: true, blendMode: 'normal' },
    { name: 'Levels', canvas: pixels, left: 0, top: 0, opacity: 100, visible: true,
      blendMode: 'normal', sectionMarker: true, additionalInfo: [adjustmentBlock] },
  ], pixels, { format, depth: 8 })
  const decoded = await decodePsd(new Uint8Array(await encoded.arrayBuffer()))
  assert.equal(decoded.layers.length, 1, 'unsupported Photoshop adjustment must not masquerade as raster')
  assert.equal(decoded.sectionMarkers.length, 1)
  assert.equal(decoded.sectionMarkers[0].kind, 'adjustment')
  assert.equal(decoded.sectionMarkers[0].beforeLayerIndex, 1)
  assert.deepEqual(Array.from(photoshopTaggedBlock(decoded.sectionMarkers[0].additionalInfo, 'levl')), Array.from(adjustmentBlock))
  assert.ok(decoded.warnings.some(w => w.includes('not rendered or editable')))
}


function labComposite(l: number, a: number, b: number, depth: 8 | 16 = 8): Uint8Array {
  const bytes = new Uint8Array(26 + 4 + 4 + 4 + 2 + 3 * (depth >>> 3))
  bytes.set(new TextEncoder().encode('8BPS'))
  const view = new DataView(bytes.buffer)
  view.setUint16(4, 1)
  view.setUint16(12, 3)
  view.setUint32(14, 1)
  view.setUint32(18, 1)
  view.setUint16(22, depth)
  view.setUint16(24, 9) // Lab
  view.setUint16(38, 0) // raw composite channels
  if (depth === 8) bytes.set([l, a, b], 40)
  else for (const [i, value] of [l, a, b].entries()) view.setUint16(40 + i * 2, value, false)
  return bytes
}
for (const [color, white] of [
  [[255, 128, 128], true],
  [[0, 128, 128], false],
] as const) {
  const decoded = await decodePsd(labComposite(color[0], color[1], color[2]))
  const rgb = decoded.canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(rgb[i] - (white ? 255 : 0)) <= 2,
    'Photoshop Lab neutral white/black converts approximately to sRGB')
  assert.ok(decoded.warnings.some(w => w.includes('Lab was converted')))
}
const lab16 = await decodePsd(labComposite(65535, 32896, 32896, 16))
assert.equal(lab16.depth, 16)
assert.ok(lab16.canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[0] >= 253,
  'Photoshop 16-bit neutral Lab converts to a white preview')


function indexedPsd(transparent: boolean): Uint8Array {
  const palette = new Uint8Array(768)
  palette[0] = 220; palette[1] = 17 // red plane
  palette[256] = 20; palette[257] = 121 // green plane
  palette[512] = 10; palette[513] = 240 // blue plane
  const resource = transparent ? Uint8Array.from([
    0x38, 0x42, 0x49, 0x4d, // 8BIM
    0x04, 0x17, // transparency-index resource 1047
    0, 0, // zero-length Pascal resource name
    0, 0, 0, 2, // resource payload length
    0, 1, // index 1 is transparent
  ]) : new Uint8Array(0)
  const bytes = new Uint8Array(26 + 4 + 768 + 4 + resource.length + 4 + 2 + 2)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('8BPS'))
  view.setUint16(4, 1)
  view.setUint16(12, 1)
  view.setUint32(14, 1)
  view.setUint32(18, 2)
  view.setUint16(22, 8)
  view.setUint16(24, 2)
  view.setUint32(26, palette.length)
  bytes.set(palette, 30)
  const resourcePosition = 30 + palette.length
  view.setUint32(resourcePosition, resource.length)
  bytes.set(resource, resourcePosition + 4)
  const imagePosition = resourcePosition + 4 + resource.length + 4
  view.setUint16(imagePosition, 0)
  bytes.set([0, 1], imagePosition + 2)
  return bytes
}
for (const transparent of [false, true]) {
  const decoded = await decodePsd(indexedPsd(transparent))
  const pixel = decoded.canvas.getContext('2d')!.getImageData(0, 0, 2, 1).data
  assert.deepEqual(Array.from(pixel), [
    220, 20, 10, 255, 17, 121, 240, transparent ? 0 : 255,
  ], 'PSD indexed palette must use non-interleaved RGB planes and transparency index')
  assert.equal(decoded.hasAlpha, transparent)
}


const literal = new Uint8Array(2)
decodePackBitsRow(Uint8Array.from([1, 19, 31]), 0, 3, literal, 0, 2)
assert.deepEqual(Array.from(literal), [19, 31])
const repeated = new Uint8Array(3)
decodePackBitsRow(Uint8Array.from([254, 55]), 0, 2, repeated, 0, 3)
assert.deepEqual(Array.from(repeated), [55, 55, 55])
assert.throws(() => decodePackBitsRow(Uint8Array.from([1, 19]), 0, 2, new Uint8Array(2), 0, 2), /Truncated/)
assert.throws(() => decodePackBitsRow(Uint8Array.from([254, 19]), 0, 2, new Uint8Array(2), 0, 2), /oversized/)
assert.throws(() => decodePackBitsRow(Uint8Array.from([0, 12]), 0, 2, new Uint8Array(2), 0, 2), /Incomplete/)
assert.throws(() => decodePackBitsRow(Uint8Array.from([0, 12]), 0, 7, new Uint8Array(2), 0, 2), /Invalid/)


function rgbWithExtraChannels(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(26 + 4 + 4 + 4 + 2 + samples.length)
  const dv = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('8BPS'))
  dv.setUint16(4, 1)
  dv.setUint16(12, samples.length)
  dv.setUint32(14, 1)
  dv.setUint32(18, 1)
  dv.setUint16(22, 8)
  dv.setUint16(24, 3)
  dv.setUint16(38, 0)
  bytes.set(samples, 40)
  return bytes
}
const flattenedWithSpots = await decodePsd(rgbWithExtraChannels([100, 150, 200, 80, 207, 39]))
assert.equal(flattenedWithSpots.layers.length, 0)
assert.deepEqual(flattenedWithSpots.extraMergedChannels.map(c => Array.from(c)), [[207], [39]],
  'Flattened RGB PSD imports must retain extra spot/alpha samples')
assert.ok(flattenedWithSpots.warnings.some(w => w.includes('retained for compatible export')))

for (const [samples, expected] of [
  [[100, 150, 200], [100, 150, 200, 255]],
  [[100, 150, 200, 45], [100, 150, 200, 45]],
  [[100, 150, 200, 45, 255], [100, 150, 200, 45]],
  [[100, 150, 200, 45, 255, 0], [100, 150, 200, 45]],
] as const) {
  const decoded = await decodePsd(rgbWithExtraChannels(Array.from(samples)))
  assert.deepEqual(
    Array.from(decoded.canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data),
    Array.from(expected), 'PSD spot channels must never override the first merged alpha channel')
  assert.equal(decoded.hasAlpha, samples.length >= 4)
  if (samples.length > 4) {
    assert.ok(decoded.warnings.some(w => w.includes('retained for compatible export')))
    assert.deepEqual(decoded.extraMergedChannels.map(c => Array.from(c)),
      Array.from(samples.slice(4)).map(value => [value]),
      'Flattened extra channels retain their original single-pixel samples')
  }
}
await assert.rejects(
  () => decodePsd(rgbWithExtraChannels([100, 150])),
  /Invalid Photoshop channel count/,
)
const corruptMerged = rgbWithExtraChannels([100, 150, 200])
new DataView(corruptMerged.buffer).setUint16(38, 9)
await assert.rejects(
  () => decodePsd(corruptMerged),
  /Cannot decode PSD merged image and no raster layers are available/,
  'corrupt flattened PSD must never import as an apparently valid empty canvas',
)
await assert.rejects(
  () => decodePsd(rgbWithExtraChannels([100, 150, 200]).subarray(0, 40)),
  /Cannot decode PSD merged image and no raster layers are available/,
  'truncated flattened PSD must fail rather than appear blank',
)



assert.equal(psdBlendKeyToMode('smud'), 'exclusion', 'Photoshop Exclusion must not be imported as Difference')
assert.equal(blendModeToPsdKey('exclusion'), 'smud', 'Photoshop Exclusion must remain Exclusion on export')
for (const format of ['psd', 'psb'] as const) {
  const source = canvas(31, 62, 93)
  const unsupported = buildPsd(2, 2, [{
    name: 'Photoshop mode', canvas: source, left: 0, top: 0, opacity: 100,
    blendMode: 'normal', visible: true, rawBlendKey: 'brst',
  }], source, { format })
  const decoded = await decodePsd(new Uint8Array(await unsupported.arrayBuffer()))
  assert.equal(decoded.layers[0].blendKey, 'brst', 'Unknown Photoshop blend key must not be replaced by Normal')
  assert.ok(decoded.warnings.some(w => w.includes('blend modes cannot be previewed faithfully')))
  const reexport = buildPsd(2, 2, [{
    name: decoded.layers[0].name, canvas: decoded.layers[0].canvas,
    left: 0, top: 0, opacity: 100, blendMode: 'normal', visible: true,
    rawBlendKey: decoded.layers[0].blendKey,
  }], source, { format })
  const recovered = await decodePsd(new Uint8Array(await reexport.arrayBuffer()))
  assert.equal(recovered.layers[0].blendKey, 'brst', 'Unknown Photoshop blend key round trips')
}


function photoshopResource(id: number): Uint8Array {
  return Uint8Array.from([
    0x38, 0x42, 0x49, 0x4d, id >> 8, id & 255, 0, 0,
    0, 0, 0, 4, 0xde, 0xad, 0xbe, 0xef,
  ])
}
for (const format of ['psd', 'psb'] as const) {
  const image = canvas(19, 57, 105)
  const staleJpeg4Thumbnail = photoshopResource(0x0409) // Photoshop 4.0 BGR thumbnail
  const staleJpeg5Thumbnail = photoshopResource(0x040c) // Photoshop 5+ RGB thumbnail
  const unrelatedMetadata = photoshopResource(0x0428)
  const output = buildPsd(2, 2, [{
    name: 'Thumbnail regression', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
  }], image, { format, sourceColorMode: 3,
    imageResources: [staleJpeg4Thumbnail, staleJpeg5Thumbnail, unrelatedMetadata] })
  const bytes = new Uint8Array(await output.arrayBuffer())
  assert.ok(!containsResource(bytes, 0x0409) && !containsResource(bytes, 0x040c),
    'PSD/PSB exports must not carry stale Photoshop thumbnail image resources')
  assert.ok(containsResource(bytes, 0x0428),
    'Unrelated Photoshop image-resource metadata remains intact')
  const reopened = await decodePsd(bytes)
  assert.equal(reopened.imageResources.some(b => b[4] === 0x04 && b[5] === 0x28), true)
}

const iccResource = photoshopResource(0x040f)
const indexedTransparencyResource = photoshopResource(0x0417)
function containsResource(bytes: Uint8Array, id: number): boolean {
  return bytes.some((_, i) => i + 6 <= bytes.length &&
    bytes[i] === 0x38 && bytes[i + 1] === 0x42 &&
    bytes[i + 2] === 0x49 && bytes[i + 3] === 0x4d &&
    bytes[i + 4] === (id >> 8) && bytes[i + 5] === (id & 255))
}
for (const format of ['psd', 'psb'] as const) {
  for (const colorMode of [3, 4, 9]) {
    const image = canvas(75, 85, 95)
    const output = buildPsd(2, 2, [{
      name: 'Converted RGB', canvas: image, left: 0, top: 0,
      opacity: 100, blendMode: 'normal', visible: true,
    }], image, {
      format, sourceColorMode: colorMode, imageResources: [iccResource, indexedTransparencyResource],
    })
    const bytes = new Uint8Array(await output.arrayBuffer())
    assert.equal(containsResource(bytes, 0x040f), colorMode === 3,
      'Original CMYK/Lab ICC profile must not be applied to RGB export')
    assert.ok(!containsResource(bytes, 0x0417),
      'Indexed transparency resource must not be applied to RGB export')
    assert.ok(containsResource(bytes, 0x03ed), 'RGB export retains a canonical ResolutionInfo block')
  }
}


for (const format of ['psd', 'psb'] as const) {
  const image = canvas(90, 120, 150)
  const userMask = canvas(255, 255, 255, 100)
  const source = buildPsd(2, 2, [{
    name: 'Masked', canvas: image, left: 1, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    mask: userMask, maskEnabled: false,
  }], image, { format })
  const bytes = new Uint8Array(await source.arrayBuffer())
  const decoded = await decodePsd(bytes)
  assert.equal(decoded.layers.length, 1)
  assert.ok(decoded.layers[0].mask, 'Photoshop disabled masks retain their pixel channels')
  assert.equal(decoded.layers[0].maskEnabled, false, 'Photoshop disabled-mask bit is respected')
  assert.equal(decoded.layers[0].mask!.getContext('2d')!.getImageData(0, 0, 1, 1).data[3], 100)

  // Change the Photoshop mask metadata only: default outside-mask color is
  // white and mask position is layer-relative. The original 2x2 mask
  // pixels stay encoded intact so they still test the real channel decoder.
  const changed = bytes.slice()
  const maskHeader = Uint8Array.from([
    0, 0, 0, 20, // mask metadata length
    0, 0, 0, 0, 0, 0, 0, 0, // top/left
    0, 0, 0, 2, 0, 0, 0, 2, // bottom/right
    0, 2, 0, 0, // default black, disabled, padding
  ])
  const offset = changed.findIndex((_, at) =>
    at + maskHeader.length <= changed.length &&
    maskHeader.every((byte, i) => changed[at + i] === byte))
  assert.ok(offset >= 0, 'Photoshop mask metadata is present')
  changed[offset + 20] = 255 // white outside recorded bounds
  changed[offset + 21] = 1 // position relative to layer, mask enabled
  const relative = await decodePsd(changed)
  assert.equal(relative.layers[0].maskEnabled, true)
  const mask = relative.layers[0].mask!.getContext('2d')!
  assert.equal(mask.getImageData(0, 0, 1, 1).data[3], 255,
    'Outside relative mask rectangle, Photoshop default color must be used')
  assert.equal(mask.getImageData(1, 0, 1, 1).data[3], 100,
    'Relative mask position must include the layer x offset')
  const inverted = changed.slice()
  inverted[offset + 21] = 5 // layer-relative plus inverse-mask flag
  const inverseLayer = (await decodePsd(inverted)).layers[0]
  const inverseMask = inverseLayer.mask!.getContext('2d')!
  assert.equal(inverseMask.getImageData(0, 0, 1, 1).data[3], 0,
    'Inverted masks must complement the Photoshop outside-rectangle default')
  assert.equal(inverseMask.getImageData(1, 0, 1, 1).data[3], 155,
    'Inverted masks must complement actual raster samples')
  const inverseRoundTrip = await decodePsd(new Uint8Array(await buildPsd(2, 2, [{
    name: 'Inverted normalized', canvas: image, left: 1, top: 0,
    opacity: 100, blendMode: 'normal', visible: true, mask: inverseLayer.mask,
  }], image, { format }).arrayBuffer()))
  assert.equal(inverseRoundTrip.layers[0].mask!.getContext('2d')!.getImageData(1, 0, 1, 1).data[3], 155,
    'Normalized inverse mask must retain the same visible alpha through Photoshop export')
}


for (const format of ['psd', 'psb'] as const) {
  const image = canvas(20, 40, 60)
  const userMask = canvas(255, 255, 255, 90)
  const file = buildPsd(2, 2, [{
    name: 'Real mask compatibility', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true, mask: userMask,
  }], image, { format })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const channelIndex = bytes.findIndex((b, i) =>
    b === 255 && bytes[i + 1] === 254 && i + (format === 'psb' ? 10 : 6) <= bytes.length)
  assert.ok(channelIndex > 26, 'Mask channel identifier is present')
  bytes[channelIndex + 1] = 253 // -2 user mask -> -3 real combined mask
  const decoded = await decodePsd(bytes)
  assert.equal(decoded.layers.length, 1, 'A real mask channel must not block PSD layer decoding')
  assert.equal(decoded.layers[0].mask, null, 'Unrepresented real vector mask is not mislabeled as a user raster mask')
  assert.equal(decoded.layers[0].unsupportedRealMask, true,
    'Combined Photoshop real-mask loss must be tracked for export warnings')
  assert.ok(decoded.warnings.some(w => w.includes('combined user/vector mask channel')))
}


function nativeDescriptor(key: string): Uint8Array {
  assert.equal(key.length, 4)
  const bytes = new Uint8Array(16)
  bytes.set(new TextEncoder().encode('8BIM' + key), 0)
  new DataView(bytes.buffer).setUint32(8, 4)
  bytes.set([1, 2, 3, 4], 12)
  return bytes
}
const nativeDescriptors = [
  nativeDescriptor('TySh'),
  nativeDescriptor('SoLd'),
  nativeDescriptor('vmsk'),
  nativeDescriptor('lfx2'),
]
assert.equal(psdNativeObjectKind([nativeDescriptors[0]]), 'text')
assert.equal(psdNativeObjectKind([nativeDescriptors[1]]), 'smart')
assert.equal(psdNativeObjectKind([nativeDescriptors[2]]), 'vector')
assert.equal(psdNativeObjectKind([nativeDescriptors[3]]), null)
const rasterOnlyBlocks = stripPsdNativeObjectBlocks(nativeDescriptors)
assert.deepEqual(rasterOnlyBlocks, [nativeDescriptors[3]],
  'Raster edits remove native Photoshop objects, but retain unrelated effects')
assert.equal(psdNativeObjectKind(rasterOnlyBlocks), null)
const cachedPhotoshopPreview = canvas(135, 75, 190)
const smartPreviewOrigin = {
  kind: 'smart' as const,
  pixelFingerprint: psdPixelFingerprint(cachedPhotoshopPreview),
  maskFingerprint: null,
  maskEnabled: false,
  left: 5, top: 9,
  width: cachedPhotoshopPreview.width, height: cachedPhotoshopPreview.height,
}
const unchangedPhotoshopSmart = {
  kind: 'smart' as const,
  source: cachedPhotoshopPreview,
  transform: { x: 6, y: 10, scale: 1, rotation: 0 },
  smartFilters: [] as Array<{ enabled: boolean }>,
  mask: null,
  maskEnabled: false,
  psdNativeOrigin: smartPreviewOrigin,
}
assert.equal(psdImportedSmartIsUnchanged(unchangedPhotoshopSmart as any), true,
  'Unmodified Photoshop cached Smart Object preview and placement retain its live descriptor')
assert.equal(psdImportedSmartIsUnchanged({
  ...unchangedPhotoshopSmart, transform: { ...unchangedPhotoshopSmart.transform, x: 7 },
} as any), false, 'Moving an imported Smart Object must invalidate stale Photoshop transform metadata')
assert.equal(psdImportedSmartIsUnchanged({
  ...unchangedPhotoshopSmart, smartFilters: [{ enabled: true }],
} as any), false, 'An enabled Studio Smart Filter must invalidate Photoshop native preview descriptor')
assert.equal(psdImportedSmartIsUnchanged({
  ...unchangedPhotoshopSmart, transform: { ...unchangedPhotoshopSmart.transform, scale: 0.5 },
} as any), false, 'Scaling imported Photoshop cached previews must not retain stale live descriptors')
const alteredPreview = canvas(135, 75, 191)
assert.equal(psdImportedSmartIsUnchanged({
  ...unchangedPhotoshopSmart, source: alteredPreview,
} as any), false, 'Edited cached Smart Object source pixels must invalidate native Photoshop descriptor')
for (const format of ['psd', 'psb'] as const) {
  const layerRaster = canvas(43, 67, 91)
  const source = buildPsd(2, 2, [{
    name: 'Photoshop placed Smart Object', canvas: layerRaster, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    additionalInfo: [nativeDescriptor('SoLd')],
  }], layerRaster, { format })
  const decoded = await decodePsd(new Uint8Array(await source.arrayBuffer()))
  assert.equal(psdNativeObjectKind(decoded.layers[0].additionalInfo), 'smart',
    'PSD and PSB must identify Photoshop SoLd Smart Object descriptors')
  const unchanged = buildPsd(2, 2, [{
    name: decoded.layers[0].name, canvas: decoded.layers[0].canvas,
    left: decoded.layers[0].left, top: decoded.layers[0].top,
    opacity: decoded.layers[0].opacity, blendMode: decoded.layers[0].blendMode,
    visible: decoded.layers[0].visible,
    additionalInfo: decoded.layers[0].additionalInfo,
  }], decoded.canvas, { format })
  const same = await decodePsd(new Uint8Array(await unchanged.arrayBuffer()))
  assert.equal(psdNativeObjectKind(same.layers[0].additionalInfo), 'smart',
    'Unedited Smart Object must retain the original Photoshop native descriptor')
  const rasterized = buildPsd(2, 2, [{
    name: decoded.layers[0].name, canvas: decoded.layers[0].canvas,
    left: 0, top: 0, opacity: 100, blendMode: 'normal', visible: true,
    additionalInfo: stripPsdNativeObjectBlocks(decoded.layers[0].additionalInfo),
  }], decoded.canvas, { format })
  const changed = await decodePsd(new Uint8Array(await rasterized.arrayBuffer()))
  assert.equal(psdNativeObjectKind(changed.layers[0].additionalInfo), null,
    'Rasterized Smart Object must not contain a stale Photoshop SoLd descriptor')
}

const sourceForNative = canvas(140, 60, 80)
const initialFingerprint = psdPixelFingerprint(sourceForNative)
assert.equal(initialFingerprint, psdPixelFingerprint(sourceForNative), 'fingerprint remains stable')
const rasterCtx = sourceForNative.getContext('2d')!
const edited = rasterCtx.getImageData(0, 0, 2, 2)
edited.data[0] = 160
rasterCtx.putImageData(edited, 0, 0)
assert.notEqual(psdPixelFingerprint(sourceForNative), initialFingerprint,
  'Native Photoshop descriptor provenance must detect raster edits')
for (const format of ['psd', 'psb'] as const) {
  const flattened = canvas(190, 90, 40)
  const file = buildPsd(2, 2, [{
    name: 'Text originally', canvas: flattened, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    additionalInfo: nativeDescriptors,
  }], flattened, { format })
  const decoded = await decodePsd(new Uint8Array(await file.arrayBuffer()))
  assert.equal(psdNativeObjectKind(decoded.layers[0].additionalInfo), 'text')
  const rasterized = buildPsd(2, 2, [{
    name: 'Edited raster copy', canvas: flattened, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    additionalInfo: stripPsdNativeObjectBlocks(decoded.layers[0].additionalInfo),
  }], flattened, { format })
  const recovered = await decodePsd(new Uint8Array(await rasterized.arrayBuffer()))
  assert.equal(psdNativeObjectKind(recovered.layers[0].additionalInfo), null,
    'Edited Photoshop text must not retain a stale TySh native descriptor')
  assert.ok(recovered.layers[0].additionalInfo.some(b => new TextDecoder().decode(b.subarray(4, 8)) === 'lfx2'),
    'Non-native opaque Photoshop FX records remain after rasterizing text')
}


function syntheticGroupMarker(name: string, type: 1 | 2 | 3, beforeLayerIndex: number) {
  return {
    kind: 'group' as const,
    name,
    beforeLayerIndex,
    visible: true,
    opacity: 100,
    blendKey: 'pass',
    additionalInfo: [sectionDivider(type)],
    blendingRanges: new Uint8Array(0),
  }
}
const groupsBottomUp = [
  syntheticGroupMarker('</Outer>', 3, 0),
  syntheticGroupMarker('</Inner>', 3, 0),
  syntheticGroupMarker('Inner', 1, 1),
  syntheticGroupMarker('Outer', 1, 2),
]
assert.deepEqual(psdGroupPaths(2, groupsBottomUp), [
  ['Outer', 'Inner'],
  ['Outer'],
], 'nested Photoshop groups must be reconstructed from bottom-up section records')
assert.deepEqual(psdGroupPaths(2, []), [[], []], 'ordinary layers have no imported Photoshop folder')
for (const format of ['psd', 'psb'] as const) {
  const pixels = canvas(12, 44, 86)
  const records = [
    { name: '</Outer>', canvas: pixels, left: 0, top: 0, opacity: 100,
      blendMode: 'normal', visible: true, sectionMarker: true, additionalInfo: [sectionDivider(3)] },
    { name: '</Inner>', canvas: pixels, left: 0, top: 0, opacity: 100,
      blendMode: 'normal', visible: true, sectionMarker: true, additionalInfo: [sectionDivider(3)] },
    { name: 'Inside inner', canvas: pixels, left: 0, top: 0, opacity: 100, blendMode: 'normal', visible: true },
    { name: 'Inner', canvas: pixels, left: 0, top: 0, opacity: 100,
      blendMode: 'normal', visible: true, sectionMarker: true, additionalInfo: [sectionDivider(1)] },
    { name: 'Inside outer', canvas: pixels, left: 0, top: 0, opacity: 100, blendMode: 'normal', visible: true },
    { name: 'Outer', canvas: pixels, left: 0, top: 0, opacity: 100,
      blendMode: 'normal', visible: true, sectionMarker: true, additionalInfo: [sectionDivider(1)] },
  ]
  const blob = buildPsd(2, 2, records, pixels, { format, depth: 8 })
  const parsed = await decodePsd(new Uint8Array(await blob.arrayBuffer()))
  assert.deepEqual(parsed.layers.map(l => l.groupPath), [
    ['Outer', 'Inner'], ['Outer'],
  ], 'PSD/PSB file parsing must expose original nested group ancestry')
}


function photoshopLayerId(blocks: readonly Uint8Array[]): number {
  const idBlock = blocks.find(b => b.length >= 16 &&
    new TextDecoder().decode(b.subarray(4, 8)) === 'lyid')
  assert.ok(idBlock, 'Every exported Photoshop layer needs a unique lyid record')
  assert.equal(new DataView(idBlock.buffer, idBlock.byteOffset).getUint32(8), 4)
  return new DataView(idBlock.buffer, idBlock.byteOffset).getUint32(12)
}
const originalIdRecord = nativeDescriptor('lyid')
new DataView(originalIdRecord.buffer).setUint32(12, 42)
for (const format of ['psd', 'psb'] as const) {
  const image = canvas(31, 63, 95)
  const blob = buildPsd(2, 2, [
    { name: 'Original ID', canvas: image, left: 0, top: 0, opacity: 100,
      blendMode: 'normal', visible: true, additionalInfo: [originalIdRecord] },
    { name: 'Duplicated ID', canvas: image, left: 0, top: 0, opacity: 100,
      blendMode: 'normal', visible: true, additionalInfo: [originalIdRecord] },
    { name: 'New layer', canvas: image, left: 0, top: 0, opacity: 100,
      blendMode: 'normal', visible: true },
  ], image, { format, depth: 8 })
  const parsed = await decodePsd(new Uint8Array(await blob.arrayBuffer()))
  const ids = parsed.layers.map(l => photoshopLayerId(l.additionalInfo))
  assert.equal(ids[0], 42, 'Original imported Photoshop layer ID remains stable')
  assert.equal(new Set(ids).size, 3, 'Duplicated Photoshop layer IDs are regenerated on export')
  assert.ok(ids.every(id => id > 0), 'Generated IDs must be valid positive 32-bit values')
  assert.equal(parsed.layers[0].additionalInfo.filter(b =>
    new TextDecoder().decode(b.subarray(4, 8)) === 'lyid').length, 1)
}


for (const format of ['psd', 'psb'] as const) {
  const image = canvas(70, 80, 90)
  const style = { dropShadow: {
    enabled: true, color: '#223344', opacity: 70, angle: 30,
    distance: 7, blur: 5, blendMode: 'multiply' as const,
    spread: 0, noise: 0,
  } }
  const withEditableStyle = buildPsd(2, 2, [{
    name: 'Photoshop effects', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true, fx: style,
  }], image, { format })
  const studioDecoded = await decodePsd(new Uint8Array(await withEditableStyle.arrayBuffer()))
  const legacyBlock = photoshopTaggedBlock(studioDecoded.layers[0].additionalInfo, 'lrFX')
  // Simulate an authentic Photoshop source containing only a legacy lrFX block.
  const photoshopOnly = buildPsd(2, 2, [{
    name: 'Photoshop effects', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    additionalInfo: [legacyBlock],
  }], image, { format })
  const imported = await decodePsd(new Uint8Array(await photoshopOnly.arrayBuffer()))
  assert.ok(imported.layers[0].fx?.dropShadow, 'Photoshop legacy FX should be editable')
  assert.equal(psdWillReplaceSourceFx(imported.layers[0].additionalInfo, imported.layers[0].fx), false,
    'No-op legacy PSD export must not require destructive-FX confirmation')
  assert.deepEqual(Array.from(photoshopTaggedBlock(imported.layers[0].additionalInfo, 'lrFX')),
    Array.from(legacyBlock), 'Importer must retain source effect bytes')
  const noOp = buildPsd(2, 2, [{
    name: 'Unchanged style', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    fx: imported.layers[0].fx, additionalInfo: imported.layers[0].additionalInfo,
  }], image, { format })
  const unmodified = await decodePsd(new Uint8Array(await noOp.arrayBuffer()))
  assert.deepEqual(Array.from(photoshopTaggedBlock(unmodified.layers[0].additionalInfo, 'lrFX')),
    Array.from(legacyBlock), 'Unchanged Photoshop legacy FX must survive byte-for-byte')
  const modified = structuredClone(imported.layers[0].fx)!
  modified.dropShadow!.opacity = 25
  assert.equal(psdWillReplaceSourceFx(imported.layers[0].additionalInfo, modified), true,
    'Changing imported legacy FX must warn that Photoshop effects are regenerated')
  assert.equal(psdWillReplaceSourceFx([nativeDescriptor('lfx2')], modified), true,
    'Replacing modern Photoshop FX descriptors requires explicit confirmation')
  const editedExport = buildPsd(2, 2, [{
    name: 'Changed style', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    fx: modified, additionalInfo: imported.layers[0].additionalInfo,
  }], image, { format })
  const edited = await decodePsd(new Uint8Array(await editedExport.arrayBuffer()))
  assert.notDeepEqual(Array.from(photoshopTaggedBlock(edited.layers[0].additionalInfo, 'lrFX')),
    Array.from(legacyBlock), 'Edited native styles regenerate Photoshop effects')
  assert.ok(edited.layers[0].fx?.dropShadow?.opacity !== imported.layers[0].fx?.dropShadow?.opacity)
}


function photoshopProtection(blocks: readonly Uint8Array[]): number {
  const block = photoshopTaggedBlock(blocks, 'lspf')
  return new DataView(block.buffer, block.byteOffset, block.byteLength).getUint32(12)
}
for (const format of ['psd', 'psb'] as const) {
  const image = canvas(21, 42, 63)
  const partialProtection = nativeDescriptor('lspf')
  new DataView(partialProtection.buffer).setUint32(12, 1) // transparency lock only
  const importedFile = buildPsd(2, 2, [{
    name: 'Source partial lock', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    additionalInfo: [partialProtection],
  }], image, { format })
  const imported = await decodePsd(new Uint8Array(await importedFile.arrayBuffer()))
  assert.equal(imported.layers[0].locked, true, 'Partial Photoshop protection must prevent unintended native editing')
  assert.ok(imported.warnings.some(w => w.includes('Partially protected')))
  const untouched = buildPsd(2, 2, [{
    name: 'Unchanged lock', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true, locked: true,
    additionalInfo: imported.layers[0].additionalInfo,
  }], image, { format })
  const preserved = await decodePsd(new Uint8Array(await untouched.arrayBuffer()))
  assert.equal(photoshopProtection(preserved.layers[0].additionalInfo), 1,
    'Unchanged partial protection survives PSD/PSB export byte-for-byte')
  const unlocked = buildPsd(2, 2, [{
    name: 'Unlocked', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true, locked: false,
    additionalInfo: imported.layers[0].additionalInfo,
  }], image, { format })
  const reopened = await decodePsd(new Uint8Array(await unlocked.arrayBuffer()))
  assert.equal(reopened.layers[0].locked, false)
  assert.equal(photoshopProtection(reopened.layers[0].additionalInfo), 0)
  const lockedNew = buildPsd(2, 2, [{
    name: 'New lock', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true, locked: true,
  }], image, { format })
  const parsedNew = await decodePsd(new Uint8Array(await lockedNew.arrayBuffer()))
  assert.equal(parsedNew.layers[0].locked, true)
  assert.equal(photoshopProtection(parsedNew.layers[0].additionalInfo), 7)
}


for (const format of ['psd', 'psb'] as const) {
  const image = canvas(44, 55, 66)
  const source = buildPsd(2, 2, [{
    name: 'Legacy protected transparency', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    sourceTransparencyProtected: true, locked: true,
  }], image, { format })
  const imported = await decodePsd(new Uint8Array(await source.arrayBuffer()))
  assert.equal(imported.layers[0].transparencyProtected, true)
  assert.equal(imported.layers[0].locked, true,
    'Legacy PSD record transparency-protection bit must lock imported layer')
  const unchanged = buildPsd(2, 2, [{
    name: 'Still protected', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    sourceTransparencyProtected: imported.layers[0].transparencyProtected, locked: true,
    additionalInfo: imported.layers[0].additionalInfo,
  }], image, { format })
  const reread = await decodePsd(new Uint8Array(await unchanged.arrayBuffer()))
  assert.equal(reread.layers[0].transparencyProtected, true)
  const unlocked = buildPsd(2, 2, [{
    name: 'Unprotected', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    sourceTransparencyProtected: true, locked: false,
    additionalInfo: imported.layers[0].additionalInfo,
  }], image, { format })
  const updated = await decodePsd(new Uint8Array(await unlocked.arrayBuffer()))
  assert.equal(updated.layers[0].transparencyProtected, false)
  assert.equal(updated.layers[0].locked, false,
    'Unlocking clears Photoshop layer-record protection in addition to lspf')
}


function taggedPsdBlock(key: string, payload: number[], wide = false): Uint8Array {
  assert.equal(key.length, 4)
  const data = Uint8Array.from(payload)
  const headerSize = wide ? 16 : 12
  const block = new Uint8Array(headerSize + data.length + (data.length & 1))
  block.set(new TextEncoder().encode('8BIM' + key))
  const view = new DataView(block.buffer)
  if (wide) {
    view.setUint32(8, 0)
    view.setUint32(12, data.length)
  } else view.setUint32(8, data.length)
  block.set(data, headerSize)
  return block
}
for (const format of ['psd', 'psb'] as const) {
  const image = canvas(31, 55, 79)
  for (const terminalBlock of [
    taggedPsdBlock('zT00', []),       // 12-byte minimum sized tag
    taggedPsdBlock('zT01', [27]),     // 14-byte tag after even padding
    ...(format === 'psb' ? [taggedPsdBlock('lnk2', [], true)] : []), // 64-bit PSB length
  ]) {
    const psd = buildPsd(2, 2, [{
      name: 'Trailing metadata', canvas: image, left: 0, top: 0,
      opacity: 100, blendMode: 'normal', visible: true,
      additionalInfo: [terminalBlock],
    }], image, { format })
    const bytes = new Uint8Array(await psd.arrayBuffer())
    const decoded = await decodePsd(bytes)
    const key = new TextDecoder().decode(terminalBlock.subarray(4, 8))
    const found = decoded.layers[0].additionalInfo.find(b =>
      new TextDecoder().decode(b.subarray(4, 8)) === key)
    assert.deepEqual(found ? Array.from(found) : null, Array.from(terminalBlock),
      `Trailing Photoshop tagged block ${key} is losslessly retained in ${format}`)
    if (key === 'zT01') {
      const corrupted = bytes.slice()
      const target = corrupted.findIndex((_, pos) =>
        pos + 12 <= corrupted.length &&
        terminalBlock.subarray(0, 8).every((value, j) => corrupted[pos + j] === value))
      assert.ok(target >= 0)
      new DataView(corrupted.buffer).setUint32(target + 8, 0xffffffff)
      await assert.rejects(() => decodePsd(corrupted), /Truncated Photoshop tagged block zT01 payload/,
        'Corrupt Photoshop layer descriptor lengths must not be silently clipped')
    }
  }
}


const linkedPayload = [0x21, 0x32, 0x43, 0x54, 0x65]
const linkedShort = taggedPsdBlock('lnk2', linkedPayload)
const linkedWide = taggedPsdBlock('lnk2', linkedPayload, true)
assert.deepEqual(Array.from(normalizePsdTaggedBlock(linkedShort, true)), Array.from(linkedWide),
  'PSD→PSB conversion must widen 64-bit-required length keys without changing their payload')
assert.deepEqual(Array.from(normalizePsdTaggedBlock(linkedWide, false)), Array.from(linkedShort),
  'PSB→PSD conversion must narrow compatible 64-bit length keys')
assert.deepEqual(Array.from(normalizePsdTaggedBlock(linkedWide, true)), Array.from(linkedWide),
  'No-op PSB export preserves source tagged blocks exactly')
const malformedWideBlock = linkedWide.slice()
new DataView(malformedWideBlock.buffer).setUint32(12, 1000)
assert.throws(() => normalizePsdTaggedBlock(malformedWideBlock, false),
  /Invalid Photoshop tagged block lnk2 length/, 'Invalid opaque tagged metadata is rejected')
for (const format of ['psd', 'psb'] as const) {
  const image = canvas(55, 77, 99)
  const input = format === 'psb' ? linkedShort : linkedWide
  const blob = buildPsd(2, 2, [{
    name: 'Cross-format metadata', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
    additionalInfo: [input],
  }], image, { format })
  const decoded = await decodePsd(new Uint8Array(await blob.arrayBuffer()))
  const matching = photoshopTaggedBlock(decoded.layers[0].additionalInfo, 'lnk2')
  assert.deepEqual(Array.from(matching), Array.from(format === 'psb' ? linkedWide : linkedShort),
    'PSD/PSB exporter must emit the target format tagged-length header')
}


for (const format of ['psd', 'psb'] as const) {
  const image = canvas(48, 90, 150)
  const extras = [
    Uint8Array.from([21, 43, 65, 87]),
    Uint8Array.from([98, 76, 54, 32]),
  ]
  const source = buildPsd(2, 2, [{
    name: 'Merged RGB with spot channels', canvas: image,
    left: 0, top: 0, opacity: 100, blendMode: 'normal', visible: true,
  }], image, { format, depth: 8, extraMergedChannels: extras })
  const bytes = new Uint8Array(await source.arrayBuffer())
  assert.equal(new DataView(bytes.buffer).getUint16(12), 6,
    'PSB/PSD channel header includes merged RGBA plus extra spot channels')
  const decoded = await decodePsd(bytes)
  assert.equal(decoded.extraMergedChannels.length, 2)
  assert.deepEqual(decoded.extraMergedChannels.map(c => Array.from(c)), extras.map(c => Array.from(c)),
    'Non-rendered merged spot/alpha channels are retained byte-for-byte')
  assert.deepEqual(Array.from(decoded.canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data),
    [48, 90, 150, 255], 'Extra spot data must not replace RGBA channels')
  const cross = buildPsd(2, 2, [{
    name: 'Converted PSD/PSB', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
  }], image, { format: format === 'psd' ? 'psb' : 'psd', depth: 8,
    extraMergedChannels: decoded.extraMergedChannels })
  const converted = await decodePsd(new Uint8Array(await cross.arrayBuffer()))
  assert.deepEqual(converted.extraMergedChannels.map(c => Array.from(c)), extras.map(c => Array.from(c)),
    'Extra spot planes survive PSD↔PSB conversion')
  assert.throws(() => buildPsd(2, 2, [{
    name: 'Incompatible spot channel', canvas: image, left: 0,
    top: 0, opacity: 100, blendMode: 'normal', visible: true,
  }], image, { format, extraMergedChannels: [Uint8Array.from([25])] }),
  /no longer matches dimensions or bit depth/, 'Stale extra channel dimensions are rejected')
}

for (const format of ['psd', 'psb'] as const) {
  // Construct a flattened image with no layer fallback, deliberately cutting
  // its shared RLE table short after one 16/32-bit row-length entry.
  const psb = format === 'psb'
  const data = new Uint8Array(26 + 4 + 4 + (psb ? 8 : 4) + 2 + (psb ? 4 : 2))
  const view = new DataView(data.buffer)
  data.set(new TextEncoder().encode('8BPS'), 0)
  view.setUint16(4, psb ? 2 : 1)
  view.setUint16(12, 4) // RGBA
  view.setUint32(14, 1)
  view.setUint32(18, 1)
  view.setUint16(22, 8)
  view.setUint16(24, 3)
  const imageStart = 26 + 4 + 4 + (psb ? 8 : 4)
  view.setUint16(imageStart, 1) // compression RLE
  if (psb) view.setUint32(imageStart + 2, 2)
  else view.setUint16(imageStart + 2, 2)
  await assert.rejects(
    () => decodePsd(data),
    /Cannot decode PSD merged image and no raster layers are available: Truncated PSD merged RLE row-length table/,
    'A truncated flattened PSD/PSB shared RLE table must fail instead of opening blank',
  )
}


function firstPhotoshopLayerRecord(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const psb = view.getUint16(4) === 2
  const lenSize = psb ? 8 : 4
  let pos = 26
  pos += 4 + view.getUint32(pos) // color-mode section
  pos += 4 + view.getUint32(pos) // image resources
  const lmAt = pos
  const lmSize = psb ? view.getUint32(pos) * 4294967296 + view.getUint32(pos + 4) : view.getUint32(pos)
  pos += lenSize
  const liAt = pos
  const liSize = psb ? view.getUint32(pos) * 4294967296 + view.getUint32(pos + 4) : view.getUint32(pos)
  pos += lenSize
  assert.ok(lmSize > liSize && liSize > 0)
  assert.equal(Math.abs(view.getInt16(pos)), 1)
  pos += 2
  return { record: pos, lmAt, liAt, lenSize, psb }
}

for (const format of ['psd', 'psb'] as const) {
  const image = canvas(60, 100, 140)
  const blob = buildPsd(2, 2, [{
    name: 'Bounds regression', canvas: image,
    left: 0, top: 0, opacity: 100, blendMode: 'normal', visible: true,
  }], image, { format })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const { record, lmAt, liAt, lenSize, psb } = firstPhotoshopLayerRecord(bytes)
  const original = new DataView(bytes.buffer)
  const count = original.getUint16(record + 16)
  // Duplicate channel IDs must be rejected rather than letting a later
  // plane silently overwrite the first RGB/alpha entry in the decoder Map.
  const duplicateColor = bytes.slice()
  const duplicateView = new DataView(duplicateColor.buffer)
  assert.ok(count >= 2, 'PSD layer must contain at least two color channels')
  duplicateView.setInt16(record + 20 + lenSize, 0)
  await assert.rejects(() => decodePsd(duplicateColor),
    /Duplicate Photoshop layer channel ID 0/,
    'Ambiguous duplicate red channels must not corrupt the imported image')
  const firstChannelLengthAt = record + 20
  const extraLengthAt = record + 18 + count * (2 + lenSize) + 12
  const broken = (mutate: (view: DataView) => void): Uint8Array => {
    const clone = bytes.slice()
    mutate(new DataView(clone.buffer))
    return clone
  }
  const oversizedMaskSection = broken(v => {
    if (psb) { v.setUint32(lmAt, 0xffffffff); v.setUint32(lmAt + 4, 0xffffffff) }
    else v.setUint32(lmAt, 0xffffffff)
  })
  await assert.rejects(() => decodePsd(oversizedMaskSection),
    /Unsupported Photoshop section length|Truncated Photoshop layer and mask section/)
  const oversizedLayerSection = broken(v => {
    if (psb) { v.setUint32(liAt, 0); v.setUint32(liAt + 4, 0xffffffff) }
    else v.setUint32(liAt, 0xffffffff)
  })
  await assert.rejects(() => decodePsd(oversizedLayerSection), /Truncated Photoshop layer info section/)
  await assert.rejects(() => decodePsd(broken(v => v.setUint16(record + 16, 57))),
    /Invalid Photoshop layer channel table/)
  await assert.rejects(() => decodePsd(broken(v => {
    if (psb) { v.setUint32(firstChannelLengthAt, 0); v.setUint32(firstChannelLengthAt + 4, 1) }
    else v.setUint32(firstChannelLengthAt, 1)
  })), /Invalid Photoshop layer channel length/)
  await assert.rejects(() => decodePsd(broken(v => v.setUint32(extraLengthAt, 0xffffffff))),
    /Truncated Photoshop layer extra data/)
}


for (const format of ['psd', 'psb'] as const) {
  const image = canvas(40, 80, 120)
  const mask = canvas(255, 255, 255, 190)
  const source = buildPsd(2, 2, [{
    name: 'Dimension safety', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true, mask,
  }], image, { format })
  const bytes = new Uint8Array(await source.arrayBuffer())
  const { record, lenSize } = firstPhotoshopLayerRecord(bytes)
  const cloneWith = (change: (view: DataView) => void) => {
    const clone = bytes.slice()
    change(new DataView(clone.buffer))
    return clone
  }
  await assert.rejects(() => decodePsd(cloneWith(view => {
    view.setInt32(record + 8, 1000000) // layer bottom
    view.setInt32(record + 12, 1000000) // layer right
  })), /Invalid Photoshop layer dimensions/,
  'Untrusted Photoshop layer extents must not allocate enormous pixel planes')
  await assert.rejects(() => decodePsd(cloneWith(view => {
    view.setInt32(record + 8, -1) // inverted layer rectangle
  })), /Invalid Photoshop layer dimensions/)
  const view = new DataView(bytes.buffer)
  const channelCount = view.getUint16(record + 16)
  const extraLengthAt = record + 18 + channelCount * (2 + lenSize) + 12
  assert.equal(view.getUint32(extraLengthAt + 4), 20)
  await assert.rejects(() => decodePsd(cloneWith(dv => {
    const maskTop = extraLengthAt + 8
    dv.setInt32(maskTop + 8, 1000000)
    dv.setInt32(maskTop + 12, 1000000)
  })), /Invalid Photoshop layer mask\/channel dimensions/,
  'Untrusted Photoshop mask rectangles must not allocate enormous buffers')
}


for (const format of ['psd', 'psb'] as const) {
  const image = canvas(90, 70, 50)
  const resource = Uint8Array.from([
    0x38, 0x42, 0x49, 0x4d, // 8BIM
    0x04, 0x28, // opaque Photoshop resource
    0, 0, // empty Pascal name, padded to even length
    0, 0, 0, 4, // payload length
    0xaa, 0xbb, 0xcc, 0xdd,
  ])
  const source = buildPsd(2, 2, [{
    name: 'Resource limits', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
  }], image, { format, imageResources: [resource] })
  const encoded = new Uint8Array(await source.arrayBuffer())
  const original = await decodePsd(encoded)
  assert.ok(original.imageResources.some(b => Array.from(b).join(',') === Array.from(resource).join(',')),
    'Valid Photoshop resource blocks must be retained')
  const at = encoded.findIndex((_, offset) => offset + resource.length <= encoded.length &&
    resource.every((v, j) => encoded[offset + j] === v))
  assert.ok(at >= 0, 'Expected source resource in serialized PSD')
  const mutated = (change: (bytes: Uint8Array, view: DataView) => void) => {
    const broken = encoded.slice()
    change(broken, new DataView(broken.buffer))
    return broken
  }
  await assert.rejects(() => decodePsd(mutated(b => { b[at] = 0 })),
    /Invalid Photoshop image resource signature/,
    'Corrupt Photoshop resource signatures must not silently drop metadata')
  await assert.rejects(() => decodePsd(mutated(b => { b[at + 6] = 255 })),
    /Truncated Photoshop image resource name/,
    'Oversized Photoshop Pascal names must be rejected')
  await assert.rejects(() => decodePsd(mutated((_b, view) => {
    view.setUint32(at + 8, 0xffffffff)
  })), /Truncated Photoshop image resource payload/,
    'Oversized Photoshop image resource payloads must be rejected')
}


const malformedPalette = indexedPsd(false)
new DataView(malformedPalette.buffer).setUint32(26, 767)
await assert.rejects(() => decodePsd(malformedPalette),
  /Truncated Photoshop indexed color palette/,
  'Missing PSD palette entries must not silently produce black RGB pixels')
const invalidIndexedDepth = indexedPsd(false)
new DataView(invalidIndexedDepth.buffer).setUint16(22, 16)
await assert.rejects(() => decodePsd(invalidIndexedDepth),
  /Photoshop indexed-color PSD requires 8-bit palette indices/,
  'Photoshop indexed-color must not decode incompatible 16-bit indices')


for (const format of ['psd', 'psb'] as const) {
  for (const depth of [8, 16] as const) {
    const pixels = canvas(44, 88, 132)
    const globalMask = Uint8Array.from([13, 37, 61, 85])
    const linkedPayload = Uint8Array.from([71, 23, 117, 201])
    // lnk2 must use a 64-bit length in PSB, and a uint32 length in PSD.
    // Feed the *opposite* source representation to exercise conversion.
    const linked = taggedPsdBlock('lnk2', Array.from(linkedPayload), format === 'psd')
    const shared = taggedPsdBlock('Patt', [9, 18, 27, 36])
    const source = buildPsd(2, 2, [{
      name: 'Global linked-data source', canvas: pixels,
      left: 0, top: 0, opacity: 100, blendMode: 'normal', visible: true,
    }], pixels, { format, depth,
      globalLayerMaskData: globalMask,
      globalAdditionalInfo: [linked, shared] })
    const decoded = await decodePsd(new Uint8Array(await source.arrayBuffer()))
    assert.equal(decoded.layers.length, 1, 'Global tags must not hide raster layer records')
    assert.deepEqual(Array.from(decoded.globalLayerMaskData), Array.from(globalMask),
      'Global Photoshop mask payload must survive the decoder')
    assert.deepEqual(decoded.globalAdditionalInfo.map(b => new TextDecoder().decode(b.subarray(4, 8))),
      ['lnk2', 'Patt'], 'Linked and pattern blocks remain document-global')
    const linkedDecoded = photoshopTaggedBlock(decoded.globalAdditionalInfo, 'lnk2')
    assert.deepEqual(Array.from(linkedDecoded), Array.from(taggedPsdBlock(
      'lnk2', Array.from(linkedPayload), format === 'psb')),
      'Global linked data must use the destination PSD/PSB length header')
    assert.ok(!decoded.globalAdditionalInfo.some(block =>
      ['Lr16', 'Lr32'].includes(new TextDecoder().decode(block.subarray(4, 8)))),
      'High-depth Photoshop layer records must never be preserved as stale global tags')
    const swappedFormat = format === 'psd' ? 'psb' : 'psd'
    const roundtrip = buildPsd(2, 2, [{
      name: 'Round-trip global metadata', canvas: pixels,
      left: 0, top: 0, opacity: 100, blendMode: 'normal', visible: true,
    }], pixels, { format: swappedFormat, depth,
      globalLayerMaskData: decoded.globalLayerMaskData,
      globalAdditionalInfo: decoded.globalAdditionalInfo })
    const reread = await decodePsd(new Uint8Array(await roundtrip.arrayBuffer()))
    assert.deepEqual(Array.from(reread.globalLayerMaskData), Array.from(globalMask))
    assert.deepEqual(Array.from(photoshopTaggedBlock(reread.globalAdditionalInfo, 'lnk2')),
      Array.from(taggedPsdBlock('lnk2', Array.from(linkedPayload), swappedFormat === 'psb')),
      'PSD↔PSB conversion must preserve global linked-object payload bytes')
    assert.equal(reread.layers.length, 1,
      'High-depth layer records are still discoverable after linked-object conversion')
  }
}


// A flattened PSD may carry an explicit zero-layer layer-info section.
// Negative zero cannot signal transparency, so retain legacy merged-alpha
// decoding for this otherwise ambiguous Photoshop representation.
const zeroLayers = rgbWithExtraChannels([11, 22, 33, 88])
const zeroLayerSection = new Uint8Array(zeroLayers.length + 10)
zeroLayerSection.set(zeroLayers.subarray(0, 38), 0)
zeroLayerSection.set([0, 0, 0, 2, 0, 0, 0, 0, 0, 0], 38)
zeroLayerSection.set(zeroLayers.subarray(38), 48)
new DataView(zeroLayerSection.buffer).setUint32(34, 10)
const zeroLayerDecoded = await decodePsd(zeroLayerSection)
assert.equal(zeroLayerDecoded.layers.length, 0)
assert.equal(zeroLayerDecoded.canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[3], 88)
assert.equal(zeroLayerDecoded.hasAlpha, true)
assert.equal(zeroLayerDecoded.extraMergedChannels.length, 0)

for (const format of ['psd', 'psb'] as const) {
  const semiTransparent = canvas(38, 76, 114, 73)
  const original = buildPsd(2, 2, [{
    name: 'Signed layer count', canvas: semiTransparent, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
  }], semiTransparent, { format })
  const bytes = new Uint8Array(await original.arrayBuffer())
  const countOffset = firstPhotoshopLayerRecord(bytes).record - 2
  assert.equal(new DataView(bytes.buffer).getInt16(countOffset), -1,
    'Writer must signal the fourth merged channel as alpha with a negative layer count')
  const transparent = await decodePsd(bytes)
  assert.equal(transparent.canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[3], 73)
  assert.equal(transparent.hasAlpha, true)
  assert.equal(transparent.extraMergedChannels.length, 0,
    'Merged transparency is not an independently editable spot channel')

  // Adobe specifies that a POSITIVE layer count means the extra merged
  // channel is unrelated alpha/spot data rather than composite transparency.
  const positiveCount = bytes.slice()
  new DataView(positiveCount.buffer).setInt16(countOffset, 1)
  const withSpot = await decodePsd(positiveCount)
  assert.equal(withSpot.canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[3], 255,
    'A positive layer count must never make a Photoshop RGB preview transparent')
  assert.equal(withSpot.hasAlpha, false)
  assert.deepEqual(withSpot.extraMergedChannels.map(c => Array.from(c)), [[73, 73, 73, 73]],
    'Source alpha/spot channel samples must be retained for re-export')
  assert.ok(withSpot.warnings.some(w => w.includes('positive layer count')))

  const opaque = canvas(38, 76, 114)
  const restored = buildPsd(2, 2, [{
    name: 'Preserved spot', canvas: opaque, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
  }], opaque, { format, extraMergedChannels: withSpot.extraMergedChannels })
  const restoredBytes = new Uint8Array(await restored.arrayBuffer())
  assert.equal(new DataView(restoredBytes.buffer).getInt16(firstPhotoshopLayerRecord(restoredBytes).record - 2), -1)
  const reread = await decodePsd(restoredBytes)
  assert.deepEqual(reread.extraMergedChannels.map(c => Array.from(c)), [[73, 73, 73, 73]])
  assert.equal(reread.canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[3], 255)
}


for (const [mode, adobeKey, legacyStudioKey] of [
  ['hard-light', 'hLit', 'hard'],
  ['soft-light', 'sLit', 'soft'],
  ['linear-dodge', 'lddg', 'dded'],
] as const) {
  assert.equal(blendModeToPsdKey(mode), adobeKey,
    `Photoshop ${mode} must use Adobe's documented blend identifier`)
  assert.equal(psdBlendKeyToMode(adobeKey), mode)
  assert.equal(psdBlendKeyToMode(legacyStudioKey), mode,
    'Older Studio PSD files must remain compatible with corrected blend-key parsing')
  for (const format of ['psd', 'psb'] as const) {
    const image = canvas(17, 45, 83)
    const output = buildPsd(2, 2, [{
      name: mode, canvas: image, left: 0, top: 0, opacity: 100,
      blendMode: mode, visible: true,
    }], image, { format })
    const parsed = await decodePsd(new Uint8Array(await output.arrayBuffer()))
    assert.equal(parsed.layers[0].blendKey, adobeKey,
      `Exported ${format} layer must use the Adobe ${adobeKey} blend key`)
    assert.equal(psdBlendKeyToMode(parsed.layers[0].blendKey), mode)
    assert.ok(!parsed.warnings.some(w => w.includes('blend modes cannot be previewed faithfully')),
      `Known Adobe ${adobeKey} must not be flagged as an unknown blend mode`)
  }
}

console.log('PSD/PSB 8-/16-/32-bit round-trip: version, layers, visibility, alpha, Unicode PPI and folder structure and CMYK previews and Photoshop-only adjustment passthrough and Lab previews and indexed palettes pass')



// Independent, externally authored PSD/PSB fixture corpus. Unlike the cases
// above, these files were not made by buildPsd. Opt in for CI/manual network
// validation: PSD_REAL_CORPUS=1 bun scripts/validate-psd-roundtrip.ts
//
// Source: psd-tools/psd-tools, MIT repository (tests/psd_files).
// Pin the upstream commit and verify Git blob SHA-1 before parsing so changes
// in an upstream fixture cannot silently alter our regression expectations.
if (process.env.PSD_REAL_CORPUS === '1') {
  const { createHash } = await import('node:crypto')
  const upstream = 'b58704c1c9c9b2459f961560b1e368dfb102b513'
  const fixtures = [
    { name: '1layer.psd', sha: '2420ee826ae9c2271cd80a0b01ec394d26b38c07', size: 6476 },
    { name: '2layers.psd', sha: '8e5f89d87d7c74e0e4ec59b03a3c64c1938e5a28', size: 14176 },
    { name: 'mask.psd', sha: '461802afc140cf2eabf228a5cfbdd0276697e99a', size: 72905 },
    { name: 'text.psd', sha: 'c424e40ae25c8d05ab7652ce5ee83eab1ac56744', size: 93949 },
    { name: 'group.psb', sha: '762ade19b89edfe280c0c302567a7a9dbe52612d', size: 36590 },
    { name: '16bit5x5.psb', sha: '834c4dab9d11f528adb1ff3933ab513bbeb08812', size: 23482 },
    { name: 'layers/pixel-layer.psd', sha: '0d3ee59728ebd8237e4c2c8eee1997e42e3ee82d', size: 24987 },
    { name: 'layers/type-layer.psd', sha: '1cdcf08f88b103a50b74de7f3b70a7ccf63122e5', size: 43717 },
    { name: 'layers/smartobject-layer.psd', sha: '924e5866581b25ffa1d2cbc8cbf34217929e4295', size: 26417 },
    { name: 'unicode_pathname.psd', sha: '6efb9ad90fd07e00e9fde652c553bbe49a6526df', size: 120304 },
    { name: 'unicode_pathname.psb', sha: '3a79bd6b8792e5eef39c49b0e79c2e8d2b09cfe2', size: 128480 },
    { name: '32bit5x5.psb', sha: 'd8edd353ee87d28e4402dc4608d22f0e2645761e', size: 20954 },
    { name: 'advanced-blending.psd', sha: 'a52475596c36c42d176929ed97b5f357f9885463', size: 961076 },
    { name: 'clipping-mask.psd', sha: '9a96be9cdc59baa5b454bfb1719d0a3d987e7286', size: 95259 },
    { name: 'group.psd', sha: '60dbe4c37171cd6d4dc7bdb81e2d49f04a108fa5', size: 31480 },
    { name: 'hidden-groups.psd', sha: '70c27dd2d992afc979a1a7923181c6752dd05fb9', size: 33178 },
    { name: 'layer_mask_data.psd', sha: '9e1ee6f835aa0f1f016a9eaa1e4ea49b094dfb24', size: 116702 },
    { name: 'mask-disabled.psd', sha: '94fd3a07fde97799629f8fe84f4ac63583710b64', size: 91988 },
    { name: 'mask-parameters-no-real-channel.psd', sha: 'db774029f8d7ba63c7345fa11e1b63cafeeab507', size: 117792 },
    { name: 'mask_parameters.psd', sha: 'd7dc91233d0e5285e7aafd969dd97f5da9449250', size: 36214 },
    { name: 'masks3.psd', sha: 'df8cc6cfa16e5e59ac8d4772ee84ee0419842afe', size: 28634 },
    { name: 'placedLayer.psd', sha: '707df934bb10bbcbb699c46d4bcde5580e48c036', size: 114796 },
    { name: 'smart-object-slice.psb', sha: '2485a0653148f243fc7c601a78ac909d1b9bae77', size: 1085326 },
  ] as const
  const failures: string[] = []
  for (const fixture of fixtures) {
    try {
      const url = `https://raw.githubusercontent.com/psd-tools/psd-tools/${upstream}/tests/psd_files/${fixture.name}`
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`)
      const data = new Uint8Array(await response.arrayBuffer())
      assert.equal(data.length, fixture.size, 'Pinned source size mismatch')
      const gitBlobHash = createHash('sha1')
        .update('blob ' + data.length + String.fromCharCode(0)).update(data).digest('hex')
      assert.equal(gitBlobHash, fixture.sha, 'Pinned source Git blob hash mismatch')
      assert.equal(new TextDecoder().decode(data.subarray(0, 4)), '8BPS', 'Authentic PSD/PSB header')
      const sourceVersion = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(4)
      const decoded = await decodePsd(data)
      if (fixture.name.startsWith('unicode_pathname.')) {
        // These independent files exercise Photoshop path-name metadata.
        // Only simple single-subpath records are editable in Studio; opaque
        // Photoshop name/compound records must still survive unchanged.
        const originals = decoded.imageResources.filter(block =>
          block.length >= 6 && block[0] === 56 && block[1] === 66 &&
          block[2] === 73 && block[3] === 77 &&
          ((block[4] << 8) | block[5]) >= 2000 &&
          ((block[4] << 8) | block[5]) <= 2997)
        const newResources = writePsdPaths(decoded.imageResources,
          decoded.paths.map((p, i) => ({ ...p, id: `imported-${i}` })),
          decoded.paths.map(p => p.psdPathResourceId), decoded.width, decoded.height)
        for (const block of originals) {
          assert.ok(newResources.includes(block),
            'Real unmodified Photoshop saved-path records must survive byte-identical export')
        }
      }
      assert.equal(decoded.width > 0 && decoded.height > 0, true)
      assert.equal(decoded.canvas.width, decoded.width)
      assert.equal(decoded.canvas.height, decoded.height)
      assert.equal(decoded.depth === 8 || decoded.depth === 16 || decoded.depth === 32, true)
      if (fixture.name.startsWith('unicode_pathname.')) {
        assert.ok(decoded.imageResources.some(block =>
          block.length >= 6 && ((block[4] << 8) | block[5]) >= 2000 &&
          ((block[4] << 8) | block[5]) <= 2997),
        'Valid path-only Photoshop files must retain their image-resource path data')
      } else {
        assert.ok(decoded.layers.length > 0, 'Layered source must not silently import as a flattened/empty project')
      }
      assert.equal(decoded.layers.every(layer => layer.canvas.width >= 0 && layer.canvas.height >= 0), true)
      for (const layer of decoded.layers) {
        if (!layer.unsupportedRealMask) continue
        assert.ok(layer.preservedMaskChannels, 'Real source -3 channel must be retained as opaque data')
        assert.ok(layer.preservedMaskChannels.real.length >= 2, 'Real Photoshop mask channel bytes are nonempty')
        assert.equal(layer.preservedMaskChannels.sourceFormat, fixture.name.endsWith('.psb') ? 'psb' : 'psd')
      }
      if (fixture.name === 'layers/smartobject-layer.psd') {
        assert.ok(decoded.layers.some(layer => psdNativeObjectKind(layer.additionalInfo) === 'smart'),
          'Real Photoshop Smart Object test file must expose at least one live placed-layer descriptor')
      }
      if (fixture.name === 'unicode_pathname.psb') {
        assert.ok(decoded.globalOpaqueTail.length >= 8,
          'PSB untagged global version-16 descriptor must survive import')
        const saved = buildPsd(decoded.width, decoded.height, [{
          name: 'Original composite preview', canvas: decoded.canvas, left: 0, top: 0,
          opacity: 100, blendMode: 'normal', visible: true,
        }], decoded.canvas, {
          format: 'psb', imageResources: decoded.imageResources,
          globalOpaqueTail: decoded.globalOpaqueTail,
        })
        const restored = await decodePsd(new Uint8Array(await saved.arrayBuffer()))
        assert.deepEqual(Array.from(restored.globalOpaqueTail), Array.from(decoded.globalOpaqueTail),
          'PSB untagged global descriptor must survive export byte-identically')
      }
      if (fixture.name === '16bit5x5.psb') {
        assert.equal(decoded.depth, 16, 'Real Photoshop 16-bit PSB must retain its source depth')
      }
      if (fixture.name === 'layer_mask_data.psd' || fixture.name === 'mask_parameters.psd') {
        const originalMasks = decoded.layers.filter(layer => layer.preservedMaskChannels)
        assert.ok(originalMasks.length > 0, 'Photoshop test fixture must contain real -3 mask channels')
        const saved = buildPsd(decoded.width, decoded.height, decoded.layers.map(layer => ({
          name: layer.name, canvas: layer.canvas,
          left: layer.left, top: layer.top,
          opacity: layer.opacity, blendMode: layer.blendMode,
          visible: layer.visible, clipped: layer.clipped,
          mask: layer.mask, maskEnabled: layer.maskEnabled,
          preservedMaskChannels: layer.preservedMaskChannels,
          additionalInfo: layer.additionalInfo, blendingRanges: layer.blendingRanges,
        })), decoded.canvas, { format: 'psd', depth: decoded.depth })
        const reopened = await decodePsd(new Uint8Array(await saved.arrayBuffer()))
        const copiedMasks = reopened.layers.filter(layer => layer.preservedMaskChannels)
        assert.equal(copiedMasks.length, originalMasks.length,
          'Genuine Photoshop -3 channels must survive the editor export')
        for (let maskIndex = 0; maskIndex < originalMasks.length; maskIndex++) {
          const original = originalMasks[maskIndex].preservedMaskChannels!
          const savedMask = copiedMasks[maskIndex].preservedMaskChannels!
          assert.deepEqual(Array.from(savedMask.real), Array.from(original.real),
            'Genuine Photoshop combined-mask compressed bytes must remain exact')
          assert.deepEqual(Array.from(savedMask.metadata), Array.from(original.metadata),
            'Genuine Photoshop mask flags, rectangles and metadata must remain exact')
          assert.deepEqual(savedMask.user ? Array.from(savedMask.user) : null,
            original.user ? Array.from(original.user) : null,
            'Genuine Photoshop user raster-mask bytes must not be rewritten')
        }
      }
      // Export a real source image through Studio and import it again.
      // This covers more than byte-level import but is NOT a substitute for
      // opening the exported file in Adobe Photoshop or comparing rendered FX.
      if (fixture.name === '1layer.psd' || fixture.name === '2layers.psd') {
        const exported = buildPsd(decoded.width, decoded.height, decoded.layers.map(layer => ({
          name: layer.name, canvas: layer.canvas, left: layer.left, top: layer.top,
          opacity: layer.opacity, blendMode: layer.blendMode,
          rawBlendKey: layer.blendKey, visible: layer.visible, clipped: layer.clipped,
          mask: layer.mask, maskEnabled: layer.maskEnabled,
          additionalInfo: layer.additionalInfo,
          blendingRanges: layer.blendingRanges,
        })), decoded.canvas, {
          depth: 8, imageResources: decoded.imageResources, resolutionPpi: decoded.resolutionPpi,
          globalLayerMaskData: decoded.globalLayerMaskData,
          globalAdditionalInfo: decoded.globalAdditionalInfo,
        })
        const again = await decodePsd(new Uint8Array(await exported.arrayBuffer()))
        assert.deepEqual(again.layers.map(layer => layer.name), decoded.layers.map(layer => layer.name),
          'Real Photoshop raster layer names must round-trip through Studio export')
        assert.equal(again.width, decoded.width)
        assert.equal(again.height, decoded.height)
        assert.deepEqual(
          Array.from(again.canvas.getContext('2d')!.getImageData(0, 0, again.width, again.height).data),
          Array.from(decoded.canvas.getContext('2d')!.getImageData(0, 0, decoded.width, decoded.height).data),
          'Real Photoshop merged composite pixels must survive Studio raster round-trip',
        )
      }
      const output = {
        fixture: fixture.name,
        source: `PSD/PSB v${sourceVersion}`,
        dimensions: `${decoded.width}x${decoded.height}`,
        depth: decoded.depth,
        colorMode: decoded.colorMode,
        layers: decoded.layers.length,
        groupsOrAdjustments: decoded.sectionMarkers.length,
        warnings: decoded.warnings,
      }
      console.log('REAL PSD PASS', JSON.stringify(output))
    } catch (error) {
      const message = `${fixture.name}: ${error instanceof Error ? error.message : String(error)}`
      failures.push(message)
      console.error('REAL PSD FAIL', message)
    }
  }
  assert.deepEqual(failures, [], 'Independent PSD/PSB fixture compatibility regressions')
  console.log(`Independent PSD/PSB binary corpus: ${fixtures.length} files passed`)
}
