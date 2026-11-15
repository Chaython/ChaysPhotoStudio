'use client'
// Route-level error boundary.
//
// Catches render-time failures (most importantly a stale chunk from an
// older deployment) and recovers automatically instead of leaving the
// user on Next.js' generic "Application error" page.
import { useEffect } from 'react'
import { isChunkLoadError, reloadOnceForChunkError } from '@/editor/utils/chunk-recovery'

export default function AppError({
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
    <div className="h-screen w-screen flex items-center justify-center bg-[#191919] px-6">
      <div className="max-w-md text-center space-y-3">
        <div className="w-8 h-8 mx-auto rounded bg-[#e8a33d33] border border-[#e8a33d66] flex items-center justify-center">
          <span className="text-[#e8a33d] text-sm font-bold">C</span>
        </div>
        <h1 className="text-[#e8e8e8] text-sm font-medium">
          {chunkFailure ? 'Updating the editor…' : 'Something went wrong'}
        </h1>
        <p className="text-[#999] text-xs leading-relaxed">
          {chunkFailure
            ? 'A newer version of the editor was downloaded. Reloading to pick it up…'
            : 'The editor hit an unexpected error. Your documents are still saved locally.'}
        </p>
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => reset()}
            className="h-7 px-3 rounded bg-[#e8a33d] text-[#1c1c1c] text-xs font-medium hover:bg-[#f0b455]"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-7 px-3 rounded border border-[#3a3a3a] text-[#ccc] text-xs hover:bg-[#242424]"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  )
}
