'use client'
import { MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator, Menubar } from '@/components/ui/menubar'
import type { MenuItem } from '../../constants/menus'
import { MENUS, PLUGINS_MENU_INDEX, getPluginsMenuItems } from '../../constants/menus'
import { useEditorStore } from '../../store'
import { Sparkles, Sun, Moon, Contrast, Settings, Keyboard, Puzzle, Info, RotateCcw, LayoutGrid, Check } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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

type AppTheme = 'dark' | 'light' | 'oled'

export function MenuBar({ theme, setTheme }: { theme: AppTheme; setTheme: (theme: AppTheme) => void }) {
  const menus = useEditorStore(s => s.renderTick) // re-render on engine changes for enabled states
  const scTick = useEditorStore(s => s.shortcutOverrides) // TASK 17 — live shortcut labels
  const openDialog = useEditorStore(s => s.openDialog)
  const resetLayout = useEditorStore(s => s.resetPanelLayout)
  void menus // plugin installs/imports also bump renderTick → the dynamic Plugins menu stays fresh
  void scTick

  const cycleTheme = () => setTheme(theme === 'dark' ? 'oled' : theme === 'oled' ? 'light' : 'dark')
  const ThemeIcon = theme === 'light' ? Sun : theme === 'oled' ? Contrast : Moon
  const themeLabel = theme === 'light' ? 'Light' : theme === 'oled' ? 'OLED black' : 'Dark'

  return (
    <Menubar className="h-8 rounded-none border-0 border-b bg-panel text-xs flex-shrink-0 gap-0">
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

      <div className="ml-auto flex h-full items-center gap-0.5 pr-2 pl-2 border-l border-border/60">
        <button
          className="flex items-center gap-1.5 h-6 px-2.5 rounded-md bg-primary/15 border border-primary/40 text-primary text-[11px] font-medium hover:bg-primary/25 active:scale-95 transition-all"
          onClick={() => openDialog('ai-generate')}
          title="AI Generate — create an image from a text prompt"
          aria-label="AI Generate: create an image from a text prompt"
        >
          <Sparkles size={12} />
          <span className="hidden sm:inline">Generate</span>
        </button>

        <button
          className="text-muted-foreground hover:text-foreground p-1.5 rounded hover:bg-accent"
          onClick={cycleTheme}
          title={`Theme: ${themeLabel} — click to cycle`}
          aria-label={`Theme: ${themeLabel}. Click to cycle themes`}
        >
          <ThemeIcon size={14} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground p-1.5 rounded hover:bg-accent"
              title="Settings"
              aria-label="Settings"
            >
              <Settings size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="z-50 min-w-56">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground select-none">Theme</div>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => setTheme('light')}>
              <Sun size={13} /><span className="flex-1">Light</span>{theme === 'light' && <Check size={13} />}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => setTheme('dark')}>
              <Moon size={13} /><span className="flex-1">Dark</span>{theme === 'dark' && <Check size={13} />}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => setTheme('oled')}>
              <Contrast size={13} /><span className="flex-1">OLED black / high contrast</span>{theme === 'oled' && <Check size={13} />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => openDialog('shortcuts')}>
              <Keyboard size={13} /><span className="flex-1">Keyboard shortcuts</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => openDialog('customize-toolbar')}>
              <LayoutGrid size={13} /><span className="flex-1">Customize toolbar</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => openDialog('plugin-manager')}>
              <Puzzle size={13} /><span className="flex-1">Plugin manager</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => resetLayout()}>
              <RotateCcw size={13} /><span className="flex-1">Reset panel layout</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => openDialog('about')}>
              <Info size={13} /><span className="flex-1">About &amp; License</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Menubar>
  )
}
