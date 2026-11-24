'use client'
import { PANEL_MAP } from './panel-registry'
import { PanelLayoutContextMenu } from './panel-layout-menu'

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
  const def = PANEL_MAP[id]
  if (!def) return children
  return (
    <PanelLayoutContextMenu
      id={id}
      label={def.label}
      hasHome={!!def.home}
      defaultFloat={def.defaultFloat}
    >
      {children}
    </PanelLayoutContextMenu>
  )
}
