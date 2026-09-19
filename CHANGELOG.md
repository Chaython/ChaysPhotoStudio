# Changelog

Notable changes to Chay's Photo Studio. Versions follow semantic versioning.

## 1.3.0

- Rebuilt Magic Wand around a perceptual Lab region-grower with sample averaging, adaptive region color, edge protection, global/non-contiguous matching, anti-aliased grayscale output, smoothing/feathering, transparency matching, diagonal connectivity, composite/layer sampling, and a new Pixel Exact RGBA mode for sprites/icons.
- Selection workflows now share the grayscale mask/refinement pipeline across Magic Wand, Quick Selection, Object Selection, Color Range and Select & Mask.
- Added local AI-assist tools that always output editable layers: Depth Map, Denoise Assist, Depth Relight, and Vector Trace Guide, alongside Select Subject, Remove Background, Smart Remove and Smart Upscale.
- ComfyUI now stores separate workflows for inpaint, outpaint, upscale, depth, denoise, face restoration, relighting, colorization, vectorization, captioning and a custom recipe instead of forcing every task through one workflow slot.
- Added a real Electron native-filter bridge for optional installed G’MIC and GEGL executables. Filters run through audited IPC using temporary PNGs and `execFile` argv isolation (no shell interpolation) and return results as new layers.
- Plugin Manager now includes a Desktop Filters tab with G’MIC/GEGL detection, command execution and version reporting.
- Added Photoshop UXP import from manifest + JavaScript, compatibility diagnostics, per-plugin permission controls, plugin-scoped persistent storage, permission-gated network fetch, and a broader `batchPlay` subset (layers, merge/flatten/rasterize, image/canvas size, rotate and flip).
- Closed a plugin sandbox gap where worker code could use global `fetch` without requesting the `network` permission; plugin fetch now goes through the audited host RPC path.
- Expanded Clone Stamp and Healing Brush sampling to Current Layer or Composite, and added Protect Tones to Dodge/Burn to preserve chroma while adjusting luminance.
- Existing GIMP `.gbr` brush and `.ggr` gradient import remains integrated; Electron users can now bridge the wider GIMP/GEGL/G’MIC processing ecosystem without pretending full libgimp/PDB/Script-Fu compatibility exists.

## 1.2.0

- Windows Electron releases now include a separate `ChaysPhotoStudio-Portable-<version>-x64.exe` no-install build alongside the normal NSIS setup executable; local scripts can build both together or either target independently.
- Repaired the multi-platform release pipeline: Tauri now uses the valid `GraphicsAndDesign` bundle category, embeds the static editor by default, and no longer depends on GitHub Pages to launch.
- Added `dist:validate` CI preflight checks for Tauri categories, bundle targets, icons, identifiers, and package/Cargo/Tauri version agreement so distribution metadata failures are caught before matrix builds start.
- GitHub Pages deployment is now opt-in with `ENABLE_GITHUB_PAGES=true` after selecting GitHub Actions as the Pages source; a Pages permission/configuration problem no longer marks normal distribution builds red.
- Updated first-party GitHub Actions to current Node 24-compatible major versions and pinned Linux CI/release runners to Ubuntu 24.04 instead of the moving `ubuntu-latest` label.
- Added automatic local crash recovery backed by IndexedDB, plus a real **Recent & Recovery** browser with restore/delete/clear controls.
- Project format v2 now preserves animation frames, active selections, saved channels, guides, and per-document view state while remaining backward-compatible with v1 project files.
- **Save Project** now saves back to the same file on browsers with the File System Access API; added **Save Project As…** (`Ctrl+Shift+S`) with the normal download fallback elsewhere.
- Added **File > New from Clipboard** for instant screenshot/image workflows.
- Expanded vector shapes with triangle, configurable polygon, and configurable star tools, including point count, star inset, and optional strokes.
- Layers panel now supports live name search and type filters, plus Alt-click eye-icon solo/restore behavior for fast compositing.
- Added **Trim Layer to Content** to remove transparent raster padding without moving the layer in document space.
- Added one-click WebP and JPEG quick exports alongside PNG.
- Dirty documents now warn before closing a document or the browser/app window, complementing autosave recovery.

