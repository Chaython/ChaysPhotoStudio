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

## Image format coverage and camera RAW limitations

The editor has native/custom import paths for PNG, JPEG, WebP, GIF, AVIF (when supported by the browser), SVG, TIFF, PSD/PSB, TGA, Netpbm (PBM/PGM/PPM/PAM), PFM, Radiance HDR, QOI, PCX/DCX (first page), BMP/DIB, ICO/CUR, DDS, IFF/ILBM, ICNS, and now **SGI RGB/RGBA/BW** and **Sun Raster (.ras/.sun)**. For additional proprietary formats the app may extract only embedded preview images; HEIC, JXL and JPEG 2000 depend on the runtime's codecs.

**Camera RAW is currently preview-only, not real RAW development.** DNG, NEF/NRW, CR2/CR3/CRW, ARW/SRF/SR2, RAF, RW2, ORF, PEF/PTX, SRW, X3F, IIQ, MOS, MEF, MRW, RWL, GPR and other named RAW families are recognized and can import an embedded preview when present. The editor does not yet demosaic sensor data, process proprietary compression, or preserve RAW exposure latitude and 12–16-bit sensor data. RAW previews are opened as 8-bit images; the import notification states this clearly. If the file has no usable embedded preview or compatible native image decoder, import fails with an explicit error.

Real RAW development should use a maintained decoder (such as LibRaw in a WASM worker or a native desktop bridge), then add camera white balance, demosaic quality, color matrices/profiles, lens corrections, and a non-destructive development panel. Adding extensions alone cannot supply these capabilities.

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
