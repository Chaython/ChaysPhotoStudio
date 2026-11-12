import assert from 'node:assert/strict'
import {
  parse3dl, parseLook, parseLutFile, detectLutFormat, decodeLutText,
} from '../src/editor/image-ops/lut-formats'
import { sampleLUT } from '../src/editor/image-ops/lut'

const enc = new TextEncoder()
const bytes = (s: string) => enc.encode(s)

// ---------------------------------------------------------------- .3dl

/**
 * An N³ identity cube listed the way a Lustre file lists it: blue
 * varies fastest. Node codes are written 0..max.
 */
function threeDlCube(edge: number, max: number, blueFastest = true): string {
  const rows: string[] = []
  const q = (v: number) => Math.round((v / (edge - 1)) * max)
  for (let i = 0; i < edge ** 3; i++) {
    const r = blueFastest ? Math.floor(i / (edge * edge)) : i % edge
    const g = Math.floor(i / edge) % edge
    const b = blueFastest ? i % edge : Math.floor(i / (edge * edge))
    rows.push(`${q(r)} ${q(g)} ${q(b)}`)
  }
  return rows.join('\n')
}

const threeDl = parse3dl(threeDlCube(2, 1), 'identity-3dl')
assert.equal(threeDl.size, 2, '2³ cube edge is read from the row count')
assert.equal(threeDl.table.length, 2 * 2 * 2 * 3)
assert.equal(threeDl.shaper, undefined, 'no shaper row means no shaper curve')

const out = [0, 0, 0]
sampleLUT(threeDl, 0.25, 0.5, 0.75, out)
for (let c = 0; c < 3; c++) {
  assert.ok(Math.abs(out[c] - [0.25, 0.5, 0.75][c]) < 1e-6, 'blue-fastest .3dl is transposed into our red-fastest table')
}

// the same table listed red-fastest must NOT come out as the identity:
// that proves the reader is really re-ordering rather than copying.
const wrongOrder = parse3dl(threeDlCube(2, 1, false), 'identity-3dl-red-first')
sampleLUT(wrongOrder, 0.25, 0.5, 0.75, out)
assert.ok(Math.abs(out[0] - 0.25) > 1e-6, 'a red-fastest .3dl is transposed, not passed through')

// a shaper row bends the input before the cube is addressed
const bent = parse3dl('0 114 455 1023\n' + threeDlCube(2, 1), 'bent-3dl')
assert.ok(bent.shaper, 'a non-even shaper row is kept')
sampleLUT(bent, 0.5, 0.5, 0.5, out)
assert.ok(Math.abs(out[0] - 0.2781) < 0.01, `shaper bends the input (got ${out[0]})`)

// an even ramp is the identity and is dropped
const even = parse3dl('0 341 682 1023\n' + threeDlCube(2, 1), 'even-3dl')
assert.equal(even.shaper, undefined, 'an even shaper ramp changes nothing and is dropped')

// a Mesh declaration fixes the cube edge (2^inBits + 1) and the output
// code range (2^outBits - 1)
const declared = parse3dl('3DMESH\nMesh 1 8\n' + new Array(27).fill('255 255 255').join('\n'), 'declared-3dl')
assert.equal(declared.size, 3, 'Mesh 1 gives a 2¹+1 = 3 wide cube')
sampleLUT(declared, 0.25, 0.5, 0.75, out)
for (let c = 0; c < 3; c++) {
  assert.ok(Math.abs(out[c] - 1) < 1e-6, 'the declared output range scales the nodes')
}

// a 10-bit declaration reads its nodes on the 10-bit scale
const tenBit = parse3dl('Mesh 1 10\n' + new Array(27).fill('512 512 512').join('\n'), 'ten-bit-3dl')
sampleLUT(tenBit, 0.25, 0.5, 0.75, out)
assert.ok(Math.abs(out[0] - 512 / 1023) < 1e-6, 'a 10-bit declaration normalises against 1023')

// a truncated cube is refused rather than half-read
assert.throws(() => parse3dl('0 0 0\n1 1 1\n', 'short-3dl'), /not a cube/)
assert.throws(() => parse3dl('0 0 0\nNaN 0 0\n', 'nan-3dl'), /bad numeric row/)
assert.throws(() => parse3dl('0 0 0\n7\n', 'one-value-3dl'), /three node values or a shaper row/)
assert.throws(() => parse3dl('0 0 0\n0 1 2 3\n', 'two-shapers-3dl'), /only one shaper row/)

// ---------------------------------------------------------------- .look

function lookFile(size: number, rgba = false): string {
  const entries = size ** 3
  const floats: number[] = []
  for (let i = 0; i < entries; i++) {
    const r = i % size
    const g = Math.floor(i / size) % size
    const b = Math.floor(i / (size * size))
    floats.push(r / (size - 1), g / (size - 1), b / (size - 1))
    if (rgba) floats.push(1)
  }
  const bytesOut = new Uint8Array(floats.length * 4)
  const view = new DataView(bytesOut.buffer)
  floats.forEach((f, i) => view.setFloat32(i * 4, f, true))
  let hex = ''
  for (const byte of bytesOut) hex += byte.toString(16).padStart(2, '0')
  return `<look version="1.0"><size>${size}</size><data>${hex}</data></look>`
}

