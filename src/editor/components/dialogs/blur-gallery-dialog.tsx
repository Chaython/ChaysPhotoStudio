'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { engine } from '../../engine/engine'
import { createCanvas, ctx2d } from '../../utils/canvas'
import { useEditorStore } from '../../store'
import { getBlurGalleryPreviewPoint } from '../../utils/blur-gallery-preview'
import { findBlurGalleryPin, moveBlurGalleryPin, removeBlurGalleryPin } from '../../utils/blur-gallery-interaction'
import type { DialogProps } from './generic-dialogs'

type Mode = 'field' | 'iris' | 'tilt-shift'
type Pin = { x: number; y: number; radius: number }

const PREVIEW_W = 680
const PREVIEW_H = 430

function smoothstep(a: number, b: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - a) / Math.max(1e-6, b - a)))
  return t * t * (3 - 2 * t)
}

async function renderBlurGallery(
  source: HTMLCanvasElement,
  mode: Mode,
  pins: Pin[],
  settings: { maxBlur: number; focusX: number; focusY: number; focusWidth: number; focusHeight: number; feather: number; angle: number; band: number },
  shouldCancel?: () => boolean,
): Promise<HTMLCanvasElement> {
  const width = source.width, height = source.height
  const output = createCanvas(width, height)
  const outputCtx = ctx2d(output)
  const radians = settings.angle * Math.PI / 180
  const cos = Math.cos(radians), sin = Math.sin(radians)
  const feather = Math.max(1, settings.feather)
  const cx = settings.focusX * width, cy = settings.focusY * height
  const rx = Math.max(2, settings.focusWidth * width / 2)
  const ry = Math.max(2, settings.focusHeight * height / 2)

  if (mode === 'field') {
    // Field Blur controls a spatially varying blur radius, not the opacity of
    // one maximum-strength blur. Quantize the radius into a small set of blur
    // passes and linearly blend adjacent passes per pixel to avoid visible bands.
    const levels = 6
    const radiusPrecision = 16
    const radiusMap = new Uint8Array(width * height)
    const maxRadius = Math.max(0.5, settings.maxBlur)

    for (let y = 0; y < height; y++) {
      if (y > 0 && y % 16 === 0) {
        await new Promise<void>(resolve => window.setTimeout(resolve, 0))
        if (shouldCancel?.()) throw new Error('Blur Gallery render cancelled')
      }
      for (let x = 0; x < width; x++) {
        let localRadius = 0
        if (pins.length) {
          let weighted = 0, total = 0
          for (const pin of pins) {
            const dx = x - pin.x * width, dy = y - pin.y * height
            const d2 = dx * dx + dy * dy
            if (d2 < 1) { weighted = pin.radius; total = 1; break }
            const weight = 1 / Math.max(1, d2)
            weighted += pin.radius * weight
            total += weight
          }
          localRadius = total ? weighted / total : 0
        }
        const scaledRadius = Math.max(0, Math.min(levels, localRadius / maxRadius * levels))
        radiusMap[y * width + x] = Math.round(scaledRadius * radiusPrecision)
      }
    }

    const layerCanvas = createCanvas(width, height)
    const layerCtx = ctx2d(layerCanvas)
    const maskCanvas = createCanvas(width, height)
    const maskCtx = ctx2d(maskCanvas)
    const maskImage = maskCtx.createImageData(width, height)
    const maskData = maskImage.data
    outputCtx.clearRect(0, 0, width, height)
    outputCtx.globalCompositeOperation = 'lighter'

    for (let level = 0; level <= levels; level++) {
      if (shouldCancel?.()) throw new Error('Blur Gallery render cancelled')
      for (let y = 0; y < height; y++) {
        if (y > 0 && y % 32 === 0) {
          await new Promise<void>(resolve => window.setTimeout(resolve, 0))
          if (shouldCancel?.()) throw new Error('Blur Gallery render cancelled')
        }
        for (let x = 0; x < width; x++) {
          const scaledRadius = radiusMap[y * width + x] / radiusPrecision
          const lower = Math.floor(scaledRadius)
          const upperWeight = scaledRadius - lower
          const weight = level === lower
            ? 1 - upperWeight
            : level === lower + 1
              ? upperWeight
              : 0
          const i = (y * width + x) * 4
          maskData[i] = maskData[i + 1] = maskData[i + 2] = 255
          maskData[i + 3] = Math.round(weight * 255)
        }
      }
      maskCtx.putImageData(maskImage, 0, 0)
      layerCtx.clearRect(0, 0, width, height)
      if (level === 0) {
        layerCtx.drawImage(source, 0, 0)
      } else {
        layerCtx.filter = `blur(${maxRadius * level / levels}px)`
        layerCtx.drawImage(source, 0, 0)
        layerCtx.filter = 'none'
      }
      layerCtx.globalCompositeOperation = 'destination-in'
      layerCtx.drawImage(maskCanvas, 0, 0)
      layerCtx.globalCompositeOperation = 'source-over'
      outputCtx.drawImage(layerCanvas, 0, 0)
    }
    outputCtx.globalCompositeOperation = 'source-over'
    return output
  }

  const blur = createCanvas(width, height)
  const blurCtx = ctx2d(blur)
  blurCtx.filter = `blur(${Math.max(0.5, settings.maxBlur)}px)`
  blurCtx.drawImage(source, 0, 0)
  blurCtx.filter = 'none'

  const mask = createCanvas(width, height)
  const maskCtx = ctx2d(mask)
  const image = maskCtx.createImageData(width, height)
  const data = image.data

  for (let y = 0; y < height; y++) {
    if (y > 0 && y % 16 === 0) {
      await new Promise<void>(resolve => window.setTimeout(resolve, 0))
      if (shouldCancel?.()) throw new Error('Blur Gallery render cancelled')
    }
    for (let x = 0; x < width; x++) {
      let strength = 1
      if (mode === 'iris') {
        const dx = x - cx, dy = y - cy
        const nx = (dx * cos + dy * sin) / rx
        const ny = (-dx * sin + dy * cos) / ry
        const distance = Math.sqrt(nx * nx + ny * ny)
        strength = smoothstep(1, 1 + settings.feather / Math.max(2, Math.min(rx, ry)), distance)
      } else {
        const dx = x - cx, dy = y - cy
        const distance = Math.abs(-dx * sin + dy * cos)
        const halfBand = Math.max(2, settings.band * Math.min(width, height) / 2)
        strength = smoothstep(halfBand, halfBand + feather, distance)
      }
      const i = (y * width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = Math.round(Math.max(0, Math.min(1, strength)) * 255)
    }
  }
  maskCtx.putImageData(image, 0, 0)
  blurCtx.globalCompositeOperation = 'destination-in'
  blurCtx.drawImage(mask, 0, 0)
  blurCtx.globalCompositeOperation = 'source-over'
  outputCtx.drawImage(source, 0, 0)
  outputCtx.drawImage(blur, 0, 0)
  return output
}

export function BlurGalleryDialog({ inst, onClose }: DialogProps) {
  const layerId = String(inst.props?.layerId ?? engine.activeLayer?.id ?? '')
  const doc = engine.activeDoc
  const [documentId] = useState(() => doc?.id ?? null)
  const [source] = useState(() => layerId ? engine.layerCanvasDocSpace(layerId) : null)
  const [mode, setMode] = useState<Mode>('field')
  const [maxBlur, setMaxBlur] = useState(18)
  const [feather, setFeather] = useState(70)
  const [focusWidth, setFocusWidth] = useState(42)
  const [focusHeight, setFocusHeight] = useState(32)
  const [band, setBand] = useState(24)
  const [angle, setAngle] = useState(0)
  const [focusX, setFocusX] = useState(0.5)
  const [focusY, setFocusY] = useState(0.5)
  const [pins, setPins] = useState<Pin[]>([{ x: 0.5, y: 0.5, radius: 18 }])
  const [selectedPin, setSelectedPin] = useState(0)
  const [preview, setPreview] = useState(true)
  const [applying, setApplying] = useState(false)
  const layer = layerId ? engine.layerById(layerId) : null
  const blocked = doc?.workingBitDepth !== 8
  const settings = useMemo(() => ({ maxBlur, focusX, focusY, focusWidth: focusWidth / 100, focusHeight: focusHeight / 100, feather, angle, band: band / 100 }), [maxBlur, focusX, focusY, focusWidth, focusHeight, feather, angle, band])
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      const previewCanvas = previewCanvasRef.current
      if (!source || !previewCanvas) return
      const scale = Math.min(1, (PREVIEW_W - 20) / source.width, (PREVIEW_H - 20) / source.height)
      const w = Math.max(1, Math.round(source.width * scale)), h = Math.max(1, Math.round(source.height * scale))
      const small = createCanvas(w, h)
      ctx2d(small).drawImage(source, 0, 0, w, h)
      const result = preview
        ? await renderBlurGallery(small, mode, pins, { ...settings, maxBlur: Math.max(0.5, maxBlur * scale), feather: Math.max(1, feather * scale), focusX, focusY, band: band / 100 }, () => cancelled)
        : small
      if (cancelled) return
      const canvas = previewCanvas
      canvas.width = PREVIEW_W
      canvas.height = PREVIEW_H
      const ctx = ctx2d(canvas)
      ctx.fillStyle = '#202329'
      ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H)
      const x = (PREVIEW_W - w) / 2, y = (PREVIEW_H - h) / 2
      ctx.drawImage(result, x, y)
      const mark = (px: number, py: number, label: string, active: boolean) => {
        ctx.beginPath(); ctx.arc(x + px * w, y + py * h, active ? 8 : 6, 0, Math.PI * 2)
        ctx.fillStyle = active ? '#f59e0b' : '#38bdf8'; ctx.fill()
        ctx.strokeStyle = '#111827'; ctx.lineWidth = 2; ctx.stroke()
        ctx.fillStyle = '#111827'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(label, x + px * w, y + py * h)
      }
      if (mode === 'field') pins.forEach((p, i) => mark(p.x, p.y, String(i + 1), i === selectedPin))
      else mark(focusX, focusY, '•', true)
    }
    void render().catch(error => {
      if (!cancelled && error instanceof Error && error.message !== 'Blur Gallery render cancelled') {
        useEditorStore.getState().pushToast('Blur Gallery preview could not be rendered', 'error')
      }
    })
    return () => { cancelled = true }
  }, [source, mode, pins, selectedPin, preview, settings, maxBlur, feather, focusX, focusY, band])

  const previewCoordinates = (clientX: number, clientY: number, clamp = false) => {
    if (!source || !previewCanvasRef.current) return null
    return getBlurGalleryPreviewPoint(
      clientX, clientY, previewCanvasRef.current.getBoundingClientRect(),
      source.width, source.height, PREVIEW_W, PREVIEW_H, clamp,
    )
  }

  const dragging = useRef<{ pointerId: number; kind: 'pin' | 'focus'; index: number } | null>(null)

  const handlePreviewPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const point = previewCoordinates(e.clientX, e.clientY)
    if (!point) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (mode === 'field') {
      let index = findBlurGalleryPin(pins, point)
      if (index >= 0) {
        setSelectedPin(index)
      } else {
        index = pins.length
        setPins(prev => [...prev, { x: point.x, y: point.y, radius: maxBlur }])
        setSelectedPin(index)
      }
      dragging.current = { pointerId: e.pointerId, kind: 'pin', index }
    } else {
      setFocusX(point.x)
      setFocusY(point.y)
      dragging.current = { pointerId: e.pointerId, kind: 'focus', index: 0 }
    }
  }

  const handlePreviewPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const active = dragging.current
    if (!active || active.pointerId !== e.pointerId) return
    const point = previewCoordinates(e.clientX, e.clientY, true)
    if (!point) return
    if (active.kind === 'pin') {
      setPins(prev => moveBlurGalleryPin(prev, active.index, point))
    } else {
      setFocusX(point.x)
      setFocusY(point.y)
    }
  }

  const stopPreviewDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragging.current?.pointerId !== e.pointerId) return
    dragging.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const updateMaxBlur = (value: number) => {
    setMaxBlur(value)
    // Maximum Blur is a true ceiling: existing pins must not retain a radius
    // above the new limit while the rendered mask silently clamps them.
    setPins(prev => prev.map(pin => ({ ...pin, radius: Math.min(pin.radius, value) })))
  }
  const updatePinRadius = (radius: number) => setPins(prev => prev.map((p, i) => i === selectedPin ? { ...p, radius: Math.max(0, Math.min(maxBlur, radius)) } : p))

  const apply = async () => {
    if (applying || !source || !doc || engine.activeDoc?.id !== documentId || (mode === 'field' && pins.length === 0)) return
    if (blocked) {
      useEditorStore.getState().pushToast('Blur Gallery currently requires an 8-bit document; higher-bit-depth pixels are not modified', 'error')
      return
    }
    if (!layer || layer.locked || layer.kind === 'adjustment') {
      useEditorStore.getState().pushToast('Select an unlocked pixel layer before applying Blur Gallery', 'error')
      return
    }
    setApplying(true)
    try {
      const output = await renderBlurGallery(source, mode, pins, settings, () => engine.activeDoc?.id !== documentId)
      if (engine.activeDoc?.id !== documentId) return
      const created = engine.addLayerFromCanvas(output, 'Blur Gallery Result', { center: false, aboveActive: true, historyLabel: 'Blur Gallery' })
      if (created) {
        useEditorStore.getState().pushToast(`Applied ${mode === 'field' ? 'Field Blur' : mode === 'iris' ? 'Iris Blur' : 'Tilt-Shift'} to a new editable layer`, 'success')
        onClose()
      }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Blur Gallery render cancelled') {
        useEditorStore.getState().pushToast('Blur Gallery could not finish rendering', 'error')
      }
    } finally {
      setApplying(false)
    }
  }

  const selected = pins[selectedPin]
  const control = (label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void) => (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <input className="min-w-0 flex-1 accent-primary" type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
      <span className="w-10 text-right tabular-nums">{Math.round(value)}{label.includes('°') ? '°' : ''}</span>
    </label>
  )

  return (
    <>
      <DialogHeader><DialogTitle>Blur Gallery</DialogTitle></DialogHeader>
      <div className="space-y-2 py-1">
        <div className="flex flex-wrap gap-1.5">
          {(['field', 'iris', 'tilt-shift'] as Mode[]).map(m => <Button key={m} type="button" size="sm" variant={mode === m ? 'default' : 'outline'} onClick={() => setMode(m)}>{m === 'field' ? 'Field Blur' : m === 'iris' ? 'Iris Blur' : 'Tilt-Shift'}</Button>)}
          <label className="ml-auto flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={preview} onChange={e => setPreview(e.target.checked)} /> Preview</label>
        </div>
        <canvas ref={previewCanvasRef} width={PREVIEW_W} height={PREVIEW_H} onPointerDown={handlePreviewPointerDown} onPointerMove={handlePreviewPointerMove} onPointerUp={stopPreviewDrag} onPointerCancel={stopPreviewDrag} className="w-full rounded border border-border cursor-crosshair touch-none" aria-label="Blur Gallery focus editor" />
        <p className="text-[10px] text-muted-foreground">{mode === 'field' ? 'Click to add blur pins or drag existing pins to reposition them. Select a pin to adjust its blur amount.' : mode === 'iris' ? 'Drag to position the sharp elliptical focus area. Adjust its width, height, rotation and transition.' : 'Drag to position the sharp focus strip. Adjust its width, angle and transition.'}</p>
        {control('Maximum Blur', maxBlur, 1, 60, 1, updateMaxBlur)}
        {mode === 'field' && <>
          {control('Selected Pin', selectedPin + 1, 1, Math.max(1, pins.length), 1, v => setSelectedPin(Math.min(pins.length - 1, v - 1)))}
          {control('Pin Blur', selected?.radius ?? maxBlur, 0, maxBlur, 1, updatePinRadius)}
          <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => { const result = removeBlurGalleryPin(pins, selectedPin); setPins(result.pins); setSelectedPin(result.selectedIndex) }} disabled={!pins.length}>Remove Pin</Button><Button size="sm" variant="outline" onClick={() => { setPins([]); setSelectedPin(0) }}>Clear Pins</Button></div>
        </>}
        {mode === 'iris' && <>
          {control('Focus Width', focusWidth, 5, 100, 1, setFocusWidth)}
          {control('Focus Height', focusHeight, 5, 100, 1, setFocusHeight)}
          {control('Transition', feather, 1, 200, 1, setFeather)}
          {control('Rotation °', angle, -180, 180, 1, setAngle)}
        </>}
        {mode === 'tilt-shift' && <>
          {control('Focus Band', band, 2, 90, 1, setBand)}
          {control('Transition', feather, 1, 200, 1, setFeather)}
          {control('Rotation °', angle, -180, 180, 1, setAngle)}
        </>}
        {blocked && <p className="text-[10px] text-amber-600">This Blur Gallery implementation is limited to 8-bit documents. High-bit-depth documents remain unchanged.</p>}
        {!source && <p className="text-[10px] text-destructive">Select a pixel layer before opening Blur Gallery.</p>}
      </div>
      <DialogFooter>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={applying}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={applying || blocked || !source || !layer || layer.locked || (mode === 'field' && pins.length === 0)}>{applying ? 'Applying…' : 'Apply to New Layer'}</Button>
      </DialogFooter>
    </>
  )
}
