/** CSV-driven editable text substitution without executing formulas, HTML or scripts.
 * Used by the offline Bulk Design Export dialog. Inputs are deliberately bounded.
 */
export const MAX_MERGE_CSV_BYTES = 1024 * 1024
export const MAX_MERGE_ROWS = 100
export const MAX_MERGE_COLUMNS = 64
const MAX_CELL_CHARS = 2000
export type MergeRow = Record<string, string>
export interface MergeTable { columns: string[]; rows: MergeRow[] }
export const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g

export function parseDesignCsv(input: string): MergeTable {
  if (typeof input !== 'string' || !input.trim() || new TextEncoder().encode(input).byteLength > MAX_MERGE_CSV_BYTES)
    throw Error('CSV is empty or exceeds 1 MiB')
  const source = input.replace(/^\uFEFF/, '')
  const grid: string[][] = []
  let record: string[] = [], field = '', quoted = false, atEndQuote = false, started = false
  const endField = () => {
    if (field.length > MAX_CELL_CHARS) throw Error('CSV cell exceeds 2,000 characters')
    record.push(field)
    if (record.length > MAX_MERGE_COLUMNS) throw Error('Too many CSV columns (64 maximum)')
    field = ''; quoted = false; atEndQuote = false; started = false
  }
  const endRecord = () => {
    endField()
    if (record.some(s => s.trim() !== '') || grid.length === 0) grid.push(record)
    if (grid.length > MAX_MERGE_ROWS + 1) throw Error('Too many CSV rows (100 maximum)')
    record = []
  }
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') { quoted = false; atEndQuote = true }
      else field += ch
    } else if (atEndQuote) {
      if (ch === ',') endField()
      else if (ch === '\r' || ch === '\n') {
        endRecord()
        if (ch === '\r' && source[i + 1] === '\n') i++
      } else if (ch !== ' ' && ch !== '\t') throw Error('Unexpected characters after quoted CSV cell')
    } else if (ch === ',' ) endField()
    else if (ch === '\r' || ch === '\n') {
      endRecord()
      if (ch === '\r' && source[i + 1] === '\n') i++
    } else if (ch === '"') {
      if (started || field.length) throw Error('Unexpected CSV quote inside unquoted cell')
      quoted = true; started = true
    } else { field += ch; started = true }
    if (field.length > MAX_CELL_CHARS) throw Error('CSV cell exceeds 2,000 characters')
  }
  if (quoted) throw Error('CSV has an unterminated quoted cell')
  if (record.length || field.length || started || atEndQuote || source.endsWith(',')) endRecord()
  const [header, ...data] = grid
  if (!header?.length || !data.length) throw Error('CSV needs a header and at least one data row')
  const columns = header.map(s => s.trim())
  if (columns.some(s => !s || s.length > 64 || /[{}]/.test(s))) throw Error('CSV column names must be 1–64 characters and cannot contain braces')
  if (new Set(columns.map(s => s.toLocaleLowerCase())).size !== columns.length) throw Error('CSV has duplicate column names')
  const rows: MergeRow[] = data.map(cells => {
    if (cells.length !== columns.length) throw Error('CSV row has a different number of fields than the header')
    return Object.fromEntries(columns.map((key, i) => [key, cells[i]]))
  })
  return { columns, rows }
}
export function mergeText(source: string, row: MergeRow): string {
  const result = source.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(row, name.trim()) ? row[name.trim()] : match)
  if (result.length > 10_000) throw Error('Merged text exceeds 10,000 characters')
  return result
}
export function mergeFieldNames(textLayers: readonly string[]): string[] {
  const found = new Set<string>()
  for (const text of textLayers) {
    for (const match of text.matchAll(PLACEHOLDER)) found.add(match[1].trim())
  }
  return [...found]
}


/** Detached copies of text layers with changed content; no canvas cloning,
 * no source mutations, and a version bump to invalidate renderer caches. */
export function mergeEditableLayers<T extends {
  kind: string; text?: { content: string } | null; _v: number
}>(layers: readonly T[], row: MergeRow): T[] {
  return layers.map(layer => {
    if (layer.kind !== 'text' || !layer.text || !layer.text.content.includes('{{')) return layer
    const content = mergeText(layer.text.content, row)
    if (content === layer.text.content) return layer
    return { ...layer, text: { ...layer.text, content }, _v: layer._v + 1 }
  })
}
