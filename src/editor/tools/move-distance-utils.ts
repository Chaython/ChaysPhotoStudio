/** Convert Move-tool gap measurements from document pixels to the selected ruler unit. */
export type MoveDistanceUnit = 'px' | 'mm' | 'cm' | 'in'

export function pixelsPerMoveUnit(
  unit: string,
  useDocumentResolution: boolean,
  documentPpi: number,
  manualPixelsPerUnit: number,
): number {
  if (unit === 'px') return 1
  if (!useDocumentResolution) {
    return Number.isFinite(manualPixelsPerUnit) && manualPixelsPerUnit > 0
      ? manualPixelsPerUnit : 1
  }
  const ppi = Number.isFinite(documentPpi) && documentPpi > 0 ? documentPpi : 72
  switch (unit) {
    case 'in': return ppi
    case 'cm': return ppi / 2.54
    case 'mm': return ppi / 25.4
    default: return 1
  }
}

export function formatMoveDistance(
  pixels: number,
  unit: string,
  useDocumentResolution: boolean,
  documentPpi: number,
  manualPixelsPerUnit: number,
): string {
  const safeUnit: MoveDistanceUnit = unit === 'mm' || unit === 'cm' || unit === 'in' ? unit : 'px'
  const ppu = pixelsPerMoveUnit(safeUnit, useDocumentResolution, documentPpi, manualPixelsPerUnit)
  const value = pixels / ppu
  const rounded = Math.round(value * 10) / 10
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + ' ' + safeUnit
}
