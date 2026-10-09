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

## Optional GIMP 3 runtime — on demand

**Plugin Manager → GIMP Runtime** detects an installed GIMP 3 only when **Detect GIMP 3** is clicked, discovers procedures only when requested, and runs the selected procedure only when Execute is pressed. GIMP Python, Script-Fu and compiled plug-ins registered in the GIMP PDB can be invoked when they support noninteractive operation and supported parameters. Composite PNG results are imported as a new layer.

Configure a portable GIMP on Windows before launching the editor:

```powershell
$env:CHAYS_GIMP_PATH = 'D:\Apps\GIMP3\bin\gimp-3.0.exe'
```

**Plugin Manager → GIMP Scripts** also runs selected Python (.py) source through GIMP 3 Python-Fu, or Scheme (.scm) via GIMP Script-Fu. GIMP Python source receives `image` and `drawable` variables bound to the temporary input image. Script-Fu source that only registers a command will not necessarily modify that image.

The Electron host performs no native process probes at startup. A fresh GIMP process runs per explicit discovery, inspection or execution command; work files are private and removed afterward. **This is not a security sandbox**: plugins run with the operating-system permissions of GIMP. Users must explicitly confirm trust. Current image interchange is 8-bit PNG, not HDR/RAW/XCF round-tripping.

## Embedded interpreters — loaded only when requested

**Plugin Manager → GIMP Scripts → Embedded interpreter** supports a limited pure Scheme subset (arithmetic, lists, lambdas, conditionals and display) and Python with Pyodide WebAssembly. Scheme runs in a temporary Worker with execution limits. Pyodide v0.27.7 is fetched from a pinned jsDelivr URL only after permission is checked and Run is clicked; the interpreter is not downloaded at application launch. Workers are destroyed after run, cancel or timeout.

Embedded interpreters do not implement GIMP's Python GI library, native PDB, TinyScheme compatibility, filesystem access or image editing. Offline mode or strict Content Security Policy may prevent remote Pyodide downloads. Source analysis is always read-only.
