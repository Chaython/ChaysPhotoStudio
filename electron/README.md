# Electron shell — Chay's Photo Studio

`main.cjs` = Electron main process · `preload.cjs` = context-isolated bridge.

- **Dev:** `bun run app:dev` (starts `electron/main.cjs` against the Next dev
  server on `http://localhost:3000`)
- **Packaged:** electron-builder bundles the Next.js **standalone** server at
  `resources/app` (from `build/electron/app`, assembled by
  `scripts/prepare-electron-app.mjs`); the main process runs it with Electron's
  Node runtime on a free localhost port and loads it.
- **Opening images:** file associations (png/jpg/webp/…) + macOS `open-file` +
  Windows "Open with" are read in the main process and relayed to the renderer
  as `chays:open-file` events → the app's normal `openFiles()` pipeline.

Full build/sign/release instructions: see [`DISTRIBUTION.md`](../DISTRIBUTION.md).
