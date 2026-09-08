# Distributing Chay's Photo Studio

Chay's Photo Studio is a web-first editor (Next.js, App Router), so it ships through
**five channels** — everything below is automated by `.github/workflows/release.yml`:

| Channel | What it is | Best for |
|---|---|---|
| 🖥️ **Electron** | Full desktop app; embeds the Next.js standalone server + Chromium (works 100% offline, AI features included) | Power users, air-gapped machines, file associations ("Open with") |
| 🪶 **Webview shell (Tauri)** | ~3 MB native binary that opens your **deployed** editor in the OS webview (no bundled Chromium) | Lightweight install, always up-to-date |
| 🌐 **Self-hosted web** | `web-standalone.tar.gz` — the Next.js standalone server | Your own domain, intranets |
| 📱 **PWA (installable web app)** | Install button on the welcome screen + manifest + service worker | Chrome/Edge "Install app", Android, iOS A2HS — no store needed |
| 🧩 **Browser plugin** | Chrome MV3 extension (+ Firefox variant): right-click any image on the web → open it in Chay's Photo Studio | Browser-native workflow |

---

## 1. One-time repository setup

The pipeline needs three generated icon sets — commit them or let CI generate them:

```bash
bun install
bun run icons          # → public/icons, build/icons, webview/src-tauri/icons
```

Optional **repository variables** (GitHub → Settings → Secrets and variables →
Actions → *Variables*):

| Variable | Used by | Default |
|---|---|---|
| `WEBVIEW_APP_URL` | Tauri webview shell — where it loads the editor from | `http://localhost:3000` (with a build warning) |
| `EDITOR_URL` | Browser plugin — the baked-in editor location users can override in the popup | `http://localhost:3000` |

Set both to your deployed editor (e.g. `https://studio.example.com`) once you
host the web build.

## 2. Releasing (GitHub automation)

```bash
git tag v1.0.0
git push origin v1.0.0
```

That tag triggers **Release — Build & Distribute**, which:

1. builds the web bundle + icons (`web` job)
2. packages **Electron installers** on three runners — Windows NSIS
   (`ChaysPhotoStudio-Setup-*.exe`), macOS universal DMG, Linux AppImage + `.deb`
3. builds the **Tauri webview shell** per OS (deb/AppImage, NSIS, dmg+app)
4. zips the **browser plugin** (Chrome + Firefox variants)
5. creates a **draft GitHub Release** containing every asset + `SHA256SUMS.txt`
   (review it, then click *Publish*)

A manual run (Actions → *Release — Build & Distribute* → *Run workflow*) builds
all artifacts without publishing a release.

> **macOS signing (optional):** CI builds are unsigned (`identity: null` in
> `electron-builder.yml`). To sign locally:
> `CSC_NAME="Developer ID Application: …" bun run app:dist:mac`. Windows SmartScreen
> will warn on unsigned installers until enough installs or an EV/OV certificate
> is used.

## 3. Building each channel locally

```bash
bun run icons                 # icons for every channel
bun run build                 # Next.js standalone build (self-contained)

# Electron (requires the devDependency electron + electron-builder)
bun run app:dev               # dev shell against http://localhost:3000
bun run app:prepare           # assemble build/electron/app
bun run app:dist              # package for your current OS
bun run app:dist:win          # …or explicitly --win / --mac --universal / --linux

# Browser plugin
bun run ext:build                                  # zips into build/extension/
EDITOR_URL=https://studio.example.com bun run ext:build   # bake your URL

# Tauri webview shell (requires Rust; uses the OS webview)
bun run webview:dev                                  # shell on localhost:3000
WEBVIEW_APP_URL=https://studio.example.com bun run webview:build

# Self-hosting the web bundle
tar -xzf web-standalone.tar.gz && PORT=3000 node server.js
```

## 4. Installing the browser plugin (end users)

**Load unpacked (dev / private use):**

1. Build or download `build/extension/unpacked/` (artifact `browser-extension`)
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked**
   → select the folder
3. Right-click any image → **Edit image in Chay's Photo Studio**
4. Click the toolbar icon to set your editor's URL (default baked from `EDITOR_URL`)

**Chrome Web Store:** upload `build/extension/chays-photo-studio-extension-*.zip`
(Developer Dashboard → New item). **Firefox (addons.mozilla.org):** upload
`chays-photo-studio-extension-firefox-*.zip` — same code, event-page background.

The plugin needs **no host permissions**: the context menu works everywhere, and
the editor page itself fetches the image URL (sites that block cross-origin
fetches show a friendly error asking the user to save the file first).

## 5. PWA — "install as an app" from the browser

Serve the site over **https** (or localhost). The welcome screen shows an
**Install as an app** button (Chrome/Edge/Android), the manifest installs
windowed standalone mode, and the service worker (`public/sw.js`) caches the
app shell for offline launch — AI endpoints gracefully degrade to their
connection-required error states.

## 6. Deep-linking images (all channels)

`https://your-host/?url=<image-url>` opens that image straight onto the canvas —
this is what the browser plugin's context menu uses, and it's handy for sharing
"edit this" links. Electron additionally registers file associations
(png/jpg/webp/gif/bmp/tiff/avif/psd) so double-clicking a picture can open it
in the desktop app.

---

## License (applies to every channel)

© Chaython Meredith. Free for consumer and education use; commercial use
requires a license — **chaython@live.ca**. Support development:
<https://github.com/sponsors/Chaython>. See `LICENSE`.
