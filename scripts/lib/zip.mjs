// Minimal ZIP writer (STORE method, UTF-8 names, no data descriptors).
// Store-only zips are accepted by the Chrome Web Store and every
// unzip tool; this keeps the build dependency-free. ~130 LOC.
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0 ^ 0xffffffff
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff]
  return (c ^ 0xffffffff) >>> 0
}

function u16(v) { return Buffer.from([v & 0xff, (v >> 8) & 0xff]) }
function u32(v) { return Buffer.from([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]) }

/** DOS date/time for "now" (local). */
function dosDateTime() {
  const d = new Date()
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f)
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f)
  return { time, date }
}

/**
 * @param {{name: string, data: Buffer}[]} entries
 * @returns {Buffer} complete .zip archive
 */
export function zipSync(entries) {
  const { time, date } = dosDateTime()
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    if (nameBuf.length > 0xffff) throw new Error(`zip: name too long: ${name}`)
    const crc = crc32(data)
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0),
      nameBuf, data,
    ])
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf,
    ])
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(cd.length), u32(offset), u16(0),
  ])
  return Buffer.concat([...locals, cd, eocd])
}
