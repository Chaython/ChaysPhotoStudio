import type { ParsedDocument } from './document-parser-types'
import { fileExtension } from './photopea-formats'
import { parseSketch } from './sketch'
import { parseXd } from './xd'
import { parseKrita } from './krita'
import { parseSvgDocument } from './svg-document'
import { parsePdfFamily } from './pdf-family'
import { parseXcf } from './xcf'
import { parseFigma } from './figma'

const DEDICATED = new Set(['sketch', 'xd', 'kra', 'kri', 'svg', 'pdf', 'ai', 'eps', 'xcf', 'fig'])

export function hasDedicatedDocumentParser(name: string): boolean {
  return DEDICATED.has(fileExtension(name))
}

export async function parseStructuredDocument(file: File | Blob, name = (file as File).name || ''): Promise<ParsedDocument | null> {
  const ext = fileExtension(name)
  if (!DEDICATED.has(ext)) return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  switch (ext) {
    case 'sketch': return parseSketch(bytes, name)
    case 'xd': return parseXd(bytes, name)
    case 'kra': case 'kri': return parseKrita(bytes, name)
    case 'svg': return parseSvgDocument(bytes, name)
    case 'pdf': case 'ai': case 'eps': return parsePdfFamily(bytes, name)
    case 'xcf': return parseXcf(bytes, name)
    case 'fig': return parseFigma(bytes, name)
    default: return null
  }
}
