#!/usr/bin/env node
// Dev launcher for the Electron shell against the running Next dev
// server (default http://localhost:3000). Usage:
//   bun run dev          (terminal 1 — Next dev server)
//   bun run app:dev      (terminal 2 — Electron window on it)
// Requires the `electron` devDependency (bun install).
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'

const ROOT = path.resolve(import.meta.dirname, '..')
const DEV_URL = process.env.CHAYS_DEV_URL || 'http://localhost:3000'

// locate the electron binary from the devDependency
const candidates = [
  path.join(ROOT, 'node_modules/electron/dist/electron'),
  path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
  path.join(ROOT, 'node_modules/.bin/electron'),
]
const electronBin = candidates.find((p) => fs.existsSync(p))
if (!electronBin) {
  console.error('dev-electron: electron binary not found — run `bun install` (devDependency "electron").')
  process.exit(1)
}

const ready = () => new Promise((resolve) => {
  const req = http.get(DEV_URL, (res) => { res.resume(); resolve(res.statusCode < 500) })
  req.on('error', () => resolve(false))
  req.setTimeout(2000, () => { req.destroy(); resolve(false) })
})

if (!(await ready())) {
  console.error(`dev-electron: dev server not reachable at ${DEV_URL} — start it first (\`bun run dev\`) or set CHAYS_DEV_URL.`)
  process.exit(1)
}

console.log(`dev-electron: launching shell on ${DEV_URL}`)
const child = spawn(electronBin, [path.join(ROOT, 'electron/main.cjs')], {
  env: { ...process.env, CHAYS_DEV_URL: DEV_URL },
  stdio: 'inherit',
})
child.on('exit', (code) => process.exit(code ?? 0))
