// ============================================================
// Chunk-load recovery.
//
// A deployed app ships hashed JavaScript chunks. When a browser (or an
// installed PWA with a stale service-worker cache) asks for a chunk that
// no longer exists, the dynamic import rejects and React renders the
// "Application error: a client-side exception has occurred" page.
//
// The service worker now precaches the whole build, but the recovery
// below is the last line of defence: it reloads the app exactly once so
// the shell, the worker cache and the chunk list agree again.
// ============================================================

const CHUNK_RELOAD_KEY = 'chays-photo-studio:chunk-reload'
const MAX_RELOADS = 2

const CHUNK_ERROR_PATTERN =
  /ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk \d+ failed|Importing a module script failed|Unable to preload CSS/i

/** True when the failure looks like a missing/stale build chunk. */
export function isChunkLoadError(value: unknown): boolean {
  if (!value) return false
  const message =
    typeof value === 'string'
      ? value
      : String((value as { message?: string; digest?: string })?.message ?? (value as { digest?: string })?.digest ?? '')
  return CHUNK_ERROR_PATTERN.test(message)
}

/**
 * Reload the page when a chunk could not be loaded.
 *
 * The reload is capped: a build that is permanently broken must not put
 * the app into a reload loop. The counter is reset once the editor has
 * booted successfully.
 */
export function reloadOnceForChunkError(): boolean {
  if (typeof window === 'undefined') return false
  let attempts = 0
  try {
    attempts = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? '0') || 0
    if (attempts >= MAX_RELOADS) return false
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(attempts + 1))
  } catch {
    // Private mode / storage disabled — reload anyway, the guard is a nicety.
  }
  window.location.reload()
  return true
}

/** The editor booted: a later chunk failure may recover again. */
export function clearChunkReloadGuard(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY)
  } catch {
    // ignore
  }
}
