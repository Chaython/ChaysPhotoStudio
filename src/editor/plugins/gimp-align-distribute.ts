'use client'
// GIMP Align and Distribute Tools
// Professional alignment and distribution tools for layers and objects

import { createCanvas, ctx2d } from '../utils/canvas'

export interface AlignDistributeOptions {
  /** Target objects to align/distribute */
  targets: AlignTarget[]
  /** Reference object (if any) */
  reference?: AlignTarget
  /** Alignment axis */
  axis: 'horizontal' | 'vertical' | 'both'
  /** Alignment type */
  alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  /** Distribution type */
  distribution: 'none' | 'horizontal' | 'vertical' | 'both'
  /** Distribution spacing */
  spacing: number
  /** Use selection bounds as reference */
  useSelectionBounds: boolean
  /** Relative to */
  relativeTo: 'selection' | 'canvas' | 'first' | 'last' | 'page'
}

export interface AlignTarget {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  selected: boolean
}

export interface AlignDistributeResult {
  targets: AlignTarget[]
  bounds: {
    left: number
    top: number
    right: number
    bottom: number
    centerX: number
    centerY: number
  }
  transforms: Map<string, { x: number; y: number }>
}

/** Main align and distribute function */
export function alignAndDistribute(
  targets: AlignTarget[],
  options: AlignDistributeOptions
): AlignDistributeResult {
  const {
    reference,
    axis = 'both',
    alignment = 'center',
    distribution = 'none',
    spacing = 0,
    useSelectionBounds = true,
    relativeTo = 'selection',
  } = options

  const selectedTargets = targets.filter(t => t.selected)
  if (selectedTargets.length === 0) {
    return { targets, bounds: getBounds(targets), transforms: new Map() }
  }

  // Determine reference bounds
  let refBounds: { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number }

  if (reference) {
    refBounds = getObjectBounds(reference)
  } else if (relativeTo === 'canvas') {
    // Would need canvas dimensions
    refBounds = { left: 0, top: 0, right: 1000, bottom: 1000, centerX: 500, centerY: 500 }
  } else if (relativeTo === 'first') {
    refBounds = getObjectBounds(selectedTargets[0])
  } else if (relativeTo === 'last') {
    refBounds = getObjectBounds(selectedTargets[selectedTargets.length - 1])
  } else if (relativeTo === 'page') {
    // Would need page dimensions
    refBounds = { left: 0, top: 0, right: 1000, bottom: 1000, centerX: 500, centerY: 500 }
  } else {
    // Selection bounds
    refBounds = getSelectionBounds(selectedTargets)
  }

  const transforms = new Map<string, { x: number; y: number }>()
  const targetsToProcess = distribution !== 'none' ? selectedTargets : selectedTargets

  // Calculate positions for distribution
  let positions: { x: number; y: number }[] = []
  if (distribution !== 'none') {
    positions = calculateDistributionPositions(
      targetsToProcess,
      distribution,
      spacing,
      axis,
      refBounds
    )
  }

  // Apply alignment and distribution
  const updatedTargets = selectedTargets.map((target, index) => {
    const currentBounds = getObjectBounds(target)
    let newX = target.x
    let newY = target.y

    // Alignment
    if (axis === 'horizontal' || axis === 'both') {
      switch (alignment) {
        case 'left':
          newX = refBounds.left
          break
        case 'center':
          newX = refBounds.centerX - currentBounds.width / 2
          break
        case 'right':
          newX = refBounds.right - currentBounds.width
          break
      }
    }

    if (axis === 'vertical' || axis === 'both') {
      switch (alignment) {
        case 'top':
          newY = refBounds.top
          break
        case 'middle':
          newY = refBounds.centerY - currentBounds.height / 2
          break
        case 'bottom':
          newY = refBounds.bottom - currentBounds.height
          break
      }
    }

    // Distribution
    if (distribution !== 'none' && positions[index]) {
      if (distribution === 'horizontal' || distribution === 'both') {
        newX = positions[index].x - currentBounds.width / 2
      }
      if (distribution === 'vertical' || distribution === 'both') {
        newY = positions[index].y - currentBounds.height / 2
      }
    }

    const transform = { x: newX - target.x, y: newY - target.y }
    transforms.set(target.id, transform)

    return { ...target, x: newX, y: newY }
  })

  // Update all targets
  const updatedTargets = targets.map(t => {
    const updated = targetsToProcess.find(u => u.id === t.id)
    return updated || t
  })

  return {
    targets: updatedTargets,
    bounds: getBounds(updatedTargets),
    transforms,
  }
}

