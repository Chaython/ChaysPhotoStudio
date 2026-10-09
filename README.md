# Chay's Photo Studio

A source-available, browser-first photo editor with layered editing, Photoshop-inspired workflows, a WebGL2-accelerated compositor, and desktop/browser distributions. It aims for useful **Photoshop / GIMP / Photopea workflow compatibility**, not full feature-for-feature or plugin-binary equivalence.

[**Open the live editor**](https://chaython.github.io/ChaysPhotoStudio/) · [**Download builds**](https://github.com/Chaython/ChaysPhotoStudio/releases) · [**User guide**](docs/USER_GUIDE.md) · [**Feature & format reference**](docs/FEATURES_AND_FORMATS.md) · [**Tool parity audit**](TOOL_PARITY.md) · [**Report an issue**](https://github.com/Chaython/ChaysPhotoStudio/issues)

![Chay's Photo Studio icon](public/icon.svg)

## Start editing

1. Open the live editor or install a release from GitHub. Use **File → New**, **Open…**, **New from Clipboard**, or drag a supported image into the editor.
2. Select a tool in the left toolbar. Modify size, shape, sampling, selection mode and other settings in **Tool Options**. Right-click a tool group or use **Edit → Customize Toolbar…** to organize tools.
3. Keep edits reversible with layers, masks, adjustment layers, Smart Objects / Smart Filters, named Paths, History snapshots and Layer Comps.
4. **File → Save Project** stores an editable `.zproj.json`. **Export As…** produces shareable raster or supported layered files. Use **File → Recent & Recovery…** after an interruption.

**Privacy & connectivity:** Most editing and local file processing run on your device; your images are not uploaded merely by opening them. **AI image generation and explicitly selected remote providers are network services** and may transmit prompts or image content. Optional local ComfyUI and desktop filter programs are separate installations. See [offline limitations](docs/FEATURES_AND_FORMATS.md#offline-use-and-privacy).

## Editor capabilities

| Area | Available in the current `main` branch |
|---|---|
| **48 registered tools** | Move/transform, rectangular/elliptical/single-row/single-column marquee; Lasso/Polygonal/Magnetic; Object/Quick/Brush selection; Magic Wand; crop/perspective crop; painting, erasers, healing, retouching, Pen/Path tools, editable Type/Shapes, Hand/Zoom |
| **Selections** | New/Add/Subtract/Intersect, Color Range, Select Subject, Focus Area, Grow/Similar, Select & Mask edge refinement, channels and luminosity selections, feather/smooth/contract/expand |
| **Layers & masks** | Raster, native text/shape, adjustments, Smart Objects with Smart Filters, alpha/vector masks, clipping, blending, Layer Styles, alignment, layer duplication into another document, Layer Comps |
| **History & automation** | Undo/redo, durable snapshots and snapshot notes, Actions recording/playback, Batch / Image Processor, scripting console |
| **Retouching** | Healing and Spot Healing, Patch, Content-Aware Move/Fill, Clone/Pattern Stamps and source transforms, Mixer/History Brushes, Dodge/Burn/Sponge, Blur/Sharpen/Smudge, red-eye correction |
| **Transforms** | Free Transform, editable Transform/Split Warp, Puppet Warp, crop/perspective crop, smart guides and distance labels; Liquify |
| **Color** | RGB/HSL/Lab and related adjustments, curves, gradient controls, HDR-aware operations where supported, proof-color preview and gamut warnings, PPI/rulers/guides/grid |
| **File information** | EXIF, XMP/IPTC, camera and GPS metadata inspection; editable File Info and metadata-aware export/sidecar workflows where supported |
| **Interface** | Classic/custom or Photoshop-style workspace, themes including OLED black, floating panels, left/right/top docks, touch-first mode, keyboard shortcut customization, lazy-loaded panels and dialogs |

The table is a **capability summary**, not a claim that every combination of file format, effect, layer type, bit depth, or Photoshop feature is supported. Review [the tool audit](TOOL_PARITY.md) and [known limits](docs/FEATURES_AND_FORMATS.md#known-compatibility-limits) before using unfamiliar formats on important files.

### Workspaces, tools and shortcuts

Choose **Photoshop-style** or **Classic / custom** from the Workspace selector. Color themes (Dark, Light, OLED black and Photoshop-inspired) are independent from workspace layout. On desktop, panels may be docked left/right/top or floated. The new all-tools search browser and bottom/corner docks are **not yet on `main`**; see [PR #81](https://github.com/Chaython/ChaysPhotoStudio/pull/81).

Open **Help → Keyboard Shortcuts** (or **Edit → Keyboard Shortcuts…**) to inspect/change bindings. Several Photoshop-style tools share a letter and **cycle** on repeated presses; they do not all have distinct default keys. The standard Pen is available; Freeform Pen, Curvature Pen and Type Mask variants are pending in [PR #82](https://github.com/Chaython/ChaysPhotoStudio/pull/82).

### File support in brief

**Open/import:** native PNG/JPEG/WebP/GIF/AVIF/SVG where the webview decodes them; custom PSD/PSB, TIFF, TGA, BMP, QOI, PNM/PFM, Radiance HDR, ICO/ICNS, PCX and other supported formats; some structured third-party project containers via dedicated parsers or raster preview extraction. Camera RAW, HEIC/HEIF, JXL, JPEG 2000 and exotic/partial document formats are **decoder- and platform-dependent**. RAW on `main` is primarily a preview-oriented import path, **not complete non-destructive RAW development**.

**Video frames:** open MP4/WebM/MKV to preview, scrub and **Import frame**; this does *not* create a video-editing timeline. **Export:** PNG, JPEG, WebP, TIFF (including supported 16-bit options), BMP, TGA, QOI, PPM, ICO, OpenRaster and PSD, plus native editable `.zproj.json`. Some advanced PSD features must be approximated or rasterized.

See [Feature & Format Reference](docs/FEATURES_AND_FORMATS.md) for categorized imports, exports and limitations. More RAW/EXR/DICOM support is being developed separately, not yet guaranteed in stable builds.

## Plugins, AI and filters

- **Native Chay plugins:** manifest/script extensions with a permission model and worker-based execution. Only install extensions you trust.
- **Photoshop UXP compatibility:** practical selected manifest, `batchPlay` and command APIs; not a complete UXP runtime and not binary Photoshop `.8bf` support.
- **GIMP compatibility:** imported brush `.gbr` and gradient `.ggr`; optional **G'MIC/GEGL** executable integration in Electron. GEGL/G'MIC are not bundled and require separate desktop installations. Arbitrary Python/Script-Fu/C GIMP plugins are not drop-in executable.
- **AI helpers:** local selection/subject, masks, cleanup and image analysis; optional ComfyUI workflows if independently configured; remote Pollinations/custom image generation requires internet and may transmit prompts or image data.

The expanded GIMP asset/filter browser and script analyzer are proposed in [PR #83](https://github.com/Chaython/ChaysPhotoStudio/pull/83); they are not part of the current main branch. See the [user guide](docs/USER_GUIDE.md#plugins-automation-and-optional-ai) for common workflows.

## Install, build and run

The editor is distributed via web/PWA, Electron desktop (including Windows portable), Tauri WebView, and Chrome/Firefox browser plugin. [**Distribution and releases**](DISTRIBUTION.md) lists package formats, GitHub Actions and signing behavior.

| Distribution | Local editor assets | Important distinction |
|---|---|---|
| **Web / PWA** | PWA caches the shell after installation | First load needs a hosted page; cached content and browser storage can be cleared |
| **Electron** | Bundled Next.js standalone server and Chromium | Runs a local server internally; does not require an external hosted editor |
| **Tauri WebView** | Default releases embed the static frontend | Uses installed OS WebView2/WKWebView/WebKitGTK; optional remote thin-shell needs internet |
| **Browser plugin** | Bundled static app in extension | Right-click images for import, subject to remote image access/CORS |

The extra Windows **offline WebView2 installer** is proposed in [PR #85](https://github.com/Chaython/ChaysPhotoStudio/pull/85). The CSP, native window persistence, recovery exports and manual update checker are proposed in [PR #86](https://github.com/Chaython/ChaysPhotoStudio/pull/86). Neither should be confused with current released builds until merged.

### Local development

Requires Node.js 20+ or a compatible recent Bun runtime; native desktop packages also require their platform toolchains.

```bash
bun install
cp .env.example .env     # adjust SQLite / Prisma environment if needed
bun run db:push
bun run dev              # http://localhost:3000
```

Run targeted checks before a PR:

```bash
bun run tools:validate
bun run help:validate
bun run dist:validate
bun run autosave:validate
bunx tsc --noEmit
bun run lint
```

Build/packaging entry points:

```bash
bun run build            # Next.js standalone web bundle
bun run app:dist         # Electron installer for host OS
bun run app:dist:win     # Windows Electron setup + portable
bun run webview:build    # Tauri static editor (requires Rust / OS SDK)
bun run ext:build        # Chrome and Firefox extension bundles
bun run dist:all         # Shared icons, web build, Electron & extensions (not Tauri)
```

**CI:** `.github/workflows/ci.yml` runs validations and build smoke tests; `.github/workflows/release.yml` produces per-platform artifacts, GitHub Pages and GitHub Releases with SHA-256 checksums. `bun run dist:all` is *not* a substitute for native cross-platform release jobs.

## Repository and documentation

| Path | Responsibility |
|---|---|
| `src/editor/` | Editor state, tools, layers, image processing, formats, plugins, workspace and Help content |
| `src/editor/help/topics.ts` | **Canonical in-app Help content**, generating `docs/USER_GUIDE.md` |
| `src/editor/constants/tools.ts` + `src/editor/tools/registry.ts` | Tool definitions, options, key groups and implementations |
| `src/editor/formats/` | File import/export handlers, structured document codecs and metadata |
| `electron/` · `webview/` · `extension/` | Platform-specific shells and installers |
| `scripts/` · `.github/workflows/` | Build, distribution, regression tests and CI |
| [**User Guide**](docs/USER_GUIDE.md) | Tutorials and troubleshooting, mirrored in the app |
| [**Feature & Format Reference**](docs/FEATURES_AND_FORMATS.md) | Formats, bit depth, runtime limitations and feature overview |
| [**Tool Parity Audit**](TOOL_PARITY.md) | Detailed implementation status and remaining parity work |
| [**Distribution Guide**](DISTRIBUTION.md) | Native builds, release artifacts, optional configuration and packaging |
| [**Changelog**](CHANGELOG.md) | Historical changes; upcoming PRs are not treated as released |

**Documentation maintenance:** Edit `src/editor/help/topics.ts` rather than directly changing the generated User Guide; run `bun run help:generate` and `bun run help:validate`. Feature claims should reflect merged code or be explicitly labeled pending.

## Licensing

Free for personal and educational use under a **non-commercial, source-available license**; commercial use requires licensing, and redistribution/modifications have additional restrictions. This is **not an OSI-approved open-source license**. See [LICENSE](LICENSE) for the authoritative terms. Commercial contact: **chaython@live.ca** · [Support development](https://github.com/sponsors/Chaython). The project is not affiliated with Adobe, GIMP or Photopea.
