'use client'
// GIMP-style Metadata handling
// EXIF, XMP, IPTC, GIMP parasites, PNG text chunks

export interface ExifData {
  // IFD0
  make?: string
  model?: string
  orientation?: number
  xResolution?: number
  yResolution?: number
  resolutionUnit?: number
  software?: string
  dateTime?: string
  artist?: string
  copyright?: string
  // ExifSubIFD
  exposureTime?: number
  fNumber?: number
  exposureProgram?: number
  isoSpeedRatings?: number
  exifVersion?: string
  dateTimeOriginal?: string
  dateTimeDigitized?: string
  componentsConfiguration?: number[]
  compressedBitsPerPixel?: number
  shutterSpeedValue?: number
  apertureValue?: number
  brightnessValue?: number
  exposureBiasValue?: number
  maxApertureValue?: number
  subjectDistance?: number
  meteringMode?: number
  lightSource?: number
  flash?: number
  focalLength?: number
  makerNote?: Uint8Array
  userComment?: string
  subSecTime?: string
  subSecTimeOriginal?: string
  subSecTimeDigitized?: string
  flashpixVersion?: string
  colorSpace?: number
  pixelXDimension?: number
  pixelYDimension?: number
  relatedSoundFile?: string
  interoperabilityIFD?: any
  flashEnergy?: number
  spatialFrequencyResponse?: Uint8Array
  focalPlaneXResolution?: number
  focalPlaneYResolution?: number
  focalPlaneResolutionUnit?: number
  subjectLocation?: number[]
  exposureIndex?: number
  sensingMethod?: number
  fileSource?: number
  sceneType?: number
  cfaPattern?: Uint8Array
  customRendered?: number
  exposureMode?: number
  whiteBalance?: number
  digitalZoomRatio?: number
  focalLengthIn35mmFilm?: number
  sceneCaptureType?: number
  gainControl?: number
  contrast?: number
  saturation?: number
  sharpness?: number
  deviceSettingDescription?: Uint8Array
  subjectDistanceRange?: number
  imageUniqueID?: string
  cameraOwnerName?: string
  bodySerialNumber?: string
  lensSpecification?: number[]
  lensMake?: string
  lensModel?: string
  lensSerialNumber?: string
  // GPS
  gpsLatitudeRef?: string
  gpsLatitude?: number[]
  gpsLongitudeRef?: string
  gpsLongitude?: number[]
  gpsAltitudeRef?: number
  gpsAltitude?: number
  gpsTimeStamp?: number[]
  gpsSatellites?: string
  gpsStatus?: string
  gpsMeasureMode?: string
  gpsDOP?: number
  gpsSpeedRef?: string
  gpsSpeed?: number
  gpsTrackRef?: string
  gpsTrack?: number
  gpsImgDirectionRef?: string
  gpsImgDirection?: number
  gpsMapDatum?: string
  gpsDestLatitudeRef?: string
  gpsDestLatitude?: number[]
  gpsDestLongitudeRef?: string
  gpsDestLongitude?: number[]
  gpsDestBearingRef?: string
  gpsDestBearing?: number
  gpsDestDistanceRef?: string
  gpsDestDistance?: number
  gpsProcessingMethod?: string
  gpsAreaInformation?: string
  gpsDateStamp?: string
  gpsDifferential?: number
}

