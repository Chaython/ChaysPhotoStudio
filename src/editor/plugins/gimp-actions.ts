'use client'
// GIMP Actions / Scripting System
// Action recording, playback, batch execution, conditional logic

export interface ActionStep {
  id: string
  command: string
  params: Record<string, any>
  enabled: boolean
  condition?: ActionCondition
  description: string
}

export interface ActionCondition {
  type: 'layer-exists' | 'layer-type' | 'selection-exists' | 'document-size' | 'layer-name' | 'custom'
  operator: 'equals' | 'not-equals' | 'contains' | 'greater-than' | 'less-than' | 'matches'
  value: any
  layerId?: string
}

export interface Action {
  id: string
  name: string
  description: string
  category: string
  steps: ActionStep[]
  version: number
  created: number
  modified: number
  author?: string
  shortcuts?: string[]
}

export interface ActionSet {
  id: string
  name: string
  actions: Action[]
  expanded: boolean
}

export interface PlaybackOptions {
  speed: 'fast' | 'normal' | 'slow' | 'step'
  pauseOnError: boolean
  showDialogs: boolean
  saveBeforeRun: boolean
  createSnapshot: boolean
}

export interface ActionRecorder {
  isRecording: boolean
  currentAction: Action | null
  recordedSteps: ActionStep[]
}

export class ActionManager {
  private sets: Map<string, ActionSet> = new Map()
  private recorder: ActionRecorder = { isRecording: false, currentAction: null, recordedSteps: [] }
  private listeners: Set<() => void> = new Set()
  private commandHistory: Array<{ command: string; params: Record<string, any>; timestamp: number }> = []

  constructor() {
    this.loadBuiltInActions()
  }

