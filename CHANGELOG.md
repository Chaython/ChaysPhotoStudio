# Changelog

Notable changes to Chay's Photo Studio. Versions follow semantic versioning.

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
