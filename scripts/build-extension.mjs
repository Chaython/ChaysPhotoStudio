#!/usr/bin/env node
// Builds the Chay's Photo Studio browser plugin:
//   build/extension/unpacked/            ← "Load unpacked" folder
//   build/extension/chays-photo-studio-extension-v{version}.zip
//   build/extension/firefox/             ← Firefox MV3 variant (event page)
//   build/extension/chays-photo-studio-extension-firefox-v{version}.zip
// Requires icons first: node scripts/gen-icons.mjs
// EDITOR_URL env sets the baked-in default editor location
// (fallback: http://localhost:3000).
import fs from 'node:fs'
import path from 'node:path'
import { zipSync } from './lib/zip.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'extension')
const OUT = path.join(ROOT, 'build/extension')
const ICONS = path.join(ROOT, 'build/icons/extension')
const EDITOR_URL = (process.env.EDITOR_URL || 'http://localhost:3000').replace(/\/+$/, '')
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

function must(dir, hint) {
  if (!fs.existsSync(dir)) {
    console.error(`build-extension: missing ${path.relative(ROOT, dir)} — ${hint}`)
    process.exit(1)
  }
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'README.md') continue // repo doc, not shipped
    const s = path.join(from, entry.name)
    const d = path.join(to, entry.name)
    if (entry.isDirectory()) copyTree(s, d)
    else fs.copyFileSync(s, d)
  }
}

function bake(dir) {
  for (const f of ['background.js', 'popup.js']) {
    const p = path.join(dir, f)
    if (!fs.existsSync(p)) continue
    let src = fs.readFileSync(p, 'utf8')
    if (src.includes('__EDITOR_URL__')) {
      src = src.split('__EDITOR_URL__').join(EDITOR_URL)
      fs.writeFileSync(p, src)
    }
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

// ---------- build ----------
must(SRC, 'extension/ sources missing')
must(ICONS, 'run `node scripts/gen-icons.mjs` first')

fs.rmSync(OUT, { recursive: true, force: true })

// Chrome build
const chromeDir = path.join(OUT, 'unpacked')
copyTree(SRC, chromeDir)
fs.cpSync(ICONS, path.join(chromeDir, 'icons'), { recursive: true })
bake(chromeDir)
const chromeManifest = setVersion(path.join(chromeDir, 'manifest.json'))
if (!chromeManifest.background || !chromeManifest.background.service_worker) {
  console.error('build-extension: manifest sanity check failed (background.service_worker missing)')
  process.exit(1)
}
const chromeCount = zipFolder(chromeDir, `chays-photo-studio-extension-v${VERSION}.zip`)

// Firefox variant: MV3 with an event-page background instead of a
// service worker, plus an AMO submission id.
const ffDir = path.join(OUT, 'firefox')
copyTree(SRC, ffDir)
fs.cpSync(ICONS, path.join(ffDir, 'icons'), { recursive: true })
bake(ffDir)
const ffManifest = setVersion(path.join(ffDir, 'manifest.json'))
delete ffManifest.background
ffManifest.background = { scripts: ['background.js'] }
ffManifest.browser_specific_settings = {
  gecko: { id: 'chays-photo-studio@chaython', strict_min_version: '109.0' },
}
fs.writeFileSync(path.join(ffDir, 'manifest.json'), JSON.stringify(ffManifest, null, 2) + '\n')
const ffCount = zipFolder(ffDir, `chays-photo-studio-extension-firefox-v${VERSION}.zip`)

// verify placeholders are gone + JSON is valid
for (const dir of [chromeDir, ffDir]) {
  for (const f of ['background.js', 'popup.js']) {
    if (fs.readFileSync(path.join(dir, f), 'utf8').includes('__EDITOR_URL__')) {
      console.error(`build-extension: placeholder left in ${dir}/${f}`)
      process.exit(1)
    }
  }
  JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) // throws on invalid
}

console.log(`build-extension: v${VERSION} — editor default: ${EDITOR_URL}`)
console.log(`  build/extension/unpacked  (${chromeCount} files, Load-unpacked ready)`)
console.log(`  build/extension/chays-photo-studio-extension-v${VERSION}.zip  (Chrome Web Store)`)
console.log(`  build/extension/firefox  (${ffCount} files)`)
console.log(`  build/extension/chays-photo-studio-extension-firefox-v${VERSION}.zip  (addons.mozilla.org)`)
