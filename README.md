# Chay's Photo Studio

A 100% browser-based raster image editor — a Photoshop-class feature set running on a
custom **WebGL2** engine. All editing (layers, filters, magic wand, object detection,
upscaling, and more) happens locally in your browser. AI image generation runs on the
free Pollinations engine (no account or key) or your own OpenAI-compatible endpoint.

![Chay's Photo Studio](public/icon.svg)

**Live app:** https://chaython.github.io/ChaysPhotoStudio/

## Help & user documentation

Click the **Help** button (?) in the upper toolbar or choose **Help → User Guide & Documentation…**. Browse and search the categorized documentation without leaving the editor, including offline web/desktop use. The **Stroke Selection** and **Offset** dialogs have contextual Help buttons.

The same manual is also readable on GitHub: **[User Guide](docs/USER_GUIDE.md)**. It covers Grow/Similar selections, Stroke Selection, Offset and seamless textures, layers, masks, Smart Objects, HDR, file exports, recovery and other workflows. Update `src/editor/help/topics.ts` and run `bun run help:generate` to regenerate the Markdown guide; CI checks they remain in sync.

The GitHub Pages site serves the editor itself. The commands below are only for running a local development copy.

## Quick start (local development)

```bash
bun install          # or: npm install
cp .env.example .env # sqlite database location
bun run db:push      # create the local database
bun run dev          # http://localhost:3000
```

> Node 20+ (or [Bun](https://bun.sh) 1.1+) is required.

## What's inside

| Path | Purpose |
| --- | --- |
| `src/` | The editor app (Next.js App Router + TypeScript + WebGL2 engine) |
| `electron/` | Desktop app shell (Electron main + preload) |
| `webview/` | Desktop webview shell (Tauri v2, ~3 MB, uses the system webview) |
| `extension/` | Browser plugin source (Chrome MV3 + Firefox event-page variant) |
| `scripts/` | Build tooling: icons, extension packaging, electron prep, webview config |
| `.github/workflows/` | CI + automated multi-channel release pipeline |
| `prisma/` + `db/` | Local SQLite schema (via Prisma) |

## v1.2 editing workflow upgrades

- **Crash recovery:** dirty documents are autosaved locally in IndexedDB and can be restored from **Recent & Recovery**.
- **Safer projects:** project v2 preserves selections, saved channels, guides, animation frames, view state, and the active layer; supported browsers also get true **Save** / **Save As** behavior.
- **Faster compositing:** search/filter large layer stacks, Alt-click a layer eye to solo/restore visibility, and trim transparent padding without moving artwork.
- **Richer vector shapes:** triangle, polygon, and star layers with configurable points, inset, fill, and stroke.
- **Quicker ingest/export:** create a document directly from the clipboard and quick-export PNG, JPEG, or WebP.

## v1.3 pro tools, AI and plugin compatibility

- **Selection engine:** perceptual/edge-aware Magic Wand, Pixel Exact mode, Quick/Object Selection and shared grayscale Select & Mask refinement.
- **Retouching:** Clone/Healing can sample the active layer or visible composite; Dodge/Burn includes Protect Tones; the brush engine includes symmetry, dynamics, scatter, smoothing and imported GIMP brush tips.
- **Local AI assists:** Select Subject, background masking, Smart Remove/Upscale, depth-map generation, denoise, depth relighting and vector-trace guides all keep outputs editable.
- **ComfyUI:** save a different local workflow for inpaint, outpaint, upscale, depth, denoise, face restoration, relight, colorize, vectorize and caption jobs.
- **Photoshop UXP bridge:** import manifest + JS, run a practical `batchPlay` subset, use plugin-scoped storage, inspect compatibility and explicitly grant sensitive permissions.
- **GIMP ecosystem:** native `.gbr`/`.ggr` assets plus optional desktop G’MIC and GEGL execution. G’MIC/GEGL results are added as new layers rather than destructively overwriting the source.
- **High-depth color & formats:** capable browsers can use a real 16-bit-float sRGB/Display-P3 working canvas; 16-bit TIFF/PNM stays high precision, TIFF exports at 16-bit, and PFM/Radiance HDR plus browser-supported HEIC/HEIF, JPEG XL and JPEG 2000 can be opened.

## Extended image formats and RAW development

**Camera RAW:** The editor now lazy-loads `libraw-wasm` to unpack supported DNG, Canon CR2/CR3, Nikon NEF, Sony ARW, Fujifilm RAF, Panasonic RW2, Olympus ORF and other camera RAW files. It requests **16-bit RGB output** rather than relying only on the 8-bit JPEG embedded preview. Before importing, the **RAW Import / Develop** dialog offers exposure (EV), camera/auto/neutral white balance, demosaicing quality, highlight mode, wavelet denoising and half-resolution processing. Settings are remembered locally; the original RAW is never overwritten. Unsupported proprietary compression may still fall back to an explicitly labeled **8-bit embedded preview**, or fail if no usable preview is present. RAW import offers a source-embedded Smart Object (up to 64 MiB) with **Layer → Redevelop RAW Smart Object…**. Lens correction currently uses manual distortion, TCA and vignette coefficients, not an automatically matched lens database.

**High dynamic range:** PFM, Radiance HDR and supported TIFF/PSD precision remain available. New OpenEXR import decodes **single-part scanline or single-level tiled EXR** with 16-bit half, 32-bit floating-point or unsigned integer channels and uncompressed/RLE/ZIPS/ZIP blocks. Deep, multipart, multiresolution-tiled and uncommon compression modes currently require a more complete OpenEXR codec. EXR scene-linear samples are retained for the HDR pipeline when available.

**Modern codecs:** HEIC/HEIF, JPEG XL, JPEG XR, JPEG-LS and JPEG 2000 now have lazy-loaded decoder fallbacks (libheif, libjxl, jxrlib, CharLS and a JS JPEG 2000 decoder), in addition to any native browser support. Format coverage may vary by codec variant and runtime; these are import paths, **not** new export encoders. BPG is recognized but rejected with an explicit unsupported-codec message because there is no reviewed decoder bundled; adding a nine-year-old unmaintained decoder without compatibility and security testing was avoided.

**Scientific/medical:** FITS (2-D images and up to 24 data-cube slices) and uncompressed little-endian DICOM Part-10 (8/16-bit monochrome or 8-bit RGB) open as display-rendered images. Their numeric data is contrast/window stretched for editing and not preserved as calibrated science/medical data. **DICOM rendering must never be used for diagnosis or clinical measurements.** DICOM RLE Lossless (`1.2.840.10008.1.2.5`) is supported for the same limited monochrome/RGB image layouts, including encapsulated single-frame data and multiframe files with a valid basic offset table; JPEG/JPEG-LS/JPEG 2000 and other DICOM transfer syntaxes remain unsupported.

**Legacy and multi-page:** TIFF and DCX can open up to 24 pages as layers or offer a **page/frame selector** with a preview. SGI RGB/RGBA/BW and Sun Raster import are also available, alongside existing QOI, PCX, IFF/ILBM, DDS, ICO/CUR, ICNS, BMP, TGA, Netpbm and other codecs. Some variants are still unsupported; only formats verified by their decoder are claimed.

Custom and WASM decoders are loaded on demand to avoid slowing the initial editor startup. Run `bun run formats:validate` for synthetic fixtures. For real proprietary RAW compression, supply a licensed camera fixture corpus and run `bun run raw-corpus:validate -- fixtures/raw/corpus.json`; see [corpus guidance](docs/RAW_CODEC_CORPUS.md).

The compatibility layers are intentionally honest: UXP coverage is partial, and legacy Photoshop `.8bf` plus full GIMP libgimp/PDB/Script-Fu are not claimed as universal drop-in runtimes. The native Chay plugin API remains the stable target while compatibility shims grow around it.

## Distribution channels

The same codebase ships five ways — see **[DISTRIBUTION.md](DISTRIBUTION.md)** for the
full matrix, GitHub release automation, and per-channel build instructions:

1. **Web** (self-hosted bundle)
2. **PWA** — installable straight from the browser (offline shell included)
3. **Electron** — full offline desktop app; Windows ships both an installer and a no-install portable EXE (`bun run app:dist`)
4. **Tauri webview** — lightweight native shell using the system webview; embeds the static editor by default (`bun run webview:build`)
5. **Browser plugin** — right-click any image → *Edit image in Chay's Photo Studio* (`bun run ext:build`)

Build everything at once:

```bash
bun run dist:all
```

## Licensing

Free for personal and educational use. See [LICENSE](LICENSE) — commercial licensing
and sponsorship: **chaython@live.ca** / [github.com/sponsors/Chaython](https://github.com/sponsors/Chaython).
