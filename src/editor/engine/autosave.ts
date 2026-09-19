import { engine } from './engine'
import { openSerializedProject, serializeProject, type SerializedProject } from './io'

const DB_NAME = 'chays-photo-studio'
const DB_VERSION = 1
const STORE = 'recovery'
const MAX_RECOVERY = 8
const AUTOSAVE_DELAY = 6000

export interface RecoveryEntry {
  id: string
  name: string
  width: number
  height: number
  updatedAt: number
  dirty: boolean
  project: SerializedProject
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'))
  })
}

function request<T = unknown>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export async function saveRecoverySnapshot(docId: string): Promise<void> {
  const doc = engine.docs.find(d => d.id === docId)
  if (!doc) return
  const db = await openDb()
  try {
    const entry: RecoveryEntry = {
      id: doc.id,
      name: doc.name,
      width: doc.width,
      height: doc.height,
      updatedAt: Date.now(),
      dirty: doc.dirty,
      project: serializeProject(doc),
    }
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(entry)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Autosave failed'))
      tx.onabort = () => reject(tx.error ?? new Error('Autosave aborted'))
    })
    const all = await listRecoveryEntries()
    await Promise.all(all.slice(MAX_RECOVERY).map(e => deleteRecoveryEntry(e.id)))
  } finally {
    db.close()
  }
}

export async function listRecoveryEntries(): Promise<RecoveryEntry[]> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const rows = await request<RecoveryEntry[]>(tx.objectStore(STORE).getAll())
    return rows.sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    db.close()
  }
}

export async function deleteRecoveryEntry(id: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    await request(tx.objectStore(STORE).delete(id))
  } finally {
    db.close()
  }
}

export async function clearRecoveryEntries(): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    await request(tx.objectStore(STORE).clear())
  } finally {
    db.close()
  }
}

export async function restoreRecoveryEntry(id: string) {
  const db = await openDb()
  let entry: RecoveryEntry | undefined
  try {
    const tx = db.transaction(STORE, 'readonly')
    entry = await request<RecoveryEntry | undefined>(tx.objectStore(STORE).get(id))
  } finally {
    db.close()
  }
  if (!entry) throw new Error('Recovery snapshot not found')
  const doc = await openSerializedProject(entry.project, 'Recovered Autosave')
  doc.dirty = true
  engine.emit()
  return doc
}

/** Debounced per-document crash recovery. Snapshots live in IndexedDB and are
 * intentionally independent of the browser download flow. */
export function startAutoSave(): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const knownDocs = new Set<string>()
  const schedule = (docId: string) => {
    const old = timers.get(docId)
    if (old) clearTimeout(old)
    timers.set(docId, setTimeout(() => {
      timers.delete(docId)
      void saveRecoverySnapshot(docId).catch(() => { /* recovery is best-effort */ })
    }, AUTOSAVE_DELAY))
  }
  const queue = () => {
    for (const doc of engine.docs) {
      // A first snapshot makes this double as a lightweight Recent Sessions list;
      // subsequent snapshots are only scheduled for documents with unsaved edits.
      const firstSeen = !knownDocs.has(doc.id)
      knownDocs.add(doc.id)
      if (firstSeen || doc.dirty) schedule(doc.id)
    }
  }
  const flush = () => {
    for (const doc of engine.docs) {
      if (doc.dirty) void saveRecoverySnapshot(doc.id).catch(() => { /* best effort */ })
    }
  }
  const unsub = engine.onChange(queue)
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
  const onProjectSaved = (event: Event) => {
    const id = (event as CustomEvent<string>).detail
    if (id) void saveRecoverySnapshot(id).catch(() => { /* best effort */ })
  }
  window.addEventListener('pagehide', flush)
  window.addEventListener('chays:project-saved', onProjectSaved)
  document.addEventListener('visibilitychange', onVisibility)
  queue()
  return () => {
    unsub()
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
    window.removeEventListener('pagehide', flush)
    window.removeEventListener('chays:project-saved', onProjectSaved)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
