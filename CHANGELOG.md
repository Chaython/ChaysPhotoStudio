# Changelog

Notable changes to Chay's Photo Studio. Versions follow semantic versioning.

## 1.1.0

- AI image generation now defaults to the free Pollinations engine (no account or key) with automatic retries; custom OpenAI-compatible endpoints work as before.
- Object detection now runs fully on-device (saliency + region analysis) — images never leave the browser.
- AI Upscale consolidated into the on-device precision engine (denoise → Lanczos-3 → edge-adaptive detail recovery).
- Every push to the default branch now builds all bundles (Electron installers, webview shells, browser plugin, web bundle) and publishes a GitHub Release automatically; `v*.*.*` tags publish stable releases.
- Fixed CI failing on fresh checkouts (Prisma client generation).

## 1.0.0

Initial public release.

- WebGL2 editing engine: layers, masks, smart objects, smart filters, blend modes, non-destructive adjustments.
- Tools: marquee/lasso/wand selections, brush/pencil/pen, clone/heal/patch, gradients, type, shapes, crop, rulers and guides.
- Assisted selections (subject, quick, focus, color range), content-aware fill, object detection with one-click layer extraction.
- Image generation with style presets and batch output; on-device upscaling.
- Color engineering: curves, levels, HSL, selective color, raw-style adjustments, match color.
- Automation: action recording and playback, batch processing, scripting API, plugin system.
- Formats: PNG, JPEG, WebP, AVIF, TIFF, BMP, TGA, ICO, animated GIF, PSD import.
- Customizable keyboard shortcuts and toolbar layout with drag-and-drop tool pinning.
- Export pipeline with quality controls, resizing, and format conversion.
- Installable as a PWA; deep links (`?url=`); right-click "Edit image" browser plugin for Chrome and Firefox.
