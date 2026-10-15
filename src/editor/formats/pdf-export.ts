/**
 * Export a rendered canvas as a standards-compliant single-page PDF.
 * This is a flattened visual export. Editable PDF object streams are not
 * reconstructed; retain the native project for editable layer preservation.
 */
export async function canvasToPdf(canvas: HTMLCanvasElement, ppi = 72, quality = 0.92): Promise<Blob> {
  if (!Number.isFinite(ppi) || ppi <= 0) throw new Error('Invalid PDF resolution')
  if (!canvas.width || !canvas.height || canvas.width * canvas.height > 100_000_000) {
    throw new Error('PDF image dimensions are invalid or exceed the safe export limit')
  }
  // JPEG cannot represent transparency. Flatten explicitly against white,
  // matching PDF viewers' default page background instead of black artifacts.
  const opaque = document.createElement('canvas')
  opaque.width = canvas.width
  opaque.height = canvas.height
  const ctx = opaque.getContext('2d')
  if (!ctx) throw new Error('PDF export canvas unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, opaque.width, opaque.height)
  ctx.drawImage(canvas, 0, 0)
  const image = await new Promise<Blob>((resolve, reject) => {
    opaque.toBlob(blob => blob ? resolve(blob) : reject(new Error('JPEG encoding failed')), 'image/jpeg', quality)
  })
  if (image.type !== 'image/jpeg') throw new Error('Canvas did not produce JPEG data')
  const jpeg = new Uint8Array(await image.arrayBuffer())
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 ||
      jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) {
    throw new Error('Invalid JPEG data for PDF export')
  }
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = [0]
  let offset = 0
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data
    chunks.push(bytes)
    offset += bytes.length
  }
  const object = (id: number, data: string | (() => void)) => {
    offsets[id] = offset
    push(`${id} 0 obj\n`)
    if (typeof data === 'string') push(data)
    else data()
    push('\nendobj\n')
  }
  const width = +(canvas.width * 72 / ppi).toFixed(4)
  const height = +(canvas.height * 72 / ppi).toFixed(4)
  if (width <= 0 || height <= 0 || width > 14400 || height > 14400) {
    throw new Error('PDF page dimensions exceed the supported limits')
  }
  const content = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`
  push('%PDF-1.4\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)
  object(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
    push(jpeg)
    push('\nendstream')
  })
  const body = enc.encode(content)
  object(5, () => {
    push(`<< /Length ${body.length} >>\nstream\n`)
    push(body)
    push('endstream')
  })
  const xref = offset
  push('xref\n0 6\n0000000000 65535 f \n')
  for (let id = 1; id <= 5; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(chunks.map(bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer), { type: 'application/pdf' })
}
