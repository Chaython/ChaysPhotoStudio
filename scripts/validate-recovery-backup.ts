import assert from 'node:assert/strict'
import { recoveryBackupBlob, recoveryBackupFilename, writeRecoveryBackups } from '../src/editor/engine/recovery-backup'
import type { RecoveryEntry } from '../src/editor/engine/autosave'

const makeEntry = (id: string, name: string, updatedAt: number): RecoveryEntry => ({
  id, name, updatedAt, width: 12, height: 8, dirty: true,
  project: { version: 2, name, width: 12, height: 8, layers: [] } as unknown as RecoveryEntry['project'],
})
const entries = [
  makeEntry('foo:bar', '../../ Portrait?.psd', 1740000000000),
  makeEntry('another', 'Composite.zproj.json', 1740000005000),
]
const filename = recoveryBackupFilename(entries[0])
assert.match(filename, /^Portrait--recovery-1740000000000-foo-bar\.zproj\.json$/)
assert.ok(!filename.includes('/') && !filename.includes('\\'))
assert.equal(recoveryBackupFilename(entries[1]), 'Composite-recovery-1740000005000-another.zproj.json')
assert.deepEqual(JSON.parse(await recoveryBackupBlob(entries[1]).text()), entries[1].project)

const saved = new Map<string, string>()
const folder = {
  async getFileHandle(name: string, opts: { create?: boolean }) {
    assert.equal(opts.create, true)
    return {
      async createWritable() {
        let body: Blob | undefined
        return {
          async write(value: Blob) { body = value },
          async close() {
            assert.ok(body)
            saved.set(name, await body.text())
          },
          async abort() {},
        }
      },
    }
  },
}
const count = await writeRecoveryBackups(entries, folder as unknown as Pick<FileSystemDirectoryHandle, 'getFileHandle'>)
assert.equal(count, 2)
for (const entry of entries) {
  assert.deepEqual(JSON.parse(saved.get(recoveryBackupFilename(entry))!), entry.project)
}

let aborted = false
const failingFolder = {
  async getFileHandle() {
    return {
      async createWritable() {
        return {
          async write() { throw new Error('disk full') },
          async close() { throw new Error('should not close') },
          async abort() { aborted = true },
        }
      },
    }
  },
}
await assert.rejects(
  () => writeRecoveryBackups(entries, failingFolder as unknown as Pick<FileSystemDirectoryHandle, 'getFileHandle'>),
  /disk full/,
)
assert.equal(aborted, true, 'partial file writes must be aborted')
console.log('Portable recovery backups round-trip their project JSON, sanitize filenames, and abort failed writes')
