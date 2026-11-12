// Headless Artboard Layer Assignment regression test.
// Verifies that layers can be assigned to specific artboards via setLayerProps,
// and that layersForArtboard filters correctly.
import assert from 'node:assert/strict'
import { Engine } from '../src/editor/engine/engine'
import { layersForArtboard } from '../src/editor/artboards'
import type { PsDocument } from '../src/editor/types'

// ---------------------------------------------------------------- fake canvas

class FakeCanvas {
  width: number
  height: number
  constructor(w: number, h: number) { this.width = w; this.height = h }
  getContext() { return null }
}

// ---------------------------------------------------------------- test

{
  const raw = new Engine()
  const doc = {
    id: 'd1', name: 'Test', width: 200, height: 200,
    workingBitDepth: 8, sourceBitDepth: 8, workingColorSpace: 'srgb',
    layers: [{
      id: 'l1', name: 'Layer 1', kind: 'raster', visible: true, opacity: 100,
      blendMode: 'normal', locked: false, clipped: false, canvas: null,
      source: null, mask: null, hdrPixels: null, hdrColorSpace: 'srgb',
      transform: null, smartFilters: [], maskEnabled: true, vectorMask: null,
      adjustment: null, text: null, shape: null, blendIf: null, fx: null,
      _v: 1, _mv: 1, offsetX: 0, offsetY: 0,
    }, {
      id: 'l2', name: 'Layer 2', kind: 'raster', visible: true, opacity: 100,
      blendMode: 'normal', locked: false, clipped: false, canvas: null,
      source: null, mask: null, hdrPixels: null, hdrColorSpace: 'srgb',
      transform: null, smartFilters: [], maskEnabled: true, vectorMask: null,
      adjustment: null, text: null, shape: null, blendIf: null, fx: null,
      _v: 1, _mv: 1, offsetX: 0, offsetY: 0,
    }],
    activeLayerId: 'l1', selection: null, channelView: 'rgb',
    channelTarget: 'composite', channelEditingTarget: null,
    savedChannels: [], view: { zoom: 1, panX: 0, panY: 0 },
    _epoch: 1, _stroke: null, _strokeLayerId: null, _strokeErase: false,
    _strokeOpacity: 1, _strokeBlendMode: 'normal', _strokeBbox: null,
    _strokeBgColor: null, _strokeV: 0, _liveDrag: null,
    artboards: [
      { id: 'a1', name: 'Artboard 1', x: 0, y: 0, width: 100, height: 100 },
      { id: 'a2', name: 'Artboard 2', x: 100, y: 0, width: 100, height: 100 },
    ],
    activeArtboardId: null,
    history: { states: [], index: -1 },
  } as unknown as PsDocument
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)

  // Initially no artboard assignment: layers appear in all artboards
  const board1 = doc.artboards![0]
  const board2 = doc.artboards![1]
  assert.equal(layersForArtboard(doc.layers, board1).length, 2, 'no artboardId: appears in all artboards')
  assert.equal(layersForArtboard(doc.layers, board2).length, 2, 'no artboardId: appears in all artboards')

  // Assign Layer 1 to Artboard 1
  raw.setLayerProps('l1', { artboardId: 'a1' }, { history: false })
  assert.equal(doc.layers.find(l => l.id === 'l1')!.artboardId, 'a1', 'artboardId set on layer')

  assert.equal(layersForArtboard(doc.layers, board1).length, 2, 'L1 assigned to A1: still appears in A1')
  assert.equal(layersForArtboard(doc.layers, board2).length, 1, 'L1 assigned to A1: only L2 in A2')
  assert.equal(layersForArtboard(doc.layers, board2)[0].id, 'l2', 'L2 is the only layer in A2')

  // Assign Layer 1 to Artboard 2
  raw.setLayerProps('l1', { artboardId: 'a2' }, { history: false })
  assert.equal(layersForArtboard(doc.layers, board1).length, 1, 'L1 moved to A2: only L2 in A1')
  assert.equal(layersForArtboard(doc.layers, board2).length, 2, 'L1 moved to A2: both layers in A2')

  // Clear artboard assignment (back to all)
  raw.setLayerProps('l1', { artboardId: undefined }, { history: false })
  assert.equal(layersForArtboard(doc.layers, board1).length, 2, 'artboardId cleared: L1 back in A1')
  assert.equal(layersForArtboard(doc.layers, board2).length, 2, 'artboardId cleared: L1 back in A2')

  console.log('artboard layer assignment validator: all checks passed')
}
