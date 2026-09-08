// File IO: open images, place layers, project save/load, export
import { engine } from './engine'
import { useEditorStore } from '../store'
import { fileToCanvas, createCanvas, ctx2d, downloadBlob, canvasToBlob, cloneCanvas } from '../utils/canvas'
import { newLayer } from './document'
import { uid } from '../utils/canvas'
import type { Layer, PsDocument } from '../types'
import { decodeFile, detectFormat } from '../formats'
import type { DecodedImage, ImportFormatId } from '../formats'

/** formats our own codecs handle — everything else prefers the browser
 *  decoder and only falls back to decodeFile when that fails */
const CODEC_FORMATS: readonly ImportFormatId[] = ['tiff', 'psd', 'tga', 'ppm', 'qoi', 'pcx', 'ico']

/** sniff the first 32 bytes — enough for every magic-byte signature we know */
async function sniffFormat(file: File): Promise<ImportFormatId | null> {
  try {
    const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
    return detectFormat(head)
  } catch {
    return null
  }
}

/** decode a file to a single canvas through the full pipeline:
 *  codec formats straight to our decoders, the rest native-first with a
 *  decodeFile fallback (e.g. 16-bit TIFFs the browser can't read) */
async function decodeToCanvas(file: File): Promise<HTMLCanvasElement> {
  const format = await sniffFormat(file)
  if (format && CODEC_FORMATS.includes(format)) return (await decodeFile(file)).canvas
  try {
    return await fileToCanvas(file)
  } catch {
    return (await decodeFile(file)).canvas
  }
}

export async function openFiles(files: File[], asLayer = false) {
  const store = useEditorStore.getState()
  for (const file of files) {
    if (file.name.endsWith('.zproj.json')) { await openProjectFile(file); continue }
    // accept by magic bytes OR declared MIME type (some formats have none)
    const format = await sniffFormat(file)
    if (!format && !file.type.startsWith('image/')) {
      store.pushToast(`Skipped ${file.name} — not an image`, 'error')
      continue
    }
    try {
      // layered PSD → full document rebuild (one raster layer per PSD layer);
      // PSD-as-layer / flat PSD falls through to the composite canvas
      if (!asLayer && format === 'psd') {
        const decoded = await decodeFile(file)
        if (decoded.psdLayers?.length) { addPsdDocument(file.name, decoded); continue }
        engine.addCanvasDocument(decoded.canvas, file.name)
        continue
      }
      const canvas = await decodeToCanvas(file)
      if (asLayer && engine.activeDoc) {
        engine.addLayerFromCanvas(canvas, file.name.replace(/\.[^.]+$/, ''))
      } else {
        engine.addCanvasDocument(canvas, file.name)
      }
    } catch (err) {
      const why = err instanceof Error && err.message ? ` — ${err.message}` : ''
      store.pushToast(`Failed to open ${file.name}${why}`, 'error')
    }
  }
}

/** build a document from decoded PSD layers: one raster layer per PSD
 *  layer, kept in its original rect (canvas-space offsets preserve
 *  off-canvas pixels), with opacity / blend mode / visibility / clipping
 *  / mask carried over. Layers arrive bottom-first = doc order. */
function addPsdDocument(name: string, decoded: DecodedImage): PsDocument {
  const { width, height } = decoded
  const doc: PsDocument = {
    id: uid(), name, width, height,
    layers: [], activeLayerId: null,
    selection: null, channelView: 'rgb', savedChannels: [],
    guides: [],
    view: { zoom: 1, panX: 0, panY: 0 },
    history: { states: [], index: -1 },
    dirty: false, previewFilter: null, previewAdjustment: null,
    _epoch: 1, _stroke: null, _strokeLayerId: null, _strokeErase: false, _strokeOpacity: 1, _strokeBbox: null, _strokeV: 0, _liveDrag: null,
  }
  for (const psd of decoded.psdLayers ?? []) {
    const layer = newLayer('raster', psd.name || 'Layer', width, height)
    // PSD layer canvas = layer rect; register it in canvas space at
    // (left, top) exactly like the engine's native raster offsets
    layer.canvas = psd.canvas
    layer.offsetX = psd.left
    layer.offsetY = psd.top
    layer.opacity = Math.round(psd.opacity)          // 0..100 on both sides
    layer.blendMode = (psd.blendMode || 'normal') as Layer['blendMode']
    layer.visible = psd.visible
    layer.clipped = !!psd.clipped
    if (psd.mask) { layer.mask = psd.mask; layer.maskEnabled = true }
    doc.layers.push(layer as Layer)
  }
  if (!doc.layers.length) {
    // PSD had no decodable layer rects — fall back to the composite
    return engine.addCanvasDocument(decoded.canvas, name)
  }
  doc.activeLayerId = doc.layers[doc.layers.length - 1].id
  engine.docs.push(doc)
  engine.setActiveDocument(doc.id)
  engine.pushHistory('Open PSD', doc)
  engine.emit()
  return doc
}

