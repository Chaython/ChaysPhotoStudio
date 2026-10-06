'use client'

import { useEffect, useMemo, useState } from 'react'
import { Blend, Sigma } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { engine } from '../../engine/engine'
import { getFlatComposite, prepareLayer } from '../../engine/document'
import { BLEND_MODES } from '../../constants/tools'
import {
  calculateChannelMask,
  type CalculationBlendMode,
  type CalculationChannel,
} from '../../image-ops/calculations'
import { createCanvas, ctx2d } from '../../utils/canvas'
import { useEditorStore } from '../../store'
import type { PsDocument } from '../../types'
import type { DialogProps } from './generic-dialogs'

type ResultTarget = 'selection' | 'channel' | 'document'
type SourceChannelChoice = CalculationChannel | `saved:${string}`

interface SourceState {
  docId: string
  layerId: string
  channel: SourceChannelChoice
  invert: boolean
}

const CHANNELS: { value: CalculationChannel; label: string }[] = [
  { value: 'gray', label: 'Gray (Luminosity)' },
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'alpha', label: 'Transparency / Alpha' },
]

function resolveSource(doc: PsDocument, source: SourceState): { canvas: HTMLCanvasElement; channel: CalculationChannel } | null {
  if (source.channel.startsWith('saved:')) {
    const saved = doc.savedChannels.find(item => item.id === source.channel.slice(6))
    return saved ? { canvas: saved.mask, channel: 'alpha' } : null
  }
  if (source.layerId === 'merged') return { canvas: getFlatComposite(doc), channel: source.channel }
  const layer = doc.layers.find(item => item.id === source.layerId)
  const canvas = layer ? prepareLayer(doc, layer) : null
  return canvas ? { canvas, channel: source.channel } : null
}

