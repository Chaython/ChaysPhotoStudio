import assert from 'node:assert/strict'
import {
  MAX_WEB_REGION_POINTS, buildImageMapHtml, circleMetrics, normalizeWebRegions,
  regionShape, type WebRegion,
} from '../src/editor/web-assets'
import {
  findRegionVertex, findWebRegion, moveRegion, moveRegionVertex, pointInPolygon,
  regionBounds, regionChanged, regionContains, scaleRegionPoints,
} from '../src/editor/tools/web-region-geometry'

const W = 100, H = 100

// --- Data model normalization -------------------------------------------------
const circleIn = { id: 'c1', kind: 'hotspot', name: 'Round', x: 10, y: 20, width: 30, height: 40, shape: 'circle', href: 'https://example.com', alt: '', target: '_self' }
const circle = normalizeWebRegions([circleIn], W, H)[0]
assert.equal(regionShape(circle), 'circle', 'circle hotspot shape must survive normalization')
assert.equal(circle.width, 30)
assert.equal(circle.height, 30, 'circles must normalize to square bounds')
assert.deepEqual(circleMetrics(circle), { cx: 25, cy: 35, radius: 15 }, 'circle metrics derive from the square bounds')

// Slices are always rectangular, even when fed polygon data.
const slicePoly = normalizeWebRegions([{
  id: 's1', kind: 'slice', name: 'S', x: 5, y: 5, width: 20, height: 20,
  shape: 'poly', points: [5, 5, 25, 5, 25, 25, 5, 25],
}], W, H)[0]
assert.equal(regionShape(slicePoly), 'rect', 'slices must stay rectangular')
assert.equal(slicePoly.shape, undefined)
assert.equal(slicePoly.points, undefined, 'slice polygon data must be dropped')

// Legacy rect saves keep working.
const legacy = normalizeWebRegions([{ id: 'l1', kind: 'hotspot', name: 'L', x: 1, y: 2, width: 10, height: 10 }], W, H)[0]
assert.equal(regionShape(legacy), 'rect', 'regions without a shape default to rect')

// Polygon vertices clamp to the document and recompute the bounding box.
const polyClamped = normalizeWebRegions([{
  id: 'p0', kind: 'hotspot', name: 'P', x: 0, y: 0, width: 1, height: 1,
  shape: 'poly', points: [-5, 10, 120, 10, 60, 90],
}], W, H)[0]
assert.deepEqual(polyClamped.points, [0, 10, 99, 10, 60, 90], 'polygon points must clamp to document bounds')
assert.deepEqual([polyClamped.x, polyClamped.y, polyClamped.width, polyClamped.height], [0, 10, 100, 81],
  'polygon bounding box must be recomputed from the clamped vertices')

// Invalid polygons are rejected rather than half-imported.
assert.equal(normalizeWebRegions([{ id: 'p1', kind: 'hotspot', name: 'P', x: 0, y: 0, width: 10, height: 10, shape: 'poly', points: [1, 1, 20, 20] }], W, H).length, 0, 'two vertices are not a polygon')
assert.equal(normalizeWebRegions([{ id: 'p2', kind: 'hotspot', name: 'P', x: 0, y: 0, width: 10, height: 10, shape: 'poly', points: [1, 1, 20, 20, 30] }], W, H).length, 0, 'odd point counts are rejected')
assert.equal(normalizeWebRegions([{ id: 'p3', kind: 'hotspot', name: 'P', x: 0, y: 0, width: 10, height: 10, shape: 'poly', points: [1, 1, 20.5, 20, 30, 30] }], W, H).length, 0, 'non-integer vertices are rejected')
assert.equal(normalizeWebRegions([{ id: 'p4', kind: 'hotspot', name: 'P', x: 0, y: 0, width: 10, height: 10, shape: 'poly' }], W, H).length, 0, 'missing points array is rejected')
assert.equal(normalizeWebRegions([{ id: 'p5', kind: 'hotspot', name: 'P', x: 0, y: 0, width: 10, height: 10, shape: 'poly', points: [5, 5, 5, 5, 5, 5] }], W, H).length, 0, 'zero-area polygons are rejected')

// Vertex cap: more than 60 vertices truncate instead of failing.
const many: number[] = []
for (let i = 0; i < 80; i++) many.push(i, (i % 40) + 2)
const truncated = normalizeWebRegions([{ id: 'p6', kind: 'hotspot', name: 'P', x: 0, y: 0, width: 10, height: 10, shape: 'poly', points: many }], W, H)[0]
assert.equal(truncated.points!.length / 2, MAX_WEB_REGION_POINTS, 'polygon vertices cap at ' + MAX_WEB_REGION_POINTS)
assert.equal(MAX_WEB_REGION_POINTS, 60, 'guard against the vertex cap changing unnoticed')

// --- Shape-aware hit testing --------------------------------------------------
const quad = normalizeWebRegions([{
  id: 'q1', kind: 'hotspot', name: 'Q', x: 10, y: 10, width: 41, height: 31,
  shape: 'poly', points: [10, 10, 50, 10, 50, 40, 10, 40],
}], W, H)[0]
assert.ok(regionContains(quad, 30, 25), 'polygon interior must be selectable')
assert.ok(!regionContains(quad, 5, 5), 'polygon exterior must not match')
assert.ok(regionContains(quad, 10, 25), 'polygon boundary counts as inside for stable clicking')
assert.ok(pointInPolygon([10, 10, 50, 10, 50, 40, 10, 40], 30, 25))
assert.ok(!pointInPolygon([10, 10, 50, 10, 50, 40, 10, 40], 60, 25))

