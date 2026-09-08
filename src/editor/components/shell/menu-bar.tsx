'use client'
import { MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator, Menubar } from '@/components/ui/menubar'
import type { MenuItem } from '../../constants/menus'
import { MENUS, PLUGINS_MENU_INDEX, getPluginsMenuItems } from '../../constants/menus'
import { useEditorStore } from '../../store'

const MENU_NAMES = ['File', 'Edit', 'Image', 'Layer', 'Select', 'Filter', 'Plugins', 'View', 'Window', 'Help']

function renderItems(items: MenuItem[], depth = 0): React.ReactNode[] {
  const out: React.ReactNode[] = []
  for (const item of items) {
    if (item.separator) {
      out.push(<MenubarSeparator key={`sep-${depth}-${out.length}`} />)
      continue
    }
    const disabled = item.enabled ? !item.enabled() : false
    if (item.submenu) {
      out.push(
        <MenubarItem key={item.id} disabled={disabled} className="gap-2">
          <span className="flex-1">{item.label}</span>
          <span className="text-muted-foreground text-xs">▶</span>
        </MenubarItem>
      )
      // flatten submenu into nested rendering (radix menubar lacks submenus in shadcn wrapper) — render as second-level list
      out.push(
        <div key={`${item.id}-sub`} className="pl-4 border-l border-border ml-2 my-1">
          {renderItems(item.submenu, depth + 1)}
        </div>
      )
      continue
    }
    // TASK 17: shortcut may be a live function reading the user's overrides
    const scLabel = typeof item.shortcut === 'function' ? item.shortcut() : item.shortcut
    out.push(
      <MenubarItem
        key={item.id}
        disabled={disabled}
        onClick={() => !disabled && item.run?.()}
        className="gap-8"
      >
        <span className="flex-1">{item.label}</span>
        {item.checked?.() && <span className="text-primary text-xs">✓</span>}
        {scLabel && <span className="text-muted-foreground text-xs font-mono">{scLabel}</span>}
      </MenubarItem>
    )
  }
  return out
}

export function MenuBar() {
  const menus = useEditorStore(s => s.renderTick) // re-render on engine changes for enabled states
  const scTick = useEditorStore(s => s.shortcutOverrides) // TASK 17 — live shortcut labels
  void menus // plugin installs/imports also bump renderTick → the dynamic Plugins menu stays fresh
  void scTick
  return (
    <Menubar className="h-8 rounded-none border-0 border-b bg-panel text-xs flex-shrink-0">
      {MENUS.map((items, i) => (
        <MenubarMenu key={i}>
          <MenubarTrigger className="h-8 px-3 text-xs font-medium data-[highlighted]:bg-accent">
            {MENU_NAMES[i]}
          </MenubarTrigger>
          <MenubarContent align="start" className="min-w-56 max-h-[70vh] overflow-y-auto z-50">
            {renderItems(i === PLUGINS_MENU_INDEX ? getPluginsMenuItems() : items)}
          </MenubarContent>
        </MenubarMenu>
      ))}
    </Menubar>
  )
}