function SourceEditor(props: {
  number: 1 | 2
  source: SourceState
  onChange: (next: SourceState) => void
  docs: PsDocument[]
}) {
  const doc = props.docs.find(item => item.id === props.source.docId) ?? props.docs[0]
  const layers = useMemo(
    () => (doc?.layers ?? []).filter(layer => layer.kind !== 'adjustment'),
    [doc],
  )

  if (!doc) return null

  return (
    <div className="rounded border border-border/70 p-2.5 space-y-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Source {props.number}</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1 col-span-2">
          <Label className="text-[10px]">Document</Label>
          <Select
            value={doc.id}
            onValueChange={docId => props.onChange({
              ...props.source,
              docId,
              layerId: 'merged',
              channel: props.source.channel.startsWith('saved:') ? 'gray' : props.source.channel,
            })}
          >
            <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent className="z-50">
              {props.docs.map(item => (
                <SelectItem key={item.id} value={item.id} className="text-[11px]">
                  {item.name} · {item.width} × {item.height}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px]">Layer</Label>
          <Select
            value={props.source.layerId}
            onValueChange={layerId => props.onChange({ ...props.source, layerId })}
          >
            <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent className="z-50">
              <SelectItem value="merged" className="text-[11px]">Merged</SelectItem>
              {layers.map(layer => (
                <SelectItem key={layer.id} value={layer.id} className="text-[11px]">{layer.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px]">Channel</Label>
          <Select
            value={props.source.channel}
            onValueChange={channel => props.onChange({ ...props.source, channel: channel as CalculationChannel })}
          >
            <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent className="z-50">
              {CHANNELS.map(item => (
                <SelectItem key={item.value} value={item.value} className="text-[11px]">{item.label}</SelectItem>
              ))}
              {doc.savedChannels.map(item => (
                <SelectItem key={item.id} value={'saved:' + item.id} className="text-[11px]">
                  Alpha: {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-[11px] cursor-pointer">
        <Checkbox
          checked={props.source.invert}
          onCheckedChange={value => props.onChange({ ...props.source, invert: value === true })}
        />
        Invert
      </label>
    </div>
  )
}

export function CalculationsDialog({ onClose }: DialogProps) {
  const tick = useEditorStore(s => s.renderTick)
  void tick
  const doc = engine.activeDoc
  const docs = engine.docs
  const initialDocId = doc?.id ?? ''
  const initialLayer = engine.activeLayer?.kind !== 'adjustment' ? engine.activeLayer?.id ?? 'merged' : 'merged'

  const [source1, setSource1] = useState<SourceState>({
    docId: initialDocId,
    layerId: 'merged',
    channel: 'gray',
    invert: false,
  })
  const [source2, setSource2] = useState<SourceState>({
    docId: initialDocId,
    layerId: initialLayer,
    channel: 'gray',
    invert: false,
  })
  const [blendMode, setBlendMode] = useState<CalculationBlendMode>('multiply')
  const [opacity, setOpacity] = useState(100)
  const [resultTarget, setResultTarget] = useState<ResultTarget>('channel')
  const [channelName, setChannelName] = useState('')
  const [useSelection, setUseSelection] = useState(false)
  const [busy, setBusy] = useState(false)

  const doc1 = docs.find(item => item.id === source1.docId) ?? doc
  const doc2 = docs.find(item => item.id === source2.docId) ?? doc
  const hdrBlocked = [doc, doc1, doc2].some(item => item?.workingBitDepth === 32)

  useEffect(() => {
    if (!doc) return
    if (!source1.docId) setSource1(current => ({ ...current, docId: doc.id }))
    if (!source2.docId) setSource2(current => ({ ...current, docId: doc.id }))
  }, [doc, source1.docId, source2.docId])

  const calculate = () => {
    if (!doc || !doc1 || !doc2 || busy || hdrBlocked) return
    const resolved1 = resolveSource(doc1, source1)
    const resolved2 = resolveSource(doc2, source2)
    if (!resolved1 || !resolved2) {
      useEditorStore.getState().pushToast('A Calculations source has no renderable pixels or channel', 'error')
      return
    }

    setBusy(true)
    try {
      const mask = calculateChannelMask(
        { canvas: resolved1.canvas, channel: resolved1.channel, invert: source1.invert },
        { canvas: resolved2.canvas, channel: resolved2.channel, invert: source2.invert },
        {
          width: doc.width,
          height: doc.height,
          blendMode,
          opacity,
          selectionMask: useSelection ? doc.selection?.mask ?? null : null,
        },
      )

      if (resultTarget === 'selection') {
        engine.setSelectionAlpha(mask, 'new', 'Calculations')
        useEditorStore.getState().pushToast('Calculations loaded as selection', 'success')
      } else if (resultTarget === 'channel') {
        const id = engine.saveAlphaChannel(mask, channelName || undefined, 'Calculations')
        if (!id) throw new Error('Could not save Calculations channel')
        useEditorStore.getState().pushToast('Calculations saved as a new alpha channel', 'success')
      } else {
        const canvas = createCanvas(doc.width, doc.height)
        const image = ctx2d(canvas).createImageData(doc.width, doc.height)
        for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
          const value = mask[p]
          image.data[i] = image.data[i + 1] = image.data[i + 2] = value
          image.data[i + 3] = 255
        }
        ctx2d(canvas).putImageData(image, 0, 0)
        engine.addCanvasDocument(canvas, 'Calculations', {
          sourceBitDepth: 8,
          workingBitDepth: 8,
          workingColorSpace: doc.workingColorSpace ?? 'srgb',
          resolutionPpi: doc.resolutionPpi ?? 72,
        })
        useEditorStore.getState().pushToast('Calculations opened as a new grayscale RGB document', 'success')
      }
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Calculations failed'
      useEditorStore.getState().pushToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!doc) {
    return (
      <>
        <DialogHeader><DialogTitle>Calculations</DialogTitle></DialogHeader>
        <div className="py-4 text-xs text-muted-foreground">Open a document first.</div>
        <DialogFooter><Button variant="secondary" size="sm" onClick={onClose}>Close</Button></DialogFooter>
      </>
    )
  }

  const differentSizes = [doc1, doc2].some(item => item && (item.width !== doc.width || item.height !== doc.height))

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Sigma size={15} className="text-primary" /> Calculations</DialogTitle>
      </DialogHeader>

      <div className="space-y-3 py-1">
        <div className="text-[10px] text-muted-foreground">
          Combine two document/layer channels—including saved alpha channels—into a selection, saved alpha channel, or new grayscale result document.
        </div>

        <div className="grid grid-cols-2 gap-2">
          <SourceEditor number={1} source={source1} onChange={setSource1} docs={docs} />
          <SourceEditor number={2} source={source2} onChange={setSource2} docs={docs} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] flex items-center gap-1"><Blend size={10} /> Blending</Label>
            <Select value={blendMode} onValueChange={value => setBlendMode(value as CalculationBlendMode)}>
              <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50 max-h-72">
                {BLEND_MODES.map(mode => (
                  <SelectItem key={mode.value} value={mode.value} className="text-[11px]">{mode.label}</SelectItem>
                ))}
                <SelectItem value="subtract" className="text-[11px]">Subtract</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Opacity — {opacity}%</Label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={opacity}
              onChange={event => setOpacity(Number(event.target.value))}
              className="w-full mt-2"
            />
          </div>
        </div>

        <div className="rounded border border-border/70 p-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">Result</Label>
              <Select value={resultTarget} onValueChange={value => setResultTarget(value as ResultTarget)}>
                <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent className="z-50">
                  <SelectItem value="selection" className="text-[11px]">Selection</SelectItem>
                  <SelectItem value="channel" className="text-[11px]">New Channel</SelectItem>
                  <SelectItem value="document" className="text-[11px]">New Document</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {resultTarget === 'channel' && (
              <div className="space-y-1">
                <Label className="text-[10px]">Channel name</Label>
                <Input
                  value={channelName}
                  onChange={event => setChannelName(event.target.value.slice(0, 120))}
                  placeholder={'Alpha ' + (doc.savedChannels.length + 1)}
                  className="h-8 text-[11px]"
                />
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-[11px] cursor-pointer">
            <Checkbox
              checked={useSelection}
              disabled={!doc.selection}
              onCheckedChange={value => setUseSelection(value === true)}
            />
            Limit result to current selection
            {!doc.selection && <span className="text-muted-foreground">(no active selection)</span>}
          </label>
        </div>

        {differentSizes && (
          <div className="text-[10px] text-amber-500">
            Source dimensions differ from the active document. Channels align at the top-left document origin and clip outside the result bounds.
          </div>
        )}
        {hdrBlocked && (
          <div className="text-[10px] text-amber-500">
            32-bit HDR sources are disabled until Calculations uses scene-linear Float32 blend math instead of display-canvas channel math.
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={calculate} disabled={busy || hdrBlocked}>
          {busy ? 'Calculating…' : 'OK'}
        </Button>
      </DialogFooter>
    </>
  )
}
