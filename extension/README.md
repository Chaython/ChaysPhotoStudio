# Browser plugin — Chay's Photo Studio

Chrome (MV3) + Firefox extension. **Self-contained**: the build bundles the
entire editor webapp inside the extension (static export at the package
root), so it opens instantly, works offline, and needs no server, URL
configuration, or host permissions.

Right-click any image → **Edit image in Chay's Photo Studio** opens the
bundled editor with the image on the canvas (`?url=…` deep link). The
toolbar popup opens the bundled editor in a new tab.

```
extension/
  manifest.json   MV3 (the build script swaps background → event page for Firefox)
  background.js   service worker: context menus (callback-style = cross-browser)
  popup.html/js/css
```

Build: `bun run ext:build` → static webapp export + `build/extension/unpacked/`
(load unpacked) + store zips (Chrome & Firefox). Inline scripts in the
exported HTML are extracted to files so the app satisfies the MV3
extension-pages CSP. AI generation calls the free engine directly.
See [`DISTRIBUTION.md`](../DISTRIBUTION.md).
