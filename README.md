# Chay's Photo Studio

A 100% browser-based raster image editor — a Photoshop-class feature set running on a
custom **WebGL2** engine. All editing (layers, filters, magic wand, object detection,
upscaling, and more) happens locally in your browser. AI image generation runs on the
free Pollinations engine (no account or key) or your own OpenAI-compatible endpoint.

![Chay's Photo Studio](public/icon.svg)

## Quick start (web)

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
