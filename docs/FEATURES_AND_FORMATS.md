# Feature, format and compatibility reference

This guide documents **the current `main` branch**. It distinguishes an import extension being *recognized* from successful decoding, editing with intact structure, and round-trip export. See [README](../README.md), [Tool Parity Audit](../TOOL_PARITY.md), [User Guide](USER_GUIDE.md), [Distribution](../DISTRIBUTION.md), [Development & Testing](DEVELOPMENT_AND_TESTING.md), and [Changelog](../CHANGELOG.md).

## Feature availability at a glance

The current tool registry has **52 tools** across Move, Selection, Sampling, Crop/Measurement, Painting, Retouching, Drawing/Type and Navigation. Several tools share a default shortcut and cycle on repeated presses. You can change shortcuts in **Help → Keyboard Shortcuts**. This number counts tools, not every menu command, layer effect or panel.

| Area | Working functionality | Important limit |
|---|---|---|
| Workspace | Classic/custom and Photoshop-style layouts; eight dock destinations (left/right/top/bottom + four corners), automatic content-fit dock sizing and independent manual overrides, floating panels and searchable All Tools dialog; multiple themes and touch mode | Some complex drag/drop and panel arrangements still need real browser verification |
| Brushes | Brush, Pencil, Mixer, Erasers, History/Art History, procedural/imported brush tips, pen-pressure/tilt mappings, symmetry and dynamics | Some tips and third-party brush engines have limited fidelity |
| Selection | Marquee (including single row/column), Lasso/Polygon/Magnetic, Magic Wand, Quick/Object Selection, Selection Brush, Color Range, Focus Area, Select Subject, Select & Mask | Subject/complex hair segmentation quality varies; optional AI engines are not always local |
| Paths and text | Pen, Freeform Pen, Curvature Pen, Horizontal/Vertical Type Mask, Path/Direct Selection, editable text, shape layers and path-derived shapes | Advanced vertical typography, curve fitting and Photoshop round-trip fidelity remain limited |
| Retouch | Clone/Pattern stamps, Healing/Spot Healing, Patch, Content-Aware Move/Fill, Red Eye, Color Replacement, Blur/Sharpen/Smudge, Dodge/Burn/Sponge | 16/32-bit destructive edits can require guarded paths; unsupported combinations should refuse rather than quantize |
| Compositing | Layers, masks, adjustment layers, clipping, Blend-If/Layer Styles, groups, Smart Objects/Filters, Layer Comps, vector paths | Not every imported PSD/PSB live effect maps exactly onto the editor |
| Layout and transform | Free Transform, Warp/Split Warp, Puppet Warp, crop/perspective crop, Smart Guides, rulers, canvas/layer alignment and distribution | 32-bit geometry and compound layer interactions have conservative safety restrictions |
| Color | Histogram/info readouts, adjustment and channel workflows, proof colors/gamut warnings, supported high-depth/HDR operations, resolution metadata | HDR operation support depends on working-pixel representation; ICC/CMYK proofing is approximate |
| File Info | Searchable EXIF/IPTC/XMP/ICC metadata with supported editable descriptive fields, metadata-conscious exports/sidecars | Not all vendor-specific tags are editable or round-tripped |

### Layer, selection and adjustment workflow

Use separate layers for painting and imported assets. **Layer → New Adjustment Layer** keeps many tonal/color changes editable. **Layer → Layer Mask** supports Hide/Reveal selection, copy/paste/replace, enabling/disabling and applying raster masks where valid. Use vector masks, clipping masks and path-to-shape conversion for geometric workflows. **Layer → Layer Style** includes editable effect settings and style clipboard commands.

**History:** one-step undo/redo is not a replacement for named snapshots. The **History** panel can save durable snapshots with notes; restore or compare them independently from recent undo. **Layer Comps** store layer-state variants and provide export workflows.

**Selection cleanup:** **Select → Modify** includes Border, Smooth, Expand, Contract and Feather; **Select → Grow (Similar Colors)** expands connected similar-color regions, while **Similar** finds disconnected matching colors. **Select and Mask** allows edge refinement and mask-oriented output. **Edit → Stroke Selection…** adds the selection boundary to a separate layer.

### High-bit-depth/HDR behavior

The editor includes 16-bit-float and 32-bit scene-linear infrastructure, guarded native/float pixel read/write paths, HDR-aware compositing and selected high-depth fills/transforms. Do **not** interpret that as universal 16/32-bit fidelity for every filter, tool, codec, plugin or PSD round trip.

- The active document's working depth and the chosen operation govern whether pixels are retained at high precision.
- Imported/converted TIFF and selected HDR sources can contain more than 8-bit samples.
- Some destructive retouch operations are blocked where a preview-only Canvas2D path would lose precision; use non-destructive workflows or an 8-bit duplicate when necessary.
- 32-bit HDR Merge, Flatten and related operations have compatibility guards for unsupported stacks rather than silently flattening to SDR.
- Verify scene-linear values and metadata before delivering scientific or HDR-critical projects.

