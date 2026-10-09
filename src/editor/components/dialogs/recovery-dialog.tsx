'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Clock3, Download, FolderDown, RotateCcw, Trash2 } from 'lucide-react'
import { clearRecoveryEntries, deleteRecoveryEntry, listRecoveryEntries, restoreRecoveryEntry, type RecoveryEntry } from '../../engine/autosave'
import { useEditorStore } from '../../store'
import { recoveryBackupBlob, recoveryBackupFilename, writeRecoveryBackups } from '../../engine/recovery-backup'
import { downloadBlob } from '../../utils/canvas'
import type { DialogProps } from './generic-dialogs'

function age(ts: number) {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 48) return `${hr}h ago`
  return new Date(ts).toLocaleDateString()
}

export function RecoveryDialog({ onClose }: DialogProps) {
  const [items, setItems] = useState<RecoveryEntry[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const refresh = () => void listRecoveryEntries().then(setItems).catch(() => setItems([]))
  useEffect(refresh, [])

  const backupOne = (entry: RecoveryEntry) => {
    try {
      downloadBlob(recoveryBackupBlob(entry), recoveryBackupFilename(entry))
      useEditorStore.getState().pushToast('Recovery backup downloaded', 'success')
    } catch (err) {
      useEditorStore.getState().pushToast(err instanceof Error ? err.message : 'Recovery backup failed', 'error')
    }
  }
  const backupAll = async () => {
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
    if (!picker || busy) return
    setBusy('backup')
    try {
      const directory = await picker.call(window)
      const count = await writeRecoveryBackups(items, directory)
      useEditorStore.getState().pushToast(`Backed up ${count} recoveries outside the application profile`, 'success')
    } catch (err: any) {
      if (err?.name !== 'AbortError') useEditorStore.getState().pushToast(err instanceof Error ? err.message : 'Backup failed', 'error')
    } finally { setBusy(null) }
  }

  const restore = async (id: string) => {
    setBusy(id)
    try {
      await restoreRecoveryEntry(id)
      useEditorStore.getState().pushToast('Recovered autosaved work', 'success')
      onClose()
    } catch (err) {
      useEditorStore.getState().pushToast(err instanceof Error ? err.message : 'Recovery failed', 'error')
    } finally { setBusy(null) }
  }

  return <>
    <DialogHeader><DialogTitle>Recent & Recovery</DialogTitle></DialogHeader>
    <div className="space-y-2 py-1">
      <p className="text-[11px] text-muted-foreground">Automatic recovery snapshots are stored in this app's local WebView profile. Download backups or save them to another folder to protect against profile loss.</p>
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2 rounded-md border p-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium truncate">{item.name}</div>
            <div className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock3 size={10}/>{item.width}×{item.height} · {age(item.updatedAt)}{item.dirty ? ' · unsaved' : ''}</div>
          </div>
          <Button size="icon" variant="outline" className="h-7 w-7" title="Download a portable project backup" aria-label={`Download recovery backup for ${item.name}`} disabled={!!busy} onClick={() => backupOne(item)}><Download size={12}/></Button>
          <Button size="sm" className="h-7 text-[11px]" disabled={!!busy} onClick={() => void restore(item.id)}><RotateCcw size={12}/> Restore</Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" disabled={!!busy} onClick={() => void deleteRecoveryEntry(item.id).then(refresh)}><Trash2 size={12}/></Button>
        </div>
      ))}
      {!items.length && <div className="rounded-md border border-dashed p-5 text-center text-[11px] text-muted-foreground">No recovery snapshots yet. Dirty documents autosave after a few seconds.</div>}
    </div>
    <DialogFooter className="gap-2">
      {items.length > 0 && typeof window !== 'undefined' && 'showDirectoryPicker' in window && (
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void backupAll()}><FolderDown size={13}/> Back up all to folder…</Button>
      )}
      {items.length > 0 && <Button variant="ghost" size="sm" className="mr-auto text-destructive" disabled={!!busy} onClick={() => void clearRecoveryEntries().then(refresh)}>Clear All</Button>}
      <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
    </DialogFooter>
  </>
}
