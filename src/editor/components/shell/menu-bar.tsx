'use client'
import { useRef, useState } from 'react'
import {
  MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator, Menubar,
  MenubarSub, MenubarSubTrigger, MenubarSubContent,
} from '@/components/ui/menubar'
import type { MenuItem } from '../../constants/menus'
import { MENUS, PLUGINS_MENU_INDEX, getPluginsMenuItems } from '../../constants/menus'
import { useEditorStore } from '../../store'
import { Sparkles, Sun, Moon, Contrast, Settings, Keyboard, Puzzle, Info, CircleHelp, RotateCcw, LayoutGrid, Check, Smartphone, Download, Upload, Save, Trash2, Pencil, X, Lock, Unlock } from 'lucide-react'
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
        <MenubarSub key={item.id}>
          <MenubarSubTrigger disabled={disabled} className="gap-2 text-xs">
            <span className="flex-1">{item.label}</span>
            {item.checked?.() && <span className="text-primary text-xs">✓</span>}
          </MenubarSubTrigger>
          <MenubarSubContent className="min-w-56 max-h-[70vh] overflow-y-auto">
            {renderItems(item.submenu, depth + 1)}
          </MenubarSubContent>
        </MenubarSub>
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

type AppTheme = 'dark' | 'light' | 'oled' | 'photoshop'

