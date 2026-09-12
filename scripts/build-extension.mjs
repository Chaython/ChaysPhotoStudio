#!/usr/bin/env node
// Builds the Chay's Photo Studio browser plugin — fully self-
// contained: the complete editor webapp is bundled INSIDE the
// extension, so it opens instantly, offline, with no server.
//   build/extension/unpacked/            ← "Load unpacked" folder
//   build/extension/chays-photo-studio-extension-v{version}.zip
//   build/extension/firefox/             ← Firefox MV3 variant
//   build/extension/chays-photo-studio-extension-firefox-v{version}.zip
// Pipeline:
//   1. static webapp export (scripts/export-webapp.mjs) if missing
//   2. post-process its HTML for MV3: inline <script> payloads are
//      extracted to files (extension pages forbid inline JS)
//   3. assemble: plugin chrome files + app files (shared icons/ dir)
//   4. validate: manifest parses, no inline scripts left, every
//      root-absolute asset reference in index.html resolves
// Requires icons first: node scripts/gen-icons.mjs
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { zipSync } from './lib/zip.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'extension')
const OUT = path.join(ROOT, 'build/extension')
const ICONS = path.join(ROOT, 'build/icons/extension')
const EXPORT = path.join(ROOT, 'build/webapp-export')
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

function must(dir, hint) {
  if (!fs.existsSync(dir)) {
    console.error(`build-extension: missing ${path.relative(ROOT, dir)} — ${hint}`)
    process.exit(1)
  }
}

function copyTree(from, to, filter) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (filter && filter(entry)) continue
    const s = path.join(from, entry.name)
    const d = path.join(to, entry.name)
    if (entry.isDirectory()) copyTree(s, d, filter)
    else fs.copyFileSync(s, d)
  }
}

// ---------- 1. static webapp export ----------
if (!fs.existsSync(path.join(EXPORT, 'index.html'))) {
  console.log('build-extension: no static export found — building it (export-webapp plugin)')
  const res = spawnSync('node', [path.join(ROOT, 'scripts/export-webapp.mjs'), 'plugin'], { stdio: 'inherit' })
  if (res.status !== 0) { console.error('build-extension: export-webapp failed'); process.exit(1) }
}
must(path.join(EXPORT, 'index.html'), 'static export missing')

// ---------- 2. MV3 post-processing ----------
/** App files that ship inside the extension. Skips: the service
 *  worker (never registered in extensions), generated RSC payload
 *  .txt files, and duplicate error pages. */
function appFileFilter(entry) {
  if (entry.name === 'sw.js' || entry.name.endsWith('.txt')) return true
  if (entry.isDirectory() && entry.name === '_not-found') return true
  if (entry.isFile() && (entry.name === '404.html' || entry.name === '_not-found.html')) return true
  return false
}

/** Extract every inline <script> payload to a real file so the page
 *  satisfies the MV3 extension-pages CSP (script-src 'self', no
 *  inline). Document order and attributes are preserved — the
 *  hydration payloads (self.__next_f.push) execute exactly where
 *  they used to. Returns the rewritten HTML. */
function extractInlineScripts(html, outDir) {
  const chunkDir = path.join(outDir, '_next/static/chunks')
  fs.mkdirSync(chunkDir, { recursive: true })
  let n = 0
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/g, (whole, attrs, body) => {
    if (/\ssrc\s*=/.test(attrs)) return whole // already external
    if (!body.trim()) return whole
    // preserve document order via a global counter
    const name = `inline-${String(n).padStart(3, '0')}.js`
    n++
    fs.writeFileSync(path.join(chunkDir, name), body)
    const kept = String(attrs).replace(/\s*(async|defer)\s*/g, ' ').trim()
    return `<script${kept ? ' ' + kept : ''} src="_next/static/chunks/${name}"></script>`
  })
}

function processAppHtml(appDir) {
  const p = path.join(appDir, 'index.html')
  let html = fs.readFileSync(p, 'utf8')
  html = extractInlineScripts(html, appDir)
  fs.writeFileSync(p, html)
  return html
}

function assertNoInlineScripts(html, label) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g
  let m
  while ((m = re.exec(html))) {
    if (!/\ssrc\s*=/.test(m[1]) && m[2].trim()) {
      console.error(`build-extension: ${label} still has an inline script (${m[2].length} bytes)`)
      process.exit(1)
    }
  }
}

