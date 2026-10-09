'use client'
import { useState } from 'react'
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

/** Defer mutations that reparent the context menu trigger until Radix has
 * finished selection and closing. Otherwise the original menu can survive
 * and apply a stale "Dock bottom" item on the next right-click.
 */
function afterContextMenuClose(close: () => void, action: () => void) {
  close()
  // Close in a separate turn before the menu's trigger changes DOM parent.
  window.setTimeout(action, 0)
}

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
  const [open, setOpen] = useState(false)
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

  const move = (side: DockSide) => afterContextMenuClose(() => setOpen(false), () => useEditorStore.getState().dockPanel(id, side))

  return (
    <ContextMenu open={open} onOpenChange={setOpen}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="z-[90] min-w-52">
        {def.home && (
          <>
            <ContextMenuItem className="gap-2 text-xs" onSelect={() => afterContextMenuClose(() => setOpen(false), () => useEditorStore.getState().homePanel(id))}>
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
              onSelect={() => afterContextMenuClose(() => setOpen(false), () => useEditorStore.getState().collapsePanel(id, !floatingRect.collapsed))}
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
              onSelect={() => afterContextMenuClose(() => setOpen(false), () => useEditorStore.getState().floatPanel(id, def.defaultFloat))}
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
        {(['bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map(side => (
          <DockItem key={side} id={id} label={`Dock ${side.replaceAll('-', ' ')}`} side={side} current={current} onSelect={() => move(side)} />
        ))}
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