/** Calculate distribution positions */
function calculateDistributionPositions(
  targets: AlignTarget[],
  distribution: string,
  spacing: number,
  axis: string,
  refBounds: { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number }
): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = []
  const count = targets.length

  if (count <= 1) return targets.map(t => ({ x: t.x, y: t.y }))

  const sortedTargets = [...targets].sort((a, b) => {
    if (axis === 'horizontal' || axis === 'both') {
      return a.x - b.x
    }
    return a.y - b.y
  })

  // Calculate total space needed
  let totalSize = 0
  const bounds = sortedTargets.map(t => getObjectBounds(t))
  const totalWidth = bounds.reduce((sum, b) => sum + b.width, 0)
  const totalHeight = bounds.reduce((sum, b) => sum + b.height, 0)

  let startPos: number
  let step: number

  if (distribution === 'horizontal' || distribution === 'both') {
    const availableWidth = 1000 // Would use actual canvas width
    const totalSpacing = spacing * (count - 1)
    const totalContentWidth = bounds.reduce((sum, b) => sum + b.width, 0)
    const availableSpace = 1000 - totalContentWidth - totalSpacing

    if (distribution === 'horizontal') {
      // Distribute evenly across available space
      step = (1000 - totalContentWidth) / (count - 1)
      startPos = 0
    } else {
      step = (1000 - totalContentWidth) / (count - 1)
      startPos = 0
    }
  }

  // Simplified: distribute evenly between first and last
  const first = sortedTargets[0]
  const last = sortedTargets[sortedTargets.length - 1]
  const firstBounds = getObjectBounds(first)
  const lastBounds = getObjectBounds(last)

  const startX = firstBounds.left
  const endX = lastBounds.right
  const startY = firstBounds.top
  const endY = lastBounds.bottom

  return sortedTargets.map((target, index) => {
    const bounds = getObjectBounds(target)
    let x = target.x
    let y = target.y

    if (distribution === 'horizontal' || distribution === 'both') {
      const progress = count > 1 ? index / (count - 1) : 0
      x = startX + (endX - startX - bounds[index].width) * progress
    }

    if (distribution === 'vertical' || distribution === 'both') {
      const progress = count > 1 ? index / (count - 1) : 0
      y = startY + (endY - startY - bounds[index].height) * progress
    }

    return { x, y }
  })
}

/** Get object bounds */
function getObjectBounds(obj: AlignTarget): { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number; width: number; height: number } {
  return {
    left: obj.x,
    top: obj.y,
    right: obj.x + obj.width,
    bottom: obj.y + obj.height,
    centerX: obj.x + obj.width / 2,
    centerY: obj.y + obj.height / 2,
    width: obj.width,
    height: obj.height,
  }
}

/** Get selection bounds */
function getSelectionBounds(targets: AlignTarget[]): { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number } {
  if (targets.length === 0) return { left: 0, top: 0, right: 0, bottom: 0, centerX: 0, centerY: 0 }

  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity

  for (const target of targets) {
    const bounds = getObjectBounds(target)
    left = Math.min(left, bounds.left)
    top = Math.min(top, bounds.top)
    right = Math.max(right, bounds.right)
    bottom = Math.max(bottom, bounds.bottom)
  }

  return {
    left,
    top,
    right,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }
}

/** Get bounds of all targets */
function getBounds(targets: AlignTarget[]): { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number } {
  return getSelectionBounds(targets)
}

