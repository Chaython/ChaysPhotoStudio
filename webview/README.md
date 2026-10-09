# Webview shell — Chay's Photo Studio (Tauri v2)

A lightweight native desktop build that uses the operating system webview
(WebView2 / WKWebView / webkit2gtk) instead of bundling Chromium. Release builds
**embed the static Chay's Photo Studio web app by default**, so they do not depend
on GitHub Pages or another server and continue to launch offline.

- **Dev:** `bun run webview:dev` — Tauri points at `http://localhost:3000`; run the web dev server separately.
- **Release (recommended):** `bun run webview:build` — creates the plugin-flavor static export, validates it, then embeds it in the native bundle.
- **Optional remote thin shell:** `WEBVIEW_APP_URL=https://studio.example.com bun run webview:build`. This override requires connectivity and is not the normal offline release.
- **Windows installation:** the default WebView NSIS setup embeds the editor, but on Windows without an existing WebView2 runtime the runtime may need to be installed separately/online. A second Windows offline-runtime NSIS installer is configured on **main** by merged [PR #85](https://github.com/Chaython/ChaysPhotoStudio/pull/85), and will be available when release jobs publish it.
- **Proposed hardening:** CSP, recovery exports, native window state, optional Authenticode and manual release checks are in [PR #86](https://github.com/Chaython/ChaysPhotoStudio/pull/86), **not yet merged**.
- Requires Rust (`rustup`) plus, on Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev`.
- `dragDropEnabled: false` lets the editor's own HTML5 drag-and-drop work.
- No IPC capabilities are exposed (see `capabilities/default.json`); the editor is self-contained.

Local filters and most editing work offline; external generation/image URLs do not. OS WebView codecs and File System Access support vary. See [Feature & Format Reference](../docs/FEATURES_AND_FORMATS.md) and [`DISTRIBUTION.md`](../DISTRIBUTION.md) for details.