  private loadBuiltInActions(): void {
    // Default action set
    const defaultSet: ActionSet = {
      id: 'default',
      name: 'Default Actions',
      expanded: true,
      actions: [
        {
          id: 'action-resize-web',
          name: 'Resize for Web',
          description: 'Resize image to 1920px max dimension for web',
          category: 'Image',
          steps: [
            { id: 's1', command: 'resize', params: { width: 1920, height: 1080, maintainAspect: true }, enabled: true, description: 'Resize to 1920x1080 max' },
            { id: 's2', command: 'export', params: { format: 'webp', quality: 85 }, enabled: true, description: 'Export as WebP' },
          ],
          version: 1,
          created: Date.now(),
          modified: Date.now(),
        },
        {
          id: 'action-vintage',
          name: 'Vintage Photo Effect',
          description: 'Apply vintage photo effect with sepia, vignette, and grain',
          category: 'Effects',
          steps: [
            { id: 's1', command: 'adjustment', params: { type: 'colorize', hue: 30, saturation: 40 }, enabled: true },
            { id: 's2', command: 'filter', params: { type: 'vignette', radius: 0.6, amount: -0.4 }, enabled: true },
            { id: 's3', command: 'filter', params: { type: 'noise', amount: 0.08, monochrome: true }, enabled: true },
            { id: 's4', command: 'adjustment', params: { type: 'levels', inputLow: 15, inputHigh: 240 }, enabled: true },
          ],
          version: 1,
          created: Date.now(),
          modified: Date.now(),
        },
        {
          id: 'action-batch-resize',
          name: 'Batch Resize to 1080p',
          description: 'Resize all open documents to 1920x1080',
          category: 'Batch',
          steps: [
            { id: 's1', command: 'batch-resize', params: { width: 1920, height: 1080, maintainAspect: true }, enabled: true },
          ],
          version: 1,
          created: Date.now(),
          modified: Date.now(),
        },
      ],
    }
    this.sets.set('default', defaultSet)

    // Photography set
    const photoSet: ActionSet = {
      id: 'photography',
      name: 'Photography',
      expanded: false,
      actions: [
        {
          id: 'action-raw-basic',
          name: 'Raw Basic Adjustments',
          description: 'Basic RAW development adjustments',
          category: 'RAW',
          steps: [
            { id: 's1', command: 'camera-raw', params: { exposure: 0.2, contrast: 10, highlights: -20, shadows: 20, whites: 10, blacks: -10 }, enabled: true },
            { id: 's2', command: 'adjustment', params: { type: 'vibrance', vibrance: 15, saturation: 5 }, enabled: true },
            { id: 's3', command: 'filter', params: { type: 'unsharp-mask', amount: 50, radius: 1, threshold: 2 }, enabled: true },
          ],
          version: 1,
          created: Date.now(),
          modified: Date.now(),
        },
        {
          id: 'action-portrait-retouch',
          name: 'Portrait Retouch',
          description: 'Basic portrait retouching workflow',
          category: 'Retouch',
          steps: [
            { id: 's1', command: 'filter', params: { type: 'spot-healing', size: 20 }, enabled: true },
            { id: 's2', command: 'filter', params: { type: 'frequency-separation', radius: 8 }, enabled: true },
            { id: 's3', command: 'adjustment', params: { type: 'hue-saturation', saturation: -10 }, enabled: true },
            { id: 's4', command: 'filter', params: { type: 'dodge-burn', exposure: 10 }, enabled: true },
          ],
          version: 1,
          created: Date.now(),
          modified: Date.now(),
        },
      ],
    }
    this.sets.set('photography', photoSet)

    // Web/Graphics set
    const webSet: ActionSet = {
      id: 'web-graphics',
      name: 'Web & Graphics',
      expanded: false,
      actions: [
        {
          id: 'action-export-web',
          name: 'Export for Web',
          description: 'Optimize and export for web',
          category: 'Export',
          steps: [
            { id: 's1', command: 'resize', params: { width: 1200, maintainAspect: true }, enabled: true },
            { id: 's2', command: 'filter', params: { type: 'unsharp-mask', amount: 50, radius: 0.5 }, enabled: true },
            { id: 's3', command: 'export', params: { format: 'webp', quality: 80, stripMetadata: true }, enabled: true },
          ],
          version: 1,
          created: Date.now(),
          modified: Date.now(),
        },
        {
          id: 'action-social-media',
          name: 'Social Media Export',
          description: 'Export for Instagram/Facebook/Twitter',
          category: 'Export',
          steps: [
            { id: 's1', command: 'crop', params: { aspectRatio: '1:1' }, enabled: true },
            { id: 's2', command: 'resize', params: { width: 1080, height: 1080 }, enabled: true },
            { id: 's3', command: 'watermark', params: { text: '@username', position: 'bottom-right', opacity: 30 }, enabled: true },
            { id: 's4', command: 'export', params: { format: 'jpg', quality: 90 }, enabled: true },
          ],
          version: 1,
          created: Date.now(),
          modified: Date.now(),
        },
      ],
    }
    this.sets.set('web-graphics', webSet)
  }

  // Action Set Management
  getSets(): ActionSet[] {
    return Array.from(this.sets.values())
  }

  getSet(id: string): ActionSet | undefined {
    return this.sets.get(id)
  }

  createSet(name: string): ActionSet {
    const set: ActionSet = {
      id: 'set-' + Date.now(),
      name,
      actions: [],
      expanded: true,
    }
    this.sets.set(set.id, set)
    this.notify()
    return set
  }

  deleteSet(id: string): boolean {
    if (id === 'default') return false // Can't delete default
    const result = this.sets.delete(id)
    if (result) this.notify()
    return result
  }

  // Action Management
  getAction(setId: string, actionId: string): Action | undefined {
    const set = this.sets.get(setId)
    return set?.actions.find(a => a.id === actionId)
  }

  addAction(setId: string, action: Omit<Action, 'id' | 'created' | 'modified'>): Action {
    const set = this.sets.get(setId)
    if (!set) throw new Error('Set not found')

    const action: Action = {
      ...action,
      id: 'action-' + Date.now(),
      created: Date.now(),
      modified: Date.now(),
    }
    set.actions.push(action)
    this.notify()
    return action
  }

