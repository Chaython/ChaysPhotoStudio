# Browser plugin — Chay's Photo Studio

Chrome (MV3) + Firefox extension. **Self-contained**: the build bundles the
entire editor webapp inside the extension (static export at the package
root, with Next.js files under `next-assets/`), so it opens instantly, works
offline, and needs no server, URL configuration, or host permissions.

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
extension-pages CSP. AI generation calls a **remote** free engine directly and therefore requires internet; it may transmit the prompt and image content. Importing a remote image by URL also depends on network access and image-host CORS. Local editing with a file already imported is offline-capable.
The extension's bundled static frontend is not a full server runtime; server-side AI proxy routes and arbitrary native GIMP/Photoshop plugins are not included. See [Feature & Format Reference](../docs/FEATURES_AND_FORMATS.md) and [`DISTRIBUTION.md`](../DISTRIBUTION.md).

Stable GitHub Releases can be submitted to Firefox AMO and Microsoft Edge
Add-ons by `.github/workflows/publish.yml`. Configure `AMO_JWT_ISSUER` and
`AMO_JWT_SECRET` as repository secrets, plus `EDGE_CLIENT_ID` and
`EDGE_API_KEY` as secrets and `EDGE_PRODUCT_ID` as a repository variable.
Published stable releases submit automatically; manual runs can target an
existing stable tag and opt into store submission. Each extension package
includes the project `LICENSE`.
