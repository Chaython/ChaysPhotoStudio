'use client'
// Workspace-aware toolbox: the shared single-column rail in every workspace,
// the two-column category palette in Fireworks Expanded Mode. The panel
// registry and the native shell both render this, so a floated/docked toolbox
// keeps the same presentation as the in-place one.
import { useEditorStore } from '../../store'
import { Toolbar } from './toolbar'
import { FireworksToolbox } from './fireworks-toolbox'

export function WorkspaceToolbox({ embedded = false }: { embedded?: boolean }) {
  const workspacePreset = useEditorStore(s => s.workspacePreset)
  return workspacePreset === 'fireworks'
    ? <FireworksToolbox />
    : <Toolbar embedded={embedded} />
}
