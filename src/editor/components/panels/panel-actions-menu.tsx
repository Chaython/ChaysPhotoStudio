'use client'
import { ArrowUp, Check, ChevronDown, ChevronUp, Home, Maximize2, PanelLeft, PanelRight } from 'lucide-react'
import { useEditorStore, type DockSide } from '../../store'
import { PANEL_MAP } from './panel-registry'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

/**
 * Zero-footprint panel controls. Right-click panel chrome (tab/title/drag
 * handle) to arrange it; no visible ellipsis or action button is required.
 */
export function PanelContextMenu({
  id,
  children,
}: {
  id: string
  children: React.ReactElement
}) {
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const floatingRect = useEditorStore(s => s.panels.floating[id])
  const def = PANEL_MAP[id]
  if (!def) return children

  const explicitSide: DockSide | undefined = Object.prototype.hasOwnProperty.call(dockSide, id)
    ? dockSide[id]
    : undefined
  const current: DockSide | 'floating' | 'home' = floatingRect
    ? 'floating'
    : explicitSide ?? (def.home ? 'home' : 'right')

  const move = (side: DockSide) => useEditorStore.getState().dockPanel(id, side)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="z-[90] min-w-52">
        {def.home && (
          <>
            <ContextMenuItem className="gap-2 text-xs" onSelect={() => useEditorStore.getState().homePanel(id)}>
              <Home size={13} />
              <span className="flex-1">Return to default position</span>
              {current === 'home' && <Check size={12} className="text-primary" />}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}

        {floatingRect ? (
          <>
            <ContextMenuItem
              className="gap-2 text-xs"
              onSelect={() => useEditorStore.getState().collapsePanel(id, !floatingRect.collapsed)}
            >
              {floatingRect.collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              <span className="flex-1">{floatingRect.collapsed ? 'Expand panel' : 'Collapse panel'}</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : (
          <>
            <ContextMenuItem
              className="gap-2 text-xs"
              onSelect={() => useEditorStore.getState().floatPanel(id, def.defaultFloat)}
            >
              <Maximize2 size={13} />
              <span className="flex-1">Float panel</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}

        <DockItem id={id} label="Dock left" side="left" current={current} onSelect={() => move('left')} />
        <DockItem id={id} label="Dock right" side="right" current={current} onSelect={() => move('right')} />
        <DockItem id={id} label="Dock top" side="top" current={current} onSelect={() => move('top')} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function DockItem({
  id,
  label,
  side,
  current,
  onSelect,
}: {
  id: string
  label: string
  side: DockSide
  current: DockSide | 'floating' | 'home'
  onSelect: () => void
}) {
  const Icon = side === 'left' ? PanelLeft : side === 'right' ? PanelRight : ArrowUp
  return (
    <ContextMenuItem
      className="gap-2 text-xs"
      onSelect={onSelect}
      aria-label={`${label}: ${PANEL_MAP[id]?.label ?? id}`}
    >
      <Icon size={13} />
      <span className="flex-1">{label}</span>
      {current === side && <Check size={12} className="text-primary" />}
    </ContextMenuItem>
  )
}