export function MenuBar({ theme, setTheme, mobileMode, setMobileMode }: {
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
  mobileMode: boolean
  setMobileMode: (mobile: boolean) => void
}) {
  const menus = useEditorStore(s => s.renderTick) // re-render on engine changes for enabled states
  const scTick = useEditorStore(s => s.shortcutOverrides) // TASK 17 — live shortcut labels
  const openDialog = useEditorStore(s => s.openDialog)
  const resetLayout = useEditorStore(s => s.resetPanelLayout)
  const workspacePreset = useEditorStore(s => s.workspacePreset)
  const setWorkspacePreset = useEditorStore(s => s.setWorkspacePreset)
  const resetWorkspaceLayout = useEditorStore(s => s.resetWorkspaceLayout)
  const workspaceLocks = useEditorStore(s => s.workspaceLayoutLocks[s.workspacePreset])
  const setWorkspaceLayoutLock = useEditorStore(s => s.setWorkspaceLayoutLock)
  const savedLayouts = useEditorStore(s => s.savedLayouts)
  const saveNamedLayout = useEditorStore(s => s.saveNamedLayout)
  const applyNamedLayout = useEditorStore(s => s.applyNamedLayout)
  const deleteNamedLayout = useEditorStore(s => s.deleteNamedLayout)
  const renameNamedLayout = useEditorStore(s => s.renameNamedLayout)
  const importNamedLayout = useEditorStore(s => s.importNamedLayout)
  const exportNamedLayout = useEditorStore(s => s.exportNamedLayout)
  const pushToast = useEditorStore(s => s.pushToast)
  const layoutFile = useRef<HTMLInputElement>(null)
  const [layoutName, setLayoutName] = useState('')
  const [layoutKind, setLayoutKind] = useState<'tools' | 'panels' | 'both'>('both')
  const [renamingLayout, setRenamingLayout] = useState<string | null>(null)
  const [pendingLayoutDelete, setPendingLayoutDelete] = useState<string | null>(null)
  const downloadLayout = (name: string) => {
    try {
      const blob = new Blob([exportNamedLayout(name)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60) || 'layout'}.zlayout.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { pushToast(String(error), 'error') }
  }
  const loadLayoutFile = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 250_000) throw Error('Layout file exceeds 250 KB')
      const name = importNamedLayout(await file.text())
      pushToast(`Imported layout: ${name}`, 'success')
    } catch (error) { pushToast(`Import failed: ${String(error)}`, 'error') }
  }
  void menus // plugin installs/imports also bump renderTick → the dynamic Plugins menu stays fresh
  void scTick

  const cycleTheme = () => setTheme(theme === 'dark' ? 'oled' : theme === 'oled' ? 'photoshop' : theme === 'photoshop' ? 'light' : 'dark')
  const ThemeIcon = theme === 'light' ? Sun : theme === 'oled' ? Contrast : theme === 'photoshop' ? LayoutGrid : Moon
  const themeLabel = theme === 'light' ? 'Light' : theme === 'oled' ? 'OLED black' : theme === 'photoshop' ? 'Photoshop-inspired' : 'Dark'

  return (
    <Menubar className={`h-8 rounded-none border-0 border-b bg-panel text-xs flex-shrink-0 gap-0 ${mobileMode ? 'overflow-x-auto zphoto-scroll' : ''}`}>
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

      <input ref={layoutFile} type="file" data-file-purpose="layout" accept=".json,.zlayout.json,application/json" className="hidden" aria-label="Import layout file"
        onChange={e => { void loadLayoutFile(e.target.files?.[0]); e.target.value = '' }} />
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

        <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground px-1.5 py-1 rounded hover:bg-accent"
          onClick={() => openDialog('help-guide')} aria-label="Help & User Guide" title="Help & User Guide">
          <CircleHelp size={15}/>
          <span className="hidden xl:inline text-[11px]">Help</span>
        </button>

        <button
          className="text-muted-foreground hover:text-foreground p-1.5 rounded hover:bg-accent"
          onClick={cycleTheme}
          title={`Theme: ${themeLabel} — click to cycle`}
          aria-label={`Theme: ${themeLabel}. Click to cycle themes`}
        >
          <ThemeIcon size={14} />
        </button>

        {!mobileMode && <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex items-center gap-1 px-2 h-6 rounded hover:bg-accent text-[11px] text-muted-foreground hover:text-foreground" title="Choose workspace template" aria-label="Workspace template">
              <LayoutGrid size={13} /><span className="hidden 2xl:inline">{workspacePreset === 'photoshop' ? 'Photoshop-style' : 'Classic'}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="w-72 max-w-[calc(100vw-1rem)]">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Workspace template</div>
            <DropdownMenuItem onClick={() => setWorkspacePreset('photoshop')} className="gap-2 text-xs"><LayoutGrid size={13} /><span className="flex-1">Photoshop-style</span>{workspacePreset === 'photoshop' && <Check size={13} />}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setWorkspacePreset('classic')} className="gap-2 text-xs"><LayoutGrid size={13} /><span className="flex-1">Classic / custom</span>{workspacePreset === 'classic' && <Check size={13} />}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Protect workspace arrangement</div>
            {(['panels', 'tools'] as const).map(kind => (
              <DropdownMenuItem key={kind} className="gap-2 text-xs" onSelect={e => {
                e.preventDefault()
                try {
                  setWorkspaceLayoutLock(kind, !workspaceLocks[kind])
                  pushToast((workspaceLocks[kind] ? 'Unlocked ' : 'Locked ') + kind + ' layout for ' + workspacePreset, 'success')
                } catch (error) { pushToast(String(error), 'error') }
              }}>
                {workspaceLocks[kind] ? <Lock size={13} /> : <Unlock size={13} />}
                <span className="flex-1">{workspaceLocks[kind] ? 'Unlock' : 'Lock'} {kind} layout</span>
                {workspaceLocks[kind] && <Check size={13} />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem disabled={workspaceLocks.panels || workspaceLocks.tools}
              onClick={() => { resetWorkspaceLayout(); pushToast('Restored current workspace template; saved layouts were kept.', 'success') }}
              title="Reset tools and panels in this workspace only. Named layouts and the other workspace stay unchanged."
              className="gap-2 text-xs"><RotateCcw size={13} /><span className="flex-1">Restore {workspacePreset === 'photoshop' ? 'Photoshop-style' : 'Classic'} template</span></DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Saved layouts (independent from workspace)</div>
            <div className="flex gap-1 px-2 py-1" onKeyDown={e => e.stopPropagation()}>
              <input aria-label="Layout name" placeholder="Layout name" value={layoutName}
                onChange={e => setLayoutName(e.target.value)}
                className="min-w-0 flex-1 h-7 rounded border bg-background px-2 text-xs" maxLength={100} />
              <select aria-label="Layout contents" value={layoutKind} onChange={e => setLayoutKind(e.target.value as 'tools' | 'panels' | 'both')}
                className="w-21 h-7 rounded border bg-background text-[11px]">
                <option value="both">Both</option><option value="tools">Tools</option><option value="panels">Panels</option>
              </select>
            </div>
            {renamingLayout && <div className="flex items-center justify-between gap-1 px-2 text-[10px] text-muted-foreground">
              <span className="truncate" title={renamingLayout}>Renaming: {renamingLayout}</span>
              <button type="button" className="p-1 hover:text-foreground" aria-label="Cancel layout rename"
                onClick={() => setRenamingLayout(null)}><X size={13}/></button>
            </div>}
            <DropdownMenuItem disabled={!layoutName.trim()} onSelect={e => {
              e.preventDefault()
              try {
                if (renamingLayout) {
                  renameNamedLayout(renamingLayout, layoutName)
                  setRenamingLayout(null)
                  pushToast('Layout renamed', 'success')
                } else {
                  saveNamedLayout(layoutName, layoutKind)
                  pushToast('Layout ' + (savedLayouts.some(x => x.name === layoutName.trim()) ? 'updated' : 'saved'), 'success')
                }
              } catch (error) { pushToast(String(error), 'error') }
            }} className="gap-2 text-xs"><Save size={13} /> {renamingLayout ? 'Rename saved layout' : savedLayouts.some(x => x.name === layoutName.trim()) ? 'Update existing layout' : 'Save named layout'}</DropdownMenuItem>
            <div className="max-h-52 overflow-y-auto zphoto-scroll" role="group" aria-label="Saved layouts">
            {savedLayouts.map(layout => (
              <div key={layout.name} className="flex items-center px-1 hover:bg-accent">
                <button type="button" className="min-w-0 flex-1 truncate text-left px-2 py-1.5 text-xs"
                  title={'Apply ' + layout.name + ' (' + layout.kind + ')'}
                  onClick={() => {
                    try { applyNamedLayout(layout.name); pushToast('Applied ' + layout.name, 'success') }
                    catch (error) { pushToast(String(error), 'error') }
                  }}>
                  {layout.name} <span className="text-muted-foreground">({layout.kind})</span>
                </button>
                {pendingLayoutDelete === layout.name ? <>
                  <button type="button" className="p-1.5 text-destructive font-semibold text-[10px]"
                    aria-label={'Confirm delete ' + layout.name} title="Confirm permanent deletion"
                    onClick={() => {
                      try {
                        deleteNamedLayout(layout.name)
                        setPendingLayoutDelete(null)
                        if (renamingLayout === layout.name) setRenamingLayout(null)
                        pushToast('Layout deleted', 'success')
                      } catch (error) { pushToast(String(error), 'error') }
                    }}>Delete?</button>
                  <button type="button" className="p-1.5" aria-label={'Cancel deleting ' + layout.name}
                    onClick={() => setPendingLayoutDelete(null)}><X size={12}/></button>
                </> : <>
                  <button type="button" className="p-1.5" aria-label={'Rename ' + layout.name} title="Rename saved layout"
                    onClick={() => { setRenamingLayout(layout.name); setLayoutName(layout.name); setPendingLayoutDelete(null) }}><Pencil size={12}/></button>
                  <button type="button" className="p-1.5" aria-label={'Export ' + layout.name} title="Export JSON"
                    onClick={() => downloadLayout(layout.name)}><Download size={12} /></button>
                  <button type="button" className="p-1.5" aria-label={'Delete ' + layout.name} title="Delete saved layout"
                    onClick={() => setPendingLayoutDelete(layout.name)}><Trash2 size={12} /></button>
                </>}
              </div>
            ))}
            </div>
            <DropdownMenuItem onSelect={e => { e.preventDefault(); layoutFile.current?.click() }}
              className="gap-2 text-xs"><Upload size={13}/> Import layout JSON</DropdownMenuItem>

          </DropdownMenuContent>
        </DropdownMenu>}
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
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => setTheme('photoshop')}>
              <LayoutGrid size={13} /><span className="flex-1">Photoshop-inspired colors</span>{theme === 'photoshop' && <Check size={13} />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Workspace</div>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => setWorkspacePreset('photoshop')}><LayoutGrid size={13} /><span className="flex-1">Photoshop-style workspace</span>{workspacePreset === 'photoshop' && <Check size={13} />}</DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => setWorkspacePreset('classic')}><LayoutGrid size={13} /><span className="flex-1">Classic / custom workspace</span>{workspacePreset === 'classic' && <Check size={13} />}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => openDialog('help-guide')}>
              <CircleHelp size={13}/><span className="flex-1">Help & User Guide</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => openDialog('all-tools')}>
              <LayoutGrid size={13} /><span className="flex-1">All tools / Search tools</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => openDialog('shortcuts')}>
              <Keyboard size={13} /><span className="flex-1">Keyboard shortcuts</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => openDialog('customize-toolbar')}>
              <LayoutGrid size={13} /><span className="flex-1">Customize toolbar</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => setMobileMode(!mobileMode)}>
              <Smartphone size={13} /><span className="flex-1">Touch / mobile mode</span>{mobileMode && <Check size={13} />}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => openDialog('plugin-manager')}>
              <Puzzle size={13} /><span className="flex-1">Plugin manager</span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={workspaceLocks.panels} className="gap-2 text-xs" onClick={() => resetLayout()}>
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