## Format support

### Open/import: capability classes

| Input | Current behavior | Caveat |
|---|---|---|
| PNG, JPEG, GIF, WebP, AVIF, SVG | Uses the webview/browser decoder where possible | Alpha, animation and specific bit depths are runtime-dependent |
| PSD / PSB | Layered 8-/16-bit RGB import/export and simple 32-bit RGB (Float32) import/export, including Photoshop Lr16/Lr32 blocks and ZIP prediction; PSD and PSB v2 writing | Imported Photoshop text, shapes, groups, adjustments and Smart Objects are not yet reconstructed as their native editable counterparts. Export warns before rasterizing or omitting these. Complex 32-bit HDR compositing/interchange, modern FX descriptors and complex ICC/CMYK remain incomplete. |
| TIFF / TIF | Dedicated TIFF reader (supported 8/16-bit, selected compression) | Floating TIFF and some uncommon compressions/color models aren't universal |
| BMP, TGA, QOI, PNM/PPM/PGM/PBM/PAM, PFM, Radiance HDR, PCX, ICO/ICNS, DDS/IFF/ANIM | Dedicated/native/fallback codecs according to format | Not all subtypes or compression variants decode; verify output |
| OpenRaster (.ora), XCF, Krita/Sketch/other project containers | Dedicated structured parsers for supported cases; otherwise embedded preview or raster fallback | Original editable effects and vector/text fidelity vary by container |
| PDF, EPS/AI and design/document containers | Selected embedded images, objects/text and preview extraction | Not a full PDF/Illustrator/InDesign rendering or editing engine |
| HEIC/HEIF, JPEG XL, JPEG 2000 | Runtime-native decode where available or suitable fallback/embedded preview | Browser/WebView codec availability varies; recognized extension ≠ decoder |
| Camera RAW (DNG, NEF, CR2, CR3, ARW, RW2, RAF, ORF etc.) | Lazy LibRaw/WASM sensor decode, adjustable development settings, optional original-source RAW Smart Objects (up to 64 MiB), imported Lensfun XML calibration for unambiguous matches; embedded-preview fallback | Six selected camera samples passed sensor-decode checks; untested compression variants, exact color/orientation and RAW round-trip are not guaranteed. Oversized originals cannot be embedded |
| OpenEXR and specialized scientific/medical images | Supported regular scanline/tiled and multipart EXR with NONE/RLE/ZIP/ZIPS compression; FITS; DICOM uncompressed and selected encapsulated RLE/JPEG/JPEG-LS/JPEG 2000 transfer syntaxes; multipage TIFF/DCX | Deep/multiresolution EXR, other compressors, additional DICOM variants, high-depth output and diagnostic accuracy are not guaranteed |
| MP4, WebM, MKV | Local video preview and timestamp-based frame extraction | Only imports a still frame, not an editable video timeline |
| Native `.zproj.json` | Editable project round-trip | Prefer this for work-in-progress; backups depend on the chosen storage location |

**Do not rely on an extension appearing in the Open dialog as a guarantee of compatibility.** Supported file *families* do not imply every color profile, camera, compression mode, page, animation, metadata tag, proprietary layer, or HDR representation is supported.

### Export/save

| Output | Notes |
|---|---|
| `.zproj.json` native project | Recommended for continued editing: layers, supported masks/selection/channel state and editor project data |
| PNG / JPEG / WebP | Quick Export and Export As; JPEG is flattened and has no alpha |
| TIFF | Export As supports configured 8-/16-bit raster paths, lossless compression and selected metadata |
| BMP / TGA / QOI / PPM / ICO | Raster exports with format-specific alpha/palette/size constraints |
| OpenRaster (.ora) | Layer-oriented interchange; effects not represented in ORA may be rasterized |
| Photoshop PSD | Supported layered export; verify complex layer effects/Smart Object compatibility in Photoshop |
| Export Layers to Files | Outputs per-layer rendered files; unsupported or intrinsically pixel-less adjustment layers may be skipped |
| Layer Comps export | Automates exports of selected saved layer-state variants |
| File Info / metadata | Supported XMP/IPTC/EXIF descriptive fields and optional metadata stripping |

When interoperability matters, test with a small representative project, reopen the exported file, and compare layers/effects/precision to the original.

### Incoming format/codec work, not yet on `main`

