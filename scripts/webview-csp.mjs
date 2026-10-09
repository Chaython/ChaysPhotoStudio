// CSP is applied only to *embedded release* assets, not the development
// server or opt-in remote thin shells. Tauri injects hashes/nonces at bundle
// time for Next.js inline hydration scripts.
export const embeddedWebviewCsp = {
  'default-src': "'self'",
  'base-uri': "'self'",
  'object-src': "'none'",
  'form-action': "'self'",
  'frame-src': "'none'",
  // The plugin worker compiles user-imported scripts with new Function.
  // Unsafe eval is a deliberate compatibility exception; no remote scripts
  // or arbitrary inline scripts are allowed. Revisit when plugins have a
  // fully isolated signed/declarative runtime.
  'script-src': "'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  'style-src': "'self' 'unsafe-inline'",
  'font-src': "'self' data:",
  'img-src': "'self' data: blob: asset: http://asset.localhost https:",
  'media-src': "'self' data: blob: https:",
  'worker-src': "'self' blob:",
  // User-specified external image/AI endpoints require https, while local
  // ComfyUI and other opt-in services may be hosted on loopback interfaces.
  'connect-src': "'self' blob: data: https: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* ipc: http://ipc.localhost",
}