export interface IptcData {
  // Envelope record
  modelVersion?: number
  destination?: string
  fileFormat?: number
  fileFormatVersion?: number
  serviceIdentifier?: string
  envelopeNumber?: number
  productID?: string
  envelopePriority?: number
  dateSent?: string
  timeSent?: string
  coderEncoder?: string
  // Application record
  objectTypeReference?: string
  objectName?: string
  editStatus?: string
  editorialUpdate?: string
  urgency?: number
  subjectReference?: string
  category?: string
  supplementalCategory?: string[]
  fixtureIdentifier?: string
  keywords?: string[]
  contentLocationCode?: string
  contentLocationName?: string
  releaseDate?: string
  releaseTime?: string
  expirationDate?: string
  expirationTime?: string
  specialInstructions?: string
  actionAdvised?: number
  referenceService?: string
  referenceDate?: string
  referenceNumber?: string
  dateCreated?: string
  timeCreated?: string
  digitalCreationDate?: string
  digitalCreationTime?: string
  originatingProgram?: string
  programVersion?: string
  objectCycle?: string
  byline?: string
  bylineTitle?: string
  city?: string
  subLocation?: string
  provinceState?: string
  countryName?: string
  countryCode?: string
  originalTransmissionReference?: string
  headline?: string
  credit?: string
  source?: string
  copyrightNotice?: string
  contact?: string
  abstract?: string
  writerEditor?: string
  rasterizedCaption?: string
  imageType?: string
  imageOrientation?: number
  languageIdentifier?: string
  audioType?: string
  audioSamplingRate?: number
  audioSamplingResolution?: number
  audioDuration?: number
  audioOutcue?: string
  jobID?: string
  masterDocumentID?: string
  shortDocumentID?: string
  uniqueDocumentID?: string
  ownerID?: string
  preferred?: string
  prefs?: any
  classifier?: string
  instanceID?: string
}

export interface XmpData {
  // Dublin Core
  title?: string[]
  creator?: string[]
  subject?: string[]
  description?: string[]
  publisher?: string[]
  contributor?: string[]
  date?: string[]
  type?: string[]
  format?: string[]
  identifier?: string[]
  source?: string[]
  language?: string[]
  relation?: string[]
  coverage?: string[]
  rights?: string[]
  // Photoshop
  authorsPosition?: string
  captionWriter?: string
  category?: string
  city?: string
  country?: string
  credit?: string
  dateCreated?: string
  headline?: string
  instructions?: string
  source?: string
  state?: string
  transmissionReference?: string
  urgency?: number
  // IPTC Core
  creatorTool?: string
  metadataDate?: string
  rating?: number
  label?: string
  // XMP Rights
  copyrightOwner?: string
  copyrightOwnerID?: string
  usageTerms?: string
  webStatement?: string
  // Camera Raw
  crsVersion?: string
  crsHasSettings?: boolean
  crsHasCrop?: boolean
  crsAlreadyApplied?: boolean
  // Custom
  [key: string]: any
}

export interface GimpParasite {
  name: string
  flags: number
  data: Uint8Array
}

export interface ImageMetadata {
  exif?: ExifData
  iptc?: IptcData
  xmp?: XmpData
  parasites?: GimpParasite[]
  pngText?: Record<string, string>
  iccProfile?: ArrayBuffer
  resolution?: { x: number; y: number; unit: 'inches' | 'cm' | 'none' }
  colorSpace?: string
  orientation?: number
  comment?: string
}

// ============================================================
// EXIF parsing
// ============================================================

function readU16(data: DataView, offset: number, littleEndian: boolean): number {
  return data.getUint16(offset, littleEndian)
}
function readU32(data: DataView, offset: number, littleEndian: boolean): number {
  return data.getUint32(offset, littleEndian)
}
function readString(data: DataView, offset: number, length: number): string {
  return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset + offset, length)).replace(/\0.*$/, '')
}

