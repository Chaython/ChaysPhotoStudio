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

// ---------------------------------------------------------------- exposure with target

{
  const step = adjustmentStep('exposure', { exposure: 1.5, gamma: 1.0, offset: 0.0 }, 'rb')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'exposure step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyAdjustment', 'step is applyAdjustment')
  assert.equal(importedStep.args.target, 'rb', 'target restored on import')
  assert.equal(importedStep.args.params.exposure, 1.5, 'exposure value restored')
  console.log('.atn export/import exposure target rb passed')
}

// ---------------------------------------------------------------- color-balance with target

{
  const step = adjustmentStep('color-balance', { tones: 'Midtones', shadows: 10, midtones: -5, highlights: 15 }, 'r')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'color-balance step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyAdjustment', 'step is applyAdjustment')
  assert.equal(importedStep.args.target, 'r', 'target restored on import')
  assert.equal(importedStep.args.params.tones, 'Midtones', 'tones restored on import')
  assert.equal(importedStep.args.params.shadows, 10, 'shadows restored on import')
  assert.equal(importedStep.args.params.midtones, -5, 'midtones restored on import')
  assert.equal(importedStep.args.params.highlights, 15, 'highlights restored on import')
  console.log('.atn export/import color-balance target r passed')
}

// ---------------------------------------------------------------- levels with target

{
  const step = adjustmentStep('levels', { inBlack: 10, gamma: 1.2, inWhite: 240, outBlack: 5, outWhite: 250 }, 'gb')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'levels step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyAdjustment', 'step is applyAdjustment')
  assert.equal(importedStep.args.target, 'gb', 'target restored on import')
  assert.equal(importedStep.args.params.inBlack, 10, 'inBlack restored on import')
  assert.equal(importedStep.args.params.gamma, 1.2, 'gamma restored on import')
  assert.equal(importedStep.args.params.inWhite, 240, 'inWhite restored on import')
  assert.equal(importedStep.args.params.outBlack, 5, 'outBlack restored on import')
  assert.equal(importedStep.args.params.outWhite, 250, 'outWhite restored on import')
  console.log('.atn export/import levels target gb passed')
}

// ---------------------------------------------------------------- photo-filter with target

{
  const step = adjustmentStep('photo-filter', { color: 'Custom', density: 50, luminosity: 30 }, 'r')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'photo-filter step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyAdjustment', 'step is applyAdjustment')
  assert.equal(importedStep.args.target, 'r', 'target restored on import')
  assert.equal(importedStep.args.params.color, 'Custom', 'color restored on import')
  assert.equal(importedStep.args.params.density, 50, 'density restored on import')
  assert.equal(importedStep.args.params.luminosity, 30, 'luminosity restored on import')
  console.log('.atn export/import photo-filter target r passed')
}

// ---------------------------------------------------------------- channel-mixer with target

{
  const step = adjustmentStep('channel-mixer', {
    monochrome: false,
    redRed: 110, redGreen: 10, redBlue: 5,
    greenRed: 5, greenGreen: 100, greenBlue: 15,
    blueRed: 0, blueGreen: 20, blueBlue: 90,
    constant: 0,
  }, 'rb')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'channel-mixer step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyAdjustment', 'step is applyAdjustment')
  assert.equal(importedStep.args.target, 'rb', 'target restored on import')
  assert.equal(importedStep.args.params.monochrome, false, 'monochrome restored')
  assert.equal(importedStep.args.params.redRed, 110, 'redRed restored')
  assert.equal(importedStep.args.params.greenGreen, 100, 'greenGreen restored')
  assert.equal(importedStep.args.params.blueBlue, 90, 'blueBlue restored')
  console.log('.atn export/import channel-mixer target rb passed')
}

// ---------------------------------------------------------------- selective-color with target

