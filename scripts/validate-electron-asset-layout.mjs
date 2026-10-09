import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { inspectElectronStaticAssets } from './electron-asset-layout.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chays-assets-'))
try {
  const root = path.join(tmp, '.next', 'static')
  const chunks = path.join(root, 'chunks')
  const cssDir = path.join(root, 'css')
  fs.mkdirSync(chunks, { recursive: true })
  fs.mkdirSync(cssDir, { recursive: true })
  fs.writeFileSync(path.join(chunks, 'app.js'), '/* JS */')
  fs.writeFileSync(path.join(cssDir, 'app.css'), '/* Webpack CSS */')
  assert.deepEqual(inspectElectronStaticAssets(root), { javascript: 1, css: 1, chunkDirectory: true })
  fs.rmSync(path.join(cssDir, 'app.css'))
  fs.writeFileSync(path.join(chunks, 'app.css'), '/* Turbopack CSS */')
  assert.deepEqual(inspectElectronStaticAssets(root), { javascript: 1, css: 1, chunkDirectory: true })
  fs.rmSync(path.join(chunks, 'app.css'))
  assert.equal(inspectElectronStaticAssets(root).css, 0, 'missing CSS must still fail verification')
  fs.rmSync(path.join(chunks, 'app.js'))
  assert.equal(inspectElectronStaticAssets(root).javascript, 0, 'missing JS must still fail verification')
  console.log('Electron packaging verifier accepts both Next CSS layouts and rejects missing assets')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