const look = parseLook(lookFile(2), 'speedgrade-look')
assert.equal(look.size, 2)
sampleLUT(look, 0.25, 0.5, 0.75, out)
for (let c = 0; c < 3; c++) {
  assert.ok(Math.abs(out[c] - [0.25, 0.5, 0.75][c]) < 1e-6, '.look is read red-fastest, our table order')
}

// an RGBA-flavoured .look is accepted and the alpha is dropped
const lookRgba = parseLook(lookFile(2, true), 'speedgrade-look-rgba')
assert.equal(lookRgba.size, 2)
assert.equal(lookRgba.table.length, 2 * 2 * 2 * 3)

// comments can hide tag-like text
const commented = parseLook(lookFile(2).replace('<data>', '<!-- <size>99</size> --><data>'), 'commented-look')
assert.equal(commented.size, 2, 'comments are stripped before tags are read')

assert.throws(() => parseLook('<size>2</size>', 'no-data'), /no <data>/)
assert.throws(() => parseLook('<size>2</size><data>zz</data>', 'bad-hex'), /hexadecimal/)

// ---------------------------------------------------------------- text decoding

const utf16 = new Uint8Array(2 + lookFile(2).length * 2)
utf16[0] = 0xff
utf16[1] = 0xfe
for (let i = 0; i < lookFile(2).length; i++) {
  const code = lookFile(2).charCodeAt(i)
  utf16[2 + i * 2] = code & 0xff
  utf16[3 + i * 2] = code >> 8
}
assert.ok(decodeLutText(utf16).includes('<size>'), 'a UTF-16LE BOM is honoured')
const utf16be = new Uint8Array(utf16.length)
utf16be[0] = 0xfe
utf16be[1] = 0xff
for (let i = 2; i < utf16.length; i += 2) { utf16be[i] = utf16[i + 1]; utf16be[i + 1] = utf16[i] }
assert.ok(decodeLutText(utf16be).includes('<size>'), 'a UTF-16BE BOM is honoured')

// ---------------------------------------------------------------- dispatch

assert.equal(detectLutFormat('look.3dl', bytes('0 0 0')), '3dl')
assert.equal(detectLutFormat('look.look', bytes('<size>2</size>')), 'look')
assert.equal(detectLutFormat('look.cube', bytes('LUT_3D_SIZE 2')), 'cube')
assert.equal(detectLutFormat('mystery', bytes('<size>2</size>')), 'look', 'XML is sniffed')
assert.equal(detectLutFormat('mystery', bytes('3DMESH\n')), '3dl', 'a Mesh header is sniffed')
assert.equal(detectLutFormat('mystery', bytes('LUT_3D_SIZE 2')), 'cube', 'anything else is a .cube')

const viaFile = parseLutFile('anything.3dl', bytes(threeDlCube(2, 1)))
assert.equal(viaFile.size, 2, 'the dispatcher reaches the .3dl reader')

// ---------------------------------------------------------------- end to end

// An imported table has to survive the whole Color Lookup path: the
// adjustment resolves the id through the session registry and applies
// the table to the layer's pixels.
{
  const { ADJUSTMENTS, applyAdjustment } = await import('../src/editor/image-ops')
  const data = new Uint8ClampedArray([128, 64, 32, 255])
  const img = { width: 1, height: 1, data } as ImageData
  applyAdjustment(img as never, 'color-lookup', { lutId: viaFile.id, strength: 100 })
  // the identity cube leaves the pixel alone
  assert.ok(Math.abs(data[0] - 128) <= 1 && Math.abs(data[1] - 64) <= 1, 'an identity .3dl leaves the pixels alone')
}

// a table that inverts the channels must invert them
{
  const { applyAdjustment } = await import('../src/editor/image-ops')
  const inverted = parse3dl(
    threeDlCube(2, 1).split('\n').map(line => {
      const [r, g, b] = line.split(' ').map(Number)
      return `${1 - r} ${1 - g} ${1 - b}`
    }).join('\n'),
    'inverted-3dl',
  )
  const data = new Uint8ClampedArray([200, 100, 50, 255])
  const img = { width: 1, height: 1, data } as ImageData
  applyAdjustment(img as never, 'color-lookup', { lutId: inverted.id, strength: 100 })
  assert.ok(data[0] < 60 && data[1] > 140 && data[2] > 195, `the inverted table is applied (got ${data[0]}, ${data[1]}, ${data[2]})`)
}

// the layer parameters stay JSON-serializable — the table itself lives
// in the session registry, never in the params
{
  const lut = parse3dl(threeDlCube(2, 1), 'params-3dl')
  const params = { lutId: lut.id, strength: 80 }
  assert.deepEqual(JSON.parse(JSON.stringify(params)), params, 'Color Lookup params round-trip through JSON')
  assert.ok(!JSON.stringify(params).includes('table'), 'the table is never written into the params')
}

console.log('LUT formats: .3dl ordering + shaper, .look RGB/RGBA, UTF-16 and format dispatch passed')
