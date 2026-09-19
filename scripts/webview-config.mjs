#!/usr/bin/env node
// Writes webview/src-tauri/tauri.conf.release.json — a Tauri config
// overlay (deep-merged by `tauri build --config`).
//
// Release default: embed the local static export so installers work offline
// and do not depend on GitHub Pages being enabled.
// Optional thin-shell override:
//   WEBVIEW_APP_URL=https://studio.example.com node scripts/webview-config.mjs
// Optional local-dist override:
//   WEBVIEW_FRONTEND_DIST=../../some/export node scripts/webview-config.mjs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC_TAURI = path.join(ROOT, 'webview/src-tauri')
const OUT = path.join(SRC_TAURI, 'tauri.conf.release.json')

const appUrl = (process.env.WEBVIEW_APP_URL || '').trim()
const localDist = (process.env.WEBVIEW_FRONTEND_DIST || '../../build/webapp-export').trim()

let frontendDist
if (appUrl) {
  let url
  try {
    url = new URL(appUrl)
  } catch {
    console.error(`webview-config: WEBVIEW_APP_URL is not a valid URL: ${appUrl}`)
    process.exit(1)
  }
  if (!/^https?:$/.test(url.protocol)) {
    console.error(`webview-config: WEBVIEW_APP_URL must be http(s), got ${appUrl}`)
    process.exit(1)
  }
  frontendDist = url.toString().replace(/\/+$/, '')
  console.log(`webview-config: remote thin-shell frontend → ${frontendDist}`)
} else {
  if (!localDist) {
    console.error('webview-config: WEBVIEW_FRONTEND_DIST cannot be empty when WEBVIEW_APP_URL is unset')
    process.exit(1)
  }

  const resolved = path.resolve(SRC_TAURI, localDist)
  const index = path.join(resolved, 'index.html')
  const nextAssets = path.join(resolved, '_next')
  if (!fs.existsSync(index) || !fs.existsSync(nextAssets)) {
    console.error(`webview-config: embedded frontend is incomplete: ${resolved}`)
    console.error('webview-config: expected index.html and _next/. Run `node scripts/export-webapp.mjs plugin` first.')
    process.exit(1)
  }
  frontendDist = localDist.replace(/\\/g, '/')
  console.log(`webview-config: embedded frontend → ${frontendDist}`)
}

const overlay = { build: { frontendDist } }
fs.writeFileSync(OUT, JSON.stringify(overlay, null, 2) + '\n')
console.log(`webview-config: wrote ${path.relative(ROOT, OUT)}`)
