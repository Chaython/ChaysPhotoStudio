/** Exact, finite ruler calibration independent of the canvas/editor runtime. */
export function pixelsPerMeasureUnit(
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