/** Align/Distribute UI Component */
export function createAlignDistributeUI(
  targets: AlignTarget[],
  onApply: (result: AlignDistributeResult) => void
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'align-distribute-ui'
  container.innerHTML = `
    <div class="align-distribute-panel">
      <h3>Align & Distribute</h3>
      
      <div class="section">
        <h4>Align</h4>
        <div class="align-buttons">
          <button data-align="left" title="Align Left"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="2" width="4" height="12" fill="currentColor"/><rect x="8" y="2" width="6" height="12" fill="currentColor"/></svg></button>
          <button data-align="center-h" title="Align Horizontal Centers"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="3" y="2" width="4" height="12" fill="currentColor"/><rect x="9" y="2" width="4" height="12" fill="currentColor"/><line x1="7" y1="8" x2="9" y2="8" stroke="currentColor" stroke-width="2"/></svg></button>
          <button data-align="right" title="Align Right"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="2" width="4" height="12" fill="currentColor"/><rect x="10" y="2" width="4" height="12" fill="currentColor"/></svg></button>
          <br>
          <button data-align="top" title="Align Top"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="4" fill="currentColor"/><rect x="2" y="10" width="12" height="4" fill="currentColor"/></svg></button>
          <button data-align="center-v" title="Align Vertical Centers"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="4" fill="currentColor"/><rect x="2" y="9" width="12" height="4" fill="currentColor"/><line x1="8" y1="7" x2="8" y2="9" stroke="currentColor" stroke-width="2"/></svg></button>
          <button data-align="bottom" title="Align Bottom"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="4" fill="currentColor"/><rect x="2" y="10" width="12" height="4" fill="currentColor"/></svg></button>
        </div>
      </div>

      <div class="section">
        <h4>Distribute</h4>
        <div class="distribute-buttons">
          <button data-distribute="horizontal" title="Distribute Horizontally"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="6" width="4" height="4" fill="currentColor"/><rect x="6" y="6" width="4" height="4" fill="currentColor"/><rect x="11" y="6" width="4" height="4" fill="currentColor"/></svg></button>
          <button data-distribute="vertical" title="Distribute Vertically"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="6" y="1" width="4" height="4" fill="currentColor"/><rect x="6" y="6" width="4" height="4" fill="currentColor"/><rect x="6" y="11" width="4" height="4" fill="currentColor"/></svg></button>
          <button data-distribute="both" title="Distribute Both"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="4" height="4" fill="currentColor"/><rect x="6" y="6" width="4" height="4" fill="currentColor"/><rect x="11" y="11" width="4" height="4" fill="currentColor"/></svg></button>
        </div>
        <div class="spacing-control">
          <label>Spacing: <input type="number" id="distribute-spacing" min="0" max="1000" step="1" value="0">px</label>
        </div>
      </div>

      <div class="section">
        <h4>Options</h4>
        <div class="option-row">
          <label>Relative to:
            <select id="relative-to">
              <option value="selection">Selection</option>
              <option value="canvas">Canvas</option>
              <option value="first">First Object</option>
              <option value="last">Last Object</option>
              <option value="page">Page</option>
            </select>
          </label>
        </div>
        <div class="option-row">
          <label>Axis:
            <select id="align-axis">
              <option value="both">Both</option>
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
          </label>
        </div>
        <div class="option-row">
          <label>Use Selection Bounds: <input type="checkbox" id="use-selection-bounds" checked></label>
        </div>
      </div>

      <div class="actions">
        <button id="apply-align-distribute" class="primary">Apply</button>
        <button id="reset-align">Reset</button>
      </div>
    </div>
  `

  // Event listeners
  let selectedAlignment = 'center'
  let selectedDistribution = 'none'
  let selectedAxis = 'both'

  container.querySelectorAll('[data-align]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('[data-align]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      selectedAlignment = btn.dataset.align || 'center'
    })
  })

  container.querySelectorAll('[data-distribute]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('[data-distribute]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      selectedDistribution = btn.dataset.distribute || 'none'
    })
  })

  container.querySelector('#align-axis')?.addEventListener('change', (e) => {
    selectedAxis = (e.target as HTMLSelectElement).value as 'horizontal' | 'vertical' | 'both'
  })

  container.querySelector('#apply-align-distribute')?.addEventListener('click', () => {
    const options: AlignDistributeOptions = {
      axis: selectedAxis,
      alignment: selectedAlignment as any,
      distribution: selectedDistribution as any,
      spacing: parseFloat((document.getElementById('distribute-spacing') as HTMLInputElement).value) || 0,
      useSelectionBounds: (document.getElementById('use-selection-bounds') as HTMLInputElement).checked,
      relativeTo: (document.getElementById('relative-to') as HTMLSelectElement).value as any,
    }

    const result = alignAndDistribute(targets, options)
    onApply(result)
  })

  return container
}

/** Quick align functions */
export function alignLeft(targets: AlignTarget[], reference?: AlignTarget): AlignDistributeResult {
  return alignAndDistribute(targets, { alignment: 'left', axis: 'horizontal', reference })
}

export function alignCenter(targets: AlignTarget[], reference?: AlignTarget): AlignDistributeResult {
  return alignAndDistribute(targets, { alignment: 'center', axis: 'horizontal', reference })
}

export function alignRight(targets: AlignTarget[], reference?: AlignTarget): AlignDistributeResult {
  return alignAndDistribute(targets, { alignment: 'right', axis: 'horizontal', reference })
}

export function alignTop(targets: AlignTarget[], reference?: AlignTarget): AlignDistributeResult {
  return alignAndDistribute(targets, { alignment: 'top', axis: 'vertical', reference })
}

export function alignMiddle(targets: AlignTarget[], reference?: AlignTarget): AlignDistributeResult {
  return alignAndDistribute(targets, { alignment: 'middle', axis: 'vertical', reference })
}

export function alignBottom(targets: AlignTarget[], reference?: AlignTarget): AlignDistributeResult {
  return alignAndDistribute(targets, { alignment: 'bottom', axis: 'vertical', reference })
}

export function distributeHorizontal(targets: AlignTarget[], spacing = 0): AlignDistributeResult {
  return alignAndDistribute(targets, { distribution: 'horizontal', spacing, axis: 'horizontal' })
}

export function distributeVertical(targets: AlignTarget[], spacing = 0): AlignDistributeResult {
  return alignAndDistribute(targets, { distribution: 'vertical', spacing, axis: 'vertical' })
}

export function distributeBoth(targets: AlignTarget[], spacing = 0): AlignDistributeResult {
  return alignAndDistribute(targets, { distribution: 'both', spacing })
}