#!/usr/bin/env node
// ============================================================
// Chay's Photo Studio — app icon generator
// Renders the brand SVG into every icon format needed by the
// distribution channels:
//   public/icons/*            → PWA manifest + apple-touch
//   public/favicon.ico        → browser tab icon
//   build/icons/*             → Electron (electron-builder)
//   webview/src-tauri/icons/* → Tauri system-webview shell
//   build/icons/extension/*   → browser plugin (16/32/48/128)
// Pure Node + sharp — no native tooling required. PNG-in-ICO and
// PNG-in-ICNS are hand-rolled (both formats accept PNG payloads).
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = path.resolve(import.meta.dirname, '..')
const SVG_NS = 'http://www.w3.org/2000/svg'

// ---------- brand geometry (must stay in sync with public/icon.svg) ----------
const BG = '#1c1c1c'
const AMBER = '#e8a33d'

/** Rounded-square app icon (the shipped look). */
function appIconSvg(size, rounded = true) {
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" ${rounded ? 'rx="14" ' : ''}fill="${BG}"/>
  ${rounded ? `<rect x="1.5" y="1.5" width="61" height="61" rx="12.5" fill="none" stroke="${AMBER}" stroke-opacity="0.4" stroke-width="3"/>` : ''}
  <path d="M 44 18 A 18 18 0 1 0 44 46" fill="none" stroke="${AMBER}" stroke-width="7" stroke-linecap="round"/>
</svg>`
}

/** Full-bleed square variant with the mark scaled into a safe zone —
 *  used for maskable PWA icons (OS applies its own circular mask)
 *  and apple-touch icons (iOS rounds corners itself). */
function squareIconSvg(size, scale) {
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" fill="${BG}"/>
  <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">
    <path d="M 44 18 A 18 18 0 1 0 44 46" fill="none" stroke="${AMBER}" stroke-width="7" stroke-linecap="round"/>
  </g>
</svg>`
}

async function png(svgString, _size) {
  // the SVG carries width/height attributes — sharp renders it at exactly that size
  return sharp(Buffer.from(svgString)).png().toBuffer()
}

// ---------- container formats (PNG payloads, no compression needed) ----------
function u16(v) { return Buffer.from([v & 0xff, (v >> 8) & 0xff]) }
function u32(v) { return Buffer.from([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]) }

/** Windows .ico — directory of PNG entries (supported since Vista). */
function buildIco(pngEntries) {
  const count = pngEntries.length
  const header = Buffer.concat([u16(0), u16(1), u16(count)])
  const dirSize = 16 * count
  let offset = 6 + dirSize
  const dir = []
  const blobs = []
  for (const { size, data } of pngEntries) {
    const w = size >= 256 ? 0 : size
    dir.push(Buffer.concat([
      Buffer.from([w, w, 0, 0]), u16(1), u32(32), u32(data.length), u32(offset),
    ]))
    blobs.push(data)
    offset += data.length
  }
  return Buffer.concat([header, ...dir, ...blobs])
}

/** macOS .icns — 'icns' header + typed PNG entries. */
function buildIcns(entries) {
  const parts = []
  let total = 8
  for (const { type, data } of entries) {
    const entry = Buffer.concat([Buffer.from(type, 'ascii'), u32(8 + data.length), data])
    parts.push(entry)
    total += entry.length
  }
  return Buffer.concat([Buffer.from('icns', 'ascii'), u32(total), ...parts])
}

// ---------- writers ----------
const written = []
function write(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buf)
  written.push({ file: path.relative(ROOT, file), size: buf.length })
}

