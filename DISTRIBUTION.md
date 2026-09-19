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
| `WEBVIEW_APP_URL` | Tauri webview shell — where it loads the editor from | `https://chaython.github.io/ChaysPhotoStudio/` (auto-deployed by the same workflow) |

The **browser plugin is self-contained** — it bundles the whole editor inside the
extension and needs no URL, server, or host permissions. GitHub Pages is enabled
automatically on the first release run.

## 2. Releasing (GitHub automation)

**Every push to the default branch** (`main`/`master`) triggers **Release — Build &
Distribute**, which:

1. builds the web bundle + icons + static exports (`web` job)
2. deploys the **static web app to GitHub Pages** (auto-enabled on first run)
3. packages **Electron installers** on native platform/architecture runners — Windows NSIS
   (`ChaysPhotoStudio-Setup-*.exe`), macOS Intel + Apple Silicon DMGs, Linux AppImage + `.deb`
4. builds the **Tauri webview shell** per OS (deb/AppImage, NSIS, dmg+app)
5. zips the **browser plugin** (Chrome + Firefox variants — editor bundled inside)
6. publishes a **continuous GitHub Release** (prerelease, tagged
   `v{version}-b{run number}`) containing every asset + `SHA256SUMS.txt`

To publish a **stable release** (marked as *Latest*, no prerelease flag):

```bash
git tag v1.1.0
git push origin v1.1.0
```

A manual run (Actions → *Release — Build & Distribute* → *Run workflow*) publishes a
continuous-style release just like a push.

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
bun run app:dist:win          # Windows x64
bun run app:dist:mac          # macOS current architecture
bun run app:dist:mac:x64      # macOS Intel
bun run app:dist:mac:arm64    # macOS Apple Silicon
bun run app:dist:linux        # Linux x64

# Browser plugin (self-contained — bundles the whole editor)
bun run ext:build            # generates icons, static export, then Chrome + Firefox zips

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
4. Click the toolbar icon → **Open editor** — the full app runs inside the
   extension, no server required

**Chrome Web Store:** upload `build/extension/chays-photo-studio-extension-*.zip`
(Developer Dashboard → New item). **Firefox (addons.mozilla.org):** upload
`chays-photo-studio-extension-firefox-*.zip` — same code, event-page background.

The plugin is **self-contained and offline-capable**: the entire editor ships
inside the extension, it needs no host permissions, and the context menu works
everywhere. When AI generation is used, the free engine is called directly from
the browser.

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
