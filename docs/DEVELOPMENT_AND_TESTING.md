# Development, validation and documentation maintenance

This reference describes the **current `main` build system**, not features still waiting in open PRs. Begin with [README](../README.md), [Feature & Format Reference](FEATURES_AND_FORMATS.md), [Tool Parity Audit](../TOOL_PARITY.md) and [Distribution](../DISTRIBUTION.md).

## Setup

```bash
bun install
cp .env.example .env
bun run db:push
bun run dev
```

The editor uses Next.js App Router, TypeScript, WebGL2/Canvas2D, client-side document state and optional Prisma-backed server functionality. The static browser plugin and Tauri releases **do not ship the Next.js API routes**; the Electron release bundles the standalone server. Test both a server build and a static export when changes affect file loading, dynamic imports or optional AI.

```bash
bun run build
node scripts/export-webapp.mjs plugin
node scripts/webview-config.mjs
bun run ext:build
```

Static export files reside in `build/webapp-export`. The browser plugin reuses that export. The release WebView config points `frontendDist` to the same folder by default.

## Where behavior lives

| Edit | Primary source | What to verify |
|---|---|---|
| New/edit tool | `src/editor/constants/tools.ts`, `src/editor/types.ts`, `src/editor/tools/registry.ts`, specific file under `src/editor/tools/` | Tool definitions, options/defaults, shortcuts, pixel guards, idle rendering, `bun run tools:validate` |
| New/edit keyboard shortcut | `src/editor/shortcuts.ts`, `src/editor/keyboard-shortcuts.ts`, Tool Definitions, `src/editor/store.ts` | Conflicts with fixed commands, tool cycling and persistence |
| Menus / dialogs | `src/editor/constants/menus.ts`, `src/editor/components/dialogs/` | Enablement, keyboard access, lazy loading and touch layout |
| Dock/panel | `src/editor/components/panels/`, `src/editor/store.ts`, `src/editor/components/shell/` | Layout persistence, pointer/drag targets, minimum window dimensions |
| Raster/HDR engine | `src/editor/engine/`, `src/editor/image-ops/`, `src/editor/utils/canvas.ts` | 8-bit and 16/32-bit paths, safe no-ops, locked layers, history and worker cleanup |
| Image import/export | `src/editor/formats/`, `src/editor/engine/io.ts` | Magic-byte detection, fallbacks, precision, metadata, layered round-trip |
| Plugins / AI | `src/editor/plugins/`, `src/editor/ai/`, `src/editor/image-ops/generate.ts` | Permission boundaries, local vs network paths, missing-server handling |
| Recovery/history | `src/editor/engine/autosave.ts`, `src/editor/engine/history.ts` and snapshot/dialog code | Persisted data, stale async callbacks, restoration, profile/data-loss limits |
| Distribution | `scripts/`, `electron/`, `webview/`, `.github/workflows/` | Offline bundled resources, target OS toolchains, artifact names, checksums |

## Canonical user documentation

**Do not edit `docs/USER_GUIDE.md` alone.** The in-app Help and Markdown manual are generated from one source:

1. Add or update topics in `src/editor/help/topics.ts`.
2. Run `bun run help:generate` to refresh `docs/USER_GUIDE.md`.
3. Run `bun run help:validate`; CI verifies the entire generated output matches exactly.
4. Update [README](../README.md), [Feature & Format Reference](FEATURES_AND_FORMATS.md), [Tool Parity Audit](../TOOL_PARITY.md) and the appropriate shell README when the feature also changes capabilities.
5. Mark unmerged work as **pending** with PR links; never silently describe a proposal as already released.

For an added tool, register its `ToolId`, Tool Definition, `TOOLS` registry entry, group/shortcut behavior, relevant tool UI options and user help **in the same PR**. The `bun run tools:validate` check verifies these are mutually consistent.

For new formats, document *recognition*, *actual decode*, *retained structure*, *working precision* and *export* separately. A broad file-picker accept list does not prove universal compatibility. Include fixtures where redistribution permits, ideally with camera/model/compression details for RAW files.

## CI and regression tests

```bash
bun run tools:validate
bun run retouch-safety:validate
bun run warp:validate
bun run history:validate
bun run preview-lifecycle:validate
bun run selection-races:validate
bun run autosave:validate
bun run worker:validate
bun run worker-timeout:validate
bun run selection-pixels:validate
bun run selection-color:validate
bun run selection-stroke:validate
bun run offset:validate
bun run layer-alpha:validate
bun run layer-matting:validate
bun run float16-safety:validate
bun run layer-mask:validate
bun run hdr:validate
bun run hdr-composite:validate
bun run hdr-fill:validate
bun run hdr-object-layer:validate
bun run fill-coverage:validate
bun run help:validate
bun run dist:validate
bunx tsc --noEmit
bun run lint
```

The [CI workflow](../.github/workflows/ci.yml) also builds the web app, Electron payload, extension, GitHub Pages static export, and validates embedded WebView configuration. These checks are **not** a replacement for real WebView installation, GPU/HDR, Windows font/codec or large-project editing tests.

## Recommended manual smoke matrix

| Scenario | Verify |
|---|---|
| New document: 8-bit RGB | Open, brush, selection, mask, filter, save, close, reopen |
| 16-bit and 32-bit projects | No unexpected preview quantization or silent unsupported conversion |
| Layer modes | Raster, text, shape, adjustment, Smart Object, masks/FX and clipping survive project save/reopen |
| Metadata | EXIF/IPTC/XMP inspector, edits and metadata stripping where applicable |
| Formats | One normal, compressed and edge-case test per codec; check round-trip fidelity |
| Plugins | Native plugin, imported GIMP assets, UXP shim and external filter binary separately |
| Offline | Packaged editor assets available without external hosting; external AI should report an actionable connection error |
| UI | Classic vs Photoshop-style, themes, dock/floating layout, mobile, keyboard shortcuts, tool options |
| Recovery | Crash/restart data retention; independent filesystem project backups |
| Performance | Larger multi-layer documents, repeated filter previews, worker timeouts and resource cleanup |

Do not label a codec or runtime fully verified based only on source inspection. Keep platform/build artifacts and validation results attached to PRs where relevant.

## Release discipline

- [`DISTRIBUTION.md`](../DISTRIBUTION.md) explains artifacts and manual release tagging.
- Tags `v*.*.*` produce stable releases; default-branch pushes produce continuous prereleases.
- Existing release builds provide SHA-256 checksums, but checksums alone do **not** establish publisher signing.
- The separate air-gapped Windows WebView installer, manual update checks, optional Windows signing and WebView recovery/security enhancements are in PRs #85/#86 until merged.
- Licensing is consumer-free / commercial-contact, **not an OSI-approved open-source license**. Keep `LICENSE` in every distribution and do not alter licensing text without an explicit project decision.