  updateAction(setId: string, actionId: string, updates: Partial<Action>): boolean {
    const set = this.sets.get(setId)
    if (!set) return false
    const idx = set.actions.findIndex(a => a.id === actionId)
    if (idx < 0) return false
    set.actions[idx] = { ...set.actions[idx], ...updates, modified: Date.now() }
    this.notify()
    return true
  }

  deleteAction(setId: string, actionId: string): boolean {
    const set = this.sets.get(setId)
    if (!set) return false
    const idx = set.actions.findIndex(a => a.id === actionId)
    if (idx < 0) return false
    set.actions.splice(idx, 1)
    this.notify()
    return true
  }

  duplicateAction(setId: string, actionId: string): Action | null {
    const set = this.sets.get(setId)
    if (!set) return null
    const action = set.actions.find(a => a.id === actionId)
    if (!action) return null

    const newAction: Action = {
      ...action,
      id: 'action-' + Date.now(),
      name: action.name + ' copy',
      created: Date.now(),
      modified: Date.now(),
    }
    set.actions.push(newAction)
    this.notify()
    return newAction
  }

  // Step Management
  addStep(setId: string, actionId: string, step: Omit<ActionStep, 'id'>): ActionStep {
    const action = this.getAction(setId, actionId)
    if (!action) throw new Error('Action not found')

    const step: ActionStep = {
      ...step,
      id: 'step-' + Date.now(),
    }
    action.steps.push(step)
    action.modified = Date.now()
    this.notify()
    return step
  }

  updateStep(setId: string, actionId: string, stepId: string, updates: Partial<ActionStep>): boolean {
    const action = this.getAction(setId, actionId)
    if (!action) return false
    const idx = action.steps.findIndex(s => s.id === stepId)
    if (idx < 0) return false
    action.steps[idx] = { ...action.steps[idx], ...updates }
    action.modified = Date.now()
    this.notify()
    return true
  }

  deleteStep(setId: string, actionId: string, stepId: string): boolean {
    const action = this.getAction(setId, actionId)
    if (!action) return false
    action.steps = action.steps.filter(s => s.id !== stepId)
    action.modified = Date.now()
    this.notify()
    return true
  }

  moveStep(setId: string, actionId: string, stepId: string, newIndex: number): boolean {
    const action = this.getAction(setId, actionId)
    if (!action) return false
    const idx = action.steps.findIndex(s => s.id === stepId)
    if (idx < 0) return false
    const [step] = action.steps.splice(idx, 1)
    action.steps.splice(Math.max(0, Math.min(newIndex, action.steps.length)), 0, step)
    action.modified = Date.now()
    this.notify()
    return true
  }

  // Recording
  startRecording(name: string, description = ''): void {
    if (this.recorder.isRecording) return

    this.recorder = {
      isRecording: true,
      currentAction: {
        id: 'action-' + Date.now(),
        name,
        description,
        category: 'Recorded',
        steps: [],
        version: 1,
        created: Date.now(),
        modified: Date.now(),
      },
      recordedSteps: [],
    }
    this.notify()
  }

  stopRecording(): Action | null {
    if (!this.recorder.isRecording) return null

    const action = this.recorder.currentAction
    if (action) {
      action.steps = this.recorder.recordedSteps
      const set = this.sets.get('default')!
      set.actions.push(action)
    }

    this.recorder = { isRecording: false, currentAction: null, recordedSteps: [] }
    this.notify()
    return action
  }

  cancelRecording(): void {
    this.recorder = { isRecording: false, currentAction: null, recordedSteps: [] }
    this.notify()
  }

  isRecording(): boolean {
    return this.recorder.isRecording
  }

  getCurrentRecording(): Action | null {
    return this.recorder.currentAction
  }

  // Command interception for recording
  recordCommand(command: string, params: Record<string, any>): void {
    this.commandHistory.push({ command, params, timestamp: Date.now() })

    if (this.recorder.isRecording && this.recorder.currentAction) {
      const step: ActionStep = {
        id: 'step-' + Date.now(),
        command,
        params,
        enabled: true,
        description: this.generateStepDescription(command, params),
      }
      this.recorder.recordedSteps.push(step)
      this.recorder.currentAction!.steps = this.recorder.recordedSteps
      this.recorder.currentAction!.modified = Date.now()
      this.notify()
    }
  }

