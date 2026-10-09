// File IO: open images, place layers, project save/load, export
import { engine } from './engine'
import { useEditorStore } from '../store'
import { fileToCanvas, createCanvas, ctx2d, downloadBlob, uid, canvasProfile, canvasPixelCapabilities, getFloat16ImageData, putFloat16Pixels, setCanvasWorkingProfile, hdrFloat32ToPreviewCanvas } from '../utils/canvas'
import { newLayer } from './document'
import type { HistoryState, ImageMetadata, Layer, PsDocument, ShapeSpec, TextSpec } from '../types'
import { decodeFile, detectFormat } from '../formats'
import type { DecodedImage, ImportFormatId, ParsedDocumentLayer } from '../formats'
import { hasDedicatedDocumentParser, isPhotopeaPublishedExtension } from '../formats'
import { metadataResolutionPpi, readImageMetadata } from '../formats/metadata'
import { cloneVectorMask, normalizeVectorMask } from './vector-mask'

/** formats our own codecs handle — everything else prefers the browser
 *  decoder and only falls back to decodeFile when that fails */
const CODEC_FORMATS: readonly ImportFormatId[] = ['tiff', 'psd', 'tga', 'ppm', 'pfm', 'hdr', 'qoi', 'pcx', 'ico', 'icns', 'dds', 'iff', 'anim']

/** sniff the first 64 bytes — enough for every magic-byte signature we know */
async function sniffFormat(file: File): Promise<ImportFormatId | null> {
  try {
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
    return detectFormat(head)
  } catch {
    return null
  }
}

interface DecodedCanvas {
  canvas: HTMLCanvasElement
  sourceBitDepth: number
  workingBitDepth: 8 | 16 | 32
  resolutionPpi?: number
  hdrPixels?: Float32Array
}

/** Decode while retaining source precision. Custom high-depth codecs create
 * rgba-float16 canvases when the runtime supports them; otherwise they expose
 * the same file through an 8-bit compatibility preview. */
async function decodeToCanvas(file: File): Promise<DecodedCanvas> {
  const format = await sniffFormat(file)
  if (format && CODEC_FORMATS.includes(format)) {
    const decoded = await decodeFile(file)
    return {
      canvas: decoded.canvas,
      sourceBitDepth: decoded.sourceBitDepth ?? 8,
      workingBitDepth: decoded.sourceFloatPixels && decoded.sourceColorSpace === 'linear-srgb' ? 32 : canvasProfile(decoded.canvas).bitDepth,
      resolutionPpi: decoded.resolutionPpi,
      hdrPixels: decoded.sourceFloatPixels && decoded.sourceColorSpace === 'linear-srgb'
        ? new Float32Array(decoded.sourceFloatPixels)
        : undefined,
    }
  }
  try {
    const canvas = await fileToCanvas(file)
    return { canvas, sourceBitDepth: 8, workingBitDepth: canvasProfile(canvas).bitDepth }
  } catch {
    const decoded = await decodeFile(file)
    return {
      canvas: decoded.canvas,
      sourceBitDepth: decoded.sourceBitDepth ?? 8,
      workingBitDepth: decoded.sourceFloatPixels && decoded.sourceColorSpace === 'linear-srgb' ? 32 : canvasProfile(decoded.canvas).bitDepth,
      resolutionPpi: decoded.resolutionPpi,
      hdrPixels: decoded.sourceFloatPixels && decoded.sourceColorSpace === 'linear-srgb'
        ? new Float32Array(decoded.sourceFloatPixels)
        : undefined,
    }
  }
}

