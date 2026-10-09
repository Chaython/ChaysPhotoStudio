#!/usr/bin/env node
// Verify that Tauri's embedded static export is self-contained: every HTML
// script/stylesheet asset must resolve locally. Run after export-webapp plugin.
// This is a packaging smoke check; it does NOT simulate an air-gapped Windows
// install or validate WebView2 runtime installation.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] || 'build/webapp-export')
const index = path.join(root, 'index.html')
if (!fs.existsSync(index)) throw new Error(`Missing embedded frontend: ${index}`)
const html = fs.readFileSync(index, 'utf8')
const tags = html.match(/<(?:script|link)\b[^>]*>/gi) || []
let checked = 0
let nextFiles = 0
for (const tag of tags) {
  const tagName = /^<(script|link)/i.exec(tag)?.[1]?.toLowerCase()
  const attrName = tagName === 'script' ? 'src' : 'href'
  const attrs = Object.fromEntries(
    [...tag.matchAll(/([\w-]+)=["']([^"']*)["']/g)].map(m => [m[1].toLowerCase(), m[2]]),
  )
  const value = attrs[attrName]
  if (!value) continue
  if (tagName === 'link' && !/(?:stylesheet|preload|modulepreload|icon)/.test(attrs.rel || '')) continue
  if (/^(?:https?:)?\/\//i.test(value)) throw new Error(`Unexpected remotely hosted script or stylesheet: ${value}`)
  if (/^(?:data:|blob:)/i.test(value)) continue
  const pathname = decodeURIComponent(value.split(/[?#]/, 1)[0])
  if (!pathname.startsWith('/')) throw new Error(`Non-root-relative embedded asset: ${pathname}`)
  const full = path.resolve(root, '.' + pathname)
  if (!full.startsWith(root + path.sep)) throw new Error(`Asset path escaped the export: ${pathname}`)
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`Missing offline asset: ${pathname}`)
  checked++
  if (pathname.startsWith('/_next/')) nextFiles++
}
if (!checked || !nextFiles) throw new Error('Embedded frontend had no checked scripts or Next assets')
const nextDir = path.join(root, '_next')
if (!fs.existsSync(nextDir)) throw new Error('Missing embedded Next asset directory')
console.log(`Verified ${checked} local HTML script/style/icon assets (${nextFiles} Next assets) for offline packaging`)
