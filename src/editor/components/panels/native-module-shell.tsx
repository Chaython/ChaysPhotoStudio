'use client'
import { useRef } from 'react'
import { GripHorizontal, GripVertical } from 'lucide-react'
import { useEditorStore } from '../../store'
import { PanelContextMenu } from './panel-actions-menu'
import { beginWindowDrag } from './floating-panels'
import { PANEL_MAP } from './panel-registry'
import { cn } from '@/lib/utils'

const PULL_THRESHOLD = 12

export function NativeModuleShell({
  id,
  axis,
  className,
  children,
}: {
  id: string
  axis: 'vertical' | 'horizontal'
  className?: string
  children: React.ReactNode
}) {
  const floating = useEditorStore(s => !!s.panels.floating[id])
  const dockSide = useEditorStore(s => s.panels.dockSide[id])
  const pull = useRef<{ x: number; y: number; handed: boolean } | null>(null)
  const def = PANEL_MAP[id]

  // Explicit dock/floating placement replaces the native shell location.
  if (!def || floating || dockSide) return null

  const onDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    pull.current = { x: e.clientX, y: e.clientY, handed: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = pull.current
    if (!d || d.handed) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= PULL_THRESHOLD) {
      d.handed = true
      beginWindowDrag(id, e)
    }
  }
  const onUp = () => { pull.current = null }

  const vertical = axis === 'vertical'

  return (
    <div
      data-native-module={id}
      className={cn(
        'bg-panel flex-shrink-0 min-w-0 min-h-0',
        vertical ? 'flex flex-col h-full border-r' : 'flex w-full border-b',
        className,
      )}
    >
      <PanelContextMenu id={id}>
        <div
          className={cn(
            'flex items-center justify-center flex-shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10',
            'cursor-grab active:cursor-grabbing select-none',
            vertical ? 'h-6 border-b' : 'w-7 border-r',
          )}
          title={`${def.label} — drag/double-click to float · right-click for panel options`}
          onDoubleClick={() => useEditorStore.getState().floatPanel(id, def.defaultFloat)}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {vertical ? <GripHorizontal size={13} /> : <GripVertical size={13} />}
        </div>
      </PanelContextMenu>
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
        {children}
      </div>

    </div>
  )
}