export async function openFiles(files: File[], asLayer = false) {
  const store = useEditorStore.getState()
  for (const file of files) {
    if (file.name.endsWith('.zproj.json')) { await openProjectFile(file); continue }
    const format = await sniffFormat(file)
    if (!format && !file.type.startsWith('image/') && !isPhotopeaPublishedExtension(file.name)) {
      store.pushToast(`Skipped ${file.name} — unsupported file type`, 'error')
      continue
    }
    try {
      const metadata = !asLayer ? await readImageMetadata(file).catch(() => undefined) : undefined
      if (!asLayer && format === 'psd') {
        const decoded = await decodeFile(file)
        if (decoded.psdLayers?.length) { addPsdDocument(file.name, decoded, metadata); continue }
        engine.addCanvasDocument(decoded.canvas, file.name, { sourceBitDepth: decoded.sourceBitDepth ?? 8, workingBitDepth: canvasProfile(decoded.canvas).bitDepth, resolutionPpi: decoded.resolutionPpi ?? metadataResolutionPpi(metadata), metadata })
        continue
      }
      if (!asLayer && hasDedicatedDocumentParser(file.name)) {
        const decoded = await decodeFile(file)
        if (decoded.documentLayers?.length) {
          addStructuredDocument(file.name, decoded, metadata)
          for (const warning of (decoded.warnings ?? []).slice(0, 3)) store.pushToast(warning, 'info')
          if ((decoded.warnings?.length ?? 0) > 3) store.pushToast(`${decoded.warnings!.length - 3} additional import warnings`, 'info')
          continue
        }
      }
      const decoded = await decodeToCanvas(file)
      if (asLayer && engine.activeDoc) {
        engine.addLayerFromCanvas(decoded.canvas, file.name.replace(/\.[^.]+$/, ''), { hdrPixels: engine.activeDoc?.workingBitDepth === 32 ? decoded.hdrPixels : undefined })
        if (decoded.sourceBitDepth > 8) {
          const targetDepth = engine.activeDoc?.workingBitDepth ?? 8
          store.pushToast(`${file.name}: ${decoded.sourceBitDepth}-bit source placed into the ${targetDepth}-bit document`, 'info')
        }
      } else {
        engine.addCanvasDocument(decoded.canvas, file.name, { sourceBitDepth: decoded.sourceBitDepth, workingBitDepth: decoded.workingBitDepth, resolutionPpi: decoded.resolutionPpi ?? metadataResolutionPpi(metadata), hdrPixels: decoded.hdrPixels, metadata })
      }
    } catch (err) {
      // Cancelling the video frame picker is a normal user decision.
      if (err instanceof Error && err.name === 'AbortError') continue
      const why = err instanceof Error && err.message ? ` — ${err.message}` : ''
      store.pushToast(`Failed to open ${file.name}${why}`, 'error')
    }
  }
}

const DEFAULT_TEXT: TextSpec = {
  content: 'Type here', fontFamily: 'Arial', fontSize: 48, color: '#000000',
  bold: false, italic: false, align: 'left', lineHeight: 1.2, tracking: 0, x: 0, y: 48,
}

const DEFAULT_SHAPE: ShapeSpec = {
  shape: 'rect', x: 0, y: 0, w: 100, h: 100, radius: 0,
  fill: '#000000', fillOpacity: 100, stroke: null, strokeWidth: 0, strokeOpacity: 100,
  sides: 5, starInset: 50,
}

function layerFromParsed(parsed: ParsedDocumentLayer, width: number, height: number): Layer | null {
  const kind = parsed.kind
  const layer = newLayer(kind, parsed.name || 'Layer', width, height)
  layer.visible = parsed.visible !== false
  layer.opacity = Math.max(0, Math.min(100, Math.round(Number(parsed.opacity ?? 100))))
  layer.blendMode = (parsed.blendMode || 'normal') as Layer['blendMode']

  if (kind === 'raster') {
    if (!parsed.canvas) return null
    layer.canvas = parsed.canvas
    layer.offsetX = Number(parsed.left) || 0
    layer.offsetY = Number(parsed.top) || 0
  } else if (kind === 'smart') {
    if (!parsed.source && !parsed.canvas) return null
    layer.source = parsed.source ?? parsed.canvas ?? null
    layer.transform = parsed.transform ?? {
      x: (Number(parsed.left) || 0) + (layer.source?.width ?? width) / 2,
      y: (Number(parsed.top) || 0) + (layer.source?.height ?? height) / 2,
      scale: 1, rotation: 0,
    }
  } else if (kind === 'text') {
    if (!parsed.text) return null
    layer.text = { ...DEFAULT_TEXT, ...parsed.text } as TextSpec
  } else if (kind === 'shape') {
    if (!parsed.shape) return null
    layer.shape = { ...DEFAULT_SHAPE, ...parsed.shape } as ShapeSpec
  }
  return layer
}

function addStructuredDocument(name: string, decoded: DecodedImage, metadata?: ImageMetadata): PsDocument {
  const width = Math.max(1, decoded.width), height = Math.max(1, decoded.height)
  const doc: PsDocument = {
    id: uid(), name, width, height,
    resolutionPpi: Math.max(1, Math.min(12000, Number(decoded.resolutionPpi ?? metadataResolutionPpi(metadata)) || 72)),
    workingBitDepth: 8,
    sourceBitDepth: decoded.sourceBitDepth ?? 8,
    workingColorSpace: 'srgb',
    metadata: metadata ? structuredClone(metadata) : undefined,
    layers: [], activeLayerId: null,
    selection: null, channelView: 'rgb', savedChannels: [],
    guides: [],
    view: { zoom: 1, panX: 0, panY: 0 },
    history: { states: [], index: -1 },
    historyBrushSourceIndex: 0,
    dirty: false, previewFilter: null, previewAdjustment: null,
    _epoch: 1, _stroke: null, _strokeLayerId: null, _strokeErase: false, _strokeOpacity: 1, _strokeBlendMode: 'normal', _strokeBbox: null, _strokeV: 0, _liveDrag: null,
  }
  for (const parsed of decoded.documentLayers ?? []) {
    const layer = layerFromParsed(parsed, width, height)
    if (layer) doc.layers.push(layer)
  }
  if (!doc.layers.length) return engine.addCanvasDocument(decoded.canvas, name, {
    sourceBitDepth: decoded.sourceBitDepth ?? 8,
    workingBitDepth: canvasProfile(decoded.canvas).bitDepth,
    resolutionPpi: decoded.resolutionPpi ?? metadataResolutionPpi(metadata),
    metadata,
  })
  doc.activeLayerId = doc.layers[doc.layers.length - 1].id
  engine.docs.push(doc)
  engine.setActiveDocument(doc.id)
  engine.pushHistory(`Open ${decoded.format.toUpperCase()}`, doc)
  engine.maybeCreateAutomaticHistorySnapshot('open', doc)
  engine.emit()
  return doc
}

