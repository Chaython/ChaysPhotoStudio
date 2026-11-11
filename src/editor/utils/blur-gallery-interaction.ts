export type BlurGalleryPin = { x: number; y: number; radius: number }
export type BlurGalleryPointerPoint = { x: number; y: number; width: number; height: number }

/** Finds the closest field pin within the editor's screen-space hit radius. */
export function findBlurGalleryPin(pins: BlurGalleryPin[], point: BlurGalleryPointerPoint, hitRadius = 22): number {
  return pins.reduce((best, pin, index) => {
    const distance = Math.hypot((pin.x - point.x) * point.width, (pin.y - point.y) * point.height)
    return distance < best.distance ? { index, distance } : best
  }, { index: -1, distance: hitRadius }).index
}

/** Moves one pin while preserving its blur strength and all other pins. */
export function moveBlurGalleryPin(pins: BlurGalleryPin[], index: number, point: BlurGalleryPointerPoint): BlurGalleryPin[] {
  if (!Number.isInteger(index) || index < 0 || index >= pins.length) return pins
  return pins.map((pin, i) => i === index ? { ...pin, x: point.x, y: point.y } : pin)
}

/** Removes one pin and returns a valid selection index (or zero when empty). */
export function removeBlurGalleryPin(pins: BlurGalleryPin[], index: number): { pins: BlurGalleryPin[]; selectedIndex: number } {
  if (!Number.isInteger(index) || index < 0 || index >= pins.length) return { pins, selectedIndex: Math.min(Math.max(0, index), Math.max(0, pins.length - 1)) }
  const next = pins.filter((_, i) => i !== index)
  return { pins: next, selectedIndex: Math.min(Math.max(0, index - 1), Math.max(0, next.length - 1)) }
}

