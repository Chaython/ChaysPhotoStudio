'use client'

import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  LAYER_CONTEXT_MENU_SECTIONS,
  defaultLayerContextPreferences,
  moveLayerContextAction,
  setLayerContextActionVisible,
  type LayerContextActionId,
  type LayerContextMenuPreferences,
} from './layer-context-menu-config'

/** Customize visible right-click actions without affecting the commands themselves. */
export function LayerContextMenuEditor({
  open, onOpenChange, preferences, onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  preferences: LayerContextMenuPreferences
  onChange: (prefs: LayerContextMenuPreferences) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col min-h-0">
        <DialogHeader>
          <DialogTitle>Edit right-click menu</DialogTitle>
          <DialogDescription>
            Choose which actions appear when right-clicking a layer with the Move tool.
            Move actions within their sections; changes are saved on this device.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto space-y-3 pr-1" aria-label="Layer context menu layout">
          {LAYER_CONTEXT_MENU_SECTIONS.map(section => {
            const entries = preferences.order[section.id]
            const byId = new Map<string, string>(section.entries.map(item => [item.id, item.label]))
            return (
              <section key={section.id} aria-label={section.label} className="rounded-md border border-border/70 p-2 space-y-1">
                <h3 className="text-xs font-semibold text-foreground px-1 py-1">{section.label}</h3>
                {entries.map((id, index) => {
                  const label = byId.get(id) ?? id
                  const visible = !preferences.hidden.includes(id)
                  return (
                    <div key={id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-accent/40">
                      <Checkbox
                        id={`context-menu-${id}`}
                        checked={visible}
                        onCheckedChange={value => onChange(setLayerContextActionVisible(preferences, id as LayerContextActionId, value === true))}
                        aria-label={`Show ${label}`}
                      />
                      <label htmlFor={`context-menu-${id}`} className="flex-1 min-w-0 text-xs cursor-pointer">{label}</label>
                      <Button
                        size="icon" variant="ghost" className="size-7"
                        disabled={index === 0}
                        onClick={() => onChange(moveLayerContextAction(preferences, section.id, id as LayerContextActionId, -1))}
                        aria-label={`Move ${label} up`}
                        title={`Move ${label} up`}
                      ><ArrowUp size={13} /></Button>
                      <Button
                        size="icon" variant="ghost" className="size-7"
                        disabled={index === entries.length - 1}
                        onClick={() => onChange(moveLayerContextAction(preferences, section.id, id as LayerContextActionId, 1))}
                        aria-label={`Move ${label} down`}
                        title={`Move ${label} down`}
                      ><ArrowDown size={13} /></Button>
                    </div>
                  )
                })}
              </section>
            )
          })}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(defaultLayerContextPreferences())}>
            <RotateCcw size={13} /> Reset defaults
          </Button>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
