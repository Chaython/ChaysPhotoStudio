# Changelog

Notable changes to Chay's Photo Studio. Versions follow semantic versioning.

## 1.3.0

- Fixed undo/redo and History Snapshot state corruption: raster/Smart Object canvases, layer masks, selection masks, saved alpha channels and HDR pixels are frozen independently of live buffers; nested editable layer properties are copied, while unchanged versioned pixels are shared only between immutable History entries to limit memory use.

- Fixed File Info XMP round-tripping: sidecar XML is parsed as a complete packet, embedded XMP scans pair matching outer tags instead of truncating at `</rdf:RDF>`, and unsupported/invalid sidecars cannot silently overwrite existing editable metadata.

- Added **Edit > Puppet Warp…** with draggable source-space pins, exact mesh intersections, pin rotation, overlap-priority depth, mesh density/rigidity controls, optional mesh display and responsive downscaled preview; Smart Objects retain the resulting warp non-destructively, while raster/text/shape targets reuse the existing mask/vector-mask/history transform path. Also guarded raster Transform Warp on 32-bit HDR layers to prevent stale authoritative Float32 pixel data.
- Added Photoshop-style **Proof Setup**, **Proof Colors** (`Ctrl+Y`) and **Gamut Warning** (`Ctrl+Shift+Y`) as cached display-only transforms, with sRGB/Display P3/Adobe RGB/SWOP/Gray presets, rendering-intent controls, paper simulation, black-point compensation, project persistence and custom matrix RGB ICC/ICM loading; proofing never alters pixels, History, sampling or exports.
- Added PSD Layer Style round-trip support: legacy Photoshop `lrFX` shadows/glows/bevel/color-overlay import as editable native effects, PSD export regenerates compatible `lrFX`, and a Photoshop-ignored `chFX` block preserves Chay's complete native FX stack including stroke, gradient, pattern and satin while untouched modern `lfx2/lmfx/lfxs` blocks remain losslessly preserved.
- Added **Layer > Duplicate Into…** with destination-document and rename controls, plus Layers-panel/canvas context-menu access; duplication now deep-copies masks, vector masks, HDR data, Smart Object state, Smart Filters, Blend-If, Layer Styles and retained PSD metadata instead of sharing nested layer state.
- Added **Layer > Matting** with selection-aware **Defringe**, **Remove Black Matte**, and **Remove White Matte**, plus matching canvas/Layers-panel context commands; matte cleanup preserves alpha and offset-layer pixels while guarding 32-bit HDR.
- Added **Image > Calculations…** with two independent document/layer/channel sources including saved alpha channels, inversion, blend modes plus Subtract, opacity, optional selection masking, and Selection/New Channel/New Document outputs; new alpha channels can be created without replacing the active selection.
- Fixed **Linear Dodge (Add)** CPU/Canvas compositing to use the standards-compliant `lighter` operation instead of the invalid `add` globalCompositeOperation value.
- Added **Image > Apply Image…** with same/cross-document sources, merged or individual layers, RGB/R/G/B/Alpha channels, invert, opacity, blend modes, preserve-transparency and automatic selection masking; 32-bit HDR is guarded until scene-linear Apply Image blending is available.
- Added **File > Export Layers to Files…** with PNG/JPEG/WebP output, visible-only filtering, transparent-bound trimming, File Info metadata control, quality/prefix options, folder-picker support and browser download fallback; isolated rendering preserves masks, Blend-If and Layer Styles without mutating the document.
- Added Photoshop-style **Copy Layer Style**, **Paste Layer Style**, and **Clear Layer Style** commands to the Layer menu plus Layers-panel and canvas right-click menus, using a deep-copied non-destructive FX clipboard with proper undo history.
- Expanded File Info with IPTC Core creator contact, sublocation and rights-usage fields plus IPTC Extension event/people and scene/subject metadata; added XMP sidecar import/export for transferring editable metadata between documents.
- Move Smart Guides now infer equal spacing when a dragged layer or layer group is nearly centered between two neighboring layers; grid snapping respects per-axis Smart Guide/guide snaps instead of overriding them.
- Move now shows Photoshop-style live pixel distance measurements to the nearest overlapping layers or canvas edges while dragging, with magenta measurement ticks/badges and a separate Distance Labels toggle.
- History Snapshots now support project-persistent notes and a per-document automatic-first-snapshot policy (Use Global / Always / Never); the History panel shows notes inline and can edit them without changing the captured image state.
- File Info is now editable for imported and new documents, with Photoshop-style title/caption, author, keywords, credit/source, copyright, location, job ID and rating fields that persist in project files.
- PNG, JPEG, WebP, TIFF and layered PSD exports can write edited XMP/IPTC metadata and document PPI; Export As, Batch/Image Processor and Layer Comp export include explicit metadata controls, while Quick Export and scripting preserve File Info by default.
- Browser-native image imports now derive document resolution from EXIF/PNG physical-resolution metadata instead of silently falling back to 72 PPI. Source camera/GPS EXIF remains view-only and is not automatically copied into edited exports.
- Added an ExifGlass-style dockable **Metadata / File Info** inspector that reads original source bytes before decoding and exposes searchable EXIF/TIFF, GPS, XMP, IPTC, ICC, JPEG/PNG/WebP/PSD and Photoshop resource metadata, with raw XMP, copy tools and JSON export.
- Source metadata now persists with project files (project format v5) and duplicated documents; **File > File Info / Metadata…** and **Window > Metadata** expose the inspector while older v1-v4 projects remain compatible.
- Fixed the Properties panel incorrectly reporting every document as RGB/8; it now reports actual working color space, 8/16/32-bit depth and PPI.
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