export async function placeImageAsSmartLayer(file: File) {
  const store = useEditorStore.getState()
  try {
    const canvas = await decodeToCanvas(file)
    engine.placeSmartLayer(canvas, file.name.replace(/\.[^.]+$/, ''))
    store.pushToast(`Placed ${file.name} as Smart Object`, 'success')
  } catch {
    store.pushToast(`Failed to place ${file.name}`, 'error')
  }
}

// ---------- project format ----------
interface SerializedLayer {
  props: Record<string, any>
  canvas?: string    // dataURL
  mask?: string
  source?: string
}

export async function saveProject() {
  const store = useEditorStore.getState()
  const doc = engine.activeDoc
  if (!doc) return
  const toDataURL = (c: HTMLCanvasElement) => c.toDataURL('image/png')
  const layers: SerializedLayer[] = doc.layers.map(l => ({
    props: {
      id: uid(), name: l.name, kind: l.kind, visible: l.visible, opacity: l.opacity,
      blendMode: l.blendMode, locked: l.locked, clipped: l.clipped, maskEnabled: l.maskEnabled,
      transform: l.transform, smartFilters: l.smartFilters,
      adjustment: l.adjustment, text: l.text, shape: l.shape, blendIf: l.blendIf, fx: l.fx,
      offsetX: l.offsetX ?? 0, offsetY: l.offsetY ?? 0, origin: l.origin ?? null,
    },
    canvas: l.canvas ? toDataURL(l.canvas) : undefined,
    mask: l.mask ? toDataURL(l.mask) : undefined,
    source: l.source ? toDataURL(l.source) : undefined,
  }))
  const project = {
    format: 'z-photo-project', version: 1,
    doc: { name: doc.name, width: doc.width, height: doc.height, channelView: doc.channelView, guides: doc.guides ?? [] },
    layers,
  }
  const blob = new Blob([JSON.stringify(project)], { type: 'application/json' })
  downloadBlob(blob, `${doc.name}.zproj.json`)
  store.pushToast('Project saved', 'success')
}

async function dataURLToCanvas(url: string): Promise<HTMLCanvasElement> {
  const img = new Image()
  img.src = url
  await img.decode()
  const c = createCanvas(img.naturalWidth, img.naturalHeight)
  ctx2d(c).drawImage(img, 0, 0)
  return c
}

export async function openProjectFile(file: File) {
  const store = useEditorStore.getState()
  try {
    const text = await file.text()
    const project = JSON.parse(text)
    if (project.format !== 'z-photo-project') throw new Error('bad format')
    const { name, width, height, channelView } = project.doc
    const doc: PsDocument = {
      id: uid(), name, width, height,
      layers: [], activeLayerId: null, selection: null,
      channelView: channelView ?? 'rgb', savedChannels: [],
      guides: Array.isArray(project.doc.guides) ? project.doc.guides : [],
      view: { zoom: 1, panX: 0, panY: 0 },
      history: { states: [], index: -1 },
      dirty: false, previewFilter: null, previewAdjustment: null,
      _epoch: 1, _stroke: null, _strokeLayerId: null, _strokeErase: false, _strokeOpacity: 1, _strokeBbox: null, _strokeV: 0, _liveDrag: null,
    }
    for (const sl of project.layers as SerializedLayer[]) {
      const layer = newLayer(sl.props.kind ?? 'raster', sl.props.name ?? 'Layer', width, height)
      Object.assign(layer, {
        name: sl.props.name, kind: sl.props.kind, visible: sl.props.visible ?? true,
        opacity: sl.props.opacity ?? 100, blendMode: sl.props.blendMode ?? 'normal',
        locked: !!sl.props.locked, clipped: !!sl.props.clipped,
        maskEnabled: sl.props.maskEnabled ?? true,
        transform: sl.props.transform ?? null,
        smartFilters: sl.props.smartFilters ?? [],
        adjustment: sl.props.adjustment ?? null,
        text: sl.props.text ?? null, shape: sl.props.shape ?? null,
        blendIf: sl.props.blendIf ?? null,
        fx: sl.props.fx ?? null,
        offsetX: sl.props.offsetX ?? 0, offsetY: sl.props.offsetY ?? 0,
        origin: sl.props.origin ?? null,
      })
      if (sl.canvas) layer.canvas = await dataURLToCanvas(sl.canvas)
      if (sl.mask) layer.mask = await dataURLToCanvas(sl.mask)
      if (sl.source) layer.source = await dataURLToCanvas(sl.source)
      if (layer.kind === 'raster' && !layer.canvas) layer.canvas = createCanvas(width, height)
      layer._v = 1; layer._mv = 1
      doc.layers.push(layer as Layer)
    }
    if (!doc.layers.length) doc.layers.push(newLayer('raster', 'Layer 1', width, height))
    doc.activeLayerId = doc.layers[doc.layers.length - 1].id
    engine.docs.push(doc)
    engine.setActiveDocument(doc.id)
    engine.pushHistory('Open Project', doc)
    engine.emit()
    store.pushToast(`Project ${name} loaded`, 'success')
  } catch {
    store.pushToast('Could not open project file', 'error')
  }
}