- [PR #79](https://github.com/Chaython/ChaysPhotoStudio/pull/79) — broader RAW development, OpenEXR/HDR, newer image codecs, FITS/DICOM and multi-page imports.
- [PR #84](https://github.com/Chaython/ChaysPhotoStudio/pull/84) — RAW Smart Object workflow, lens corrections, extended EXR/DICOM decoding.
- Additional cross-camera RAW compatibility and a vetted BPG decoder remain unverified; do not describe them as universally supported.

## Plugins and scripting

**Native scripting and Actions:** editor Actions automate recorded steps; Batch/Image Processor can apply an Action to multiple files and export results. Scripting Console exposes supported API commands, not a universal Photoshop API.

**Photoshop UXP:** optional manifest/JS compatibility bridge supports a subset of commands and `batchPlay` descriptors. Arbitrary UXP plugins, native C/C++ binaries, or Adobe-only APIs may not work.

**GIMP (merged PR #83):** `.gbr` brushes, `.ggr` gradients, related GIMP assets, GEGL operation discovery, curated G'MIC command browsing, and GIMP script analysis are available. In **Electron only**, a separately installed **GIMP 3** executable can discover and invoke supported noninteractive PDB procedures and explicitly chosen Python/Script-Fu source in a new GIMP process. GIMP filters return a temporary PNG imported as a new layer, **not** high-depth RAW/PSD round-tripping. This executes code under the user's OS permissions: run only trusted scripts. Embedded interpreters provide a limited Scheme subset, or opt-in Pyodide Python WASM loaded **only when used** from a remote CDN; they do not implement GIMP GI/PDB or image editing.

**Trust model:** never import third-party plugins you don't trust. Plugins can request capabilities; compatibility scripts are not a guarantee of complete sandbox isolation. Keep copies of project files before testing experimental plugins.

## Offline use and privacy

| Channel / feature | Offline expectation |
|---|---|
| Browser-hosted live editor | Requires access at initial load; the PWA may use cached shell assets after installation |
| Default Electron build | Locally bundled application and server; doesn't require GitHub Pages |
| Default Tauri build | Static editor assets embedded with release CSP; native window state is restored. The OS WebView runtime must be present/provisioned; the separate Windows offline installer bundles WebView2 provisioning |
| Browser extension | Editor bundled locally; opening a *remote* image URL still requires that image to be reachable and CORS-permitted |
| Painting/layers/local filters/project files | Designed to process locally without uploading source documents |
| Pollinations/custom remote generation and remote image URLs | **Internet required**; content submitted to an external provider can leave the device |
| Local ComfyUI, G'MIC, GEGL or GIMP 3 | Separate installation; native GEGL/G'MIC/GIMP 3 execution is Electron-only. Pyodide embedding downloads a runtime on first explicit use |
| External links/updates | Internet required |

On current `main`, recovery snapshots live in IndexedDB. **Recent & Recovery** now supports per-snapshot `.zproj.json` downloads and a user-selected folder backup where supported. This is a **manual** backup and not a scheduled external copy; clearing the profile can still erase unexported snapshots. Merged [PR #86](https://github.com/Chaython/ChaysPhotoStudio/pull/86) also adds embedded-release CSP, native window-state persistence, a user-initiated release check and optional Authenticode support (which needs signing credentials). A separate Windows offline WebView2 NSIS installer has been configured on `main` in [PR #85](https://github.com/Chaython/ChaysPhotoStudio/pull/85) and will appear when a successful release publishes it.

## Known compatibility limits

- **Runtime differences:** WebGL2, WebGPU, Float16 rendering, canvas decoder support and the File System Access API vary by Chromium, Firefox, operating system and embedded WebView.
- **RAW:** LibRaw sensor development and redevelopable Smart Objects are available for supported files, but broad proprietary compression, Lensfun matching, color fidelity and 16/32-bit editing remain unverified. Unsupported sensor files may fall back to embedded JPEG previews.
- **PSD/PSB:** proprietary effects, blend modes, Smart Objects, channels and high-depth combinations can behave differently than in Adobe Photoshop.
- **PDF/design documents:** best-effort parsers do not guarantee exact fonts, vector geometry or multi-page layouts.
- **AI:** local heuristics and optional ComfyUI/remote providers have different accuracy, costs, network requirements and file-transfer implications.
- **HDR:** not all filters preserve scene-linear Float32 values; the editor must refuse unsafe edits rather than silently rasterize high-depth content.
- **GIMP/UXP:** an imported asset or script manifest is not equivalent to a complete host runtime.
- **WebView Windows offline installation:** static packaging checks cannot prove installation on a clean, disconnected VM; this requires separate acceptance testing.

For detailed operation-level caveats, see [TOOL_PARITY.md](../TOOL_PARITY.md); for current bug reports use [GitHub Issues](https://github.com/Chaython/ChaysPhotoStudio/issues).

## Debugging and validation

```bash
bun run tools:validate       # definitions, registry, shortcuts and tool lifecycle
bun run help:generate        # rebuild the generated help markdown after editing topics
bun run help:validate        # in-app Help / markdown synchrony
bun run dist:validate        # distribution metadata, icons and version consistency
bun run autosave:validate    # autosave scheduling
bunx tsc --noEmit            # TypeScript
bun run lint                 # ESLint
```

The `scripts/` directory also contains dedicated HDR, history, fill, selection, worker, preview, layer and transform regression checks. See [CI](../.github/workflows/ci.yml) for the complete verified list.
