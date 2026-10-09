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
- Native window size/position/maximized state is remembered by the Rust window-state plugin; the editor still owns its dock/panel layout separately.
- Embedded release builds have a CSP blocking remote scripts and objects. Custom JS plugins require a documented `unsafe-eval` exception; the development server and optional remote thin shell do not inherit the embedded-release CSP.
- Recent & Recovery snapshots can be exported as portable `.zproj.json` files, including backup to a user-selected folder where supported.
- Optional Windows Authenticode signing uses Actions secrets `WINDOWS_CODESIGN_PFX_BASE64` and `WINDOWS_CODESIGN_PFX_PASSWORD`; unsigned builds remain available when these are unset.
- No custom IPC commands are exposed (see `capabilities/default.json`). See [offline audit](../docs/WEBVIEW_OFFLINE_AUDIT.md) for network-dependent features and the limits of automated offline testing.

Full instructions: see [`DISTRIBUTION.md`](../DISTRIBUTION.md).
