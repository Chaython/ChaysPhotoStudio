# Electron shell — Chay's Photo Studio

`main.cjs` = Electron main process · `preload.cjs` = context-isolated bridge.

- **Dev:** `bun run app:dev` (starts `electron/main.cjs` against the Next dev
  server on `http://localhost:3000`)
- **Packaged:** electron-builder produces the normal platform packages, plus both a Windows NSIS setup EXE and a Windows no-install portable EXE. It bundles the Next.js **standalone** server at
  `resources/app` (from `build/electron/app`, assembled by
  `scripts/prepare-electron-app.mjs`); the main process runs it with Electron's
  Node runtime on a free localhost port and loads it.
- **Opening images:** file associations (png/jpg/webp/…) + macOS `open-file` +
  Windows "Open with" are read in the main process and relayed to the renderer
  as `chays:open-file` events → the app's normal `openFiles()` pipeline.

Full build/sign/release instructions: see [`DISTRIBUTION.md`](../DISTRIBUTION.md).

## Windows portable build

`bun run app:dist:win` builds both Windows variants. Use
`bun run app:dist:win:portable` when you only want the single-file no-install
executable. The release filename is
`ChaysPhotoStudio-Portable-<version>-x64.exe`. Portable builds intentionally do
not create shortcuts, registry uninstall entries, or file associations.

## Optional G'MIC / GEGL desktop filters

The Electron build can use an existing system installation of **G'MIC** and/or **GEGL** from **Plugin Manager → Desktop Filters**. They are optional; the editor works normally without either executable.

Discovery checks `gmic` / `gegl` on `PATH`. You can override either executable explicitly before launching:

```powershell
$env:CHAYS_GMIC_PATH = 'C:\Tools\gmic\gmic.exe'
$env:CHAYS_GEGL_PATH = 'C:\Program Files\GEGL\bin\gegl.exe'
```

Native filters are not executed in the renderer. Electron writes the current composite to a private temporary PNG, invokes the executable with `execFile` argument arrays (never a shell command string), reads the resulting PNG, removes the temporary directory, and imports the result as a new layer.

### Browsing native filter capabilities

In **Plugin Manager → Desktop Filters**, use the GEGL search box to inspect operations exposed by your installed GEGL binary (`gegl --list-all`). Selecting a result fills the operation field; inspecting it displays the local `gegl --info` metadata. The G’MIC list is a **curated CLI command set**, not the complete G’MIC-Qt filter catalog. Inspect a command using its local `gmic -h <command>` output and adjust arguments before applying it.

Filter discovery and help queries are read-only, validated and bounded. Processing still runs through the existing Electron main-process bridge and produces a separate output layer. These features are not available in the browser, PWA, Tauri webview or extension builds without an equivalent trusted native bridge.

For GIMP Python or Script-Fu source, open **Plugin Manager → GIMP Scripts**. The static analyzer lists recognized PDB calls, candidate editor equivalents, GEGL/G’MIC references and functions that require GIMP; it does **not** execute or automatically convert any imported script.