{
  const step = adjustmentStep('selective-color', {
    plate: 'reds', cyan: 20, magenta: -10, yellow: 5, black: 0, absolute: false
  }, 'g')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'selective-color step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyAdjustment', 'step is applyAdjustment')
  assert.equal(importedStep.args.target, 'g', 'target restored on import')
  assert.equal(importedStep.args.params.plate, 'reds', 'plate restored')
  assert.equal(importedStep.args.params.cyan, 20, 'cyan restored')
  assert.equal(importedStep.args.params.magenta, -10, 'magenta restored')
  console.log('.atn export/import selective-color target g passed')
}

// ---------------------------------------------------------------- gradient-map with target

{
  const step = adjustmentStep('gradient-map', {
    stops: [
      { pos: 0, color: '#0000ff' },
      { pos: 0.5, color: '#00ffff' },
      { pos: 1, color: '#ffff00' },
    ],
    dither: false,
    reverse: true,
  }, 'b')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'gradient-map step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyAdjustment', 'step is applyAdjustment')
  assert.equal(importedStep.args.target, 'b', 'target restored on import')
  assert.equal(importedStep.args.params.stops.length, 3, 'stops count restored')
  assert.equal(importedStep.args.params.stops[0].pos, 0, 'stop 0 pos restored')
  assert.equal(importedStep.args.params.stops[0].color, '#0000ff', 'stop 0 color restored')
  assert.equal(importedStep.args.params.stops[1].pos, 0.5, 'stop 1 pos restored')
  assert.equal(importedStep.args.params.stops[1].color, '#00ffff', 'stop 1 color restored')
  assert.equal(importedStep.args.params.stops[2].pos, 1, 'stop 2 pos restored')
  assert.equal(importedStep.args.params.stops[2].color, '#ffff00', 'stop 2 color restored')
  assert.equal(importedStep.args.params.dither, false, 'dither restored')
  assert.equal(importedStep.args.params.reverse, true, 'reverse restored')
  console.log('.atn export/import gradient-map target b passed')
}

// ---------------------------------------------------------------- black-white with target

{
  const step = adjustmentStep('black-white', {
    reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80
  }, 'b')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'black-white step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyAdjustment', 'step is applyAdjustment')
  assert.equal(importedStep.args.target, 'b', 'target restored on import')
  assert.equal(importedStep.args.params.reds, 40, 'reds restored')
  assert.equal(importedStep.args.params.yellows, 60, 'yellows restored')
  assert.equal(importedStep.args.params.greens, 40, 'greens restored')
  assert.equal(importedStep.args.params.cyans, 60, 'cyans restored')
  assert.equal(importedStep.args.params.blues, 20, 'blues restored')
  assert.equal(importedStep.args.params.magentas, 80, 'magentas restored')
  console.log('.atn export/import black-white target b passed')
}

// ---------------------------------------------------------------- lens-flare with target

{
  const step = filterStep('lens-flare', { brightness: 150 }, 'rb')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'lens-flare step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyFilter', 'step is applyFilter')
  assert.equal(importedStep.args.target, 'rb', 'target restored on import')
  assert.equal(importedStep.args.params.brightness, 150, 'brightness restored')
  console.log('.atn export/import lens-flare target rb passed')
}

// ---------------------------------------------------------------- clouds with target

{
  const step = filterStep('clouds', {}, 'r')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'clouds step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyFilter', 'step is applyFilter')
  assert.equal(importedStep.args.target, 'r', 'target restored on import')
  console.log('.atn export/import clouds target r passed')
}

// ---------------------------------------------------------------- color-lookup with target

{
  const step = adjustmentStep('color-lookup', { lutId: 'someLut', opacity: 80 }, 'rg')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'color-lookup step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyAdjustment', 'step is applyAdjustment')
  assert.equal(importedStep.args.target, 'rg', 'target restored on import')
  assert.equal(importedStep.args.params.lutId, 'someLut', 'lutId restored')
  assert.equal(importedStep.args.params.opacity, 80, 'opacity restored')
  console.log('.atn export/import color-lookup target rg passed')
}

// ---------------------------------------------------------------- hdr-toning with target