export function parseExif(buf: ArrayBuffer): ExifData | null {
  const data = new DataView(buf)
  if (buf.byteLength < 8) return null

  // Check for JPEG APP1 marker (0xFFE1) or raw EXIF
  let offset = 0
  if (data.getUint16(0) === 0xFFE1) {
    offset = 4 + data.getUint16(2) - 2 // Skip APP1 marker and length
  }

  // Check for "Exif\0\0"
  if (readString(data, offset, 6) !== 'Exif\0\0') return null
  offset += 6

  // TIFF header
  const littleEndian = readU16(data, offset, true) === 0x4949 // "II"
  offset += 2
  if (readU16(data, offset, littleEndian) !== 0x002A) return null // Magic number 42
  offset += 2
  const ifd0Offset = readU32(data, offset, littleEndian)
  offset += ifd0Offset

  const result: ExifData = {}

  function parseIFD(ifdOffset: number) {
    const numEntries = readU16(data, ifdOffset, littleEndian)
    let entryOffset = ifdOffset + 2
    for (let i = 0; i < numEntries; i++) {
      const tag = readU16(data, entryOffset, littleEndian)
      const type = readU16(data, entryOffset + 2, littleEndian)
      const count = readU32(data, entryOffset + 4, littleEndian)
      const valueOffset = readU32(data, entryOffset + 8, littleEndian)
      entryOffset += 12

      // Simplified tag reading - would need full implementation
      const tagNames: Record<number, keyof ExifData> = {
        0x010F: 'make',
        0x0110: 'model',
        0x0112: 'orientation',
        0x011A: 'xResolution',
        0x011B: 'yResolution',
        0x0128: 'resolutionUnit',
        0x0131: 'software',
        0x0132: 'dateTime',
        0x013B: 'artist',
        0x8298: 'copyright',
        // ExifSubIFD tags
        0x829A: 'exposureTime',
        0x829D: 'fNumber',
        0x8822: 'exposureProgram',
        0x8827: 'isoSpeedRatings',
        0x9000: 'exifVersion',
        0x9003: 'dateTimeOriginal',
        0x9004: 'dateTimeDigitized',
        0x9101: 'componentsConfiguration',
        0x9102: 'compressedBitsPerPixel',
        0x9201: 'shutterSpeedValue',
        0x9202: 'apertureValue',
        0x9203: 'brightnessValue',
        0x9204: 'exposureBiasValue',
        0x9205: 'maxApertureValue',
        0x9206: 'subjectDistance',
        0x9207: 'meteringMode',
        0x9208: 'lightSource',
        0x9209: 'flash',
        0x920A: 'focalLength',
        0x927C: 'makerNote',
        0x9286: 'userComment',
        0x9290: 'subSecTime',
        0x9291: 'subSecTimeOriginal',
        0x9292: 'subSecTimeDigitized',
        0xA000: 'flashpixVersion',
        0xA001: 'colorSpace',
        0xA002: 'pixelXDimension',
        0xA003: 'pixelYDimension',
        0xA004: 'relatedSoundFile',
        0xA20B: 'flashEnergy',
        0xA20C: 'spatialFrequencyResponse',
        0xA20E: 'focalPlaneXResolution',
        0xA20F: 'focalPlaneYResolution',
        0xA210: 'focalPlaneResolutionUnit',
        0xA214: 'subjectLocation',
        0xA215: 'exposureIndex',
        0xA217: 'sensingMethod',
        0xA300: 'fileSource',
        0xA301: 'sceneType',
        0xA302: 'cfaPattern',
        0xA401: 'customRendered',
        0xA402: 'exposureMode',
        0xA403: 'whiteBalance',
        0xA404: 'digitalZoomRatio',
        0xA405: 'focalLengthIn35mmFilm',
        0xA406: 'sceneCaptureType',
        0xA407: 'gainControl',
        0xA408: 'contrast',
        0xA409: 'saturation',
        0xA40A: 'sharpness',
        0xA40B: 'deviceSettingDescription',
        0xA40C: 'subjectDistanceRange',
        0xA420: 'imageUniqueID',
        0xA430: 'cameraOwnerName',
        0xA431: 'bodySerialNumber',
        0xA432: 'lensSpecification',
        0xA433: 'lensMake',
        0xA434: 'lensModel',
        0xA435: 'lensSerialNumber',
      }
      const key = tagNames[tag]
      if (key) {
        // Simplified value reading
        if (type === 2) { // ASCII
          (result as any)[key] = readString(data, valueOffset, count)
        } else if (type === 3) { // SHORT
          (result as any)[key] = readU16(data, valueOffset, littleEndian)
        } else if (type === 4) { // LONG
          (result as any)[key] = readU32(data, valueOffset, littleEndian)
        } else if (type === 5) { // RATIONAL
          const num = readU32(data, valueOffset, littleEndian)
          const den = readU32(data, valueOffset + 4, littleEndian)
          (result as any)[key] = num / den
        }
      }
    }
  }

  parseIFD(offset)
  return result
}

// ============================================================
// XMP parsing
// ============================================================