## 1.1.3

- Fixed the welcome screen's "Download source (ZIP)" link: on deployments without the bundled project archive (GitHub Pages, browser plugin) it pointed at a repository URL that never existed — it now downloads the always-current source archive of the default branch.
- Added a "Desktop & plugin builds" link next to it, pointing at the latest release page with the desktop installers, web bundle, and browser plugins.

## 1.1.2

- The browser plugin is now fully self-contained: the entire editor is bundled inside the extension, so it opens instantly, works offline, and no longer points at a local development server. Right-clicking any image still opens it straight onto the canvas.
- The web app is now also deployed to GitHub Pages on every push (https://chaython.github.io/ChaysPhotoStudio/), and the lightweight webview shell hosts that deployment by default.
- Fixed Windows and macOS desktop installers failing to build (native dependency rebuild and a malformed Windows icon are now resolved; installers build cleanly on all platforms).
- AI generation falls back to calling the free engine directly from the browser when no server is present (static deployments and the browser plugin), with the same automatic retries.
- The service worker now supports sub-path deployments, and source-zip links in static deployments point at the repository copy.

## 1.1.1

- Performance: path and selection tools (Pen, lassos, marquees, crop, measure) now repaint their previews on the overlay canvas only — dragging no longer recomposites the whole document, keeping the GUI responsive on large photos.
- Performance: panning and zooming (Hand tool, Navigator drag, zoom controls) re-blit the cached composite instead of recompositing, and selection changes no longer trigger full recomposites.
- Performance: the histogram panel samples a downscaled proxy of the composite instead of reading the full-resolution image.
- Images in dialogs no longer start native browser ghost-drags when clicked or dragged.
- AI Generate results can now be dragged from the dialog straight onto the canvas — the image is placed as a layer centered on the drop point.

## 1.1.0

- AI image generation now defaults to the free Pollinations engine (no account or key) with automatic retries; custom OpenAI-compatible endpoints work as before.
- Object detection now runs fully on-device (saliency + region analysis) — images never leave the browser.
- AI Upscale consolidated into the on-device precision engine (denoise → Lanczos-3 → edge-adaptive detail recovery).
- Every push to the default branch now builds all bundles (Electron installers, webview shells, browser plugin, web bundle) and publishes a GitHub Release automatically; `v*.*.*` tags publish stable releases.
- Fixed CI failing on fresh checkouts (Prisma client generation).
- Desktop installers: the packaged app is now named "Chays Photo Studio" (installer tooling rejects apostrophes in package paths); the app window keeps the full branded title.
- Added package metadata (description, author, homepage) required by Linux package builds.

## 1.0.0

Initial public release.

- WebGL2 editing engine: layers, masks, smart objects, smart filters, blend modes, non-destructive adjustments.
- Tools: marquee/lasso/wand selections, brush/pencil/pen, clone/heal/patch, gradients, type, shapes, crop, rulers and guides.
- Assisted selections (subject, quick, focus, color range), content-aware fill, object detection with one-click layer extraction.
- Image generation with style presets and batch output; on-device upscaling.
- Color engineering: curves, levels, HSL, selective color, raw-style adjustments, match color.
- Automation: action recording and playback, batch processing, scripting API, plugin system.
- Formats: PNG, JPEG, WebP, AVIF, TIFF, BMP, TGA, ICO, animated GIF, PSD import.
- Customizable keyboard shortcuts and toolbar layout with drag-and-drop tool pinning.
- Export pipeline with quality controls, resizing, and format conversion.
- Installable as a PWA; deep links (`?url=`); right-click "Edit image" browser plugin for Chrome and Firefox.
