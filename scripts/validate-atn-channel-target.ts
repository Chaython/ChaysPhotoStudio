// Headless .atn Channel-Target Round-Trip regression test.
// Verifies that when an adjustment/filter step carries a channel editing
// target, exporting to .atn embeds it and re-importing restores it.
// Uses the published .atn binary format (no Photoshop code copied).
import assert from 'node:assert/strict'
import {
  readAtnActions, writeAtnActions,
} from '../src/editor/formats/atn-actions'
import type { ActionStep, PsAction } from '../src/editor/types'

// ---------------------------------------------------------------- helpers

function adjustmentStep(type: string, params: Record<string, any>, target?: string): ActionStep {
  return {
    op: 'applyAdjustment',
    args: { layerId: 'l1', type, params, ...(target ? { target } : {}) },
    label: type,
  }
}

function filterStep(type: string, params: Record<string, any>, target?: string): ActionStep {
  return {
    op: 'applyFilter',
    args: { layerId: 'l1', type, params, ...(target ? { target } : {}) },
    label: type,
  }
}

function findChnT(descriptor: any): string | null {
  for (const item of descriptor.items) {
    if (item.key.text.trim() === 'ChnT' && item.value.type === 'enum') {
      return item.value.value.text.trim()
    }
  }
  return null
}

// ---------------------------------------------------------------- export embeds ChnT

{
  // Curves with target 'rb' → descriptor should carry ChnT
  const step = adjustmentStep('curves', { channel: 'rgb', points: [[0, 0], [255, 255]] }, 'rb')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'curves step mapped')
  const importedAction = imported.actions[0]
  assert.equal(importedAction.steps.length, 1, 'one step imported')
  const importedStep = importedAction.steps[0]
  assert.equal(importedStep.op, 'applyAdjustment', 'step is applyAdjustment')
  assert.equal(importedStep.args.target, 'rb', 'target restored on import')
  console.log('.atn export/import curves target rb passed')
}

// ---------------------------------------------------------------- export without target → no ChnT

{
  // Invert without target → no ChnT in descriptor
  const step = adjustmentStep('invert', {})
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'invert step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.args.target, undefined, 'no target when none set')
  console.log('.atn export/import invert without target passed')
}

// ---------------------------------------------------------------- Gaussian blur with target 'g'

{
  const step = filterStep('gaussian-blur', { radius: 2 }, 'g')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'gaussian-blur step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyFilter', 'step is applyFilter')
  assert.equal(importedStep.args.target, 'g', 'target restored on import')
  console.log('.atn export/import gaussian-blur target g passed')
}

// ---------------------------------------------------------------- composite target → no ChnT (composite is default)

{
  const step = adjustmentStep('invert', {}, 'composite')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'invert step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.args.target, undefined, 'composite target not stored (it is the default)')
  console.log('.atn export/import composite target not stored passed')
}

// ---------------------------------------------------------------- unknown target → export keeps step (no mapping for unknown)

{
  // target 'rg' on invert — should still map since target is just metadata
  const step = adjustmentStep('invert', {}, 'rg')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'invert step with rg target mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.args.target, 'rg', 'rg target restored on import')
  console.log('.atn export/import invert target rg passed')
}

console.log('.atn channel-target round-trip: all checks passed')
