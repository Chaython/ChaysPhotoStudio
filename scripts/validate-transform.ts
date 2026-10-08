// Geometry regression tests: no browser canvas or GPU required.
import assert from 'node:assert/strict'
import { mapNormalizedPointThroughWarp, puppetWarpMesh, validateWarpMesh } from '../src/editor/image-ops/transform'

const near = (actual: number, expected: number, label: string) => {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`)
}

const pin = {
  id: 'p1', x: 0.37, y: 0.63, targetX: 0.58, targetY: 0.82, rotation: 0, depth: 0,
}
const moved = puppetWarpMesh([pin], 6, 50, 1.8)
const exact = mapNormalizedPointThroughWarp({ x: pin.x, y: pin.y }, moved)
near(exact.x, pin.targetX, 'Source pin X reaches target')
near(exact.y, pin.targetY, 'Source pin Y reaches target')

const idle = puppetWarpMesh([], 6, 50, 1.8)
for (const point of [{ x: 0, y: 0 }, { x: 0.19, y: 0.75 }, { x: 1, y: 1 }]) {
  const mapped = mapNormalizedPointThroughWarp(point, idle)
  near(mapped.x, point.x, 'Unpinned X remains unchanged')
  near(mapped.y, point.y, 'Unpinned Y remains unchanged')
}

// A quarter-image horizontal displacement is half an image-height on a 2:1
// canvas. Rotating that offset 90° must move the point half a height vertically.
const rotated = puppetWarpMesh([{
  ...pin, x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5, rotation: 90,
}], 6, 50, 2)
const point = mapNormalizedPointThroughWarp({ x: 0.25, y: 0.5 }, rotated)
near(point.x, 0.5, '90° rotation preserves physical center X')
near(point.y, 0, '90° rotation uses physical X/Y aspect')

assert.equal(validateWarpMesh({ u: [0, 1], v: [0, 1], points: [{ x: 0, y: 0 }] }), null,
  'Malformed warp meshes must be rejected')
console.log('Puppet Warp geometry: identity, precise pins, aspect-correct rotation and invalid mesh checks passed')
