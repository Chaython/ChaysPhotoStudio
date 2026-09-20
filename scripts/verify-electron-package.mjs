#!/usr/bin/env node
// Verify electron-builder preserved the Next standalone payload inside the
// unpacked application. This specifically catches green installer builds that
// accidentally omit hidden .next assets and would open on an endless loader.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST = path.join(ROOT, 'build/electron/dist')

function fail(msg) {
  console.error(`verify-electron-package: ERROR — ${msg}`)
  process.exit(1)
}

function walk(dir, visit) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      visit(p, entry)
      walk(p, visit)
    }
  }
}

if (!fs.existsSync(DIST)) fail('build/electron/dist does not exist')

const appDirs = []
walk(DIST, (p, entry) => {
  if (entry.name !== 'app') return
  if (fs.existsSync(path.join(p, 'server.js'))) appDirs.push(p)
})

if (!appDirs.length) fail('no unpacked resources/app/server.js payload found after electron-builder')

for (const appDir of appDirs) {
  const required = [
    'server.js',
    path.join('.next', 'server'),
    path.join('.next', 'static'),
    'public',
    path.join('server_modules', 'next', 'package.json'),
  ]
  for (const rel of required) {
    if (!fs.existsSync(path.join(appDir, rel))) fail(`missing ${path.relative(ROOT, path.join(appDir, rel))}`)
  }

  const chunks = path.join(appDir, '.next', 'static', 'chunks')
  if (!fs.existsSync(chunks)) fail(`missing static chunk directory in ${path.relative(ROOT, appDir)}`)
  const names = fs.readdirSync(chunks)
  if (!names.some(n => n.endsWith('.js'))) fail(`no JavaScript chunks in ${path.relative(ROOT, chunks)}`)
  if (!names.some(n => n.endsWith('.css'))) fail(`no CSS chunks in ${path.relative(ROOT, chunks)}`)
  if (fs.existsSync(path.join(appDir, 'node_modules'))) {
    fail(`unexpected prunable node_modules remained in ${path.relative(ROOT, appDir)}`)
  }
  console.log(`verify-electron-package: OK — ${path.relative(ROOT, appDir)} (${names.length} top-level chunks; traced runtime preserved)`)
}
