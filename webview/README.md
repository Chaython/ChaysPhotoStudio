# Webview shell — Chay's Photo Studio (Tauri v2)

A ~3 MB native app that opens your **deployed** Chay's Photo Studio in the
operating system's webview (WebView2 / WKWebView / webkit2gtk) — no bundled
Chromium, no Node server. The editor itself is the web build; this shell is
just the window.

- **Dev:** `bun run webview:dev` — shell pointing at `http://localhost:3000`
- **Release:** `bun run webview:build` — points at `WEBVIEW_APP_URL`
  (scripts/webview-config.mjs writes the merged `tauri.conf.release.json`)
- Requires Rust (`rustup`) plus, on Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev`
- `dragDropEnabled: false` — lets the editor's own HTML5 drag & drop work.
- No IPC capabilities are exposed (see `capabilities/default.json`): the hosted
  web app is fully self-contained.

Full instructions: see [`DISTRIBUTION.md`](../DISTRIBUTION.md).
