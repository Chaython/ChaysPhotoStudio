'use client'
// Fireworks Expanded Mode document bar: the Original/Preview/2-Up/4-Up view
// switch plus the Fireworks page selector. It sits below the shared document
// tabs and above the canvas.
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { normalizeArtboards } from '../../artboards'
import { cn } from '@/lib/utils'

export type FireworksViewMode = 'original' | 'preview' | '2-up' | '4-up'

const VIEW_LABELS: { id: FireworksViewMode; label: string; title: string }[] = [
  { id: 'original', label: 'Original', title: 'Edit the document with guides, overlays and tools' },
  { id: 'preview', label: 'Preview', title: 'Show a clean, flattened preview of the document' },
  { id: '2-up', label: '2-Up', title: 'Compare the original and the optimized preview side by side' },
  { id: '4-up', label: '4-Up', title: 'Compare four preview variations' },
]

export function FireworksDocumentBar({ view, onView }: {
  view: FireworksViewMode
  onView(view: FireworksViewMode): void
}) {
  const tick = useEditorStore(s => s.renderTick)
  const doc = engine.activeDoc
  void tick
  const boards = doc ? normalizeArtboards(doc.artboards, doc.width, doc.height) : []
  const activePage = doc?.activeArtboardId ?? ''

  const selectPage = (id: string) => {
    if (!doc) return
    doc.activeArtboardId = id || null
    engine.emitOverlay()
    engine.emit()
  }

  return (
    <div
      data-fireworks-document-bar
      className="hidden h-7 shrink-0 items-center gap-1 border-b border-border bg-panel px-1.5 text-[10px] md:flex"
      role="toolbar"
      aria-label="Fireworks document view"
    >
      <span className="px-1 text-[9px] uppercase tracking-wide text-muted-foreground">View</span>
      <div className="flex items-center gap-0.5" role="group" aria-label="Document view mode">
        {VIEW_LABELS.map(option => (
          <button
            key={option.id}
            type="button"
            onClick={() => onView(option.id)}
            aria-pressed={view === option.id}
            title={option.title}
            className={cn(
              'h-5 rounded-sm border px-1.5 text-[10px] transition-colors',
              view === option.id
                ? 'border-primary/50 bg-primary/15 font-medium text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <span aria-hidden className="mx-1 h-4 w-px bg-border/80" />

      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Page</span>
      <select
        className="h-5 max-w-40 rounded-sm border border-border bg-background px-1 text-[10px]"
        value={activePage}
        onChange={event => selectPage(event.target.value)}
        aria-label="Active page"
        disabled={!doc}
      >
        <option value="">Page 1 · Canvas</option>
        {boards.map((board, index) => (
          <option key={board.id} value={board.id}>Page {index + 2} · {board.name}</option>
        ))}
      </select>

      <span className="ml-auto truncate px-1 text-[9px] text-muted-foreground">
        {doc ? `${doc.width} × ${doc.height} px` : 'No document'}
      </span>
    </div>
  )
}
