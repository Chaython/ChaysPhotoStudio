'use client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '../../store'
import { DIALOG_COMPONENTS } from './dialog-registry'
import type { DialogInstance } from '../../types'
import { engine } from '../../engine/engine'

export function DialogManager() {
  const dialogs = useEditorStore(s => s.dialogs)
  const closeDialog = useEditorStore(s => s.closeDialog)

  return (
    <>
      {dialogs.map((d, i) => {
        const Cmp = DIALOG_COMPONENTS[d.type]
        return (
          <Dialog key={d.id} open onOpenChange={open => { if (!open) closeDialog(d.id) }}>
            <DialogContent
              aria-describedby={undefined}
              className={
                ['select-mask', 'content-aware-fill', 'curves', 'levels', 'batch', 'script-console', 'camera-raw', 'color-range', 'ai-upscale', 'ai-generate', 'liquify', 'content-aware-scale', 'match-color', 'plugin-manager', 'shortcuts', 'customize-toolbar'].includes(d.type)
                  ? 'max-w-2xl max-h-[85vh] overflow-y-auto zphoto-scroll'
                  : 'max-w-md max-h-[85vh] overflow-y-auto zphoto-scroll'
              }
              style={{ zIndex: 60 + i }}
              onPointerDownOutside={e => e.preventDefault()}
            >
              {Cmp ? (
                <Cmp inst={d} onClose={() => closeDialog(d.id)} />
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>{d.type}</DialogTitle>
                  </DialogHeader>
                  <div className="text-xs text-muted-foreground py-4">Dialog not yet implemented.</div>
                  <DialogFooter>
                    <Button variant="secondary" onClick={() => closeDialog(d.id)}>Close</Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        )
      })}
      {/* clear previews when all dialogs close */}
      <PreviewClear />
    </>
  )
}

function PreviewClear() {
  const dialogs = useEditorStore(s => s.dialogs)
  const prev = useEditorStore(s => s.renderTick)
  void prev
  // when dialog count transitions to zero, clear any live previews
  if (dialogs.length === 0 && (engine.activeDoc?.previewFilter || engine.activeDoc?.previewAdjustment)) {
    // schedule outside render
    queueMicrotask(() => {
      engine.clearPreviewFilter()
      engine.clearPreviewAdjustment()
      engine.emit()
    })
  }
  return null
}