/** build a document from decoded PSD layers */
function addPsdDocument(name: string, decoded: DecodedImage, metadata?: ImageMetadata): PsDocument {
  const { width, height } = decoded
  const doc: PsDocument = {
    id: uid(), name, width, height,
    resolutionPpi: Math.max(1, Math.min(12000, Number(decoded.resolutionPpi) || 72)),
    workingBitDepth: canvasProfile(decoded.canvas).bitDepth,
    sourceBitDepth: decoded.sourceBitDepth ?? 8,
    psdImageResources: decoded.psdImageResources?.map(bytesToBase64),
    metadata: metadata ? structuredClone(metadata) : undefined,
    workingColorSpace: 'srgb',
    layers: [], activeLayerId: null,
    selection: null, channelView: 'rgb', savedChannels: [],
    guides: [],
    view: { zoom: 1, panX: 0, panY: 0 },
    history: { states: [], index: -1 },
    historyBrushSourceIndex: 0,
    dirty: false, previewFilter: null, previewAdjustment: null,
    _epoch: 1, _stroke: null, _strokeLayerId: null, _strokeErase: false, _strokeOpacity: 1, _strokeBlendMode: 'normal', _strokeBbox: null, _strokeV: 0, _liveDrag: null,
  }
  for (const psd of decoded.psdLayers ?? []) {
    const layer = newLayer('raster', psd.name || 'Layer', width, height)
    layer.canvas = psd.canvas
    layer.offsetX = psd.left
    layer.offsetY = psd.top
    layer.opacity = Math.round(psd.opacity)
    layer.blendMode = (psd.blendMode || 'normal') as Layer['blendMode']
    layer.visible = psd.visible
    layer.clipped = !!psd.clipped
    if (psd.mask) { layer.mask = psd.mask; layer.maskEnabled = true }
    if (psd.fx) layer.fx = structuredClone(psd.fx)
    if (psd.additionalInfo?.length) layer.psdAdditionalInfo = psd.additionalInfo.map(bytesToBase64)
    doc.layers.push(layer as Layer)
  }
  if (!doc.layers.length) return engine.addCanvasDocument(decoded.canvas, name, {
    sourceBitDepth: decoded.sourceBitDepth ?? 8,
    resolutionPpi: decoded.resolutionPpi,
    metadata,
  })
  doc.activeLayerId = doc.layers[doc.layers.length - 1].id
  engine.docs.push(doc)
  engine.setActiveDocument(doc.id)
  engine.pushHistory('Open PSD', doc)
  engine.maybeCreateAutomaticHistorySnapshot('open', doc)
  engine.emit()
  return doc
}

export async function placeImageAsSmartLayer(file: File) {
  const store = useEditorStore.getState()
  try {
    const decoded = await decodeToCanvas(file)
    engine.placeSmartLayer(decoded.canvas, file.name.replace(/\.[^.]+$/, ''))
    if (decoded.sourceBitDepth > 8) {
      store.pushToast(`${file.name}: ${decoded.sourceBitDepth}-bit source placed as a ${decoded.workingBitDepth}-bit smart-object raster`, 'info')
    }
    store.pushToast(`Placed ${file.name} as Smart Object`, 'success')
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return
    store.pushToast(`Failed to place ${file.name}`, 'error')
  }
}

// ---------- project format ----------
interface SerializedFloatCanvas {
  width: number
  height: number
  colorSpace: 'srgb' | 'display-p3'
  data: string
}

interface SerializedHdrCanvas {
  width: number
  height: number
  colorSpace: 'linear-srgb'
  data: string
}

export interface SerializedLayer {
  props: Record<string, any>
  canvas?: string
  canvas16?: SerializedFloatCanvas
  hdr32?: SerializedHdrCanvas
  mask?: string
  source?: string
  source16?: SerializedFloatCanvas
}

interface SerializedHistoryState {
  label: string
  time: number
  width: number
  height: number
  resolutionPpi?: number
  activeLayerId: string | null
  channelView: string
  layers: SerializedLayer[]
  selection?: { bounds: any; mask: string } | null
  savedChannels?: { id: string; name: string; mask: string }[]
  savedPaths?: import('../types').SavedPath[]
}

interface SerializedHistorySnapshot {
  id: string
  name: string
  note?: string
  time: number
  thumbnail?: string
  state: SerializedHistoryState
}

