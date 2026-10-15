/** Multi-page flattened PDF writer. Each page is a separate RGB JPEG XObject. */
export async function canvasPagesToPdf(
  pages: readonly HTMLCanvasElement[], ppi = 72, quality = 0.92,
): Promise<Blob> {
  if (!pages.length || pages.length > 256) throw new Error('PDF export requires 1–256 pages')
  if (!Number.isFinite(ppi) || ppi <= 0) throw new Error('Invalid PDF resolution')
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = [0]
  let cursor = 0
  const write = (value: string | Uint8Array) => {
    const bytes = typeof value === 'string' ? enc.encode(value) : value
    chunks.push(bytes)
    cursor += bytes.length
  }
  const object = (id: number, body: () => void) => {
    offsets[id] = cursor
    write(String(id) + ' 0 obj\n')
    body()
    write('\nendobj\n')
  }
  const pageIds = pages.map((_, i) => 3 + i * 3)
  const count = 2 + 3 * pages.length
  write('%PDF-1.4\n')
  object(1, () => write('<< /Type /Catalog /Pages 2 0 R >>'))
  object(2, () => write('<< /Type /Pages /Kids [' + pageIds.map(id => id + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>'))
  for (const [i, canvas] of pages.entries()) {
    if (!canvas.width || !canvas.height || canvas.width * canvas.height > 100_000_000)
      throw new Error('Invalid PDF page dimensions')
    const width = +(canvas.width * 72 / ppi).toFixed(4)
    const height = +(canvas.height * 72 / ppi).toFixed(4)
    if (width <= 0 || height <= 0 || width > 14400 || height > 14400)
      throw new Error('PDF page dimensions exceed supported limits')
    const opaque = document.createElement('canvas')
    opaque.width = canvas.width
    opaque.height = canvas.height
    const ctx = opaque.getContext('2d')
    if (!ctx) throw new Error('PDF export canvas unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, opaque.width, opaque.height)
    ctx.drawImage(canvas, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) =>
      opaque.toBlob(value => value ? resolve(value) : reject(new Error('JPEG encoding failed')), 'image/jpeg', quality))
    if (blob.type !== 'image/jpeg') throw new Error('PDF export requires JPEG data')
    const jpeg = new Uint8Array(await blob.arrayBuffer())
    if (jpeg.length < 4 || jpeg[0] !== 255 || jpeg[1] !== 216 ||
        jpeg[jpeg.length - 2] !== 255 || jpeg[jpeg.length - 1] !== 217)
      throw new Error('Invalid JPEG for PDF page')
    const page = pageIds[i], img = page + 1, contents = page + 2
    object(page, () => write('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + width + ' ' + height +
      '] /Resources << /XObject << /Im0 ' + img + ' 0 R >> >> /Contents ' + contents + ' 0 R >>'))
    object(img, () => {
      write('<< /Type /XObject /Subtype /Image /Width ' + canvas.width +
        ' /Height ' + canvas.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
        jpeg.length + ' >>\nstream\n')
      write(jpeg)
      write('\nendstream')
    })
    const stream = enc.encode('q\n' + width + ' 0 0 ' + height + ' 0 0 cm\n/Im0 Do\nQ\n')
    object(contents, () => {
      write('<< /Length ' + stream.length + ' >>\nstream\n')
      write(stream)
      write('endstream')
    })
  }
  const start = cursor
  write('xref\n0 ' + (count + 1) + '\n0000000000 65535 f \n')
  for (let id = 1; id <= count; id++) write(String(offsets[id]).padStart(10, '0') + ' 00000 n \n')
  write('trailer\n<< /Size ' + (count + 1) + ' /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n')
  return new Blob(chunks.map(x => x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) as ArrayBuffer),
    { type: 'application/pdf' })
}
