'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { engine } from '../../engine/engine'
import { warpCanvasQuadToQuad, type Point2 } from '../../image-ops/perspective'
import { createCanvas, ctx2d } from '../../utils/canvas'
import { useEditorStore } from '../../store'
import type { DialogProps } from './generic-dialogs'

type Plane = { id: string; source: Point2[]; destination: Point2[] }
type Mode = 'source' | 'destination'

const PREVIEW_W = 640
const PREVIEW_H = 420

export function VanishingPointDialog({ inst, onClose }: DialogProps) {
  const layerId = String(inst.props?.layerId ?? engine.activeLayer?.id ?? '')
  const doc = engine.activeDoc
  const [documentId] = useState(() => doc?.id ?? null)
  const [source] = useState(() => layerId ? engine.layerCanvasDocSpace(layerId) : null)
  const [planes, setPlanes] = useState<Plane[]>([])
  const [mode, setMode] = useState<Mode>('source')
  const [points, setPoints] = useState<Point2[]>([])
  const [showOriginal, setShowOriginal] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragPlaneRef = useRef<string | null>(null)
  const layer = layerId ? engine.layerById(layerId) : null
  const blocked = doc?.workingBitDepth !== 8

  const view = useMemo(() => {
    if (!source) return { x: 0, y: 0, w: PREVIEW_W, h: PREVIEW_H, scale: 1 }
    const scale = Math.min((PREVIEW_W - 24) / source.width, (PREVIEW_H - 24) / source.height)
    const w = source.width * scale, h = source.height * scale
    return { x: (PREVIEW_W - w) / 2, y: (PREVIEW_H - h) / 2, w, h, scale }
  }, [source])

  const renderResult = (includeOriginal = false) => {
    if (!source || !doc) return null
    const out = createCanvas(doc.width, doc.height)
    const ctx = ctx2d(out)
    if (includeOriginal) ctx.drawImage(source, 0, 0)
    for (const plane of planes) {
      if (plane.source.length !== 4 || plane.destination.length !== 4) continue
      const warped = warpCanvasQuadToQuad(source, plane.source, plane.destination, doc.width, doc.height)
      ctx.drawImage(warped, 0, 0)
    }
    return out
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !source) return
    const ctx = ctx2d(canvas)
    ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H)
    ctx.fillStyle = '#17191e'
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H)
    const tile = 12
    for (let y = view.y; y < view.y + view.h; y += tile) for (let x = view.x; x < view.x + view.w; x += tile) {
      ctx.fillStyle = (Math.floor((x - view.x) / tile) + Math.floor((y - view.y) / tile)) % 2 ? '#30343b' : '#252930'
      ctx.fillRect(x, y, tile, tile)
    }
    if (showOriginal) ctx.drawImage(source, view.x, view.y, view.w, view.h)
    const result = renderResult(false)
    if (result) ctx.drawImage(result, view.x, view.y, view.w, view.h)
    const toScreen = (p: Point2) => ({ x: view.x + p.x * view.scale, y: view.y + p.y * view.scale })
    planes.forEach((plane, index) => {
      for (const [quad, color] of [[plane.source, '#45c6ff'], [plane.destination, '#ffbd55']] as const) {
        if (!quad.length) continue
        ctx.beginPath()
        quad.forEach((p, i) => { const q = toScreen(p); if (!i) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y) })
        if (quad.length === 4) ctx.closePath()
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.stroke()
        quad.forEach((p, i) => {
          const q = toScreen(p)
          ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2)
          ctx.fillStyle = color; ctx.fill()
          ctx.fillStyle = '#111'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(String(i + 1), q.x, q.y)
        })
      }
      if (plane.source.length === 4 && plane.destination.length === 4) {
        const center = toScreen(plane.destination.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 }))
        ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.fillText('Plane ' + (index + 1), center.x, center.y)
      }
    })
    points.forEach((p, i) => {
      const q = toScreen(p)
      ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, Math.PI * 2)
      ctx.fillStyle = mode === 'source' ? '#45c6ff' : '#ffbd55'; ctx.fill()
      ctx.fillStyle = '#111'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), q.x, q.y)
    })
  }, [source, doc, planes, points, mode, showOriginal, view])

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!source || points.length >= 4) return
    const bounds = e.currentTarget.getBoundingClientRect()
    const sx = (e.clientX - bounds.left) * PREVIEW_W / bounds.width
    const sy = (e.clientY - bounds.top) * PREVIEW_H / bounds.height
    const x = (sx - view.x) / view.scale, y = (sy - view.y) / view.scale
    if (x < 0 || y < 0 || x >= source.width || y >= source.height) return
    setPoints(prev => [...prev, { x, y }])
  }

  const finishPlane = () => {
    if (points.length !== 4) return
    if (mode === 'source') {
      setPlanes(prev => [...prev, { id: crypto.randomUUID(), source: points, destination: [] }])
      setPoints([])
      setMode('destination')
    } else {
      setPlanes(prev => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last) next[next.length - 1] = { ...last, destination: points }
        return next
      })
      setPoints([])
      setMode('source')
    }
  }

  const undoPoint = () => setPoints(prev => prev.slice(0, -1))
  const removeLastPlane = () => {
    setPlanes(prev => prev.slice(0, -1))
    setPoints([])
    setMode('source')
  }

  const apply = () => {
    const liveDoc = engine.activeDoc
    const liveLayer = layerId ? engine.layerById(layerId) : null
    if (!source || !liveDoc || liveDoc.id !== documentId || !liveLayer || !planes.length) return
    if (liveDoc.workingBitDepth !== 8) {
      useEditorStore.getState().pushToast('Vanishing Point currently requires an 8-bit document to avoid reducing high-bit-depth precision', 'error')
      return
    }
    if (liveLayer.locked || liveLayer.kind === 'adjustment') {
      useEditorStore.getState().pushToast('Select an unlocked pixel layer before applying Vanishing Point', 'error')
      return
    }
    const output = renderResult(false)
    if (!output) return
    const created = engine.addLayerFromCanvas(output, 'Vanishing Point Result', { center: false, historyLabel: 'Vanishing Point' })
    if (!created) return
    useEditorStore.getState().pushToast(`Applied ${planes.length} perspective plane${planes.length === 1 ? '' : 's'} to a new editable layer`, 'success')
    onClose()
  }

  const completePlanes = planes.filter(p => p.source.length === 4 && p.destination.length === 4).length
  const canApply = !!source && completePlanes > 0 && mode === 'source' && points.length === 0 && !blocked && !layer?.locked

  return (
    <>
      <DialogHeader><DialogTitle>Vanishing Point · Multi-Plane Perspective</DialogTitle></DialogHeader>
      <div className="space-y-2 py-1">
        <p className="text-[10px] text-muted-foreground">For each plane, click four corners clockwise on the source surface, then click four matching destination corners. Add connected planes to build a perspective-mapped surface. The original layer remains untouched.</p>
        <canvas ref={canvasRef} width={PREVIEW_W} height={PREVIEW_H} onClick={handleCanvasClick}
          className="w-full rounded border border-border touch-none cursor-crosshair" aria-label="Multi-plane perspective editor" />
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-medium">{mode === 'source' ? 'Source plane' : 'Destination plane'} · {points.length}/4 corners</span>
          <span className="text-muted-foreground">{completePlanes} completed plane(s)</span>
          <span className="ml-auto flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-sky-400" /> Source <span className="ml-2 inline-block h-2 w-2 rounded-full bg-amber-400" /> Destination</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" onClick={finishPlane} disabled={points.length !== 4}>{mode === 'source' ? 'Set Source Plane' : 'Set Destination Plane'}</Button>
          <Button type="button" size="sm" variant="secondary" onClick={undoPoint} disabled={!points.length}>Undo Point</Button>
          <Button type="button" size="sm" variant="secondary" onClick={removeLastPlane} disabled={!planes.length}>Remove Last Plane</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => { setPlanes([]); setPoints([]); setMode('source') }} disabled={!planes.length && !points.length}>Clear All</Button>
          <label className="ml-auto flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={showOriginal} onChange={e => setShowOriginal(e.target.checked)} /> Show Original</label>
        </div>
        {blocked && <p className="text-[10px] text-amber-600">This first multi-plane renderer is limited to 8-bit documents; high-bit-depth documents are not modified.</p>}
        {!source && <p className="text-[10px] text-destructive">Select a layer with a pixel source before opening Vanishing Point.</p>}
      </div>
      <DialogFooter>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={!canApply}>Apply to New Layer</Button>
      </DialogFooter>
    </>
  )
}
