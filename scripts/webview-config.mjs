#!/usr/bin/env node
// Writes webview/src-tauri/tauri.conf.release.json — a Tauri config
// overlay (deep-merged by `tauri build --config`) that points the
// shell at the deployed editor URL for release builds.
//   WEBVIEW_APP_URL=https://your-host.example.com node scripts/webview-config.mjs
// Default (no env): http://localhost:3000 — handy for local testing
// against the dev server.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'webview/src-tauri/tauri.conf.release.json')

const raw = (process.env.WEBVIEW_APP_URL || 'http://localhost:3000').trim()
let url
try {
  url = new URL(raw)
} catch {
  console.error(`webview-config: WEBVIEW_APP_URL is not a valid URL: ${raw}`)
  process.exit(1)
}
if (!/^https?:$/.test(url.protocol)) {
  console.error(`webview-config: WEBVIEW_APP_URL must be http(s), got ${raw}`)
  process.exit(1)
}
if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
  console.warn('webview-config: WARNING — building against a localhost URL; the shipped app will need that server running. Set WEBVIEW_APP_URL to your deployed editor for real releases.')
}

const overlay = {
  build: {
    frontendDist: url.toString().replace(/\/+$/, ''),
    devUrl: url.toString().replace(/\/+$/, ''),
  },
}
fs.writeFileSync(OUT, JSON.stringify(overlay, null, 2) + '\n')
console.log(`webview-config: release frontendDist → ${overlay.build.frontendDist}`)
