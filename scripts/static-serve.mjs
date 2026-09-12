// Tiny static server for local verification of the exported webapp /
// unpacked extension folder. Usage: bun scripts/static-serve.mjs <dir> <port>
const dir = process.argv[2] || '.'
const port = Number(process.argv[3] || 8377)
const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', png: 'image/png', svg: 'image/svg+xml',
  ico: 'image/x-icon', json: 'application/json', webmanifest: 'application/manifest+json',
  woff2: 'font/woff2', txt: 'text/plain; charset=utf-8', jpg: 'image/jpeg',
}
Bun.serve({
  port,
  fetch(req) {
    const u = new URL(req.url)
    let p = decodeURIComponent(u.pathname)
    if (p.endsWith('/')) p += 'index.html'
    const file = Bun.file(dir + p)
    const ext = p.split('.').pop().toLowerCase()
    return new Response(file, { headers: { 'content-type': TYPES[ext] || 'application/octet-stream' } })
  },
})
console.log(`serving ${dir} on http://localhost:${port}`)