{
  const step = adjustmentStep('hdr-toning', {
    method: 0, exposure: 1.5, gamma: 1.0, detail: 20, saturation: 30, vibrance: 40
  }, 'r')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'hdr-toning step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyAdjustment', 'step is applyAdjustment')
  assert.equal(importedStep.args.target, 'r', 'target restored on import')
  assert.equal(importedStep.args.params.method, 0, 'method restored')
  assert.equal(importedStep.args.params.exposure, 1.5, 'exposure restored')
  assert.equal(importedStep.args.params.gamma, 1.0, 'gamma restored')
  assert.equal(importedStep.args.params.detail, 20, 'detail restored')
  assert.equal(importedStep.args.params.saturation, 30, 'saturation restored')
  assert.equal(importedStep.args.params.vibrance, 40, 'vibrance restored')
  console.log('.atn export/import hdr-toning target r passed')
}

// ---------------------------------------------------------------- bloom with target

{
  const step = filterStep('bloom', { radius: 50, intensity: 60 }, 'g')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'bloom step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyFilter', 'step is applyFilter')
  assert.equal(importedStep.args.target, 'g', 'target restored on import')
  assert.equal(importedStep.args.params.radius, 50, 'radius restored')
  assert.equal(importedStep.args.params.intensity, 60, 'intensity restored')
  console.log('.atn export/import bloom target g passed')
}

// ---------------------------------------------------------------- camera-raw with target

{
  const step = adjustmentStep('camera-raw', {
    exposure: 0.5, contrast: 10, shadows: 20, highlights: -10,
    whites: 5, blacks: -5, clarity: 15, dehaze: 5, saturation: 10, vibrance: 5
  }, 'rb')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'camera-raw step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyAdjustment', 'step is applyAdjustment')
  assert.equal(importedStep.args.target, 'rb', 'target restored on import')
  assert.equal(importedStep.args.params.exposure, 0.5, 'exposure restored')
  assert.equal(importedStep.args.params.contrast, 10, 'contrast restored')
  assert.equal(importedStep.args.params.shadows, 20, 'shadows restored')
  assert.equal(importedStep.args.params.highlights, -10, 'highlights restored')
  assert.equal(importedStep.args.params.whites, 5, 'whites restored')
  assert.equal(importedStep.args.params.blacks, -5, 'blacks restored')
  assert.equal(importedStep.args.params.clarity, 15, 'clarity restored')
  assert.equal(importedStep.args.params.dehaze, 5, 'dehaze restored')
  assert.equal(importedStep.args.params.saturation, 10, 'saturation restored')
  assert.equal(importedStep.args.params.vibrance, 5, 'vibrance restored')
  console.log('.atn export/import camera-raw target rb passed')
}

// ---------------------------------------------------------------- vignette with target

{
  const step = filterStep('vignette', { amount: 0.4, radius: 60 }, 'g')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'vignette step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyFilter', 'step is applyFilter')
  assert.equal(importedStep.args.target, 'g', 'target restored on import')
  assert.equal(importedStep.args.params.amount, 0.4, 'amount restored')
  assert.equal(importedStep.args.params.radius, 60, 'radius restored')
  console.log('.atn export/import vignette target g passed')
}

// ---------------------------------------------------------------- newsprint with target

{
  const step = filterStep('newsprint', { amount: 0.8 }, 'b')
  const actions: PsAction[] = [{ id: 'a1', name: 'Test', steps: [step], created: Date.now() }]
  const bytes = writeAtnActions(actions, 'Test')
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1, 'newsprint step mapped')
  const importedStep = imported.actions[0].steps[0]
  assert.equal(importedStep.op, 'applyFilter', 'step is applyFilter')
  assert.equal(importedStep.args.target, 'b', 'target restored on import')
  assert.equal(importedStep.args.params.amount, 0.8, 'amount restored')
  console.log('.atn export/import newsprint target b passed')
}

console.log('.atn channel-target round-trip: all checks passed')