  private generateStepDescription(command: string, params: Record<string, any>): string {
    const descriptions: Record<string, (params: any) => string> = {
      resize: p => `Resize to ${p.width}x${p.height}${p.maintainAspect ? ' (maintain aspect)' : ''}`,
      crop: p => `Crop to ${p.width}x${p.height}`,
      rotate: p => `Rotate ${p.angle}°`,
      filter: p => `${p.type} filter`,
      adjustment: p => `${p.type} adjustment`,
      export: p => `Export as ${p.format}`,
      crop: p => `Crop`,
      resize: p => `Resize`,
      'camera-raw': p => 'Camera Raw adjustment',
      watermark: p => `Watermark: ${p.text}`,
      'batch-resize': p => `Batch resize to ${p.width}x${p.height}`,
      'color-space': p => `Convert ${p.sourceSpace} to ${p.destSpace}`,
      watermark: p => `Watermark: ${p.text}`,
      'layer-effects': p => `Layer effect: ${p.preset}`,
    }

    const generator = descriptions[command]
    return generator ? generator(params) : command
  }

  // Playback
  async playAction(
    setId: string,
    actionId: string,
    options: PlaybackOptions = {
      speed: 'normal',
      pauseOnError: true,
      showDialogs: false,
      saveBeforeRun: false,
      createSnapshot: true,
    }
  ): Promise<{ success: boolean; results: Array<{ step: string; success: boolean; error?: string }> }> {
    const action = this.getAction(setId, actionId)
    if (!action) throw new Error('Action not found')

    const results: Array<{ step: string; success: boolean; error?: string }> = []

    for (const step of action.steps) {
      if (!step.enabled) {
        results.push({ step: step.id, success: true, error: 'Skipped (disabled)' })
        continue
      }

      // Check condition
      if (step.condition && !await this.evaluateCondition(step.condition)) {
        results.push({ step: step.id, success: true, error: 'Condition not met' })
        continue
      }

      try {
        // Execute step
        await this.executeStep(step)

        // Handle speed
        if (options.speed === 'slow') await new Promise(r => setTimeout(r, 500))
        else if (options.speed === 'normal') await new Promise(r => setTimeout(r, 100))
        else if (options.speed === 'step') {
          // Would pause for user confirmation
        }

        results.push({ step: step.id, success: true })
      } catch (error) {
        results.push({ step: step.id, success: false, error: String(error) })
        if (options.pauseOnError) break
      }
    }

    return { success: results.every(r => r.success), results }
  }

  private async evaluateCondition(condition: ActionCondition): Promise<boolean> {
    // Would evaluate actual conditions
    return true
  }

  private async executeStep(step: ActionStep): Promise<void> {
    // This would dispatch to actual command handlers
    // For now, just log
    console.log('Executing step:', step.command, step.params)
  }

  // Batch Playback
  async batchPlay(
    actionIds: string[],
    files: File[],
    options: PlaybackOptions & { outputFolder?: string; namingPattern?: string } = {
      speed: 'fast',
      pauseOnError: false,
      showDialogs: false,
      saveBeforeRun: false,
      createSnapshot: false,
    }
  ): Promise<{ results: Array<{ file: string; success: boolean; error?: string }> }> {
    const results = []

    for (const file of files) {
      try {
        // Load file
        // For each action
        for (const actionId of actionIds) {
          const [setId, aid] = actionId.split(':')
          await this.playAction(setId, aid, options)
        }
        results.push({ file: file.name, success: true })
      } catch (error) {
        results.push({ file: file.name, success: false, error: String(error) })
      }
    }

    return { results }
  }

  // Import/Export
  exportActions(setId: string): string {
    const set = this.sets.get(setId)
    if (!set) throw new Error('Set not found')
    return JSON.stringify(set, null, 2)
  }

