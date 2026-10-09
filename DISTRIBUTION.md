# Distributing Chay's Photo Studio

Chay's Photo Studio is a web-first editor (Next.js, App Router), so it ships through
**five channels** — everything below is automated by `.github/workflows/release.yml`:

| Channel | What it is | Best for |
|---|---|---|
| 🖥️ **Electron** | Bundles Chromium and a local Next.js standalone server; editor loads without external hosting | Desktop editing, file associations and Windows portable; network AI/providers still require their services |
| 🪶 **Webview shell (Tauri)** | Native OS webview (WebView2/WKWebView/WebKitGTK), embedded static editor by default | Smaller package; OS webview runtime and codecs must be present |
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

Optional **repository variable** (GitHub → Settings → Secrets and variables →
Actions → *Variables*):

| Variable | Used by | Default |
|---|---|---|
| `WEBVIEW_APP_URL` | Optional Tauri thin-shell URL override | unset — Tauri embeds `build/webapp-export` |

The **browser plugin and default Tauri release are self-contained**. GitHub Pages
publishes the static live editor automatically from default-branch builds. The
repository's one-time Pages setting must use **Settings → Pages → Build and
deployment → Source → GitHub Actions**.

## 2. Releasing (GitHub automation)

**Every push to the default branch** (`main`/`master`) triggers **Release — Build &
Distribute**, which:

1. validates distribution metadata, then builds the web bundle + icons + static exports (`web` job)
2. deploys the **static live editor to GitHub Pages** from the default branch
3. packages **Electron desktop builds** on native platform/architecture runners — Windows NSIS
   (`ChaysPhotoStudio-Setup-*.exe`) **and a no-install portable EXE**
   (`ChaysPhotoStudio-Portable-*-x64.exe`), macOS Intel + Apple Silicon DMGs, Linux AppImage + `.deb`
4. builds the **Tauri webview shell** per OS (deb/AppImage, NSIS, dmg+app), embedding the static editor by default
5. zips the **browser plugin** (Chrome + Firefox variants — editor bundled inside)
6. publishes a **continuous GitHub Release** (prerelease, tagged
   `v{version}-b{run number}`) containing every asset + `SHA256SUMS.txt`

To publish a **stable release** (marked as *Latest*, no prerelease flag):

```bash
git tag v1.3.0
git push origin v1.3.0
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
bun run dist:validate         # verify release metadata before packaging
bun run help:validate         # validate generated in-app Help and user guide

# Electron (requires the devDependency electron + electron-builder)
bun run app:dev               # dev shell against http://localhost:3000
bun run app:prepare           # assemble build/electron/app
bun run app:dist              # package for your current OS
bun run app:dist:win          # Windows x64: setup + portable EXE
bun run app:dist:win:setup    # Windows x64: NSIS installer only
bun run app:dist:win:portable # Windows x64: no-install portable EXE only
bun run app:dist:mac          # macOS current architecture
bun run app:dist:mac:x64      # macOS Intel
bun run app:dist:mac:arm64    # macOS Apple Silicon
bun run app:dist:linux        # Linux x64

# Browser plugin (self-contained — bundles the whole editor)
bun run ext:build            # generates icons, static export, then Chrome + Firefox zips

# Tauri webview shell (requires Rust; uses the OS webview)
bun run webview:dev                                  # devUrl: localhost:3000
bun run webview:build                                # static editor embedded; offline-capable
WEBVIEW_APP_URL=https://studio.example.com bun run webview:build  # optional remote thin shell

# Self-hosting the web bundle
tar -xzf web-standalone.tar.gz && PORT=3000 node server.js
```


### Windows Electron: installer vs portable

The Windows Electron job publishes **two choices** from the same application payload:

- `ChaysPhotoStudio-Setup-<version>.exe` — normal NSIS installer. It can create
  shortcuts, register file associations, and uninstall normally.
- `ChaysPhotoStudio-Portable-<version>-x64.exe` — single-file, **no-install** build.
  Run it from Downloads, an external drive, or any writable folder. It does not
  install/uninstall or register Windows file associations.

The portable target is built directly by electron-builder; it extracts its runtime temporarily when launched and generally needs no administrator access. A no-install executable is not the same as a fully isolated user-data profile: back up editable projects separately.

### Default Tauri and proposed offline installer

The default Tauri release bundles local static editor assets (`build/webapp-export`) and uses the **system WebView**; that is different from bundling a WebView2 runtime installer. A normal Windows NSIS installer may need internet to provision WebView2 when it is missing. The independent Windows NSIS **offline WebView2 installer** is in [PR #85](https://github.com/Chaython/ChaysPhotoStudio/pull/85), not yet merged into `main`. Its planned release asset prefix is `webview-windows-offline-x64--`; only use that filename after the PR has merged and produced a release.

A separate [WebView hardening and recovery PR #86](https://github.com/Chaython/ChaysPhotoStudio/pull/86) proposes an embedded-release CSP, native window state restoration, recovery-backup exports, an optional manual release checker and optional Authenticode signing. None are assumed to be in the latest stable build until merged. The required Windows code-signing secrets and updater keys are **not** supplied by the repository.

### Offline versus online features

| Feature | Network requirement |
|---|---|
| Bundled Electron / embedded Tauri editor UI and local image editing | No external server needed |
| Existing WebView2 on Windows | Can run offline; a clean machine may need provisioning at install time |
| Browser PWA first installation | Requires access to the website; later cache availability depends on the browser |
| Local project files and IndexedDB recovery | Stored locally, but profile deletion can erase recovery data |
| Remote images, Pollinations/custom AI generation, GitHub release updates | Requires network; content may be sent to external services |
| Optional local ComfyUI / G'MIC / GEGL | Requires separate executable/service installation; ComfyUI static-WebView integration may be limited |

For detailed format and privacy limitations, see [Feature & Format Reference](docs/FEATURES_AND_FORMATS.md).

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

The plugin is **self-contained and offline-capable** for local editing: the entire editor ships inside the extension. Opening a remote image still needs an accessible URL and browser permissions/CORS; remote AI generation contacts the selected external service and is **not available offline**.

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
