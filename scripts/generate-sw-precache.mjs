#!/usr/bin/env node
// ============================================================
// Chay's Photo Studio — service-worker precache manifest.
//
// The static webapp export is the PWA payload. To make the
// installed PWA behave like the packaged webview (fully offline,
// no network needed after the first load) the service worker has
// to own every asset of the build, not just the app shell.
//
// This script walks a finished export and writes `sw-precache.json`
// next to `sw.js`:
//
//   { "version": "<content hash>", "files": ["index.html", ...] }
//
// The version changes whenever any asset changes, so the worker can
// notice a new deployment, precache the new asset set into a fresh
// cache and drop the old one — no stale HTML pointing at chunks that
// no longer exist.
//
// Usage: node scripts/generate-sw-precache.mjs <export-dir>
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const dir = process.argv[2]
if (!dir) {
  console.error('generate-sw-precache: expected an export directory')
  process.exit(1)
}

const root = path.resolve(dir)
if (!fs.existsSync(root)) {
  console.error(`generate-sw-precache: ${root} does not exist`)
  process.exit(1)
}

// The worker script and the manifest itself are never precached.
const SKIP = new Set(['sw.js', 'sw-precache.json', '.nojekyll'])

function walk(current, out) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(current, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile()) {
      const rel = path.relative(root, full).split(path.sep).join('/')
      out.push({ rel, size: fs.statSync(full).size })
    }
  }
  return out
}

const entries = walk(root, []).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))

if (!entries.some(e => e.rel === 'index.html')) {
  console.error('generate-sw-precache: export has no index.html')
  process.exit(1)
}
if (!entries.some(e => e.rel.startsWith('_next/static/'))) {
  console.error('generate-sw-precache: export has no _next/static assets')
  process.exit(1)
}

// The version is a content hash over the whole asset list, so a new
// deployment always produces a new cache name.
const hash = crypto.createHash('sha256')
for (const entry of entries) hash.update(`${entry.rel}:${entry.size}\n`)
const version = hash.digest('hex').slice(0, 16)

const manifest = {
  version,
  generatedAt: new Date().toISOString(),
  totalBytes: entries.reduce((sum, e) => sum + e.size, 0),
  files: entries.map(e => e.rel),
}

fs.writeFileSync(path.join(root, 'sw-precache.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(
  `generate-sw-precache: ${entries.length} files, ` +
  `${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MiB, version=${version}`,
)
