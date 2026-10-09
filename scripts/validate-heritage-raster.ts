import { decodeSgi, decodeSunRaster } from '../src/editor/formats/heritage-raster'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

// SGI .rgb: 2x2, three color planes, bottom-to-top, 8-bit uncompressed.
const sgi = new Uint8Array(512 + 2 * 2 * 3)
const sv = new DataView(sgi.buffer)
sv.setUint16(0, 474, false)
sgi[2] = 0 // uncompressed
sgi[3] = 1 // byte per component
sv.setUint16(4, 3, false)
sv.setUint16(6, 2, false)
sv.setUint16(8, 2, false)
sv.setUint16(10, 3, false)
sgi.set([255, 0, 0, 255], 512) // red bottom and top rows
sgi.set([0, 255, 255, 0], 516) // green
sgi.set([0, 0, 255, 255], 520) // blue
const decodedSgi = decodeSgi(sgi)
assert(decodedSgi.width === 2 && decodedSgi.height === 2, 'SGI dimensions')
assert(decodedSgi.rgba[0] === 0 && decodedSgi.rgba[1] === 255 && decodedSgi.rgba[2] === 255, 'SGI top-left RGB')
assert(decodedSgi.rgba[8] === 255 && decodedSgi.rgba[9] === 0 && decodedSgi.rgba[10] === 0, 'SGI bottom-left RGB')

// Sun Raster: 2 RGB24 pixels, blue-green-red byte order.
const ras = new Uint8Array(32 + 8)
const rv = new DataView(ras.buffer)
rv.setUint32(0, 0x59a66a95, false)
rv.setUint32(4, 2, false)
rv.setUint32(8, 1, false)
rv.setUint32(12, 24, false)
rv.setUint32(16, 8, false)
rv.setUint32(20, 1, false)
ras.set([3, 2, 1, 6, 5, 4], 32)
const decodedRas = decodeSunRaster(ras)
assert(decodedRas.width === 2 && decodedRas.height === 1, 'Sun Raster dimensions')
assert(decodedRas.rgba[0] === 1 && decodedRas.rgba[1] === 2 && decodedRas.rgba[2] === 3, 'Sun Raster BGR first pixel')
assert(decodedRas.rgba[4] === 4 && decodedRas.rgba[5] === 5 && decodedRas.rgba[6] === 6, 'Sun Raster BGR second pixel')

// Bad header / truncated payloads must fail rather than reading arbitrary bytes.
for (const [label, fn] of [
  ['truncated SGI', () => decodeSgi(sgi.subarray(0, 513))],
  ['truncated Sun Raster', () => decodeSunRaster(ras.subarray(0, 34))],
] as const) {
  let rejected = false
  try { fn() } catch { rejected = true }
  assert(rejected, label + ' was accepted')
}
console.log('Heritage raster decoder checks passed')
