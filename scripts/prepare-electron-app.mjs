#!/usr/bin/env node
// Assembles the Electron packaging input from the standalone Next
// build: build/electron/app  (server.js + .next/static + public +
// traced node_modules). electron-builder.yml references this folder
// via extraResources → <resources>/app.
// Run AFTER `bun run build` (which runs post-build.mjs).
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, '.next/standalone')
const DEST = path.join(ROOT, 'build/electron/app')

function must(dir, hint) {
  if (!fs.existsSync(dir)) {
    console.error(`prepare-electron-app: missing ${path.relative(ROOT, dir)} — ${hint}`)
    process.exit(1)
  }
}

must(path.join(SRC, 'server.js'), 'run `bun run build` first (standalone output)')
must(path.join(SRC, '.next/static'), 'run `bun run build` first (static chunks missing)')
must(path.join(SRC, 'public'), 'run `bun run build` first (public assets missing)')
must(path.join(ROOT, 'build/icons/icon.ico'), 'run `node scripts/gen-icons.mjs` first')

fs.rmSync(DEST, { recursive: true, force: true })
fs.cpSync(SRC, DEST, { recursive: true })

// quick inventory for the build log
const count = (dir) => {
  let n = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.DS_Store') continue
      n++
      if (e.isDirectory()) walk(path.join(d, e.name))
    }
  }
  walk(dir)
  return n
}
console.log(`prepare-electron-app: ${count(DEST)} files → build/electron/app (ready for electron-builder)`)
