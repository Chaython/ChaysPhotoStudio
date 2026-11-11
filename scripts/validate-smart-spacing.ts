import assert from 'node:assert/strict'
import { inferOneSidedSpacing, type SpacingRect } from '../src/editor/tools/smart-spacing'

const rect = (x: number, y: number, w = 20, h = 20): SpacingRect => ({ x, y, w, h })
const near = (actual: number | null, expected: number, label: string) => {
  assert.notEqual(actual, null, label + ': expected a spacing snap')
  assert.ok(Math.abs(actual! - expected) < 1e-6, label + ': expected ' + expected + ', got ' + actual)
}

// Two stationary layers to the left establish a 12px gap for the moving layer.
near(inferOneSidedSpacing(rect(80, 10), [rect(10, 10), rect(42, 10)], 'x', 'before', 20),
  4, 'Horizontal repeated gap from left')
near(inferOneSidedSpacing(rect(10, 10), [rect(80, 10), rect(112, 10)], 'x', 'after', 20),
  -4, 'Horizontal repeated gap from right')

// The same inference works vertically.
near(inferOneSidedSpacing(rect(10, 80), [rect(10, 10), rect(10, 42)], 'y', 'before', 20),
  4, 'Vertical repeated gap from above')
near(inferOneSidedSpacing(rect(10, 10), [rect(10, 80), rect(10, 112)], 'y', 'after', 20),
  -4, 'Vertical repeated gap from below')

// Orthogonal non-overlap must not create a false guide.
assert.equal(inferOneSidedSpacing(rect(80, 100), [rect(10, 10), rect(42, 10)], 'x', 'before', 100),
  null, 'Non-overlapping neighbors are ignored')
assert.equal(inferOneSidedSpacing(rect(80, 10), [rect(10, 10)], 'x', 'before', 100),
  null, 'One neighbor cannot define a repeated gap')
assert.equal(inferOneSidedSpacing(rect(80, 10), [rect(10, 10), rect(42, 10)], 'x', 'before', 2),
  null, 'Corrections outside snap tolerance are ignored')
console.log('Move Smart Guides: one-sided repeated spacing, both axes/sides, overlap and tolerance checks passed')
