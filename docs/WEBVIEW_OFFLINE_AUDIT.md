# WebView offline, security, and recovery audit

## What runs without internet

The default Tauri release embeds the statically exported editor under
`build/webapp-export`; no application server or GitHub Pages request is needed
to launch it. The release configuration generator adds a Content Security
Policy to **embedded** builds only. The dev server and deliberately configured
`WEBVIEW_APP_URL` remote thin shells are separate modes.

| Area | Offline behavior | Limits / verification |
|---|---|---|
| Editor interface and icons | Bundled locally | `bun run webview-offline:validate` resolves every script, stylesheet, and icon referenced by the exported HTML and rejects remote script/style sources |
| Raster/vector tools, layers and filters | Run locally | Some specialized formats still rely on codecs or external tools not packaged by default; not every format is supported |
| Project open / save | Local input and download/save dialog | File System Access support differs by OS webview; fall back to browser-style file downloads |
| Autosave and Recent & Recovery | IndexedDB in the application's persistent local profile | Profile deletion/corruption can destroy this copy; use Download Backup or Back up all to folder (when directory picker is supported) |
| Fonts, user image imports | Local fonts, blobs and files | Remote images opened by URL require internet and must respect CORS |
| AI generation (Pollinations) | **Online only** | Static WebView calls `https://image.pollinations.ai` directly; the app's Next server-side AI routes are not bundled |
| ComfyUI and other optional local AI | Depends on separately installed/running service | Loopback can work without the public internet, but static builds do not bundle the ComfyUI backend or proxy; cross-origin restrictions still apply |
| Plugin scripts | Run locally in an opt-in worker | User-supplied JS plugins compile dynamically, requiring the documented `unsafe-eval` CSP exception; don't import untrusted plugins |
| Updates, external help links, donation links | Online only | No automatic updater currently packaged in Tauri |
| Native WebView2 runtime | Existing Windows runtime works offline | A clean-machine offline installer requires the separate `windows-offline-x64` variant from PR #85; don't confuse it with the small ordinary NSIS installer |

## CSP and threat model

The CSP is built in `scripts/webview-csp.mjs` and injected by
`scripts/webview-config.mjs` for **embedded releases**. Local scripts,
fonts, assets and blob workers are allowed. Remote scripts are blocked
**except** the pinned `https://cdn.jsdelivr.net/pyodide/v0.27.7/full/` path used
when a user explicitly enables/runs the embedded Python interpreter.
Objects remain blocked. HTTPS connections/media/images and user-configured
loopback services are allowed for remote image import and optional AI.
The CDN runtime has no integrity/SRI attestation in the app, so this narrow
exception is a documented trust trade-off, not equivalent to bundling the
interpreter locally.

**Compatibility exception:** `script-src` still allows `unsafe-eval`
because the opt-in plugin worker uses `new Function` to load script plugins.
This means the policy is defense in depth, not complete script execution
isolation. Future hardened-plugin runtimes should remove that exception,
subject to actual plugin compatibility tests.

## Native window state

The Rust `tauri-plugin-window-state` plugin restores window position,
size and maximized state across launches. Panel layout preferences still
belong to the editor's existing workspace store. Window-state data remains
in the local app profile. A full native runtime build is needed to verify
multi-monitor unplugging, DPI scaling and minimized-state recovery.

## Recovery backups and automated checks

- Every snapshot in **Recent & Recovery** has a Download Backup button;
  exported files are native `.zproj.json` projects.
- **Back up all to folder** uses the browser directory picker where supported.
  This is a manual, user-initiated export, **not** a silent scheduled filesystem
  backup. Snapshot contents never leave the machine unless the user chooses
  a synced folder.
- `bun run recovery-backup:validate` tests file naming, native-project JSON
  round-tripping and aborted writes; `bun run autosave:validate` checks
  autosave scheduling.
- `bun run webview-offline:validate` audits static shell assets, and
  `bun run dist:validate` guards the security policy and native plugin setup.

These tests do not prove that a Windows NSIS installer successfully installs
WebView2 on a fresh air-gapped VM. A Windows VM with network disabled and
no preinstalled WebView2 is still required for that end-to-end acceptance test.

## Authenticode signing

The release workflow accepts optional repository **Actions secrets**
`WINDOWS_CODESIGN_PFX_BASE64` and `WINDOWS_CODESIGN_PFX_PASSWORD`.
When both are configured, the Windows WebView NSIS setup is Authenticode
SHA-256 signed and verified before release upload. When neither is configured,
the workflow produces unsigned installers. Signing improves publisher identity
and is separate from Tauri's **mandatory updater signature** requirements.
Do not confuse Authenticode signing with the Tauri updater key pair.

A native signed updater with downloadable, validated packages is **not yet
enabled**: it requires a long-term Tauri public/private updater key pair,
an HTTPS feed and a carefully designed consent/restart workflow.
