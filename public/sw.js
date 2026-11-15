/* Chay's Photo Studio — service worker.
   Installed only in production, http(s) pages (see src/app/native-bridges.tsx).

   Goal: the installed PWA behaves like the packaged webview — after the
   first successful load it keeps working without the network.

   Strategy:
   - a build-time manifest (`sw-precache.json`) lists every asset of the
     current build; the worker precaches all of them into a cache named
     after the manifest's content hash
   - navigations: network-first, with the cached shell as offline fallback
   - precached assets (hashed chunks, wasm codecs, fonts, icons): cache-first
   - anything else: stale-while-revalidate
   - never touches /api/* or cross-origin requests
   - a new deployment produces a new manifest version: the worker precaches
     the new asset set, switches to it and drops the old cache, so a stale
     HTML shell can never point at chunks that no longer exist

   BASE: derived from this worker's own URL, so the same file serves
   root deployments and sub-path deployments (GitHub Pages) alike. */
const CACHE_PREFIX = 'chays-photo-studio-'
const BASE = self.location.pathname.replace(/\/sw\.js$/, '')
const IS_TAURI = self.location.hostname === 'tauri.localhost'
const BATCH_SIZE = 24

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Chay's Photo Studio — offline</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#1c1c1c;color:#e8a33d;font:14px/1.6 system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}
div{text-align:center;max-width:32ch}h1{font-size:18px;margin:0 0 8px}p{color:#b8b8b8;margin:0}
a{color:#e8a33d}</style></head><body><div>
<h1>Chay's Photo Studio</h1>
<p>You're offline. Documents you were editing stay open — reconnect to use AI features (generate, upscale, detect).</p>
<p style="margin-top:12px"><a href="${BASE}/">Retry</a></p>
</div></body></html>`

/** Absolute URL for a path relative to this worker's base directory. */
function assetUrl(relative) {
  return `${BASE}/${relative}`
}

/** Pathname form of assetUrl(), used to compare against cached requests. */
function assetPath(relative) {
  return new URL(assetUrl(relative), self.location.origin).pathname
}

// The cache that currently holds the complete, matching asset set.
let currentVersion = null
let currentCacheName = `${CACHE_PREFIX}fallback`
let pendingUpdate = null

async function readManifest() {
  try {
    const res = await fetch(assetUrl('sw-precache.json'), { cache: 'no-store' })
    if (!res || !res.ok) return null
    const data = await res.json()
    if (!data || !Array.isArray(data.files) || data.files.length === 0) return null
    return data
  } catch {
    return null
  }
}

/** Make sure the cache for the current manifest version holds every asset. */
async function ensurePrecache() {
  if (pendingUpdate) return pendingUpdate
  pendingUpdate = (async () => {
    const manifest = await readManifest()
    if (!manifest) return
    const version = String(manifest.version || 'dev')
    const name = `${CACHE_PREFIX}precache-${version}`
    const cache = await caches.open(name)

    const existing = new Set()
    for (const request of await cache.keys()) existing.add(new URL(request.url).pathname)

    const missing = manifest.files.filter(file => !existing.has(assetPath(file)))
    const shell = ['', 'index.html'].filter(part => !existing.has(assetPath(part)))
    const targets = [...shell, ...missing]

    if (targets.length > 0) {
      // A missing asset must never abort the install — a partial cache is
      // still far better than no cache at all.
      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = targets.slice(i, i + BATCH_SIZE)
        await Promise.allSettled(batch.map(part =>
          cache.add(new Request(assetUrl(part), { cache: 'reload' })),
        ))
      }
    }

    currentVersion = version
    currentCacheName = name

    // Older builds are dead weight now that this one is cached.
    const keys = await caches.keys()
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== name)
      .map(key => caches.delete(key)))
  })().catch(() => {}).finally(() => { pendingUpdate = null })
  return pendingUpdate
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    // A Tauri/WebView2 build must never run as a PWA. Older releases could
    // register this worker on http://tauri.localhost, where a cached shell can
    // outlive app updates and point at no-longer-existing hashed Next chunks.
    if (IS_TAURI) {
      await self.skipWaiting()
      return
    }

    await ensurePrecache()
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys()

    if (IS_TAURI) {
      await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)))
      await self.registration.unregister()
      return
    }

    // Adopt (or rebuild) the cache for the manifest version in use.
    await ensurePrecache()
    await Promise.all(keys
      .filter(k => k.startsWith(CACHE_PREFIX) && k !== currentCacheName)
      .map(k => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting()
  if (e.data === 'update') ensurePrecache()
})

const STATIC_RE = /\.(png|jpe?g|svg|webp|avif|gif|ico|woff2?|ttf|css|js|wasm|json)$/i

self.addEventListener('fetch', (e) => {
  // Never intercept native-shell requests. A clean WebView profile plus this
  // guard makes future desktop upgrades immune to PWA shell caching.
  if (IS_TAURI) return

  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // cross-origin: browser default
  if (url.pathname.startsWith(`${BASE}/api/`)) return // live server data, never cached

  if (req.mode === 'navigate') {
    e.respondWith(networkFirstNavigation(req))
    return
  }
  const isStatic =
    url.pathname.startsWith(`${BASE}/_next/static`) ||
    url.pathname.startsWith(`${BASE}/icons/`) ||
    STATIC_RE.test(url.pathname)
  if (isStatic) e.respondWith(assetResponse(req))
})

async function networkFirstNavigation(req) {
  try {
    const res = await fetch(req)
    if (res && res.ok) {
      const cache = await caches.open(currentCacheName)
      cache.put(assetUrl(''), res.clone()).catch(() => {})
      cache.put(assetUrl('index.html'), res.clone()).catch(() => {})
      // A new deployment may be live: pick up its asset set in the background
      // so the next offline launch is complete again.
      ensurePrecache().catch(() => {})
    }
    return res
  } catch {
    const cached =
      (await caches.match(assetUrl(''))) ||
      (await caches.match(assetUrl('index.html'))) ||
      (await caches.match(req))
    if (cached) return cached
    return new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' }, status: 503 })
  }
}

async function assetResponse(req) {
  const cache = await caches.open(currentCacheName)
  const cached = await cache.match(req)
  if (cached) {
    // Hashed build assets are immutable; everything else may change.
    if (!req.url.includes('/_next/static/')) revalidate(req, cache)
    return cached
  }

  // Not part of the cached build (a fresh deployment, a lazily fetched
  // asset): go to the network, and keep a copy for the next offline run.
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
    return res
  } catch {
    const any = await caches.match(req)
    if (any) return any
    return Response.error()
  }
}

function revalidate(req, cache) {
  fetch(req)
    .then(res => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
    })
    .catch(() => {})
}
