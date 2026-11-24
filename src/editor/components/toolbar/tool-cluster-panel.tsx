'use client'
// Content of a popped-out tool cluster (Selection, Image, Tools, Brushes,
// Shapes, Retouch). The same component is used by a floating window, a dock
// tab and the inspector, so a group behaves identically wherever it lands.
import { useMemo } from 'react'
import { TOOL_MAP } from '../../constants/tools'
import { TOOL_CLUSTER_MAP, type ToolClusterId } from '../../constants/tool-clusters'
import { useEditorStore } from '../../store'
import { setActiveTool } from '../../tools/registry'
import type { ToolId } from '../../types'
import { ToolIcon } from './tool-icons'
import { cn } from '@/lib/utils'

export function ToolClusterPanel({ cluster: clusterId }: { cluster: ToolClusterId }) {
  const cluster = TOOL_CLUSTER_MAP[clusterId]
  const activeTool = useEditorStore(s => s.activeTool)
  const setTool = useEditorStore(s => s.setTool)
  const overrides = useEditorStore(s => s.shortcutOverrides)
  const tools = useMemo(() => cluster.tools.map(id => TOOL_MAP[id]).filter(Boolean), [cluster])

  const keys = useMemo(() => {
    const out = {} as Record<ToolId, string>
    for (const def of tools) out[def.id] = (overrides?.[`tool:${def.id}`] || def.shortcut || '?').toLowerCase()
    return out
  }, [tools, overrides])

  const selectTool = (id: ToolId) => {
    setTool(id)
    setActiveTool(id)
  }

  return (
    <div className="flex min-h-0 flex-col p-1.5" aria-label={`${cluster.label} tools`} data-tool-cluster-panel={cluster.id}>
      <div
        className="grid content-start gap-1"
        style={{ gridTemplateColumns: `repeat(${cluster.panelColumns}, minmax(0, 1fr))` }}
      >
        {tools.map(tool => (
          <button
            key={tool.id}
            type="button"
            onClick={() => selectTool(tool.id)}
            title={`${tool.label}${keys[tool.id] ? ` (${keys[tool.id].toUpperCase()})` : ''}`}
            aria-label={tool.label}
            aria-pressed={activeTool === tool.id}
            className={cn(
              'flex h-9 min-w-0 items-center justify-center rounded-sm border transition-colors',
              activeTool === tool.id
                ? 'border-primary/60 bg-primary/15 text-primary ring-1 ring-primary/40'
                : 'border-transparent text-foreground/85 hover:border-border hover:bg-accent',
            )}
          >
            <ToolIcon icon={tool.icon} toolId={tool.id} size={17} />
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-1 border-t border-border/50 pt-1 text-[9px] text-muted-foreground">
        <span className="truncate">{cluster.label}</span>
        <span className="truncate text-right">{tools.length} tool{tools.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  )
}
