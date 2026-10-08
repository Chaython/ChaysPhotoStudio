import assert from 'node:assert/strict'
import { Engine } from '../src/editor/engine/engine'
import type { PsDocument } from '../src/editor/types'

// Lightweight documents: preview bookkeeping must never require a canvas,
// nor mutate layers or History.
const engine = new Engine()
const mockDoc = (id: string) => ({
  id, width: 2, height: 2, layers: [
    { id: `${id}-layer`, _v: 1, smartFilters: [
      { id: `${id}-smart`, type: 'offset', enabled: true, params: { horizontal: 3 } },
    ] },
  ], history: { states: [], index: -1 }, _epoch: 1,
  previewFilter: null, previewAdjustment: null,
  _flatCache: 'stale-composite', _flatCacheKey: 'cached-key',
}) as unknown as PsDocument
const a = mockDoc('a'), b = mockDoc('b')
engine.docs.push(a, b)
const useDoc = (d: PsDocument) => {
  ;(engine as unknown as { _activeId: string })._activeId = d.id
}
const first = Symbol('first'), second = Symbol('second')
useDoc(a)
engine.setPreviewFilter('a-layer', 'offset', { horizontal: 5 }, first, a)
assert.equal(a.previewFilter?.params.horizontal, 5)
assert.equal((a as unknown as { _flatCache: unknown })._flatCache, null, 'preview invalidates composite')
engine.setPreviewFilter('a-layer', 'offset', { horizontal: 6 }, second, a)
engine.clearPreviewFilter(first, a)
assert.equal(a.previewFilter?.params.horizontal, 6, 'stale dialog cannot erase a newer preview')
useDoc(b)
engine.setPreviewFilter('b-layer', 'offset', { horizontal: 7 }, second, b)
engine.clearPreviewFilter(second, a)
assert.equal(a.previewFilter, null, 'closing a tab-switched dialog clears its original document')
assert.equal(b.previewFilter?.params.horizontal, 7, 'clearing A cannot affect B')

engine.setPreviewFilter('a-layer', 'offset', { horizontal: 8 }, first, a)
assert.equal(a.previewFilter, null, 'inactive dialog cannot start a new preview on a different tab')

const adjustOwner = Symbol('adjustment')
useDoc(a)
engine.setPreviewAdjustment('exposure', { exposure: 2 }, adjustOwner, a)
assert.equal(a.previewAdjustment?.params.exposure, 2)
useDoc(b)
engine.setPreviewAdjustment('exposure', { exposure: 3 }, second, b)
engine.clearPreviewAdjustment(adjustOwner, a)
assert.equal(a.previewAdjustment, null)
assert.equal(b.previewAdjustment?.params.exposure, 3)

const original = (a.layers[0].smartFilters[0].params as { horizontal: number }).horizontal
engine.updateSmartFilter('a-layer', 'a-smart', { horizontal: 17 }, a)
assert.equal(a.layers[0].smartFilters[0].params.horizontal, 17)
assert.equal(b.layers[0].smartFilters[0].params.horizontal, original)
engine.updateSmartFilter('a-layer', 'a-smart', { horizontal: original }, a)
assert.equal(a.layers[0].smartFilters[0].params.horizontal, original, 'rollback targets original tab')
const initialVersion = a.layers[0]._v
useDoc(a)
assert.equal(engine.updateSmartFilter('a-layer', 'a-smart', { horizontal: original }, a), false,
  'opening a Smart Filter with unchanged parameters cannot mutate layer version')
assert.equal(a.layers[0]._v, initialVersion)
a.layers[0].locked = true
engine.updateSmartFilter('a-layer', 'a-smart', { horizontal: 99 }, a)
assert.equal(a.layers[0].smartFilters[0].params.horizontal, original,
  'locked Smart Filter cannot be edited')
const beforeLockedVersion = a.layers[0]._v
engine.toggleSmartFilter('a-layer', 'a-smart')
engine.removeSmartFilter('a-layer', 'a-smart')
assert.equal(a.layers[0].smartFilters.length, 1, 'locked filters cannot be deleted')
assert.equal(a.layers[0].smartFilters[0].enabled, true, 'locked filters cannot be toggled')
assert.equal(a.layers[0]._v, beforeLockedVersion)
assert.equal(engine.mutateLayerPixels('a-layer'), null, 'locked pixel layers cannot be mutated')
a.layers[0].locked = false
engine.removeSmartFilter('a-layer', 'does-not-exist')
assert.equal(a.layers[0]._v, beforeLockedVersion,
  'removing a missing Smart Filter must not create a history step')
a.layers[0].locked = true
engine.updateSmartFilter('a-layer', 'a-smart', { horizontal: 11 }, a, true)
assert.equal(a.layers[0].smartFilters[0].params.horizontal, 11,
  'preview rollback may restore original parameters after a layer was locked')
engine.updateSmartFilter('a-layer', 'a-smart', { horizontal: original }, a, true)
console.log('Preview leases, cross-tab cleanup, no-op edits, layer locks and Smart Filter rollback passed')
