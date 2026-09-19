# Webview shell — Chay's Photo Studio (Tauri v2)

A lightweight native desktop build that uses the operating system webview
(WebView2 / WKWebView / webkit2gtk) instead of bundling Chromium. Release builds
**embed the static Chay's Photo Studio web app by default**, so they do not depend
on GitHub Pages or another server and continue to launch offline.

- **Dev:** `bun run webview:dev` — Tauri points at `http://localhost:3000`; run the web dev server separately.
- **Release (recommended):** `bun run webview:build` — creates the plugin-flavor static export, validates it, then embeds it in the native bundle.
- **Optional remote thin shell:** `WEBVIEW_APP_URL=https://studio.example.com bun run webview:build`.
- Requires Rust (`rustup`) plus, on Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev`.
- `dragDropEnabled: false` lets the editor's own HTML5 drag-and-drop work.
- No IPC capabilities are exposed (see `capabilities/default.json`); the editor is self-contained.

Full instructions: see [`DISTRIBUTION.md`](../DISTRIBUTION.md).
