'use client'
import dynamic from 'next/dynamic'

const EditorApp = dynamic(
  () => import('@/editor/components/shell/editor-app').then(m => m.EditorApp),
  { ssr: false, loading: () => (
    <div className="h-screen w-screen flex items-center justify-center bg-[#191919]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded bg-[#e8a33d33] border border-[#e8a33d66] flex items-center justify-center">
          <span className="text-[#e8a33d] text-sm font-bold">C</span>
        </div>
        <div className="text-[#999] text-xs">Loading Chay's Photo Studio…</div>
      </div>
    </div>
  ) }
)

export default function Page() {
  return <EditorApp />
}
