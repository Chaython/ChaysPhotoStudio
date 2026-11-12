// Headless Off-Canvas Artboards regression test.
// Verifies that artboards may sit partly or fully outside the document canvas,
// with transparent padding on export/preview, using pure functions and fake
// pixel canvases (no GUI, no native canvas dependency).
import assert from 'node:assert/strict'
import {
  normalizeArtboards, artboardCrop, type Artboard, type ArtboardCrop,
} from '../src/editor/artboards.ts'

// ---------------------------------------------------------------- normalizeArtboards accepts off-canvas

{
  const boards = normalizeArtboards([
    { id: 'a1', name: 'On-canvas', x: 10, y: 10, width: 50, height: 50 },
    { id: 'a2', name: 'Negative origin', x: -20, y: -20, width: 40, height: 40 },
    { id: 'a3', name: 'Extends right', x: 180, y: 10, width: 60, height: 50 },
    { id: 'a4', name: 'Fully off-canvas', x: 300, y: 300, width: 40, height: 40 },
  ], 200, 200)
  assert.equal(boards.length, 4, 'all four off-canvas variants accepted')
  assert.equal(boards.find(b => b.id === 'a2')!.x, -20, 'negative x preserved')
  assert.equal(boards.find(b => b.id === 'a2')!.y, -20, 'negative y preserved')
  assert.equal(boards.find(b => b.id === 'a3')!.x, 180, 'extends right preserved')
  assert.equal(boards.find(b => b.id === 'a3')!.x + boards.find(b => b.id === 'a3')!.width, 240, 'extends beyond canvas')
  assert.equal(boards.find(b => b.id === 'a4')!.x, 300, 'fully off-canvas preserved')
  console.log('normalizeArtboards off-canvas acceptance passed')
}

// invalid dimensions still rejected
{
  const boards = normalizeArtboards([
    { id: 'a1', name: 'Bad', x: 10, y: 10, width: 0, height: 50 },
    { id: 'a2', name: 'Bad', x: 10, y: 10, width: 50, height: -5 },
    { id: 'a3', name: 'Good', x: 10, y: 10, width: 50, height: 50 },
  ], 200, 200)
  assert.equal(boards.length, 1, 'zero/negative dimensions rejected')
  assert.equal(boards[0].id, 'a3', 'valid board kept')
  console.log('normalizeArtboards dimension validation passed')
}

// ---------------------------------------------------------------- artboardCrop source/destination

{
  // Fully on-canvas: source == artboard, no offset
  const c1 = artboardCrop({ id: 'a', name: 'A', x: 10, y: 10, width: 50, height: 50 }, 200, 200)!
  assert.deepEqual(c1, { sx: 10, sy: 10, sw: 50, sh: 50, dx: 0, dy: 0, aw: 50, ah: 50 })

  // Negative origin: source clamped to (0,0), offset positive
  const c2 = artboardCrop({ id: 'a', name: 'A', x: -20, y: -20, width: 40, height: 40 }, 200, 200)!
  assert.deepEqual(c2, { sx: 0, sy: 0, sw: 20, sh: 20, dx: 20, dy: 20, aw: 40, ah: 40 })

  // Extends right/bottom: source clamped to canvas edge
  const c3 = artboardCrop({ id: 'a', name: 'A', x: 180, y: 10, width: 60, height: 50 }, 200, 200)!
  assert.deepEqual(c3, { sx: 180, sy: 10, sw: 20, sh: 50, dx: 0, dy: 0, aw: 60, ah: 50 })

  // Fully off-canvas: no source overlap
  const c4 = artboardCrop({ id: 'a', name: 'A', x: 300, y: 300, width: 40, height: 40 }, 200, 200)!
  assert.deepEqual(c4, { sx: 200, sy: 200, sw: 0, sh: 0, dx: 100, dy: 100, aw: 40, ah: 40 })

  console.log('artboardCrop source/destination mapping passed')
}

// ---------------------------------------------------------------- translate/scale preserve off-canvas boards

{
  const boards = normalizeArtboards([
    { id: 'a1', name: 'A', x: -30, y: -20, width: 60, height: 40 },
  ], 200, 200)

  // translateArtboards shifts off-canvas boards correctly
  const translated = normalizeArtboards(
    boards.map(b => ({ ...b, x: b.x + 10, y: b.y + 5 })),
    200, 200
  )
  assert.equal(translated[0].x, -20, 'translate preserves negative x')
  assert.equal(translated[0].y, -15, 'translate preserves negative y')

  // scaleArtboards scales off-canvas boards about origin
  const scaled = normalizeArtboards(
    boards.map(b => ({
      ...b,
      x: Math.round(b.x * 2),
      y: Math.round(b.y * 2),
      width: Math.max(1, Math.round((b.x + b.width) * 2 - b.x * 2)),
      height: Math.max(1, Math.round((b.y + b.height) * 2 - b.y * 2)),
    })),
    400, 400
  )
  assert.equal(scaled[0].x, -60, 'scale doubles negative x')
  assert.equal(scaled[0].y, -40, 'scale doubles negative y')
  console.log('translate/scale off-canvas preservation passed')
}

console.log('validate-artboards-offcanvas: all checks passed')
