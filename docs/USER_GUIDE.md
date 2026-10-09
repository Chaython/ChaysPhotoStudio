# Chay's Photo Studio — User Guide

This manual mirrors the in-app **Help** dialog. Click the Help button in the editor toolbar or choose **Help → User Guide & Documentation…**. In-app topics are bundled for offline use.

For technical parity details, see [TOOL_PARITY.md](../TOOL_PARITY.md). For development, see [README.md](../README.md).

## Contents

### Basics

- [Getting started](#getting-started)
- [Workspace and panels](#workspace-and-panels)

### Selections

- [Making and modifying selections](#making-and-modifying-selections)
- [Grow and Similar colors](#grow-and-similar-colors)
- [Stroke Selection](#stroke-selection)
- [Select and Mask / Refine Edge](#select-and-mask-refine-edge)

### Layers

- [Layers, masks and clipping](#layers-masks-and-clipping)
- [Smart Objects and Smart Filters](#smart-objects-and-smart-filters)
- [Layer Styles](#layer-styles)
- [Remove Matte, Defringe and Trim Layer](#remove-matte-defringe-and-trim-layer)
- [Layer Comps and alternate designs](#layer-comps-and-alternate-designs)
- [Apply Image, Calculations and channels](#apply-image-calculations-and-channels)

### Filters

- [Offset and seamless textures](#offset-and-seamless-textures)
- [Filters and adjustments](#filters-and-adjustments)

### Tools

- [Transform, Puppet Warp and Crop](#transform-puppet-warp-and-crop)
- [Brushes, cloning and healing](#brushes-cloning-and-healing)
- [Content-Aware editing](#content-aware-editing)
- [Tool groups and choosing the right tool](#tool-groups-and-choosing-the-right-tool)
- [Paths, text and shapes](#paths-text-and-shapes)

### Color & files

- [Color depth, HDR and proofing](#color-depth-hdr-and-proofing)
- [HDR Fill and feathered selections](#hdr-fill-and-feathered-selections)
- [Match Color between documents](#match-color-between-documents)
- [Saving, exporting and metadata](#saving-exporting-and-metadata)
- [Proofing, print resolution and guides](#proofing-print-resolution-and-guides)
- [Import formats and video frame extraction](#import-formats-and-video-frame-extraction)
- [Layered exports, Save As and metadata](#layered-exports-save-as-and-metadata)
- [High-depth workflows and guarded edits](#high-depth-workflows-and-guarded-edits)

### Workspace

- [Undo, snapshots and recovery](#undo-snapshots-and-recovery)
- [Keyboard shortcuts and mobile](#keyboard-shortcuts-and-mobile)

### Advanced

- [Plugins, automation and optional AI](#plugins-automation-and-optional-ai)
- [Offline editing and desktop releases](#offline-editing-and-desktop-releases)
- [GIMP plugins, PDB runtime and script interpreters](#gimp-plugins-pdb-runtime-and-script-interpreters)

### Support

- [Troubleshooting and known limits](#troubleshooting-and-known-limits)
- [Large documents, performance and memory](#large-documents-performance-and-memory)

## Getting started

Create, edit, save and export a document.

**Where:** File → New / Open / Save Project

1. Choose File → New to specify canvas size and color depth, or File → Open to import an existing image.
2. Select a tool from the toolbar and adjust its Tool Options.
3. Edit on separate layers so you can adjust or undo effects later.
4. Use Save Project for editable work; choose Export As or Quick Export for a finished image.

**Notes and tips:**

- The native project keeps editing structure; PNG and JPEG exports do not.
- Check File → Recent & Recovery after an interruption.
- Opening MP4, WebM or MKV prompts for a frame timestamp. Scrub the preview and choose Import frame to make an editable still image.
- File → Place (Smart Object)… keeps supported imports separately editable.
- Video import picks one still frame, not an editable video timeline.

## Workspace and panels

Find tools and customize the appearance of the studio.

**Where:** Window / Settings

1. Choose Window → Layers, History, Channels, Metadata or other panels to reveal them.
2. Rearrange panels to match your workflow.
3. On desktop, dock panels left/right/top, group tabs or float windows; reveal hidden panels from Window.
4. Choose the Photoshop-style or Classic workspace from the top-right workspace selector; the Classic arrangement can be restored later.
5. Use the theme menu for Dark, Light, OLED black or Photoshop-inspired colors; Settings also offers Touch / mobile mode.
6. Choose Settings → Reset panel layout if a panel is difficult to locate.
7. On desktop, use eight dock destinations: Left, Right, Top, Bottom, Top Left, Top Right, Bottom Left and Bottom Right.

**Notes and tips:**

- The top-toolbar Help button opens this manual without leaving the editor.
- Use Window → All Tools / Tool Search to search and launch registered tools.

## Making and modifying selections

Select part of an image before painting, masking or editing it.

**Where:** Marquee, Lasso, Wand and Selection tools / Select menu

1. Choose Marquee, Lasso, Magic Wand, Object Selection or Quick Selection.
2. Use New, Add, Subtract or Intersect selection modes in Tool Options.
3. Select → Modify provides Expand, Contract, Smooth, Border and Feather.
4. Use Select → Deselect when done; Reselect can restore the last deselected selection.

**Notes and tips:**

- Select → Modify → Expand grows an outline by a fixed pixel distance, unlike color matching.
- Object Selection → Layer via Copy creates a native-size raster layer from the detected document region, retaining its position.

## Grow and Similar colors

Extend a selection according to colors in the visible image.

**Where:** Select → Grow (Similar Colors)… / Similar…

1. Create an initial selection with any supported selection tool.
2. Choose Grow (Similar Colors) to include connected, color-matching pixels.
3. Choose Similar to include matching colors anywhere in the document, including disconnected islands.
4. Enter a tolerance from 0 to 100. Lower values match a narrower range.

**Notes and tips:**

- These commands preserve original feathered edges and create one undoable selection change.
- When you need a fixed pixel-distance expansion, use Select → Modify → Expand.

## Stroke Selection

Paint a selection outline on an independent new raster layer.

**Where:** Edit → Stroke Selection…

1. Create a selection with Marquee, Lasso, Wand or another selection tool.
2. Open Edit → Stroke Selection….
3. Set width (1–200 px), color and opacity; choose Inside, Center or Outside placement.
4. Choose Stroke on New Layer. The source artwork and current selection remain intact.

**Notes and tips:**

- Inside stays inside the selected region; Outside extends beyond it; Center straddles the boundary.
- For a fully editable effect on a layer, use Layer → Layer Style → Stroke instead.
- Irregular shapes, holes, and selection transparency are supported.

## Select and Mask / Refine Edge

Clean up fine edges, difficult cutouts and hair.

**Where:** Select → Select and Mask…

1. Make an initial selection first.
2. Open Select and Mask, then choose a useful preview background.
3. Adjust edge Radius, Smooth, Contrast, Feather, Shift Edge, and local refinement brushes.
4. Output to a selection, layer mask or new layer, then confirm or cancel.

**Notes and tips:**

- Outputting a layer mask is generally more reversible than deleting pixels.

## Offset and seamless textures

Shift pixels while controlling what happens at document edges.

**Where:** Filter → Other → Offset…

1. Select the layer to shift, preferably a Smart Object if you want an editable Smart Filter.
2. Open Filter → Other → Offset… and enter Horizontal and Vertical pixel offsets.
3. Choose Wrap Around to send pixels exiting one edge to the opposite edge.
4. Choose Repeat Edge Pixels to extend boundary colors, or Transparent to leave uncovered regions clear.
5. Apply. To create a seamless texture, use Wrap Around and retouch the seams now visible in the middle.

**Notes and tips:**

- Positive X shifts pixels right and positive Y shifts pixels down.
- Wrap Around reveals existing seams; it does not automatically repair them.
- The filter supports high-precision HDR pixel values and Smart Filter use.

## Filters and adjustments

Blur, sharpen, recolor and stylize artwork.

**Where:** Filter / Image → Adjustments / Layer → New Adjustment Layer

1. Choose a raster or Smart Object layer.
2. Open a filter and tune its controls with Preview enabled.
3. Confirm the filter or cancel to discard it.
4. Use a new Adjustment Layer for editable tonal or color corrections.

**Notes and tips:**

- Some effects are not supported in 32-bit HDR and may refuse the operation rather than reduce precision.

## Layers, masks and clipping

Keep a composition editable without overwriting originals.

**Where:** Window → Layers / Layer → Layer Mask

1. Use Window → Layers to adjust ordering, visibility, opacity and blending.
2. Create, duplicate or rearrange layers as needed.
3. Use Layer → Layer Mask → Reveal Selection or Hide Selection to control visibility non-destructively.
4. Use clipping masks when the visible area should follow the layer underneath.
5. Use Copy/Paste Layer Style or Duplicate Into… for cross-document work.
6. Use Layer Comps to save alternate visibility, position and appearance states.

**Notes and tips:**

- Applying a mask bakes its visibility into raster pixels; disable a mask instead to inspect content.

## Smart Objects and Smart Filters

Transform and filter placed artwork with editable source content.

**Where:** File → Place (Smart Object)… / Filter

1. Place an image as a Smart Object through File → Place (Smart Object)….
2. Transform the Smart Object without repeatedly resampling the source.
3. Apply a supported filter and edit its Smart Filter settings later.
4. Save the native project to retain the editable setup.

**Notes and tips:**

- Offset can be used as an editable Smart Filter.
- Plugin effects do not necessarily support Smart Filters.
- Smart Object and Smart Filter behavior differs from Adobe native PSD; test interoperability.

## Layer Styles

Create editable shadows, glows, outlines and overlays.

**Where:** Layer → Layer Style…

1. Select a layer, then open Layer → Layer Style….
2. Enable an effect such as Stroke, Drop Shadow, Inner Glow or Bevel & Emboss.
3. Adjust the effect in the style editor.
4. Use Copy/Paste Layer Style to reuse the result.

**Notes and tips:**

- Layer Style → Stroke is live; Edit → Stroke Selection writes pixel artwork on a new layer.

## Remove Matte, Defringe and Trim Layer

Clean unwanted white or black edge contamination and remove transparent padding without changing the layer's position.

**Where:** Layer → Matting → Remove White Matte / Remove Black Matte / Defringe; Layer → Trim Layer to Content

1. Select an unlocked image layer containing transparent or anti-aliased boundaries.
2. Choose Layer → Matting → Remove White Matte if translucent edge colors were blended against white, or Remove Black Matte for a dark matte.
3. Use Layer → Matting → Defringe to propagate nearby opaque colors into translucent edge pixels; select a suitable fringe width.
4. Inspect the result against contrasting backgrounds. Undo if an edge loses useful color.
5. Use Layer → Trim Layer to Content to crop away transparent padding while keeping the artwork in the same document-space position.

**Notes and tips:**

- Matting changes RGB in partially transparent pixels; it does not remove transparency.
- Fully opaque images, selections without eligible fringe pixels, and already-trimmed layers produce no new History entry.
- Editable Smart Objects can be rasterized by a successful matting operation; duplicate the layer first if you want to retain the original.
- 16-bit matting requires browser support for float16 readback. Matting is not yet supported on 32-bit HDR documents.
- Locked layers cannot be trimmed or matted.
- When native 16-bit pixel readback or writeback is unavailable, Matting leaves the source untouched and reports the unsupported operation.

## Transform, Puppet Warp and Crop

Move, scale, straighten, crop and warp images.

**Where:** Edit → Transform / Puppet Warp… / Crop toolbar

1. Use Edit → Free Transform for move, scale and rotation.
2. Choose Transform variants for perspective or warp distortion.
3. Use Puppet Warp to bend portions of a subject by placing pins.
4. Use Crop or Perspective Crop to adjust the image frame.

**Notes and tips:**

- Raster Warp and Puppet Warp have restrictions on authoritative 32-bit HDR layers.

## Brushes, cloning and healing

Paint, repair photos and retouch local regions.

**Where:** Brush / Clone Stamp / Healing / Patch toolbar

1. Choose a brush or repair tool.
2. Configure size, hardness, opacity, flow and sampling options.
3. Alt/Option-click to define a Clone Stamp or Healing Brush source when required.
4. Use Spot Healing, Patch or Content-Aware Move for local repair.

**Notes and tips:**

- Where supported, sample all layers and paint onto a new blank layer for non-destructive retouching.
- Clone and Heal are useful for tidying seams after the Offset filter.

## Content-Aware editing

Remove objects or reconstruct vacated areas.

**Where:** Edit → Content-Aware Fill… / Content-Aware Move

1. Make a selection around an unwanted object and open Edit → Content-Aware Fill….
2. Review available output and sampling controls, then apply.
3. Use the Content-Aware Move tool to reposition a selected subject.
4. Refine difficult regions with Clone Stamp or Healing.

**Notes and tips:**

- Content-Aware Fill estimates hidden pixels and may need manual cleanup.
- Content-Aware Fill requires an 8-bit document; 16-bit float and 32-bit HDR are blocked to prevent precision loss.

## Color depth, HDR and proofing

Work at appropriate precision and simulate output colors.

**Where:** File → New / View → Proof Setup…

1. Choose 8-bit, supported 16-bit float, or 32-bit HDR when creating a document.
2. Configure a soft-proof profile through View → Proof Setup….
3. Toggle Proof Colors or Gamut Warning to inspect display differences.
4. Choose an output format and bit depth appropriate for the final asset.

**Notes and tips:**

- Not every filter supports authoritative Float32 HDR.
- Soft proofing changes the preview, not source image pixels.
- ICC LUT/CLUT support remains incomplete.
- Auto Tone, Auto Contrast, Auto Color and Match Color are not yet supported on 32-bit HDR documents.
- In 32-bit HDR, Object Selection → Layer via Copy preserves scene-linear Float32 highlights for simple raster stacks. Complex effects cannot yet be extracted without risking precision loss.
- 16-bit float editing requires native float16 Canvas2D readback and writeback. If a browser lacks either, the affected operation is stopped rather than converted silently to 8-bit.
- High precision varies by operation and runtime; unsupported destructive high-depth edits should refuse rather than silently quantize.

## HDR Fill and feathered selections

Fill a selected area with a color without clipping HDR highlights or flattening image precision.

**Where:** Edit → Fill / 32-bit HDR document

1. Open or create a 32-bit HDR document and select an unlocked raster layer.
2. Set a foreground color using a hexadecimal RGB color (such as #ff8800).
3. Optionally select the pixels you want to paint, using Feather for soft transitions.
4. Choose Edit → Fill to blend the selected color into the layer's scene-linear Float32 pixels.
5. Use Undo or History to revert the fill. Unselected pixels and HDR highlights remain unchanged.

**Notes and tips:**

- Fill uses straight-alpha source-over compositing and converts the UI sRGB color into scene-linear RGB.
- Layer offsets are respected and pixels outside the document are not filled.
- Text, shapes and Smart Objects must be rasterized explicitly before 32-bit HDR Fill.
- A selection containing no overlapping pixels does not modify the image or create a History entry.
- 32-bit HDR Fill is supported, but other editing tools can have their own high-bit precision limitations.

## Match Color between documents

Transfer color and contrast characteristics from one open image to a layer in another document.

**Where:** Image → Adjustments → Match Color…

1. Open the image to modify and a second image that will serve as the color reference.
2. Select an unlocked raster or rasterizable layer in the document you want to modify.
3. Choose Image → Adjustments → Match Color… and select the other open image under Source.
4. Adjust Luminance, Color Intensity, Fade and Neutralize while viewing the Before/After sample.
5. Choose Match Color to apply the result as an undoable pixel edit, or Cancel to leave the layer unchanged.

**Notes and tips:**

- The command does not support 32-bit scene-linear HDR documents yet; no conversion is performed silently.
- The original layer is modified, so duplicate it first if you want to keep the source independently editable.
- Long operations discard stale results if you switch documents, edit the layer or change History.

## Saving, exporting and metadata

Keep editable project data and share finished files.

**Where:** File → Save Project / Export As… / File Info

1. Use Save Project to keep layer/mask information.
2. Use Export As or Quick Export for PNG, JPEG or WebP.
3. Use Export Layers to Files to create separate rendered layer images.
4. Open File → File Info / Metadata to inspect EXIF/IPTC/XMP and edit descriptive metadata where supported.

**Notes and tips:**

- JPEG has no transparency.
- Review GPS metadata and the strip-metadata option before sharing.

## Undo, snapshots and recovery

Review earlier versions and recover unsaved work.

**Where:** Edit → Undo / Window → History / File → Recent & Recovery

1. Use Undo/Redo for recent edits and open Window → History to revisit them.
2. Create named history snapshots when you need durable comparison states.
3. Save projects regularly.
4. Use File → Recent & Recovery after a browser crash or unexpected restart.
5. Create named History snapshots with notes for milestones or comparisons.
6. Click Download Backup on a recovery entry to export a portable project, or Back up all to folder when your WebView supports selecting a directory.

**Notes and tips:**

- Autosave and recovery depend on local storage retention; clearing browser data may delete them.
- Recovery exports are available after merged PR #86, but these are manual backups; profile deletion can still erase snapshots not copied elsewhere.

## Keyboard shortcuts and mobile

View or customize key bindings and work without a keyboard.

**Where:** Help → Keyboard Shortcuts / Settings → Touch / mobile mode

1. Open Help → Keyboard Shortcuts to view and change current bindings.
2. Use standard shortcuts such as Ctrl/Cmd+Z for Undo and Ctrl/Cmd+D for Deselect.
3. Choose Touch / mobile mode when using a small or touch-first device.
4. Reset shortcut overrides if a custom binding conflicts.
5. Repeatedly press shared tool letters (M, L, B, J, etc.) to cycle related tools.

**Notes and tips:**

- The Shortcuts dialog shows the current binding if it has been customized.
- Main currently registers 48 tools; additional Pen and Type Mask tools are pending PR #82.

## Plugins, automation and optional AI

Extend workflows with plugins, scripts, batch jobs and configured AI providers.

**Where:** Plugins / Window → Batch / Scripting Console… / Generate

1. Open Plugins or Settings → Plugin Manager to inspect extensions.
2. Use Window → Batch / Image Processor… for repetitive jobs.
3. Use Window → Scripting Console… to automate supported commands.
4. Use Generate / AI Tools to access locally configured or external AI services.
5. Electron can use separately installed G'MIC/GEGL through Plugin Manager → Desktop Filters.
6. Plugin Manager → GIMP Runtime can detect an independently installed GIMP 3 and run a selected supported PDB procedure in Electron when you explicitly execute it.
7. Plugin Manager → GIMP Scripts can analyze scripts; a limited embedded Scheme interpreter or opt-in Pyodide Python runtime runs only on request.

**Notes and tips:**

- Photoshop UXP and GIMP compatibility is partial.
- Optional remote AI workflows can transmit content to outside providers.
- Online generation may send prompts or image data to remote providers.
- Supported GIMP 3 Python/Script-Fu procedures run only in a separately installed GIMP through Electron; no arbitrary GIMP native host runs in the web browser.
- Pyodide downloads its runtime only on explicit use and is not guaranteed offline.
- Only run trusted GIMP scripts; native processes have normal OS permissions.

## Troubleshooting and known limits

Find a missing tool or diagnose a failed operation.

**Where:** Window / Settings / Help

1. Use Window to reveal hidden panels or Settings → Reset panel layout.
2. Check whether a command requires an active selection, unlocked layer or specific layer type.
3. For performance problems, try smaller images and confirm browser worker support.
4. If a source format fails, try exporting PNG or TIFF from its original application.
5. Report reproducible defects with browser version, bit depth, steps and errors on GitHub Issues.
6. If the update checker reports offline, continue editing normally; automatic installs are not enabled.

**Notes and tips:**

- 32-bit HDR, complex PSD layer effects and ICC processing still have compatibility limits.
- Project issues: https://github.com/Chaython/ChaysPhotoStudio/issues
- Recognized RAW, HEIC/JXL/JP2 or design-document extensions do not guarantee a bundled decoder.
- See docs/FEATURES_AND_FORMATS.md for platform-specific limits and pending PRs.

## Tool groups and choosing the right tool

Find related Photoshop-style tools and inspect their options.

**Where:** Left toolbar / Tool Options / Edit → Customize Toolbar…

1. Use Move (V), Marquee (M) and Lasso (L) for movement and geometric/freehand selection.
2. Use Quick/Object Selection, Magic Wand (W), Selection Brush and Select & Mask for detailed subjects.
3. Paint with Brush/Mixer/Pencil (B); retouch with Healing/Patch (J), Clone Stamp (S), Eraser (E) and tonal tools.
4. Use Pen (P), Path/Direct Selection (A), Type (T), Shape (U), Hand (H) and Zoom (Z) for paths and navigation.
5. Organize toolbar groups through Edit → Customize Toolbar… and key assignments through Keyboard Shortcuts.

**Notes and tips:**

- Main has 52 registered tools; shared hotkeys cycle tools.
- Search all 52 tools through Window → All Tools / Tool Search (merged PR #81).

## Paths, text and shapes

Create editable contours and typography rather than painting everything into raster pixels.

**Where:** Pen / Paths panel / Type / Shape

1. Click or drag with Pen (P) to place corner/smooth Bézier anchors; edit handles for curved segments.
2. Use Path/Direct Selection (A) to edit saved paths in Window → Paths.
3. Turn supported paths into selections, strokes, fills or editable shape layers.
4. Use Type (T) for point/paragraph text and Shape (U) for rectangles, rounded rectangles, ellipses, stars or polygons.

**Notes and tips:**

- Freeform Pen, Curvature Pen and horizontal/vertical Type Mask tools are included on main (merged PR #82).
- Advanced OpenType settings and Photoshop PSD text round-trips are not exact.

## Layer Comps and alternate designs

Save several layout variations without duplicating the complete document.

**Where:** Window → Layer Comps / Window → Layers

1. Arrange layers, visibility, positions and supported appearances for the first design.
2. Save the current state as a named Layer Comp.
3. Switch comps to compare variants and export chosen comps when needed.

**Notes and tips:**

- Layer Comps store layer-state variants, not edit-history snapshots.

## Apply Image, Calculations and channels

Build channel-driven composites and masks.

**Where:** Image → Apply Image… / Image → Calculations… / Window → Channels

1. Use Apply Image… to blend another source document/layer/channel into the active target.
2. Use Calculations… to combine channels, choosing a selection or saved channel destination.
3. Inspect alpha/luminosity channels through Window → Channels and load them as selections.

**Notes and tips:**

- Keep a source copy before complex compositing.
- Some 32-bit HDR blend combinations remain guarded.

## Proofing, print resolution and guides

Preview intended color output and make measured edits.

**Where:** View → Proof Setup… / Proof Colors / Gamut Warning / Rulers

1. Set document PPI for print-size metadata; PPI does not create pixel detail.
2. Use View → Proof Setup… and Proof Colors for a display simulation.
3. Enable Gamut Warning to locate potentially out-of-gamut colors.
4. Show rulers, guides and grid; adjust units and snapping.

**Notes and tips:**

- ICC/CMYK proofing is an approximation, not certified print color matching.

## Import formats and video frame extraction

Choose import paths for raster, layered and media files.

**Where:** File → Open… / Open as Layer… / Place (Smart Object)…

1. Open a file as a new document, Open as Layer… to add to the current image, or Place… as a Smart Object.
2. Open MP4/WebM/MKV to scrub a local preview, choose a timestamp and Import frame.
3. Consult the feature/format reference to distinguish native codecs from previews and fallback extractors.

**Notes and tips:**

- File extension recognition does not guarantee decoding.
- RAW development on main is largely preview-oriented; deeper development is in PRs #79/#84.
- HEIC, JPEG XL and JPEG 2000 depend on operating-system/WebView codecs.

## Layered exports, Save As and metadata

Preserve work in the native project and deliver suitable formats.

**Where:** File → Save Project / Export As… / Export Layers to Files…

1. Save .zproj.json for editable projects, masks and supported document state.
2. Choose PNG, JPEG, WebP, TIFF, BMP, TGA, QOI, PPM, ICO, OpenRaster or PSD from Export As….
3. Use Export Layers to Files or Layer Comps export for multi-output deliverables.
4. Review File Info metadata and stripping controls before sharing.

**Notes and tips:**

- PSD/ORA may approximate or rasterize effects.
- TIFF 16-bit output depends on the supported document and export path.

## High-depth workflows and guarded edits

Avoid losing 16/32-bit pixel precision during editing.

**Where:** File → New (color depth) / Image / Filter / Layer

1. Create a suitable high-bit-depth document only when the runtime supports its pixel buffers.
2. Prefer adjustment layers, layer masks and Smart Filters to destructive 8-bit processing.
3. Use supported Float32 operations for merging, filling and transforming when available.
4. If a tool refuses a high-depth edit, save the original and use a supported operation or separate SDR copy.

**Notes and tips:**

- Not every codec, plugin, filter or PSD export preserves float precision.
- Unsafe high-depth destructive edits should be blocked instead of silently flattened.

## Offline editing and desktop releases

Choose a distribution that matches connectivity and OS needs.

**Where:** GitHub Releases / File / Recent & Recovery

1. Use the browser/PWA, bundled Electron desktop app, or lightweight Tauri WebView build.
2. Default Tauri releases embed their frontend but require the OS WebView runtime to be present or provisioned.
3. Save .zproj.json files outside the browser profile as backups.
4. External AI, remote image URLs and release updates require connectivity.
5. The About dialog includes a manual Check for updates control; it does not silently install or restart the app.

**Notes and tips:**

- The extra offline Windows installer and embedded WebView CSP/window-state/recovery improvements are in main after merged PRs #85/#86.
- Electron uses a bundled localhost server and does not depend on GitHub Pages.

## Large documents, performance and memory

Keep large layered projects responsive.

**Where:** Settings / Window → Layers / Filter

1. Hide unneeded panels, reduce heavy live previews and close unused documents.
2. Use bounded selections and nondestructive filters instead of repeating full-image operations.
3. Review History snapshots and layer count when memory grows.
4. Check WebGL2, browser codecs and pixel-worker support if a tool fails or falls back.

**Notes and tips:**

- Lazy panel/dialog loading reduces startup overhead but does not eliminate large-image memory costs.
- Bug reports should include document size, bit depth, layer count and reproducible steps.

## GIMP plugins, PDB runtime and script interpreters

Discover compatible GIMP assets and use supported external GIMP procedures without starting runtimes at launch.

**Where:** Plugin Manager → Desktop Filters / GIMP Scripts / GIMP Runtime

1. Import supported .gbr brush, .ggr gradient and related GIMP assets into native editing controls.
2. In Electron, use Desktop Filters to inspect an existing G'MIC or GEGL install; these are never bundled by the browser app.
3. In Plugin Manager → GIMP Runtime, click Detect GIMP 3, inspect/select a noninteractive procedure, and execute it only after reviewing/trusting it.
4. Use GIMP Scripts for static source analysis. Electron can run explicitly chosen Python/Script-Fu source in a separate GIMP 3 process; image results are returned as a new layer.
5. For simple standalone experiments, choose the embedded Scheme subset or enable Python/Pyodide; these interpreters start only when you press Run.
6. With GIMP runtime or embedded interpretation, only the required external process/interpreter starts on explicit execution.

**Notes and tips:**

- Native GIMP 3 is Electron-only, installed separately, and runs with OS permissions; scripts are not sandboxed.
- Pyodide is downloaded from a pinned remote CDN on first explicit request and may not work offline.
- Embedded interpreters do not implement native GIMP GI, PDB or direct image editing; PNG interchange is not HDR/RAW round-tripping.
