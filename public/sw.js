/* Chay's Photo Studio — service worker.
   Installed only in production builds (see src/app/native-bridges.tsx).
   Strategy:
   - precache the app shell on install
   - navigations: network-first with cached-shell + offline fallback
   - static assets: stale-while-revalidate
   - never touches /api/* or cross-origin requests            */
const CACHE = 'chays-photo-studio-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Chay's Photo Studio — offline</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#1c1c1c;color:#e8a33d;font:14px/1.6 system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}
div{text-align:center;max-width:32ch}h1{font-size:18px;margin:0 0 8px}p{color:#b8b8b8;margin:0}
a{color:#e8a33d}</style></head><body><div>
<h1>Chay's Photo Studio</h1>
<p>You're offline. Documents you were editing stay open — reconnect to use AI features (generate, upscale, detect).</p>
<p style="margin-top:12px"><a href="/">Retry</a></p>
</div></body></html>`

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    // allSettled: a missing icon must never block install
    await Promise.allSettled(SHELL.map((u) => cache.add(u)))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting()
})

const STATIC_RE = /\.(png|jpe?g|svg|webp|avif|gif|ico|woff2?|ttf|css|js|wasm|json)$/i

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // cross-origin: browser default
  if (url.pathname.startsWith('/api/')) return // live server data, never cached

  if (req.mode === 'navigate') {
    e.respondWith(networkFirstNavigation(req))
    return
  }
  const isStatic =
    url.pathname.startsWith('/_next/static') ||
    url.pathname.startsWith('/icons/') ||
    STATIC_RE.test(url.pathname)
  if (isStatic) e.respondWith(staleWhileRevalidate(req))
})

async function networkFirstNavigation(req) {
  try {
    const res = await fetch(req)
    if (res && res.ok) {
      const cache = await caches.open(CACHE)
      cache.put('/', res.clone()).catch(() => {})
    }
    return res
  } catch {
    const cached = (await caches.match(req)) || (await caches.match('/'))
    if (cached) return cached
    return new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' }, status: 503 })
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(req)
  const fresh = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
      return res
    })
    .catch(() => null)
  if (cached) return cached // respond instantly, refresh in background
  const net = await fresh
  return net || Response.error()
}
