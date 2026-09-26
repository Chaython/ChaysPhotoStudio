// File IO: open images, place layers, project save/load, export
import { engine } from './engine'
import { useEditorStore } from '../store'
import { fileToCanvas, createCanvas, ctx2d, downloadBlob, uid } from '../utils/canvas'
import { newLayer } from './document'
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

interface DecodedCanvas {
  canvas: HTMLCanvasElement
  sourceBitDepth: number
}

/** Decode a file to a canvas while retaining source precision metadata. The
 * current working raster remains 8-bit; this prevents 16-bit input from being
 * silently presented as a 16-bit editing pipeline. */
async function decodeToCanvas(file: File): Promise<DecodedCanvas> {
  const format = await sniffFormat(file)
  if (format && CODEC_FORMATS.includes(format)) {
    const decoded = await decodeFile(file)
    return { canvas: decoded.canvas, sourceBitDepth: decoded.sourceBitDepth ?? 8 }
  }
  try {
    return { canvas: await fileToCanvas(file), sourceBitDepth: 8 }
  } catch {
    const decoded = await decodeFile(file)
    return { canvas: decoded.canvas, sourceBitDepth: decoded.sourceBitDepth ?? 8 }
  }
}

export async function openFiles(files: File[], asLayer = false) {
  const store = useEditorStore.getState()
  for (const file of files) {
    if (file.name.endsWith('.zproj.json')) { await openProjectFile(file); continue }
    const format = await sniffFormat(file)
    if (!format && !file.type.startsWith('image/')) {
      store.pushToast(`Skipped ${file.name} — not an image`, 'error')
      continue
    }
    try {
      if (!asLayer && format === 'psd') {
        const decoded = await decodeFile(file)
        if (decoded.psdLayers?.length) { addPsdDocument(file.name, decoded); continue }
        engine.addCanvasDocument(decoded.canvas, file.name, { sourceBitDepth: decoded.sourceBitDepth ?? 8 })
        continue
      }
      const decoded = await decodeToCanvas(file)
      if (asLayer && engine.activeDoc) {
        engine.addLayerFromCanvas(decoded.canvas, file.name.replace(/\.[^.]+$/, ''))
        if (decoded.sourceBitDepth > 8) {
          store.pushToast(`${file.name}: ${decoded.sourceBitDepth}-bit source normalized to the current 8-bit working raster`, 'info')
        }
      } else {
        engine.addCanvasDocument(decoded.canvas, file.name, { sourceBitDepth: decoded.sourceBitDepth })
      }
    } catch (err) {
      const why = err instanceof Error && err.message ? ` — ${err.message}` : ''
      store.pushToast(`Failed to open ${file.name}${why}`, 'error')
    }
  }
}

/** build a document from decoded PSD layers */
function addPsdDocument(name: string, decoded: DecodedImage): PsDocument {
  const { width, height } = decoded
  const doc: PsDocument = {
    id: uid(), name, width, height,
    workingBitDepth: 8,
    sourceBitDepth: decoded.sourceBitDepth ?? 8,
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
    doc.layers.push(layer as Layer)
  }
  if (!doc.layers.length) return engine.addCanvasDocument(decoded.canvas, name)
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
    const decoded = await decodeToCanvas(file)
    engine.placeSmartLayer(decoded.canvas, file.name.replace(/\.[^.]+$/, ''))
    if (decoded.sourceBitDepth > 8) {
      store.pushToast(`${file.name}: ${decoded.sourceBitDepth}-bit source is preserved only as an 8-bit smart-object raster today`, 'info')
    }
    store.pushToast(`Placed ${file.name} as Smart Object`, 'success')
  } catch {
    store.pushToast(`Failed to place ${file.name}`, 'error')
  }
}

// ---------- project format ----------
export interface SerializedLayer {
  props: Record<string, any>
  canvas?: string
  mask?: string
  source?: string
}

export interface SerializedProject {
  format: 'z-photo-project'
  version: 1 | 2
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
    workingBitDepth?: 8 | 16
    sourceBitDepth?: number
    workingColorSpace?: 'srgb' | 'display-p3'
    colorSamplers?: { id: string; x: number; y: number }[]
    measurements?: import('../types').SavedMeasurement[]
    savedPaths?: import('../types').SavedPath[]
  }
  layers: SerializedLayer[]
  selection?: { bounds: any; mask: string } | null
  savedChannels?: { id: string; name: string; mask: string }[]
}

const projectHandles = new Map<string, any>()