export function parseXmp(buf: ArrayBuffer): XmpData | null {
  const text = new TextDecoder().decode(buf)
  const xmpStart = text.indexOf('<x:xmpmeta')
  const xmpEnd = text.indexOf('</x:xmpmeta>')
  if (xmpStart < 0 || xmpEnd < 0) return null

  const xmpText = text.slice(xmpStart, xmpEnd + 12)
  const result: XmpData = {}

  // Simple regex-based extraction (would use DOM parser in real impl)
  const dcPattern = /<dc:(\w+)>(.*?)<\/dc:\1>/g
  let match
  while ((match = dcPattern.exec(xmpText)) !== null) {
    const key = match[1]
    const value = match[2]
    if (!result[key as keyof XmpData]) (result as any)[key] = []
    ;(result as any)[key].push(value)
  }

  // Photoshop namespace
  const psPattern = /<photoshop:(\w+)>(.*?)<\/photoshop:\1>/g
  while ((match = psPattern.exec(xmpText)) !== null) {
    const key = 'ps' + match[1].charAt(0).toUpperCase() + match[1].slice(1)
    ;(result as any)[key] = match[2]
  }

  return result
}

// ============================================================
// PNG text chunks
// ============================================================

export function parsePngTextChunks(buf: ArrayBuffer): Record<string, string> {
  const data = new DataView(buf)
  if (data.getUint32(0) !== 0x89504E47) return {} // PNG signature

  const result: Record<string, string> = {}
  let offset = 8

  while (offset < data.byteLength - 12) {
    const length = data.getUint32(offset)
    const type = String.fromCharCode(...new Uint8Array(buf, offset + 4, 4))
    offset += 8

    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const chunkData = new Uint8Array(buf, offset, length)
      let keyword = ''
      let text = ''
      let langTag = ''
      let translatedKeyword = ''

      if (type === 'tEXt') {
        const nullIdx = chunkData.indexOf(0)
        keyword = new TextDecoder().decode(chunkData.slice(0, nullIdx))
        text = new TextDecoder().decode(chunkData.slice(nullIdx + 1))
      } else if (type === 'zTXt') {
        const nullIdx = chunkData.indexOf(0)
        keyword = new TextDecoder().decode(chunkData.slice(0, nullIdx))
        const compression = chunkData[nullIdx + 1]
        // Would need zlib decompression
        text = '(compressed)'
      } else if (type === 'iTXt') {
        // International text - more complex
        keyword = 'iTXt'
        text = '(international)'
      }
      if (keyword) result[keyword] = text
    }

    offset += length + 4 // length + CRC
    if (type === 'IEND') break
  }

  return result
}

// ============================================================
// GIMP Parasites
// ============================================================

export function parseGimpParasites(buf: ArrayBuffer): GimpParasite[] {
  const data = new DataView(buf)
  const parasites: GimpParasite[] = []

  // XCF parasites are stored in the layer hierarchy
  // This is a simplified parser for standalone parasite data
  let offset = 0
  while (offset < data.byteLength - 8) {
    const nameLen = data.getUint32(offset)
    offset += 4
    if (nameLen > 256 || offset + nameLen > data.byteLength) break
    const name = new TextDecoder().decode(new Uint8Array(buf, offset, nameLen))
    offset += nameLen
    const flags = data.getUint32(offset)
    offset += 4
    const dataLen = data.getUint32(offset)
    offset += 4
    if (offset + dataLen > data.byteLength) break
    const parasiteData = new Uint8Array(buf, offset, dataLen)
    offset += dataLen
    parasites.push({ name, flags, data: parasiteData })
  }
  return parasites
}

// ============================================================
// Metadata serialization
// ============================================================

export function serializeExif(exif: ExifData): ArrayBuffer {
  // Would write full TIFF/EXIF structure
  return new ArrayBuffer(0)
}