export interface SerializedProject {
  format: 'z-photo-project'
  version: 1 | 2 | 3 | 4 | 5
  doc: {
    name: string
    width: number
    height: number
    channelView?: string
    guides?: any[]
    view?: { zoom: number; panX: number; panY: number }
    frames?: any[]
    activeLayerId?: string | null
    historyBrushSourceIndex?: number
    workingBitDepth?: 8 | 16 | 32
    sourceBitDepth?: number
    workingColorSpace?: 'srgb' | 'display-p3'
    proof?: import('../types').ProofSettings
    resolutionPpi?: number
    psdImageResources?: string[]
    metadata?: ImageMetadata
    colorSamplers?: { id: string; x: number; y: number }[]
    measurements?: import('../types').SavedMeasurement[]
    savedPaths?: import('../types').SavedPath[]
    layerComps?: import('../types').LayerComp[]
    activeLayerCompId?: string | null
    historyBrushSnapshotId?: string | null
    historySnapshotAutoPolicy?: 'inherit' | 'always' | 'never'
  }
  layers: SerializedLayer[]
  selection?: { bounds: any; mask: string } | null
  savedChannels?: { id: string; name: string; mask: string }[]
  historySnapshots?: SerializedHistorySnapshot[]
}

const projectHandles = new Map<string, any>()

function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)))
  }
  return btoa(out)
}

