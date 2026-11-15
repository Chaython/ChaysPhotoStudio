'use client'
// Last-resort error boundary: replaces the whole document when the root
// layout itself fails. Keeps the same chunk-reload recovery as the
// route-level boundary.
import { useEffect } from 'react'
import { isChunkLoadError, reloadOnceForChunkError } from '@/editor/utils/chunk-recovery'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (!isChunkLoadError(error)) return
    reloadOnceForChunkError()
  }, [error])

  const chunkFailure = isChunkLoadError(error)

  return (
    <html lang="en">
      <body style={{ background: '#191919', color: '#e8e8e8', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 15, margin: '0 0 8px' }}>
              {chunkFailure ? 'Updating the editor…' : 'Something went wrong'}
            </h1>
            <p style={{ color: '#999', fontSize: 12, lineHeight: 1.6, margin: 0 }}>
              {chunkFailure
                ? 'A newer version of the editor was downloaded. Reloading to pick it up…'
                : 'The editor hit an unexpected error. Your documents are still saved locally.'}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 }}>
              <button
                type="button"
                onClick={() => reset()}
                style={{ height: 28, padding: '0 12px', borderRadius: 6, border: 0, background: '#e8a33d', color: '#1c1c1c', fontSize: 12 }}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{ height: 28, padding: '0 12px', borderRadius: 6, border: '1px solid #3a3a3a', background: 'transparent', color: '#ccc', fontSize: 12 }}
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}
