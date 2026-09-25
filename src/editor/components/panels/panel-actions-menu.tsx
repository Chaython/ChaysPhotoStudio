'use client'
import { ArrowUp, Check, Ellipsis, Home, Maximize2, PanelLeft, PanelRight } from 'lucide-react'
import { useEditorStore, type DockSide } from '../../store'
import { PANEL_MAP } from './panel-registry'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export function PanelActionsMenu({
  id,
  floating = false,
  className,
}: {
  id: string
  floating?: boolean
  className?: string
}) {
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const isFloating = useEditorStore(s => !!s.panels.floating[id])
  const def = PANEL_MAP[id]
  if (!def) return null

  const explicitSide: DockSide | undefined = Object.prototype.hasOwnProperty.call(dockSide, id)
    ? dockSide[id]
    : undefined
  const current: DockSide | 'floating' | 'home' = isFloating
    ? 'floating'
    : explicitSide ?? (def.home ? 'home' : 'right')
  const move = (side: DockSide) => useEditorStore.getState().dockPanel(id, side)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'h-5 w-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors',
            className,
          )}
          title={`${def.label} panel options`}
          aria-label={`${def.label} panel options`}
        >
          <Ellipsis size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="z-[80] min-w-48">
        {def.home && (
          <>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => useEditorStore.getState().homePanel(id)}>
              <Home size={13} />
              <span className="flex-1">Return to default position</span>
              {current === 'home' && <Check size={12} className="text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {!floating && current !== 'floating' && (
          <>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => useEditorStore.getState().floatPanel(id, def.defaultFloat)}>
              <Maximize2 size={13} />
              <span className="flex-1">Float panel</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DockItem id={id} label="Dock left" side="left" current={current} onClick={() => move('left')} />
        <DockItem id={id} label="Dock right" side="right" current={current} onClick={() => move('right')} />
        <DockItem id={id} label="Dock top" side="top" current={current} onClick={() => move('top')} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DockItem({
  id,
  label,
  side,
  current,
  onClick,
}: {
  id: string
  label: string
  side: DockSide
  current: DockSide | 'floating' | 'home'
  onClick: () => void
}) {
  const Icon = side === 'left' ? PanelLeft : side === 'right' ? PanelRight : ArrowUp
  return (
    <DropdownMenuItem className="gap-2 text-xs" onClick={onClick} aria-label={`${label}: ${PANEL_MAP[id]?.label ?? id}`}>
      <Icon size={13} />
      <span className="flex-1">{label}</span>
      {current === side && <Check size={12} className="text-primary" />}
    </DropdownMenuItem>
  )
}