function base64ToBytes(text: string): Uint8Array {
  const raw = atob(text)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function serializeFloatCanvas(c: HTMLCanvasElement | null): SerializedFloatCanvas | undefined {
  if (!c || canvasProfile(c).bitDepth !== 16) return undefined
  const image = getFloat16ImageData(c)
  if (!image?.data?.buffer) return undefined
  const data = image.data
  const bytes = new Uint8Array(data.buffer, data.byteOffset ?? 0, data.byteLength)
  return {
    width: c.width,
    height: c.height,
    colorSpace: canvasProfile(c).colorSpace,
    data: bytesToBase64(bytes),
  }
}

function serializeHdrPixels(l: Layer): SerializedHdrCanvas | undefined {
  if (!l.hdrPixels || !l.canvas) return undefined
  const bytes = new Uint8Array(l.hdrPixels.buffer, l.hdrPixels.byteOffset, l.hdrPixels.byteLength)
  return {
    width: l.canvas.width,
    height: l.canvas.height,
    colorSpace: 'linear-srgb',
    data: bytesToBase64(bytes),
  }
}

function serializeLayer(l: Layer, toDataURL: (c: HTMLCanvasElement) => string): SerializedLayer {
  return {
    props: {
      id: l.id, name: l.name, kind: l.kind, visible: l.visible, opacity: l.opacity,
      blendMode: l.blendMode, locked: l.locked, clipped: l.clipped, maskEnabled: l.maskEnabled,
      transform: l.transform, smartFilters: l.smartFilters,
      adjustment: l.adjustment, text: l.text, shape: l.shape, blendIf: l.blendIf, fx: l.fx,
      vectorMask: cloneVectorMask(l.vectorMask),
      psdAdditionalInfo: Array.isArray(l.psdAdditionalInfo) ? [...l.psdAdditionalInfo] : undefined,
      offsetX: l.offsetX ?? 0, offsetY: l.offsetY ?? 0, origin: l.origin ?? null,
    },
    canvas: l.canvas ? toDataURL(l.canvas) : undefined,
    canvas16: serializeFloatCanvas(l.canvas),
    hdr32: serializeHdrPixels(l),
    mask: l.mask ? toDataURL(l.mask) : undefined,
    source: l.source ? toDataURL(l.source) : undefined,
    source16: serializeFloatCanvas(l.source),
  }
}

function serializeHistoryState(st: HistoryState, toDataURL: (c: HTMLCanvasElement) => string): SerializedHistoryState {
  return {
    label: st.label,
    time: st.time,
    width: st.width,
    height: st.height,
    resolutionPpi: st.resolutionPpi,
    activeLayerId: st.activeLayerId,
    channelView: st.channelView,
    layers: st.layers.map(l => serializeLayer(l, toDataURL)),
    selection: st.selection ? { bounds: { ...st.selection.bounds }, mask: toDataURL(st.selection.mask) } : null,
    savedChannels: st.savedChannels.map(ch => ({ id: ch.id, name: ch.name, mask: toDataURL(ch.mask) })),
    savedPaths: (st.savedPaths ?? []).map(p => ({ ...p, anchors: p.anchors.map(a => ({ ...a })) })),
  }
}

export function serializeProject(doc: PsDocument): SerializedProject {
  const toDataURL = (c: HTMLCanvasElement) => c.toDataURL('image/png')
  const layers: SerializedLayer[] = doc.layers.map(l => serializeLayer(l, toDataURL))
  return {
    format: 'z-photo-project', version: 5,
    doc: {
      name: doc.name, width: doc.width, height: doc.height,
      channelView: doc.channelView, guides: doc.guides ?? [], view: { ...doc.view },
      frames: doc.frames ? structuredClone(doc.frames) : undefined, activeLayerId: doc.activeLayerId,
      historyBrushSourceIndex: doc.historyBrushSourceIndex ?? 0,
      workingBitDepth: doc.workingBitDepth ?? 8,
      sourceBitDepth: doc.sourceBitDepth ?? doc.workingBitDepth ?? 8,
      workingColorSpace: doc.workingColorSpace ?? 'srgb',
      proof: doc.proof ? structuredClone(doc.proof) : undefined,
      resolutionPpi: doc.resolutionPpi ?? 72,
      psdImageResources: doc.psdImageResources ? [...doc.psdImageResources] : undefined,
      metadata: doc.metadata ? structuredClone(doc.metadata) : undefined,
      colorSamplers: doc.colorSamplers?.map(s => ({ ...s })) ?? [],
      measurements: (doc.measurements ?? []).map(m => ({
        ...m,
        segments: m.segments.map(s => ({ a: { ...s.a }, b: { ...s.b } })),
      })),
      savedPaths: (doc.savedPaths ?? []).map(p => ({ ...p, anchors: p.anchors.map(a => ({ ...a })) })),
      layerComps: (doc.layerComps ?? []).map(comp => structuredClone(comp)),
      activeLayerCompId: doc.activeLayerCompId ?? null,
      historyBrushSnapshotId: doc.historyBrushSnapshotId ?? null,
      historySnapshotAutoPolicy: doc.historySnapshotAutoPolicy ?? 'inherit',
    },
    layers,
    selection: doc.selection ? { bounds: { ...doc.selection.bounds }, mask: toDataURL(doc.selection.mask) } : null,
    savedChannels: doc.savedChannels.map(ch => ({ id: ch.id, name: ch.name, mask: toDataURL(ch.mask) })),
    historySnapshots: (doc.historySnapshots ?? []).map(s => ({
      id: s.id,
      name: s.name,
      note: typeof s.note === 'string' && s.note ? s.note : undefined,
      time: s.time,
      thumbnail: typeof s.thumbnail === 'string' ? s.thumbnail : undefined,
      state: serializeHistoryState(s.state, toDataURL),
    })),
  }
}

function projectFileName(doc: PsDocument) {
  const base = doc.name.replace(/\.zproj\.json$/i, '').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled'
  return `${base}.zproj.json`
}

/** Save to the same File System Access handle when available. `saveAs` forces a picker.
 *  Browsers without the API keep the download fallback. */
export async function saveProject(opts: { saveAs?: boolean } = {}) {
  const store = useEditorStore.getState()
  const doc = engine.activeDoc
  if (!doc) return
  const json = JSON.stringify(serializeProject(doc))
  const blob = new Blob([json], { type: 'application/json' })
  const picker = (window as any).showSaveFilePicker as undefined | ((options: any) => Promise<any>)
  try {
    if (picker) {
      let handle = opts.saveAs ? null : projectHandles.get(doc.id)
      if (!handle) {
        handle = await picker({
          suggestedName: projectFileName(doc),
          types: [{ description: "Chay's Photo Studio Project", accept: { 'application/json': ['.zproj.json'] } }],
        })
      }
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      projectHandles.set(doc.id, handle)
    } else {
      downloadBlob(blob, projectFileName(doc))
    }
    doc.dirty = false
    engine.emit()
    window.dispatchEvent(new CustomEvent('chays:project-saved', { detail: doc.id }))
    store.pushToast(opts.saveAs ? 'Project saved as new file' : 'Project saved', 'success')
  } catch (err: any) {
    if (err?.name === 'AbortError') return
    store.pushToast(`Project save failed${err?.message ? ` — ${err.message}` : ''}`, 'error')
  }
}

async function dataURLToCanvas(url: string, hi?: SerializedFloatCanvas): Promise<HTMLCanvasElement> {
  const img = new Image()
  img.src = url
  await img.decode()
  const profile = hi ? { bitDepth: 16 as const, colorSpace: hi.colorSpace } : { bitDepth: 8 as const, colorSpace: 'srgb' as const }
  const c = createCanvas(img.naturalWidth, img.naturalHeight, profile)
  ctx2d(c).drawImage(img, 0, 0)
  if (hi && hi.width === c.width && hi.height === c.height) {
    const Float16 = (globalThis as any).Float16Array
    if (typeof Float16 === 'function') {
      try {
        const bytes = base64ToBytes(hi.data)
        const aligned = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer
        putFloat16Pixels(c, new Float16(aligned), hi.colorSpace)
      } catch { /* keep PNG compatibility preview */ }
    }
  }
  return c
}

async function deserializeHistoryLayer(sl: SerializedLayer, width: number, height: number): Promise<Layer> {
  const layer = newLayer(sl.props.kind ?? 'raster', sl.props.name ?? 'Layer', width, height)
  layer.id = typeof sl.props.id === 'string' && sl.props.id ? sl.props.id : uid()
  Object.assign(layer, {
    name: sl.props.name, kind: sl.props.kind, visible: sl.props.visible ?? true,
    opacity: sl.props.opacity ?? 100, blendMode: sl.props.blendMode ?? 'normal',
    locked: !!sl.props.locked, clipped: !!sl.props.clipped,
    maskEnabled: sl.props.maskEnabled ?? true,
    transform: sl.props.transform ?? null,
    smartFilters: sl.props.smartFilters ?? [],
    adjustment: sl.props.adjustment ?? null,
    text: sl.props.text ?? null, shape: sl.props.shape ? { sides: 5, starInset: 45, ...sl.props.shape } : null,
    blendIf: sl.props.blendIf ?? null,
    fx: sl.props.fx ?? null,
    vectorMask: normalizeVectorMask(sl.props.vectorMask),
    psdAdditionalInfo: Array.isArray(sl.props.psdAdditionalInfo) ? sl.props.psdAdditionalInfo.filter((v: unknown) => typeof v === 'string') : undefined,
    offsetX: sl.props.offsetX ?? 0, offsetY: sl.props.offsetY ?? 0,
    origin: sl.props.origin ?? null,
  })
  if (sl.canvas) layer.canvas = await dataURLToCanvas(sl.canvas, sl.canvas16)
  if (sl.hdr32?.data && sl.hdr32.width > 0 && sl.hdr32.height > 0) {
    try {
      const bytes = base64ToBytes(sl.hdr32.data)
      const copy = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer
      const hdr = new Float32Array(copy)
      if (hdr.length === sl.hdr32.width * sl.hdr32.height * 4) {
        layer.hdrPixels = new Float32Array(hdr)
        layer.hdrColorSpace = 'linear-srgb'
        layer.canvas = hdrFloat32ToPreviewCanvas(layer.hdrPixels, sl.hdr32.width, sl.hdr32.height, 'srgb')
      }
    } catch { /* keep PNG/float16 compatibility canvas */ }
  }
  if (sl.mask) layer.mask = await dataURLToCanvas(sl.mask)
  if (sl.source) layer.source = await dataURLToCanvas(sl.source, sl.source16)
  if (layer.kind === 'raster' && !layer.canvas) layer.canvas = createCanvas(width, height)
  layer._v = 1
  layer._mv = 1
  return layer
}

async function deserializeHistoryState(st: SerializedHistoryState): Promise<HistoryState> {
  const width = Math.max(1, Math.round(Number(st.width) || 1))
  const height = Math.max(1, Math.round(Number(st.height) || 1))
  const selection = st.selection?.mask
    ? {
        bounds: st.selection.bounds,
        mask: await dataURLToCanvas(st.selection.mask),
        _v: 1, _pathsV: -1, _paths: null,
      }
    : null
  const savedChannels: HistoryState['savedChannels'] = []
  for (const ch of st.savedChannels ?? []) {
    if (!ch?.mask) continue
    savedChannels.push({ id: ch.id || uid(), name: ch.name || 'Channel', mask: await dataURLToCanvas(ch.mask), _v: 1 })
  }
  const layers: Layer[] = []
  for (const sl of st.layers ?? []) layers.push(await deserializeHistoryLayer(sl, width, height))
  return {
    label: st.label || 'Snapshot',
    time: Number.isFinite(st.time) ? st.time : Date.now(),
    layers,
    activeLayerId: st.activeLayerId ?? null,
    selection,
    width,
    height,
    resolutionPpi: Number.isFinite(st.resolutionPpi) ? Math.max(1, Number(st.resolutionPpi)) : 72,
    channelView: (st.channelView ?? 'rgb') as HistoryState['channelView'],
    savedChannels,
    savedPaths: Array.isArray(st.savedPaths)
      ? st.savedPaths.map(p => ({ ...p, anchors: p.anchors.map(a => ({ ...a })) }))
      : [],
  }
}

export async function openSerializedProject(project: SerializedProject, label = 'Open Project'): Promise<PsDocument> {
  if (project.format !== 'z-photo-project') throw new Error('Unsupported project format')
  const { name, width, height, channelView } = project.doc
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error('Invalid project dimensions')
  const caps = canvasPixelCapabilities()
  const requestedDepth = project.doc.workingBitDepth === 32 ? 32 : project.doc.workingBitDepth === 16 ? 16 : 8
  const physicalDepth: 8 | 16 = requestedDepth !== 8 && caps.float16Context && caps.float16ImageData ? 16 : 8
  setCanvasWorkingProfile({
    bitDepth: physicalDepth,
    colorSpace: requestedDepth === 32 ? 'srgb' : (project.doc.workingColorSpace === 'display-p3' && caps.displayP3 ? 'display-p3' : 'srgb'),
  })
  const doc: PsDocument = {
    id: uid(), name, width, height,
    workingBitDepth: requestedDepth === 32 ? 32 : physicalDepth,
    sourceBitDepth: Number.isFinite(project.doc.sourceBitDepth)
      ? Number(project.doc.sourceBitDepth)
      : (project.doc.workingBitDepth === 32 ? 32 : project.doc.workingBitDepth === 16 ? 16 : 8),
    psdImageResources: Array.isArray(project.doc.psdImageResources)
      ? project.doc.psdImageResources.filter((v: unknown) => typeof v === 'string')
      : undefined,
    metadata: project.doc.metadata && typeof project.doc.metadata === 'object'
      ? structuredClone(project.doc.metadata)
      : undefined,
    workingColorSpace: requestedDepth === 32 ? 'srgb' : (project.doc.workingColorSpace === 'display-p3' && canvasPixelCapabilities().displayP3 ? 'display-p3' : 'srgb'),
    proof: project.doc.proof && typeof project.doc.proof === 'object' ? structuredClone(project.doc.proof) : undefined,
    resolutionPpi: Math.max(1, Math.min(12000, Number(project.doc.resolutionPpi) || 72)),
    layers: [], activeLayerId: null, selection: null,
    channelView: (channelView ?? 'rgb') as PsDocument['channelView'], savedChannels: [],
    guides: Array.isArray(project.doc.guides) ? project.doc.guides : [],
    view: project.doc.view && Number.isFinite(project.doc.view.zoom)
      ? { ...project.doc.view }
      : { zoom: 1, panX: 0, panY: 0 },
    history: { states: [], index: -1 },
    historyBrushSourceIndex: Number.isFinite(project.doc.historyBrushSourceIndex) ? Math.max(0, Math.round(project.doc.historyBrushSourceIndex!)) : 0,
    historySnapshots: [],
    historySnapshotAutoPolicy:
      project.doc.historySnapshotAutoPolicy === 'always' || project.doc.historySnapshotAutoPolicy === 'never'
        ? project.doc.historySnapshotAutoPolicy
        : 'inherit',
    historyBrushSnapshotId: typeof project.doc.historyBrushSnapshotId === 'string' ? project.doc.historyBrushSnapshotId : null,
    layerComps: Array.isArray(project.doc.layerComps)
      ? project.doc.layerComps
          .filter(c => c && typeof c.id === 'string' && typeof c.name === 'string' && c.layers && typeof c.layers === 'object')
          .map(c => structuredClone(c))
      : [],
    activeLayerCompId: typeof project.doc.activeLayerCompId === 'string' ? project.doc.activeLayerCompId : null,
    colorSamplers: Array.isArray(project.doc.colorSamplers)
      ? project.doc.colorSamplers
          .filter(s => s && Number.isFinite(s.x) && Number.isFinite(s.y))
          .slice(0, 10)
          .map(s => ({ id: typeof s.id === 'string' ? s.id : uid(), x: Number(s.x), y: Number(s.y) }))
      : [],
    measurements: Array.isArray(project.doc.measurements)
      ? project.doc.measurements
          .filter(m => m && Array.isArray(m.segments))
          .map(m => {
            const unit: import('../types').SavedMeasurement['unit'] =
              m.unit === 'mm' || m.unit === 'cm' || m.unit === 'in' ? m.unit : 'px'
            const segments = m.segments
              .filter((s: any) => s?.a && s?.b && Number.isFinite(s.a.x) && Number.isFinite(s.a.y) && Number.isFinite(s.b.x) && Number.isFinite(s.b.y))
              .map((s: any) => ({
                a: { x: Number(s.a.x), y: Number(s.a.y) },
                b: { x: Number(s.b.x), y: Number(s.b.y) },
              }))
            return {
              id: typeof m.id === 'string' && m.id ? m.id : uid(),
              name: typeof m.name === 'string' && m.name ? m.name : 'Measurement',
              segments,
              unit,
              pixelsPerUnit: Math.max(.001, Number(m.pixelsPerUnit) || 1),
              totalLengthPx: segments.reduce((sum: number, s: any) => sum + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), 0),
              createdAt: Number.isFinite(m.createdAt) ? Number(m.createdAt) : Date.now(),
            }
          })
          .filter(m => m.segments.length > 0)
      : [],
    savedPaths: Array.isArray(project.doc.savedPaths)
      ? project.doc.savedPaths
          .filter(p => p && Array.isArray(p.anchors))
          .map(p => ({
            id: typeof p.id === 'string' && p.id ? p.id : uid(),
            name: typeof p.name === 'string' && p.name ? p.name : 'Path',
            closed: !!p.closed,
            visible: p.visible !== false,
            anchors: p.anchors
              .filter(a => a && Number.isFinite(a.x) && Number.isFinite(a.y))
              .map(a => ({
                x: Number(a.x), y: Number(a.y),
                inX: Number(a.inX) || 0, inY: Number(a.inY) || 0,
                outX: Number(a.outX) || 0, outY: Number(a.outY) || 0,
                pair: a.pair !== false,
              })),
          }))
      : [],
    dirty: false, previewFilter: null, previewAdjustment: null,
    frames: Array.isArray(project.doc.frames) ? structuredClone(project.doc.frames) : undefined,
    _epoch: 1, _stroke: null, _strokeLayerId: null, _strokeErase: false, _strokeOpacity: 1, _strokeBlendMode: 'normal', _strokeBbox: null, _strokeV: 0, _liveDrag: null,
  }
  const layerIds = new Set<string>()
  for (const sl of project.layers ?? []) {
    const layer = newLayer(sl.props.kind ?? 'raster', sl.props.name ?? 'Layer', width, height)
    const requestedId = typeof sl.props.id === 'string' && sl.props.id ? sl.props.id : layer.id
    layer.id = layerIds.has(requestedId) ? uid() : requestedId
    layerIds.add(layer.id)
    Object.assign(layer, {
      name: sl.props.name, kind: sl.props.kind, visible: sl.props.visible ?? true,
      opacity: sl.props.opacity ?? 100, blendMode: sl.props.blendMode ?? 'normal',
      locked: !!sl.props.locked, clipped: !!sl.props.clipped,
      maskEnabled: sl.props.maskEnabled ?? true,
      transform: sl.props.transform ?? null,
      smartFilters: sl.props.smartFilters ?? [],
      adjustment: sl.props.adjustment ?? null,
      text: sl.props.text ?? null, shape: sl.props.shape ? { sides: 5, starInset: 45, ...sl.props.shape } : null,
      blendIf: sl.props.blendIf ?? null,
      fx: sl.props.fx ?? null,
      vectorMask: normalizeVectorMask(sl.props.vectorMask),
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

  if (project.selection?.mask) {
    doc.selection = {
      bounds: project.selection.bounds,
      mask: await dataURLToCanvas(project.selection.mask),
      _v: 1, _pathsV: -1, _paths: null,
    }
  }
  if (Array.isArray(project.savedChannels)) {
    for (const ch of project.savedChannels) {
      if (!ch?.mask) continue
      doc.savedChannels.push({ id: ch.id || uid(), name: ch.name || 'Channel', mask: await dataURLToCanvas(ch.mask), _v: 1 })
    }
  }

  if (Array.isArray(project.historySnapshots)) {
    for (const raw of project.historySnapshots.slice(0, 20)) {
      if (!raw?.state || typeof raw.id !== 'string') continue
      try {
        doc.historySnapshots!.push({
          id: raw.id || uid(),
          name: typeof raw.name === 'string' && raw.name ? raw.name : 'Snapshot',
          note: typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim().slice(0, 2000) : undefined,
          time: Number.isFinite(raw.time) ? raw.time : Date.now(),
          thumbnail: typeof raw.thumbnail === 'string' && raw.thumbnail.startsWith('data:image/') ? raw.thumbnail : undefined,
          state: await deserializeHistoryState(raw.state),
        })
      } catch {
        // A corrupt snapshot should not prevent the rest of the project from opening.
      }
    }
  }
  if (doc.historyBrushSnapshotId && !doc.historySnapshots?.some(s => s.id === doc.historyBrushSnapshotId)) {
    doc.historyBrushSnapshotId = null
  }

  doc.activeLayerId = project.doc.activeLayerId && doc.layers.some(l => l.id === project.doc.activeLayerId)
    ? project.doc.activeLayerId
    : doc.layers[doc.layers.length - 1].id
  engine.docs.push(doc)
  engine.setActiveDocument(doc.id)
  engine.pushHistory(label, doc)
  engine.maybeCreateAutomaticHistorySnapshot('open', doc)
  doc.dirty = false
  engine.emit()
  return doc
}

export async function openProjectFile(file: File) {
  const store = useEditorStore.getState()
  try {
    const project = JSON.parse(await file.text()) as SerializedProject
    const doc = await openSerializedProject(project)
    store.pushToast(`Project ${doc.name} loaded`, 'success')
  } catch (err) {
    const why = err instanceof Error && err.message ? ` — ${err.message}` : ''
    store.pushToast(`Could not open project file${why}`, 'error')
  }
}

/** Photoshop-style File > New from Clipboard. */
export async function newDocumentFromClipboard(): Promise<boolean> {
  const store = useEditorStore.getState()
  try {
    if (!navigator.clipboard?.read) throw new Error('Clipboard image access is not supported by this browser')
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'))
      if (!type) continue
      const blob = await item.getType(type)
      const canvas = await fileToCanvas(blob)
      engine.addCanvasDocument(canvas, 'Clipboard')
      store.pushToast('Created a new document from the clipboard', 'success')
      return true
    }
    store.pushToast('The clipboard does not contain an image', 'info')
  } catch (err) {
    store.pushToast(err instanceof Error ? err.message : 'Could not read the clipboard', 'error')
  }
  return false
}
