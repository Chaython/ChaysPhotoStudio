// External recovery backups are plain, portable .zproj.json files that can be
// reopened using File → Open. They are kept outside the WebView profile.
import type { RecoveryEntry } from './autosave'

export function recoveryBackupFilename(entry: RecoveryEntry): string {
  const base = (entry.name.split(/[\\/]/).pop() || 'Recovered')
    .replace(/\.zproj\.json$/i, '')
    .replace(/\.[^./\\]+$/, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim().slice(0, 70) || 'Recovered'
  const id = entry.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32) || 'doc'
  return `${base}-recovery-${entry.updatedAt}-${id}.zproj.json`
}

export function recoveryBackupBlob(entry: RecoveryEntry): Blob {
  // Keep the native project schema rather than a proprietary backup wrapper.
  // File → Open can read the exact file produced by this operation.
  return new Blob([JSON.stringify(entry.project)], { type: 'application/json' })
}

export async function writeRecoveryBackups(
  entries: readonly RecoveryEntry[],
  directory: Pick<FileSystemDirectoryHandle, 'getFileHandle'>,
): Promise<number> {
  let written = 0
  for (const entry of entries) {
    const file = await directory.getFileHandle(recoveryBackupFilename(entry), { create: true })
    const writable = await file.createWritable()
    try {
      await writable.write(recoveryBackupBlob(entry))
      await writable.close()
      written++
    } catch (error) {
      await writable.abort().catch(() => {})
      throw error
    }
  }
  return written
}
