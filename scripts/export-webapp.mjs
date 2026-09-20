#!/usr/bin/env node
// ============================================================
// Chay's Photo Studio — static webapp export.
// Produces a pure static build of the editor:
//   build/webapp-export/        ← no base path (browser plugin copy)
//   build/webapp-export-pages/  ← NEXT_BASE_PATH=/ChaysPhotoStudio
//                                 (GitHub Pages copy)
// The editor is a fully client-side app, so it exports cleanly —
// the only server-side piece (the AI proxy route) is pruned from
// the exported source tree; the client then calls the free image
// engine directly (src/editor/image-ops/generate.ts fallback).
//
// Usage:  node scripts/export-webapp.mjs [pages|plugin|both]
// Env:    WEBAPP_BASE_PATH (default /ChaysPhotoStudio for `pages`)
// Requires the repo's node_modules (bun install) — symlinked in.
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const MODE = process.argv[2] || 'both' // pages | plugin | both

const COPY = path.join(ROOT, 'build/export-src')
const OUT_PLUGIN = path.join(ROOT, 'build/webapp-export')
const PAGES_BASE = process.env.WEBAPP_BASE_PATH || '/ChaysPhotoStudio'

const SKIP = new Set([
  'node_modules', '.next', 'build', 'dist', '.git', 'db', '.turbo',
  'dev.log', 'server.log', 'worklog.md', 'next-env.d.ts', 'bun.lock',
])

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const s = path.join(from, entry.name)
    const d = path.join(to, entry.name)
    if (entry.isDirectory()) copyTree(s, d)
    else if (entry.isFile()) fs.copyFileSync(s, d)
  }
}

function runNextBuild(basePath) {
  const env = {
    ...process.env,
    NEXT_OUTPUT: 'export',
    NEXT_TELEMETRY_DISABLED: '1',
    ...(basePath ? { NEXT_BASE_PATH: basePath } : {}),
  }
  delete env.NEXT_BASE_PATH_UNSET
  const res = spawnSync('bunx', ['next', 'build'], { cwd: COPY, env, encoding: 'utf8', stdio: 'pipe' })
  if (res.stdout) process.stdout.write(res.stdout)
  if (res.stderr) process.stderr.write(res.stderr)
  if (res.status !== 0) {
    console.error(`export-webapp: next build failed (status ${res.status})`)
    process.exit(1)
  }
}

// ---------- 1. pruned source copy ----------
fs.rmSync(COPY, { recursive: true, force: true })
copyTree(ROOT, COPY)
// static export cannot ship route handlers — the client falls back
// to direct engine calls at runtime (generate.ts).
fs.rmSync(path.join(COPY, 'src/app/api'), { recursive: true, force: true })
// static flavors don't ship the ~1 MB source archive — the welcome
// screen link falls back to the repository copy at runtime. Match
// any version so stale archives can never leak in.
for (const f of fs.readdirSync(path.join(COPY, 'public'))) {
  if (/^chays-photo-studio-.*-project\.zip$/.test(f)) {
    fs.rmSync(path.join(COPY, 'public', f), { force: true })
  }
}
// the export source needs the same tsconfig paths etc. — symlink
// node_modules so bun/next resolve the real installed packages.
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(COPY, 'node_modules'), 'dir')
// prisma: schema needs a generate output; the copy never imports the
// db client (nothing in src/ does), so stub the postinstall away.
const pkgPath = path.join(COPY, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
delete pkg.scripts.postinstall
pkg.scripts.build = 'next build'
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// ---------- 2. build the requested flavors ----------
const flavors = []
if (MODE === 'pages' || MODE === 'both') flavors.push({ basePath: PAGES_BASE, out: path.join(ROOT, 'build/webapp-export-pages'), label: 'pages' })
if (MODE === 'plugin' || MODE === 'both') flavors.push({ basePath: '', out: OUT_PLUGIN, label: 'plugin' })

for (const f of flavors) {
  console.log(`export-webapp: building static ${f.label} flavor (basePath=${f.basePath || '<none>'})`)
  runNextBuild(f.basePath)
  fs.rmSync(f.out, { recursive: true, force: true })
  fs.cpSync(path.join(COPY, 'out'), f.out, { recursive: true })
  const count = (function walk(d) {
    let n = 0
    for (const e of fs.readdirSync(d, { withFileTypes: true })) { n++; if (e.isDirectory()) n += walk(path.join(d, e.name)) }
    return n
  })(f.out)
  const hasIndex = fs.existsSync(path.join(f.out, 'index.html'))
  const hasStatic = fs.existsSync(path.join(f.out, '_next'))
  console.log(`export-webapp: ${f.label} → ${path.relative(ROOT, f.out)} (${count} files, index.html=${hasIndex}, _next=${hasStatic})`)
  if (!hasIndex || !hasStatic) {
    console.error('export-webapp: export incomplete — missing index.html or _next assets')
    process.exit(1)
  }

  // The plugin flavor is also embedded by Tauri. Tauri's packaged protocol
  // does not reliably resolve root-absolute /_next/* URLs; they must be
  // relative (assetPrefix './') or the desktop app renders only SSR fallback.
  if (f.label === 'plugin') {
    const html = fs.readFileSync(path.join(f.out, 'index.html'), 'utf8')
    if (/(?:src|href)=["']\/_next\//.test(html)) {
      console.error('export-webapp: plugin/webview export still contains root-absolute /_next assets')
      process.exit(1)
    }
    if (!/(?:src|href)=["']\.\/_next\//.test(html)) {
      console.error('export-webapp: plugin/webview export does not contain relative ./_next assets')
      process.exit(1)
    }
  }
}
console.log('export-webapp: done')