  importActions(json: string, setName?: string): ActionSet {
    const set = JSON.parse(json)
    if (setName) set.name = setName
    set.id = 'set-' + Date.now()
    this.sets.set(set.id, set)
    this.notify()
    return set
  }

  // Command History
  getHistory(limit = 50): Array<{ command: string; params: Record<string, any>; timestamp: number }> {
    return this.commandHistory.slice(-limit)
  }

  clearHistory(): void {
    this.commandHistory = []
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Conditional Action Builder */
export class ActionBuilder {
  private steps: Omit<ActionStep, 'id'>[] = []

  addStep(command: string, params: Record<string, any>, description?: string): this {
    this.steps.push({ command, params, enabled: true, description: description || command })
    return this
  }

  addCondition(condition: ActionCondition): this {
    if (this.steps.length > 0) {
      this.steps[this.steps.length - 1].condition = condition
    }
    return this
  }

  ifLayerExists(layerId: string): this {
    return this.addCondition({ type: 'layer-exists', operator: 'equals', value: true, layerId })
  }

  ifSelectionExists(): this {
    return this.addCondition({ type: 'selection-exists', operator: 'equals', value: true })
  }

  ifDocumentSize(width: number, height: number, operator: 'greater-than' | 'less-than' = 'greater-than'): this {
    return this.addCondition({ type: 'document-size', operator, value: { width, height } })
  }

  ifLayerType(layerId: string, type: string): this {
    return this.addCondition({ type: 'layer-type', operator: 'equals', value: type, layerId })
  }

  ifLayerNameContains(layerId: string, text: string): this {
    return this.addCondition({ type: 'layer-name', operator: 'contains', value: text, layerId })
  }

  build(name: string, category: string): Omit<Action, 'id' | 'created' | 'modified'> {
    return {
      name,
      description: '',
      category,
      steps: this.steps,
      version: 1,
    }
  }
}

/** Action Keyboard Shortcuts */
export interface ActionShortcut {
  actionId: string
  shortcut: string // e.g., 'ctrl+shift+f'
  when: 'always' | 'editor-focused' | 'dialog-open'
}

export class ActionShortcutManager {
  private shortcuts: Map<string, ActionShortcut> = new Map()
  private listeners: Set<() => void> = new Set()

  register(shortcut: ActionShortcut): void {
    this.shortcuts.set(shortcut.shortcut.toLowerCase(), shortcut)
    this.notify()
  }

  unregister(shortcut: string): boolean {
    const result = this.shortcuts.delete(shortcut.toLowerCase())
    if (result) this.notify()
    return result
  }

  getShortcut(actionId: string): ActionShortcut | undefined {
    for (const shortcut of this.shortcuts.values()) {
      if (shortcut.actionId === actionId) return shortcut
    }
    return undefined
  }

  getAllShortcuts(): ActionShortcut[] {
    return Array.from(this.shortcuts.values())
  }

  handleKeyDown(event: KeyboardEvent): string | null {
    const keys = []
    if (event.ctrlKey || event.metaKey) keys.push('ctrl')
    if (event.shiftKey) keys.push('shift')
    if (event.altKey) keys.push('alt')
    keys.push(event.key.toLowerCase())
    const combo = keys.join('+')

    const shortcut = this.shortcuts.get(combo)
    if (shortcut) {
      event.preventDefault()
      return shortcut.actionId
    }
    return null
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Export action as JavaScript code */
export function exportActionAsJS(action: Action): string {
  let code = `// ${action.name}\n`
  code += `// ${action.description}\n\n`
  code += `async function ${action.name.replace(/\s+/g, '_')}() {\n`

  for (const step of action.steps) {
    if (!step.enabled) {
      code += `  // Skipped: ${step.description}\n`
      continue
    }
    code += `  // ${step.description}\n`
    code += `  await executeCommand('${step.command}', ${JSON.stringify(step.params, null, 2)})\n`
    code += `  // Wait for completion\n`
    code += `  await waitForCompletion()\n\n`
  }

  code += `}\n\n`
  code += `${action.name.replace(/\s+/g, '_')}()\n`

  return code
}