export function serializeProject(doc: PsDocument): SerializedProject {
  const toDataURL = (c: HTMLCanvasElement) => c.toDataURL('image/png')
  const layers: SerializedLayer[] = doc.layers.map(l => ({
    props: {
      id: l.id, name: l.name, kind: l.kind, visible: l.visible, opacity: l.opacity,
      blendMode: l.blendMode, locked: l.locked, clipped: l.clipped, maskEnabled: l.maskEnabled,
      transform: l.transform, smartFilters: l.smartFilters,
      adjustment: l.adjustment, text: l.text, shape: l.shape, blendIf: l.blendIf, fx: l.fx,
      vectorMask: cloneVectorMask(l.vectorMask),
      offsetX: l.offsetX ?? 0, offsetY: l.offsetY ?? 0, origin: l.origin ?? null,
    },
    canvas: l.canvas ? toDataURL(l.canvas) : undefined,
    mask: l.mask ? toDataURL(l.mask) : undefined,
    source: l.source ? toDataURL(l.source) : undefined,
  }))
  return {
    format: 'z-photo-project', version: 2,
    doc: {
      name: doc.name, width: doc.width, height: doc.height,
      channelView: doc.channelView, guides: doc.guides ?? [], view: { ...doc.view },
      frames: doc.frames ? structuredClone(doc.frames) : undefined, activeLayerId: doc.activeLayerId,
      historyBrushSourceIndex: doc.historyBrushSourceIndex ?? 0,
      workingBitDepth: doc.workingBitDepth ?? 8,
      sourceBitDepth: doc.sourceBitDepth ?? doc.workingBitDepth ?? 8,
      workingColorSpace: doc.workingColorSpace ?? 'srgb',
      colorSamplers: doc.colorSamplers?.map(s => ({ ...s })) ?? [],
      measurements: (doc.measurements ?? []).map(m => ({
        ...m,
        segments: m.segments.map(s => ({ a: { ...s.a }, b: { ...s.b } })),
      })),
      savedPaths: (doc.savedPaths ?? []).map(p => ({ ...p, anchors: p.anchors.map(a => ({ ...a })) })),
    },
    layers,
    selection: doc.selection ? { bounds: { ...doc.selection.bounds }, mask: toDataURL(doc.selection.mask) } : null,
    savedChannels: doc.savedChannels.map(ch => ({ id: ch.id, name: ch.name, mask: toDataURL(ch.mask) })),
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

async function dataURLToCanvas(url: string): Promise<HTMLCanvasElement> {
  const img = new Image()
  img.src = url
  await img.decode()
  const c = createCanvas(img.naturalWidth, img.naturalHeight)
  ctx2d(c).drawImage(img, 0, 0)
  return c
}

export async function openSerializedProject(project: SerializedProject, label = 'Open Project'): Promise<PsDocument> {
  if (project.format !== 'z-photo-project') throw new Error('Unsupported project format')
  const { name, width, height, channelView } = project.doc
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error('Invalid project dimensions')
  const doc: PsDocument = {
    id: uid(), name, width, height,
    // Current editable raster storage is always rgba-unorm8. Preserve a
    // historical/project-reported 16-bit value only as source provenance;
    // never resurrect the old misleading "16-bit working pipeline" claim.
    workingBitDepth: 8,
    sourceBitDepth: Number.isFinite(project.doc.sourceBitDepth)
      ? Number(project.doc.sourceBitDepth)
      : (project.doc.workingBitDepth === 16 ? 16 : 8),
    workingColorSpace: project.doc.workingColorSpace === 'display-p3' ? 'display-p3' : 'srgb',
    layers: [], activeLayerId: null, selection: null,
    channelView: (channelView ?? 'rgb') as PsDocument['channelView'], savedChannels: [],
    guides: Array.isArray(project.doc.guides) ? project.doc.guides : [],
    view: project.doc.view && Number.isFinite(project.doc.view.zoom)
      ? { ...project.doc.view }
      : { zoom: 1, panX: 0, panY: 0 },
    history: { states: [], index: -1 },
    historyBrushSourceIndex: Number.isFinite(project.doc.historyBrushSourceIndex) ? Math.max(0, Math.round(project.doc.historyBrushSourceIndex!)) : 0,
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

  doc.activeLayerId = project.doc.activeLayerId && doc.layers.some(l => l.id === project.doc.activeLayerId)
    ? project.doc.activeLayerId
    : doc.layers[doc.layers.length - 1].id
  engine.docs.push(doc)
  engine.setActiveDocument(doc.id)
  engine.pushHistory(label, doc)
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
