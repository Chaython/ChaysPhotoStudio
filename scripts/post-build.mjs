#!/usr/bin/env node
// Cross-platform replacement for the old `cp -r` post-build step:
// after `next build` (output: standalone) this folds the static
// chunks and public assets into .next/standalone so the standalone
// server is fully self-contained. Windows-safe (fs.cpSync).
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const STANDALONE = path.join(ROOT, '.next/standalone')

function must(dir, hint) {
  if (!fs.existsSync(dir)) {
    console.error(`post-build: missing ${path.relative(ROOT, dir)} — ${hint}`)
    process.exit(1)
  }
}

must(path.join(ROOT, '.next'), 'run `next build` first')
must(path.join(STANDALONE, 'server.js'), 'standalone output incomplete — run `next build` first')

// .next/standalone/.next/static
fs.cpSync(path.join(ROOT, '.next/static'), path.join(STANDALONE, '.next/static'), { recursive: true })
// .next/standalone/public
fs.cpSync(path.join(ROOT, 'public'), path.join(STANDALONE, 'public'), { recursive: true })

console.log('post-build: standalone bundle is self-contained (.next/standalone)')