/** Every root-absolute reference in the page must resolve to a real
 *  file inside the package (the extension origin root == unpacked/). */
function assertReferencesResolve(html, appDir, label) {
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1])
  const missing = []
  for (const r of new Set(refs)) {
    const clean = r.split('#')[0].split('?')[0]
    if (!clean || clean === '/') continue
    if (!fs.existsSync(path.join(appDir, clean.slice(1)))) missing.push(r)
  }
  if (missing.length) {
    console.error(`build-extension: ${label} — unresolved asset references: ${missing.join(', ')}`)
    process.exit(1)
  }
}

function setVersion(manifestPath) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  m.version = VERSION
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n')
  return m
}

function zipFolder(dir, zipName) {
  const entries = []
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(relPath)
      else entries.push({ name: relPath, data: fs.readFileSync(path.join(dir, relPath)) })
    }
  }
  walk('')
  fs.writeFileSync(path.join(OUT, zipName), zipSync(entries))
  return entries.length
}

function buildVariant(name, manifestTweak) {
  const dir = path.join(OUT, name)
  fs.rmSync(dir, { recursive: true, force: true })
  // plugin chrome files (background, popup, css) — manifest handled below
  copyTree(SRC, dir, (entry) => entry.name === 'README.md' || entry.name === 'manifest.json')
  // the webapp (post-processed HTML + chunks + public assets)
  copyTree(EXPORT, dir, appFileFilter)
  const html = processAppHtml(dir)
  assertNoInlineScripts(html, name)
  assertReferencesResolve(html, dir, name)
  // plugin icons + app icons share icons/ (no filename collisions)
  fs.cpSync(ICONS, path.join(dir, 'icons'), { recursive: true })
  // manifest with pinned version (+ variant tweak)
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'))
  if (manifestTweak) manifestTweak(manifest)
  manifest.version = VERSION
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return { dir, manifest }
}

// ---------- 3. assemble ----------
must(SRC, 'extension/ sources missing')
must(ICONS, 'run `node scripts/gen-icons.mjs` first')

fs.rmSync(OUT, { recursive: true, force: true })

// Chrome build
const chrome = buildVariant('unpacked', null)
if (!chrome.manifest.background || !chrome.manifest.background.service_worker) {
  console.error('build-extension: manifest sanity check failed (background.service_worker missing)')
  process.exit(1)
}
const chromeCount = zipFolder(chrome.dir, `chays-photo-studio-extension-v${VERSION}.zip`)

// Firefox variant: MV3 with an event-page background instead of a
// service worker, plus an AMO submission id.
const firefox = buildVariant('firefox', (m) => {
  delete m.background
  m.background = { scripts: ['background.js'] }
  m.browser_specific_settings = {
    gecko: { id: 'chays-photo-studio@chaython', strict_min_version: '109.0' },
  }
})
const ffCount = zipFolder(firefox.dir, `chays-photo-studio-extension-firefox-v${VERSION}.zip`)

// ---------- 4. verify ----------
for (const dir of [chrome.dir, firefox.dir]) {
  JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) // throws on invalid
  for (const f of ['background.js', 'popup.js', 'popup.html', 'index.html']) {
    if (!fs.existsSync(path.join(dir, f))) {
      console.error(`build-extension: ${path.relative(ROOT, dir)}/${f} missing`)
      process.exit(1)
    }
  }
}

const sizeOf = (dir) => {
  let total = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else total += fs.statSync(p).size
    }
  }
  walk(dir)
  return total
}

console.log(`build-extension: v${VERSION} — self-contained webapp bundled inside the plugin`)
console.log(`  build/extension/unpacked  (${chromeCount} files, ${(sizeOf(chrome.dir) / 1048576).toFixed(1)} MB, Load-unpacked ready)`)
console.log(`  build/extension/chays-photo-studio-extension-v${VERSION}.zip  (Chrome Web Store)`)
console.log(`  build/extension/firefox  (${ffCount} files, ${(sizeOf(firefox.dir) / 1048576).toFixed(1)} MB)`)
console.log(`  build/extension/chays-photo-studio-extension-firefox-v${VERSION}.zip  (addons.mozilla.org)`)
