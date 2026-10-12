import { readColor } from './color-readout'

export interface SamplerCsvPoint {
  x: number
  y: number
  /** Null means no visible sampled pixel, not opaque black. */
  hex: string | null
}

/** Export the actual sampling source and size alongside precision coordinates. */
export function formatSamplerCsv(
  points: readonly SamplerCsvPoint[],
  scope: 'composite' | 'layer',
  sampleSize: number,
): string {
  const header = [
    'Point', 'X (px)', 'Y (px)', 'Source', 'Sample size',
    'HEX', 'R', 'G', 'B', 'H (deg)', 'S (%)', 'L (%)',
    'Lab L', 'Lab a', 'Lab b', 'C (%)', 'M (%)', 'Y (%)', 'K (%)',
  ]
  const rows = points.map((point, i): string[] => {
    const prefix = [
      String(i + 1), point.x.toFixed(2), point.y.toFixed(2),
      scope === 'layer' ? 'Current Layer' : 'All Layers',
      String(sampleSize),
    ]
    if (point.hex === null) return [...prefix, 'Transparent', ...Array(13).fill('')]
    const color = readColor(point.hex)
    return [
      ...prefix, color.hex,
      ...color.rgb.map(String),
      ...color.hsl.map(n => n.toFixed(2)),
      ...color.lab.map(n => n.toFixed(2)),
      ...color.cmyk.map(n => n.toFixed(2)),
    ]
  })
  return [header, ...rows].map(row =>
    row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','),
  ).join('\r\n')
}