assert.ok(regionContains(circle, 25, 35), 'circle center must be selectable')
assert.ok(!regionContains(circle, 10, 20), 'circle bounding-box corner must not match')
assert.ok(regionContains(circle, 40, 35), 'circle edge counts as inside')

const stack: WebRegion[] = [legacy, circle, quad]
assert.equal(findWebRegion(stack, 30, 25)!.id, 'q1', 'topmost shape-aware hit wins')
assert.equal(findWebRegion(stack, 25, 35)!.id, 'q1', 'overlapping circle center still resolves to the later polygon')
assert.equal(findWebRegion(stack, 25, 45)!.id, 'c1', 'circle points outside the polygon resolve to the circle')
assert.equal(findWebRegion(stack, 3, 3)!.id, 'l1', 'legacy rect hit testing is unchanged')

// --- Geometry editing ---------------------------------------------------------
const moved = moveRegion(quad, 30, 45, W, H)
assert.deepEqual(moved.points, [40, 55, 80, 55, 80, 85, 40, 85], 'moving a polygon shifts every vertex')
assert.deepEqual([moved.x, moved.y], [40, 55], 'moved polygon bbox follows the vertices')
const clampedMove = moveRegion(quad, 500, 0, W, H)
assert.equal(clampedMove.x + clampedMove.width - 1, W - 1, 'polygon move clamps to the document edge')
assert.deepEqual(clampedMove.points!.slice(0, 2), [clampedMove.x, clampedMove.y], 'vertices shift with the clamped bbox')

const scaled = scaleRegionPoints(quad, { x: 10, y: 10, width: 21, height: 16 }, W, H)
assert.deepEqual(scaled.points, [10, 10, 30, 10, 30, 25, 10, 25], 'scaling maps vertices into the new bbox')
assert.deepEqual([scaled.x, scaled.y, scaled.width, scaled.height], [10, 10, 21, 16])

assert.equal(findRegionVertex(quad, 50, 40, 3), 2, 'vertex snapping finds the nearest polygon vertex')
assert.equal(findRegionVertex(quad, 47, 37, 3), -1, 'vertex snapping respects tolerance')
const reshaped = moveRegionVertex(quad, 1, { x: 70, y: -8 }, W, H)
assert.deepEqual(reshaped.points, [10, 10, 70, 0, 50, 40, 10, 40], 'vertex moves clamp to the document')
assert.deepEqual([reshaped.x, reshaped.y, reshaped.width, reshaped.height], [10, 0, 61, 41], 'bbox recomputes after a vertex move')

assert.ok(!regionChanged(quad, { ...quad, points: [...quad.points!] }), 'identical polygons are unchanged')
assert.ok(regionChanged(quad, moveRegionVertex(quad, 0, { x: 12, y: 12 }, W, H)), 'vertex edits are detected even inside the same bbox')
assert.ok(!regionChanged(legacy, { ...legacy }), 'rect change detection is unchanged')
assert.ok(regionChanged(legacy, { ...legacy, x: legacy.x + 1 }))

// --- HTML image-map export ----------------------------------------------------
const html = buildImageMapHtml('map.png', W, H, [
  { ...legacy, href: '#top' }, circle, { ...quad, href: 'https://poly.example' },
  { id: 'x1', kind: 'slice', name: 'Slice', x: 0, y: 0, width: 10, height: 10 },
  { id: 'h9', kind: 'hotspot', name: 'Bad', x: 0, y: 0, width: 5, height: 5, shape: 'circle', href: 'javascript:alert(1)' },
])
assert.match(html, /<area shape="rect" coords="1,2,11,12"/, 'legacy rect areas are unchanged')
assert.match(html, /<area shape="circle" coords="25,35,15"/, 'circle areas export center and radius')
assert.match(html, /<area shape="poly" coords="10,10,50,10,50,40,10,40"/, 'polygon areas export every vertex')
assert.doesNotMatch(html, /javascript:/, 'unsafe circle hotspots are still excluded')
const areaCount = (html.match(/<area /g) || []).length
assert.equal(areaCount, 3, 'only safe hotspots become areas; slices never do')

const oddPoly = buildImageMapHtml('map.png', W, H, [{
  id: 'z0', kind: 'hotspot', name: 'Z', x: 1, y: 1, width: 8, height: 8, shape: 'poly',
  points: [1, 1, 5, 1, 5], href: 'https://ok.example',
}])
assert.doesNotMatch(oddPoly, /<area shape="poly"/, 'odd-count polygons are rejected before export')
const triangle = buildImageMapHtml('map.png', W, H, [{
  id: 'z1', kind: 'hotspot', name: 'Z', x: 1, y: 1, width: 8, height: 8, shape: 'poly',
  points: [1, 1, 5, 1, 5, 5], href: 'https://ok.example',
}])
assert.match(triangle, /<area shape="poly" coords="1,1,5,1,5,5"/, 'valid triangle hotspots export as polygon areas')

console.log('Circle/polygon hotspot shapes, geometry editing and image-map export verified')
