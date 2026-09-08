# Browser plugin — Chay's Photo Studio

Chrome (MV3) + Firefox extension. Right-click any image → **Edit image in
Chay's Photo Studio** opens your editor with the image URL
(`?url=…` deep link). The popup sets the editor location
(`chrome.storage.sync`), overriding the URL baked at build time.

```
extension/
  manifest.json   MV3 (the build script swaps background → event page for Firefox)
  background.js   service worker: context menus (callback-style = cross-browser)
  popup.html/js/css
```

Build: `bun run ext:build` → `build/extension/unpacked/` (load unpacked) +
store zips (Chrome & Firefox). Set `EDITOR_URL` env to bake your deployed
editor URL. See [`DISTRIBUTION.md`](../DISTRIBUTION.md).
