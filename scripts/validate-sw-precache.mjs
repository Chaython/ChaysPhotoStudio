#!/usr/bin/env node
// ============================================================
// Chay's Photo Studio — service-worker precache validation.
//
// The installed PWA is only as offline-capable as its precache
// manifest: every build asset must be listed, otherwise a chunk that
// is fetched for the first time while offline can never load.
//
// Usage: node scripts/validate-sw-precache.mjs <export-dir>
// ============================================================
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('validate-sw-precache: expected an export directory')
  process.exit(1)
}

const root = path.resolve(dir)
const manifestPath = path.join(root, 'sw-precache.json')
const swPath = path.join(root, 'sw.js')

function fail(message) {
  console.error(`validate-sw-precache: ${message}`)
  process.exit(1)
}

if (!fs.existsSync(manifestPath)) fail('sw-precache.json is missing from the export')
if (!fs.existsSync(swPath)) fail('sw.js is missing from the export')

let manifest
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
} catch (error) {
  fail(`sw-precache.json is not valid JSON: ${error}`)
}

if (!manifest || typeof manifest.version !== 'string' || manifest.version.length < 8) {
  fail('sw-precache.json has no usable version')
}
if (!Array.isArray(manifest.files) || manifest.files.length < 50) {
  fail(`sw-precache.json lists too few files (${manifest.files?.length ?? 0})`)
}
if (!manifest.files.includes('index.html')) fail('sw-precache.json does not include index.html')
if (!manifest.files.some(file => file.startsWith('_next/static/'))) {
  fail('sw-precache.json does not include any _next/static assets')
}

const listed = new Set(manifest.files)
const onDisk = []
;(function walk(current) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name === 'sw.js' || entry.name === 'sw-precache.json' || entry.name === '.nojekyll') continue
    const full = path.join(current, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.isFile()) onDisk.push(path.relative(root, full).split(path.sep).join('/'))
  }
})(root)

const missing = onDisk.filter(file => !listed.has(file))
if (missing.length > 0) {
  fail(`assets missing from sw-precache.json: ${missing.slice(0, 5).join(', ')} (${missing.length} total)`)
}

const stale = [...listed].filter(file => !fs.existsSync(path.join(root, file)))
if (stale.length > 0) {
  fail(`sw-precache.json lists files that do not exist: ${stale.slice(0, 5).join(', ')}`)
}

const sw = fs.readFileSync(swPath, 'utf8')
if (!sw.includes('sw-precache.json')) {
  fail('sw.js does not read the precache manifest')
}

console.log(
  `validate-sw-precache: ${listed.size} assets, version=${manifest.version}, ` +
  `${((manifest.totalBytes ?? 0) / 1024 / 1024).toFixed(1)} MiB`,
)