export function serializeXmp(xmp: XmpData): string {
  let xml = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
  xml += '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="GIMP">\n'
  xml += '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'
  xml += '    <rdf:Description rdf:about="">\n'

  // Dublin Core
  for (const [key, value] of Object.entries(xmp)) {
    if (Array.isArray(value)) {
      xml += `      <dc:${key}>\n`
      xml += '        <rdf:Bag>\n'
      for (const v of value) {
        xml += `          <rdf:li>${escapeXml(v)}</rdf:li>\n`
      }
      xml += '        </rdf:Bag>\n'
      xml += `      </dc:${key}>\n`
    } else if (typeof value === 'string' && !key.startsWith('ps') && !key.startsWith('crs')) {
      xml += `      <dc:${key}>${escapeXml(value)}</dc:${key}>\n`
    }
  }

  xml += '    </rdf:Description>\n'
  xml += '  </rdf:RDF>\n'
  xml += '</x:xmpmeta>\n'
  xml += '<?xpacket end="w"?>'
  return xml
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, '&apos;')
}

// ============================================================
// Metadata embedding in output formats
// ============================================================

export interface MetadataExportOptions {
  includeExif: boolean
  includeIptc: boolean
  includeXmp: boolean
  includeIcc: boolean
  includeParasites: boolean
  stripGps: boolean
  stripPersonal: boolean
}

export const DEFAULT_METADATA_OPTIONS: MetadataExportOptions = {
  includeExif: true,
  includeIptc: true,
  includeXmp: true,
  includeIcc: true,
  includeParasites: false,
  stripGps: false,
  stripPersonal: false,
}

export function createMetadataBlob(metadata: ImageMetadata, options: MetadataExportOptions = DEFAULT_METADATA_OPTIONS): Blob {
  const parts: BlobPart[] = []

  if (options.includeExif && metadata.exif) {
    parts.push(new Blob([serializeExif(metadata.exif)], { type: 'application/exif' }))
  }
  if (options.includeIptc && metadata.iptc) {
    // Would serialize IPTC
  }
  if (options.includeXmp && metadata.xmp) {
    parts.push(new Blob([serializeXmp(metadata.xmp)], { type: 'application/xmp+xml' }))
  }
  if (options.includeIcc && metadata.iccProfile) {
    parts.push(new Blob([metadata.iccProfile], { type: 'application/icc' }))
  }

  return new Blob(parts)
}

// ============================================================
// Metadata extraction from canvas/image
// ============================================================

export async function extractMetadataFromImage(
  file: File | ArrayBuffer,
  options: { parseExif?: boolean; parseXmp?: boolean; parseIptc?: boolean; parsePngText?: boolean } = {}
): Promise<ImageMetadata> {
  const buf = file instanceof File ? await file.arrayBuffer() : file
  const result: ImageMetadata = {}

  if (options.parseExif !== false) {
    result.exif = parseExif(buf)
  }
  if (options.parseXmp !== false) {
    result.xmp = parseXmp(buf)
  }
  if (options.parseIptc !== false) {
    // Would parse IPTC
  }
  if (options.parsePngText !== false) {
    result.pngText = parsePngTextChunks(buf)
  }

  return result
}

// ============================================================
// GIMP-specific metadata helpers
// ============================================================

export const GIMP_PARASITE_NAMES = {
  LAYER_POSITION: 'gimp-layer-position',
  LAYER_OFFSETS: 'gimp-layer-offsets',
  LAYER_MASK: 'gimp-layer-mask',
  LAYER_MODE: 'gimp-layer-mode',
  LAYER_OPACITY: 'gimp-layer-opacity',
  LAYER_VISIBLE: 'gimp-layer-visible',
  LAYER_LOCKED: 'gimp-layer-locked',
  LAYER_LINKED: 'gimp-layer-linked',
  LAYER_NAME: 'gimp-layer-name',
  IMAGE_GUIDES: 'gimp-image-guides',
  IMAGE_GRID: 'gimp-image-grid',
  IMAGE_RESOLUTION: 'gimp-image-resolution',
  IMAGE_UNIT: 'gimp-image-unit',
  PATHS: 'gimp-paths',
  SELECTION: 'gimp-selection',
  PARASITE_LIST: 'gimp-parasite-list',
} as const

export function createGimpParasite(name: string, data: Uint8Array, flags = 0): GimpParasite {
  return { name, flags, data }
}

export function findGimpParasite(parasites: GimpParasite[], name: string): GimpParasite | undefined {
  return parasites.find(p => p.name === name)
}