async function main() {
  const appSvgCache = new Map()
  const cachedApp = async (size) => {
    if (!appSvgCache.has(size)) appSvgCache.set(size, appIconSvg(size))
    return png(appSvgCache.get(size), size)
  }
  const square = async (size, scale) => png(squareIconSvg(size, scale), size)

  // ---- PWA / web (public/) ----
  write(path.join(ROOT, 'public/icons/icon-192.png'), await cachedApp(192))
  write(path.join(ROOT, 'public/icons/icon-512.png'), await cachedApp(512))
  write(path.join(ROOT, 'public/icons/maskable-192.png'), await square(192, 1.15))
  write(path.join(ROOT, 'public/icons/maskable-512.png'), await square(512, 1.15))
  write(path.join(ROOT, 'public/icons/apple-touch-icon.png'), await square(180, 1.35))
  write(path.join(ROOT, 'public/favicon.ico'), buildIco([
    { size: 16, data: await cachedApp(16) },
    { size: 32, data: await cachedApp(32) },
    { size: 48, data: await cachedApp(48) },
  ]))

  // ---- Electron (build/icons/, referenced by electron-builder.yml) ----
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    write(path.join(ROOT, `build/icons/icon-${s}.png`), await cachedApp(s))
  }
  write(path.join(ROOT, 'build/icons/icon.ico'), buildIco([
    { size: 16, data: await cachedApp(16) },
    { size: 24, data: await cachedApp(24) },
    { size: 32, data: await cachedApp(32) },
    { size: 48, data: await cachedApp(48) },
    { size: 64, data: await cachedApp(64) },
    { size: 128, data: await cachedApp(128) },
    { size: 256, data: await cachedApp(256) },
  ]))
  write(path.join(ROOT, 'build/icons/icon.icns'), buildIcns([
    { type: 'icp4', data: await cachedApp(16) },    // 16
    { type: 'icp5', data: await cachedApp(32) },    // 32
    { type: 'icp6', data: await cachedApp(64) },    // 64
    { type: 'ic07', data: await cachedApp(128) },   // 128
    { type: 'ic08', data: await cachedApp(256) },   // 256
    { type: 'ic09', data: await cachedApp(512) },   // 512
    { type: 'ic10', data: await cachedApp(1024) },  // 512@2x / 1024
  ]))

  // ---- Tauri system-webview shell (webview/src-tauri/icons/) ----
  const tauriIcons = path.join(ROOT, 'webview/src-tauri/icons')
  write(path.join(tauriIcons, '32x32.png'), await cachedApp(32))
  write(path.join(tauriIcons, '128x128.png'), await cachedApp(128))
  write(path.join(tauriIcons, '128x128@2x.png'), await cachedApp(256))
  write(path.join(tauriIcons, 'icon.png'), await cachedApp(1024))
  write(path.join(tauriIcons, 'icon.ico'), buildIco([
    { size: 16, data: await cachedApp(16) },
    { size: 24, data: await cachedApp(24) },
    { size: 32, data: await cachedApp(32) },
    { size: 48, data: await cachedApp(48) },
    { size: 64, data: await cachedApp(64) },
    { size: 128, data: await cachedApp(128) },
    { size: 256, data: await cachedApp(256) },
  ]))
  write(path.join(tauriIcons, 'icon.icns'), buildIcns([
    { type: 'icp4', data: await cachedApp(16) },
    { type: 'icp5', data: await cachedApp(32) },
    { type: 'icp6', data: await cachedApp(64) },
    { type: 'ic07', data: await cachedApp(128) },
    { type: 'ic08', data: await cachedApp(256) },
    { type: 'ic09', data: await cachedApp(512) },
    { type: 'ic10', data: await cachedApp(1024) },
  ]))

  // ---- Browser plugin (build/icons/extension/, copied by build-extension.mjs) ----
  for (const s of [16, 32, 48, 128]) {
    write(path.join(ROOT, `build/icons/extension/icon-${s}.png`), await cachedApp(s))
  }

  // ---- report + self-verify ----
  let failures = 0
  for (const { file } of written) {
    const buf = fs.readFileSync(path.join(ROOT, file))
    const ok =
      file.endsWith('.png') ? buf.subarray(1, 4).toString('ascii') === 'PNG' :
      file.endsWith('.ico') ? buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1 :
      file.endsWith('.icns') ? buf.subarray(0, 4).toString('ascii') === 'icns' : false
    if (!ok) failures++
  }
  const pngMeta = await sharp(fs.readFileSync(path.join(ROOT, 'public/icons/icon-512.png'))).metadata()
  console.log(`gen-icons: wrote ${written.length} files, ${failures === 0 ? 'all magic bytes OK' : failures + ' CORRUPT'} (icon-512 = ${pngMeta.width}x${pngMeta.height} PNG)`)
  for (const { file, size } of written) console.log(`  ${file}  (${(size / 1024).toFixed(1)} kB)`)
  if (failures) process.exit(1)
}

main().catch(err => { console.error('gen-icons failed:', err); process.exit(1) })
