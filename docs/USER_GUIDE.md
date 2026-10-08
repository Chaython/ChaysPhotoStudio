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

### Filters

- [Offset and seamless textures](#offset-and-seamless-textures)
- [Filters and adjustments](#filters-and-adjustments)

### Tools

- [Transform, Puppet Warp and Crop](#transform-puppet-warp-and-crop)
- [Brushes, cloning and healing](#brushes-cloning-and-healing)
- [Content-Aware editing](#content-aware-editing)

### Color & files

- [Color depth, HDR and proofing](#color-depth-hdr-and-proofing)
- [Match Color between documents](#match-color-between-documents)
- [Saving, exporting and metadata](#saving-exporting-and-metadata)

### Workspace

- [Undo, snapshots and recovery](#undo-snapshots-and-recovery)
- [Keyboard shortcuts and mobile](#keyboard-shortcuts-and-mobile)

### Advanced

- [Plugins, automation and optional AI](#plugins-automation-and-optional-ai)

### Support

- [Troubleshooting and known limits](#troubleshooting-and-known-limits)

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

## Workspace and panels

Find tools and customize the appearance of the studio.

**Where:** Window / Settings

1. Choose Window → Layers, History, Channels, Metadata or other panels to reveal them.
2. Rearrange panels to match your workflow.
3. Use the theme toggle for Dark, Light or OLED black; Settings also offers Touch / mobile mode.
4. Choose Settings → Reset panel layout if a panel is difficult to locate.

**Notes and tips:**

- The top-toolbar Help button opens this manual without leaving the editor.

## Making and modifying selections

Select part of an image before painting, masking or editing it.

**Where:** Marquee, Lasso, Wand and Selection tools / Select menu

1. Choose Marquee, Lasso, Magic Wand, Object Selection or Quick Selection.
2. Use New, Add, Subtract or Intersect selection modes in Tool Options.
3. Select → Modify provides Expand, Contract, Smooth, Border and Feather.
4. Use Select → Deselect when done; Reselect can restore the last deselected selection.

**Notes and tips:**

- Select → Modify → Expand grows an outline by a fixed pixel distance, unlike color matching.

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

## Layer Styles

Create editable shadows, glows, outlines and overlays.

**Where:** Layer → Layer Style…

1. Select a layer, then open Layer → Layer Style….
2. Enable an effect such as Stroke, Drop Shadow, Inner Glow or Bevel & Emboss.
3. Adjust the effect in the style editor.
4. Use Copy/Paste Layer Style to reuse the result.

**Notes and tips:**

- Layer Style → Stroke is live; Edit → Stroke Selection writes pixel artwork on a new layer.

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

**Notes and tips:**

- Autosave and recovery depend on local storage retention; clearing browser data may delete them.

## Keyboard shortcuts and mobile

View or customize key bindings and work without a keyboard.

**Where:** Help → Keyboard Shortcuts / Settings → Touch / mobile mode

1. Open Help → Keyboard Shortcuts to view and change current bindings.
2. Use standard shortcuts such as Ctrl/Cmd+Z for Undo and Ctrl/Cmd+D for Deselect.
3. Choose Touch / mobile mode when using a small or touch-first device.
4. Reset shortcut overrides if a custom binding conflicts.

**Notes and tips:**

- The Shortcuts dialog shows the current binding if it has been customized.

## Plugins, automation and optional AI

Extend workflows with plugins, scripts, batch jobs and configured AI providers.

**Where:** Plugins / Window → Batch / Scripting Console… / Generate

1. Open Plugins or Settings → Plugin Manager to inspect extensions.
2. Use Window → Batch / Image Processor… for repetitive jobs.
3. Use Window → Scripting Console… to automate supported commands.
4. Use Generate / AI Tools to access locally configured or external AI services.

**Notes and tips:**

- Photoshop UXP and GIMP compatibility is partial.
- Optional remote AI workflows can transmit content to outside providers.

## Troubleshooting and known limits

Find a missing tool or diagnose a failed operation.

**Where:** Window / Settings / Help

1. Use Window to reveal hidden panels or Settings → Reset panel layout.
2. Check whether a command requires an active selection, unlocked layer or specific layer type.
3. For performance problems, try smaller images and confirm browser worker support.
4. If a source format fails, try exporting PNG or TIFF from its original application.
5. Report reproducible defects with browser version, bit depth, steps and errors on GitHub Issues.

**Notes and tips:**

- 32-bit HDR, complex PSD layer effects and ICC processing still have compatibility limits.
- Project issues: https://github.com/Chaython/ChaysPhotoStudio/issues
