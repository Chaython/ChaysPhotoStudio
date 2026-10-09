import fs from 'node:fs'
import path from 'node:path'

/**
 * Next.js Webpack places extracted CSS under static/css, while Turbopack
 * commonly emits CSS beside JS under static/chunks. Both are valid and must
 * be packaged. Check the entire static subtree, not just one directory.
 */
export function inspectElectronStaticAssets(staticDir) {
  const chunkDir = path.join(staticDir, 'chunks')
  if (!fs.existsSync(chunkDir) || !fs.statSync(chunkDir).isDirectory())
    return { javascript: 0, css: 0, chunkDirectory: false }
  let javascript = 0
  let css = 0
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) {
        if (entry.name.endsWith('.css')) css++
        if (entry.name.endsWith('.js') && path.relative(chunkDir, full).split(path.sep)[0] !== '..') javascript++
      }
    }
  }
  visit(staticDir)
  return { javascript, css, chunkDirectory: true }
}
