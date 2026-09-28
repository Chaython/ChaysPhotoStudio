import type { ParsedDocument } from './document-parser-types'
import { fileExtension } from './photopea-formats'
import { parseSketch } from './sketch'
import { parseXd } from './xd'
import { parseKrita } from './krita'

const DEDICATED = new Set(['sketch', 'xd', 'kra'])

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
    case 'kra': return parseKrita(bytes, name)
    default: return null
  }
}
