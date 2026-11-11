export type BlurGalleryPin = { x: number; y: number; radius: number }
export type BlurGalleryPointerPoint = { x: number; y: number; width: number; height: number }

/** Finds the closest field pin within the editor's screen-space hit radius. */
export function findBlurGalleryPin(pins: BlurGalleryPin[], point: BlurGalleryPointerPoint, hitRadius = 22): number {
  if (![point.x, point.y, point.width, point.height, hitRadius].every(Number.isFinite) || point.width <= 0 || point.height <= 0 || hitRadius <= 0) return -1
  return pins.reduce((best, pin, index) => {
    if (!Number.isFinite(pin.x) || !Number.isFinite(pin.y)) return best
    const distance = Math.hypot((pin.x - point.x) * point.width, (pin.y - point.y) * point.height)
    return distance < best.distance ? { index, distance } : best
  }, { index: -1, distance: hitRadius }).index
}

/** Moves one pin while preserving its blur strength and all other pins. */
export function moveBlurGalleryPin(pins: BlurGalleryPin[], index: number, point: BlurGalleryPointerPoint): BlurGalleryPin[] {
  if (!Number.isInteger(index) || index < 0 || index >= pins.length || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return pins
  const x = Math.max(0, Math.min(1, point.x)), y = Math.max(0, Math.min(1, point.y))
  return pins.map((pin, i) => i === index ? { ...pin, x, y } : pin)
}

/** Removes one pin and returns a valid selection index (or zero when empty). */
export function removeBlurGalleryPin(pins: BlurGalleryPin[], index: number): { pins: BlurGalleryPin[]; selectedIndex: number } {
  if (!Number.isFinite(index) || !Number.isInteger(index)) return { pins, selectedIndex: Math.max(0, Math.min(pins.length - 1, 0)) }
  const safeIndex = index
  if (safeIndex < 0 || safeIndex >= pins.length) return { pins, selectedIndex: Math.min(Math.max(0, safeIndex), Math.max(0, pins.length - 1)) }
  const next = pins.filter((_, i) => i !== safeIndex)
  return { pins: next, selectedIndex: Math.min(Math.max(0, safeIndex - 1), Math.max(0, next.length - 1)) }
}

