// Single source of truth for in-app Help and docs/USER_GUIDE.md.
// Edit topics here; run 'bun run help:generate' to update the Markdown manual.
export type HelpCategory = "Basics" | "Selections" | "Layers" | "Filters" | "Tools" | "Color & files" | "Workspace" | "Advanced" | "Support"
export interface HelpTopic {
  id: string
  title: string
  category: HelpCategory
  path: string
  summary: string
  steps: readonly string[]
  tips: readonly string[]
}
export const HELP_CATEGORIES: readonly HelpCategory[] = ["Basics","Selections","Layers","Filters","Tools","Color & files","Workspace","Advanced","Support"]
export const HELP_TOPICS: readonly HelpTopic[] = 
[
  {
    "id": "getting-started",
    "title": "Getting started",
    "category": "Basics",
    "path": "File → New / Open / Save Project",
    "summary": "Create, edit, save and export a document.",
    "steps": [
      "Choose File → New to specify canvas size and color depth, or File → Open to import an existing image.",
      "Select a tool from the toolbar and adjust its Tool Options.",
      "Edit on separate layers so you can adjust or undo effects later.",
      "Use Save Project for editable work; choose Export As or Quick Export for a finished image."
    ],
    "tips": [
      "The native project keeps editing structure; PNG and JPEG exports do not.",
      "Check File → Recent & Recovery after an interruption.",
      "Opening MP4, WebM or MKV prompts for a frame timestamp. Scrub the preview and choose Import frame to make an editable still image.",
      "File → Place (Smart Object)… keeps supported imports separately editable.",
      "Video import picks one still frame, not an editable video timeline."
    ]
  },
  {
    "id": "workspace",
    "title": "Workspace and panels",
    "category": "Basics",
    "path": "Window / Settings",
    "summary": "Find tools and customize the appearance of the studio.",
    "steps": [
      "Choose Window → Layers, History, Channels, Metadata or other panels to reveal them.",
      "Rearrange panels to match your workflow.",
      "On desktop, dock panels left/right/top, group tabs or float windows; reveal hidden panels from Window.",
      "Choose the Photoshop-style or Classic workspace from the top-right workspace selector; the Classic arrangement can be restored later.",
      "Use the theme menu for Dark, Light, OLED black or Photoshop-inspired colors; Settings also offers Touch / mobile mode.",
      "Choose Settings → Reset panel layout if a panel is difficult to locate.",
      "On desktop, use eight dock destinations: Left, Right, Top, Bottom, Top Left, Top Right, Bottom Left and Bottom Right. Docks fit their contents by default; drag the dock divider for a fixed size or double-click it to return to automatic sizing."
    ],
    "tips": [
      "The top-toolbar Help button opens this manual without leaving the editor.",
      "Use Window → All Tools / Tool Search to search and launch registered tools."
    ]
  },
  {
    "id": "selections",
    "title": "Making and modifying selections",
    "category": "Selections",
    "path": "Marquee, Lasso, Wand and Selection tools / Select menu",
    "summary": "Select part of an image before painting, masking or editing it.",
    "steps": [
      "Choose Marquee, Lasso, Magic Wand, Object Selection or Quick Selection.",
      "Use New, Add, Subtract or Intersect selection modes in Tool Options.",
      "Select → Modify provides Expand, Contract, Smooth, Border and Feather.",
      "Use Select → Deselect when done; Reselect can restore the last deselected selection."
    ],
    "tips": [
      "Select → Modify → Expand grows an outline by a fixed pixel distance, unlike color matching.",
      "Object Selection → Layer via Copy creates a native-size raster layer from the detected document region, retaining its position."
    ]
  },
  {
    "id": "grow-similar",
    "title": "Grow and Similar colors",
    "category": "Selections",
    "path": "Select → Grow (Similar Colors)… / Similar…",
    "summary": "Extend a selection according to colors in the visible image.",
    "steps": [
      "Create an initial selection with any supported selection tool.",
      "Choose Grow (Similar Colors) to include connected, color-matching pixels.",
      "Choose Similar to include matching colors anywhere in the document, including disconnected islands.",
      "Enter a tolerance from 0 to 100. Lower values match a narrower range."
    ],
    "tips": [
      "These commands preserve original feathered edges and create one undoable selection change.",
      "When you need a fixed pixel-distance expansion, use Select → Modify → Expand."
    ]
  },
  {
    "id": "stroke-selection",
    "title": "Stroke Selection",
    "category": "Selections",
    "path": "Edit → Stroke Selection…",
    "summary": "Paint a selection outline on an independent new raster layer.",
    "steps": [
      "Create a selection with Marquee, Lasso, Wand or another selection tool.",
      "Open Edit → Stroke Selection….",
      "Set width (1–200 px), color and opacity; choose Inside, Center or Outside placement.",
      "Choose Stroke on New Layer. The source artwork and current selection remain intact."
    ],
    "tips": [
      "Inside stays inside the selected region; Outside extends beyond it; Center straddles the boundary.",
      "For a fully editable effect on a layer, use Layer → Layer Style → Stroke instead.",
      "Irregular shapes, holes, and selection transparency are supported."
    ]
  },
  {
    "id": "select-mask",
    "title": "Select and Mask / Refine Edge",
    "category": "Selections",
    "path": "Select → Select and Mask…",
    "summary": "Clean up fine edges, difficult cutouts and hair.",
    "steps": [
      "Make an initial selection first.",
      "Open Select and Mask, then choose a useful preview background.",
      "Adjust edge Radius, Smooth, Contrast, Feather, Shift Edge, and local refinement brushes.",
      "Output to a selection, layer mask or new layer, then confirm or cancel."
    ],
    "tips": [
      "Outputting a layer mask is generally more reversible than deleting pixels."
    ]
  },
  {
    "id": "offset",
    "title": "Offset and seamless textures",
    "category": "Filters",
    "path": "Filter → Other → Offset…",
    "summary": "Shift pixels while controlling what happens at document edges.",
    "steps": [
      "Select the layer to shift, preferably a Smart Object if you want an editable Smart Filter.",
      "Open Filter → Other → Offset… and enter Horizontal and Vertical pixel offsets.",
      "Choose Wrap Around to send pixels exiting one edge to the opposite edge.",
      "Choose Repeat Edge Pixels to extend boundary colors, or Transparent to leave uncovered regions clear.",
      "Apply. To create a seamless texture, use Wrap Around and retouch the seams now visible in the middle."
    ],
    "tips": [
      "Positive X shifts pixels right and positive Y shifts pixels down.",
      "Wrap Around reveals existing seams; it does not automatically repair them.",
      "The filter supports high-precision HDR pixel values and Smart Filter use."
    ]
  },
  {
    "id": "filters-adjustments",
    "title": "Filters and adjustments",
    "category": "Filters",
    "path": "Filter / Image → Adjustments / Layer → New Adjustment Layer",
    "summary": "Blur, sharpen, recolor and stylize artwork.",
    "steps": [
      "Choose a raster or Smart Object layer.",
      "Open a filter and tune its controls with Preview enabled.",
      "Confirm the filter or cancel to discard it.",
      "Use a new Adjustment Layer for editable tonal or color corrections."
    ],
    "tips": [
      "Some effects are not supported in 32-bit HDR and may refuse the operation rather than reduce precision."
    ]
  },
  {
    "id": "layers-masks",
    "title": "Layers, masks and clipping",
    "category": "Layers",
    "path": "Window → Layers / Layer → Layer Mask",
    "summary": "Keep a composition editable without overwriting originals.",
    "steps": [
      "Use Window → Layers to adjust ordering, visibility, opacity and blending.",
      "Create, duplicate or rearrange layers as needed.",
      "Use Layer → Layer Mask → Reveal Selection or Hide Selection to control visibility non-destructively.",
      "Use clipping masks when the visible area should follow the layer underneath.",
      "Use Copy/Paste Layer Style or Duplicate Into… for cross-document work.",
      "Use Layer Comps to save alternate visibility, position and appearance states."
    ],
    "tips": [
      "Applying a mask bakes its visibility into raster pixels; disable a mask instead to inspect content."
    ]
  },
  {
    "id": "smart-objects",
    "title": "Smart Objects and Smart Filters",
    "category": "Layers",
    "path": "File → Place (Smart Object)… / Filter",
    "summary": "Transform and filter placed artwork with editable source content.",
    "steps": [
      "Place an image as a Smart Object through File → Place (Smart Object)….",
      "Transform the Smart Object without repeatedly resampling the source.",
      "Apply a supported filter and edit its Smart Filter settings later.",
      "Save the native project to retain the editable setup."
    ],
    "tips": [
      "Offset can be used as an editable Smart Filter.",
      "Plugin effects do not necessarily support Smart Filters.",
      "Smart Object and Smart Filter behavior differs from Adobe native PSD; test interoperability."
    ]
  },
  {
    "id": "layer-styles",
    "title": "Layer Styles",
    "category": "Layers",
    "path": "Layer → Layer Style…",
    "summary": "Create editable shadows, glows, outlines and overlays.",
    "steps": [
      "Select a layer, then open Layer → Layer Style….",
      "Enable an effect such as Stroke, Drop Shadow, Inner Glow or Bevel & Emboss.",
      "Adjust the effect in the style editor.",
      "Use Copy/Paste Layer Style to reuse the result."
    ],
    "tips": [
      "Layer Style → Stroke is live; Edit → Stroke Selection writes pixel artwork on a new layer."
    ]
  },
  {
    "id": "layer-matting",
    "title": "Remove Matte, Defringe and Trim Layer",
    "category": "Layers",
    "path": "Layer → Matting → Remove White Matte / Remove Black Matte / Defringe; Layer → Trim Layer to Content",
    "summary": "Clean unwanted white or black edge contamination and remove transparent padding without changing the layer's position.",
    "steps": [
      "Select an unlocked image layer containing transparent or anti-aliased boundaries.",
      "Choose Layer → Matting → Remove White Matte if translucent edge colors were blended against white, or Remove Black Matte for a dark matte.",
      "Use Layer → Matting → Defringe to propagate nearby opaque colors into translucent edge pixels; select a suitable fringe width.",
      "Inspect the result against contrasting backgrounds. Undo if an edge loses useful color.",
      "Use Layer → Trim Layer to Content to crop away transparent padding while keeping the artwork in the same document-space position."
    ],
    "tips": [
      "Matting changes RGB in partially transparent pixels; it does not remove transparency.",
      "Fully opaque images, selections without eligible fringe pixels, and already-trimmed layers produce no new History entry.",
      "Editable Smart Objects can be rasterized by a successful matting operation; duplicate the layer first if you want to retain the original.",
      "16-bit matting requires browser support for float16 readback. Matting is not yet supported on 32-bit HDR documents.",
      "Locked layers cannot be trimmed or matted.",
      "When native 16-bit pixel readback or writeback is unavailable, Matting leaves the source untouched and reports the unsupported operation."
    ]
  },
  {
    "id": "transform-crop",
    "title": "Transform, Puppet Warp and Crop",
    "category": "Tools",
    "path": "Edit → Transform / Puppet Warp… / Crop toolbar",
    "summary": "Move, scale, straighten, crop and warp images.",
    "steps": [
      "Use Edit → Free Transform for move, scale and rotation.",
      "Choose Transform variants for perspective or warp distortion.",
      "Use Puppet Warp to bend portions of a subject by placing pins.",
      "Use Crop or Perspective Crop to adjust the image frame."
    ],
    "tips": [
      "Raster Warp and Puppet Warp have restrictions on authoritative 32-bit HDR layers."
    ]
  },
  {
    "id": "painting-retouch",
    "title": "Brushes, cloning and healing",
    "category": "Tools",
    "path": "Brush / Clone Stamp / Healing / Patch toolbar",
    "summary": "Paint, repair photos and retouch local regions.",
    "steps": [
      "Choose a brush or repair tool.",
      "Configure size, hardness, opacity, flow and sampling options.",
      "Alt/Option-click to define a Clone Stamp or Healing Brush source when required.",
      "Use Spot Healing, Patch or Content-Aware Move for local repair."
    ],
    "tips": [
      "Where supported, sample all layers and paint onto a new blank layer for non-destructive retouching.",
      "Clone and Heal are useful for tidying seams after the Offset filter."
    ]
  },
  {
    "id": "content-aware",
    "title": "Content-Aware editing",
    "category": "Tools",
    "path": "Edit → Content-Aware Fill… / Content-Aware Move",
    "summary": "Remove objects or reconstruct vacated areas.",
    "steps": [
      "Make a selection around an unwanted object and open Edit → Content-Aware Fill….",
      "Review available output and sampling controls, then apply.",
      "Use the Content-Aware Move tool to reposition a selected subject.",
      "Refine difficult regions with Clone Stamp or Healing."
    ],
    "tips": [
      "Content-Aware Fill estimates hidden pixels and may need manual cleanup.",
      "Content-Aware Fill requires an 8-bit document; 16-bit float and 32-bit HDR are blocked to prevent precision loss."
    ]
  },
  {
    "id": "color-hdr",
    "title": "Color depth, HDR and proofing",
    "category": "Color & files",
    "path": "File → New / View → Proof Setup…",
    "summary": "Work at appropriate precision and simulate output colors.",
    "steps": [
      "Choose 8-bit, supported 16-bit float, or 32-bit HDR when creating a document.",
      "Configure a soft-proof profile through View → Proof Setup….",
      "Toggle Proof Colors or Gamut Warning to inspect display differences.",
      "Choose an output format and bit depth appropriate for the final asset."
    ],
    "tips": [
      "Not every filter supports authoritative Float32 HDR.",
      "Soft proofing changes the preview, not source image pixels.",
      "ICC LUT/CLUT support remains incomplete.",
      "Auto Tone, Auto Contrast, Auto Color and Match Color are not yet supported on 32-bit HDR documents.",
      "In 32-bit HDR, Object Selection → Layer via Copy preserves scene-linear Float32 highlights for simple raster stacks. Complex effects cannot yet be extracted without risking precision loss.",
      "16-bit float editing requires native float16 Canvas2D readback and writeback. If a browser lacks either, the affected operation is stopped rather than converted silently to 8-bit.",
      "High precision varies by operation and runtime; unsupported destructive high-depth edits should refuse rather than silently quantize."
    ]
  },
  {
    "id": "hdr-fill",
    "title": "HDR Fill and feathered selections",
    "category": "Color & files",
    "path": "Edit → Fill / 32-bit HDR document",
    "summary": "Fill a selected area with a color without clipping HDR highlights or flattening image precision.",
    "steps": [
      "Open or create a 32-bit HDR document and select an unlocked raster layer.",
      "Set a foreground color using a hexadecimal RGB color (such as #ff8800).",
      "Optionally select the pixels you want to paint, using Feather for soft transitions.",
      "Choose Edit → Fill to blend the selected color into the layer's scene-linear Float32 pixels.",
      "Use Undo or History to revert the fill. Unselected pixels and HDR highlights remain unchanged."
    ],
    "tips": [
      "Fill uses straight-alpha source-over compositing and converts the UI sRGB color into scene-linear RGB.",
      "Layer offsets are respected and pixels outside the document are not filled.",
      "Text, shapes and Smart Objects must be rasterized explicitly before 32-bit HDR Fill.",
      "A selection containing no overlapping pixels does not modify the image or create a History entry.",
      "32-bit HDR Fill is supported, but other editing tools can have their own high-bit precision limitations."
    ]
  },
  {
    "id": "match-color",
    "title": "Match Color between documents",
    "category": "Color & files",
    "path": "Image → Adjustments → Match Color…",
    "summary": "Transfer color and contrast characteristics from one open image to a layer in another document.",
    "steps": [
      "Open the image to modify and a second image that will serve as the color reference.",
      "Select an unlocked raster or rasterizable layer in the document you want to modify.",
      "Choose Image → Adjustments → Match Color… and select the other open image under Source.",
      "Adjust Luminance, Color Intensity, Fade and Neutralize while viewing the Before/After sample.",
      "Choose Match Color to apply the result as an undoable pixel edit, or Cancel to leave the layer unchanged."
    ],
    "tips": [
      "The command does not support 32-bit scene-linear HDR documents yet; no conversion is performed silently.",
      "The original layer is modified, so duplicate it first if you want to keep the source independently editable.",
      "Long operations discard stale results if you switch documents, edit the layer or change History."
    ]
  },
  {
    "id": "exports-metadata",
    "title": "Saving, exporting and metadata",
    "category": "Color & files",
    "path": "File → Save Project / Export As… / File Info",
    "summary": "Keep editable project data and share finished files.",
    "steps": [
      "Use Save Project to keep layer/mask information.",
      "Use Export As or Quick Export for PNG, JPEG or WebP.",
      "Use Export Layers to Files to create separate rendered layer images.",
      "Open File → File Info / Metadata to inspect EXIF/IPTC/XMP and edit descriptive metadata where supported."
    ],
    "tips": [
      "JPEG has no transparency.",
      "Review GPS metadata and the strip-metadata option before sharing."
    ]
  },
  {
    "id": "history-recovery",
    "title": "Undo, snapshots and recovery",
    "category": "Workspace",
    "path": "Edit → Undo / Window → History / File → Recent & Recovery",
    "summary": "Review earlier versions and recover unsaved work.",
    "steps": [
      "Use Undo/Redo for recent edits and open Window → History to revisit them.",
      "Create named history snapshots when you need durable comparison states.",
      "Save projects regularly.",
      "Use File → Recent & Recovery after a browser crash or unexpected restart.",
      "Create named History snapshots with notes for milestones or comparisons.",
      "Click Download Backup on a recovery entry to export a portable project, or Back up all to folder when your WebView supports selecting a directory."
    ],
    "tips": [
      "Autosave and recovery depend on local storage retention; clearing browser data may delete them.",
      "Recovery exports are available after merged PR #86, but these are manual backups; profile deletion can still erase snapshots not copied elsewhere."
    ]
  },
  {
    "id": "shortcuts",
    "title": "Keyboard shortcuts and mobile",
    "category": "Workspace",
    "path": "Help → Keyboard Shortcuts / Settings → Touch / mobile mode",
    "summary": "View or customize key bindings and work without a keyboard.",
    "steps": [
      "Open Help → Keyboard Shortcuts to view and change current bindings.",
      "Use standard shortcuts such as Ctrl/Cmd+Z for Undo and Ctrl/Cmd+D for Deselect.",
      "Choose Touch / mobile mode when using a small or touch-first device.",
      "Reset shortcut overrides if a custom binding conflicts.",
      "Repeatedly press shared tool letters (M, L, B, J, etc.) to cycle related tools."
    ],
    "tips": [
      "The Shortcuts dialog shows the current binding if it has been customized.",
      "Main registers 52 tools, including Freeform/Curvature Pen and both Type Mask variants; shared keys cycle within tool families."
    ]
  },
  {
    "id": "plugins-ai",
    "title": "Plugins, automation and optional AI",
    "category": "Advanced",
    "path": "Plugins / Window → Batch / Scripting Console… / Generate",
    "summary": "Extend workflows with plugins, scripts, batch jobs and configured AI providers.",
    "steps": [
      "Open Plugins or Settings → Plugin Manager to inspect extensions.",
      "Use Window → Batch / Image Processor… for repetitive jobs.",
      "Use Window → Scripting Console… to automate supported commands.",
      "Use Generate / AI Tools to access locally configured or external AI services.",
      "Electron can use separately installed G'MIC/GEGL through Plugin Manager → Desktop Filters.",
      "Plugin Manager → GIMP Runtime can detect an independently installed GIMP 3 and run a selected supported PDB procedure in Electron when you explicitly execute it.",
      "Plugin Manager → GIMP Scripts can analyze scripts; a limited embedded Scheme interpreter or opt-in Pyodide Python runtime runs only on request."
    ],
    "tips": [
      "Photoshop UXP and GIMP compatibility is partial.",
      "Optional remote AI workflows can transmit content to outside providers.",
      "Online generation may send prompts or image data to remote providers.",
      "Supported GIMP 3 Python/Script-Fu procedures run only in a separately installed GIMP through Electron; no arbitrary GIMP native host runs in the web browser.",
      "Pyodide downloads its runtime only on explicit use and is not guaranteed offline.",
      "Only run trusted GIMP scripts; native processes have normal OS permissions."
    ]
  },
  {
    "id": "file-formats-raw",
    "title": "RAW, HDR, scientific and multi-page image files",
    "category": "Color & files",
    "path": "File → Open / Place / Layer → Redevelop RAW Smart Object…",
    "summary": "Open camera RAW, HDR, modern codecs and scientific files while retaining editable RAW originals when feasible.",
    "steps": [
      "Use File → Open or File → Place to select RAW images. The Develop dialog includes exposure, white balance, demosaicing, highlight, denoising and custom lens correction fields.",
      "When Keep original RAW is enabled, files up to 64 MiB are embedded in editable Smart Objects. Select the Smart Object and choose Layer → Redevelop RAW Smart Object… to regenerate from original bytes without changing transforms or Smart Filters.",
      "Custom lens profiles use user-calibrated distortion, lateral color-fringing and vignette coefficients. Import individual Lensfun XML calibration files on demand using Import Lensfun XML… in the Develop dialog; Match EXIF Lens requires unambiguous camera lens metadata. A full Lensfun WASM database is not bundled.",
      "OpenEXR supports regular single and multipart scanline/single-level tiled images with NONE/RLE/ZIPS/ZIP compression. Float32 HDR samples are retained per part; deep and multiresolution EXR remain unsupported.",
      "FITS and a limited subset of DICOM medical images import as display renderings. DICOM supports uncompressed, RLE Lossless, JPEG baseline, JPEG-LS and JPEG 2000 via available decoders; clinical values and measurements are not preserved.",
      "When TIFF, DCX, FITS, DICOM or multipart EXR contains multiple images, choose one frame/part or import all as selectable layers."
    ],
    "tips": [
      "Files larger than 64 MiB can be developed as ordinary raster images but their original RAW bytes are not embedded. RAW decoders may use a clearly labeled 8-bit camera preview if sensor decoding fails.",
      "Imported Lensfun XML uses recorded calibration values with conservative EXIF matching; the full licensed database and WASM remapping engine are not bundled. Save the project to retain RAW originals and recipes.",
      "DICOM support is only for graphic editing, never diagnosis or medical measurements. Rare compressed transfer syntaxes and ambiguous multifragment frame tables are rejected.",
      "BPG has no vetted decoder. Deep EXR, multiresolution tile levels and PIZ/PXR24/B44 compression remain unsupported. A six-camera real RAW sensor matrix passed but newer vendor compression variants still need testing."
    ]
  },
  {
    "id": "troubleshooting",
    "title": "Troubleshooting and known limits",
    "category": "Support",
    "path": "Window / Settings / Help",
    "summary": "Find a missing tool or diagnose a failed operation.",
    "steps": [
      "Use Window to reveal hidden panels or Settings → Reset panel layout.",
      "Check whether a command requires an active selection, unlocked layer or specific layer type.",
      "For performance problems, try smaller images and confirm browser worker support.",
      "If a source format fails, try exporting PNG or TIFF from its original application.",
      "Report reproducible defects with browser version, bit depth, steps and errors on GitHub Issues.",
      "If the update checker reports offline, continue editing normally; automatic installs are not enabled."
    ],
    "tips": [
      "32-bit HDR, complex PSD layer effects and ICC processing still have compatibility limits.",
      "Project issues: https://github.com/Chaython/ChaysPhotoStudio/issues",
      "Recognized RAW, HEIC/JXL/JP2 or design-document extensions do not guarantee a bundled decoder.",
      "See docs/FEATURES_AND_FORMATS.md for platform-specific limits and pending PRs."
    ]
  },
  {
    "id": "tool-overview",
    "title": "Tool groups and choosing the right tool",
    "category": "Tools",
    "path": "Left toolbar / Tool Options / Edit → Customize Toolbar…",
    "summary": "Find related Photoshop-style tools and inspect their options.",
    "steps": [
      "Use Move (V), Marquee (M) and Lasso (L) for movement and geometric/freehand selection.",
      "Use Quick/Object Selection, Magic Wand (W), Selection Brush and Select & Mask for detailed subjects.",
      "Paint with Brush/Mixer/Pencil (B); retouch with Healing/Patch (J), Clone Stamp (S), Eraser (E) and tonal tools.",
      "Use Pen (P), Path/Direct Selection (A), Type (T), Shape (U), Hand (H) and Zoom (Z) for paths and navigation.",
      "Organize toolbar groups through Edit → Customize Toolbar… and key assignments through Keyboard Shortcuts."
    ],
    "tips": [
      "Main has 52 registered tools; shared hotkeys cycle tools.",
      "Search all 52 tools through Window → All Tools / Tool Search (merged PR #81)."
    ]
  },
  {
    "id": "paths-type",
    "title": "Paths, text and shapes",
    "category": "Tools",
    "path": "Pen / Paths panel / Type / Shape",
    "summary": "Create editable contours and typography rather than painting everything into raster pixels.",
    "steps": [
      "Click or drag with Pen (P) to place corner/smooth Bézier anchors; edit handles for curved segments.",
      "Use Path/Direct Selection (A) to edit saved paths in Window → Paths.",
      "Turn supported paths into selections, strokes, fills or editable shape layers.",
      "Use Type (T) for point/paragraph text and Shape (U) for rectangles, rounded rectangles, ellipses, stars or polygons."
    ],
    "tips": [
      "Freeform Pen, Curvature Pen and horizontal/vertical Type Mask tools are included on main (merged PR #82).",
      "Advanced OpenType settings and Photoshop PSD text round-trips are not exact."
    ]
  },
  {
    "id": "layer-comps",
    "title": "Layer Comps and alternate designs",
    "category": "Layers",
    "path": "Window → Layer Comps / Window → Layers",
    "summary": "Save several layout variations without duplicating the complete document.",
    "steps": [
      "Arrange layers, visibility, positions and supported appearances for the first design.",
      "Save the current state as a named Layer Comp.",
      "Switch comps to compare variants and export chosen comps when needed."
    ],
    "tips": [
      "Layer Comps store layer-state variants, not edit-history snapshots."
    ]
  },
  {
    "id": "channel-calculations",
    "title": "Apply Image, Calculations and channels",
    "category": "Layers",
    "path": "Image → Apply Image… / Image → Calculations… / Window → Channels",
    "summary": "Build channel-driven composites and masks.",
    "steps": [
      "Use Apply Image… to blend another source document/layer/channel into the active target.",
      "Use Calculations… to combine channels, choosing a selection or saved channel destination.",
      "Inspect alpha/luminosity channels through Window → Channels and load them as selections."
    ],
    "tips": [
      "Keep a source copy before complex compositing.",
      "Some 32-bit HDR blend combinations remain guarded."
    ]
  },
  {
    "id": "proofing-resolution",
    "title": "Proofing, print resolution and guides",
    "category": "Color & files",
    "path": "View → Proof Setup… / Proof Colors / Gamut Warning / Rulers",
    "summary": "Preview intended color output and make measured edits.",
    "steps": [
      "Set document PPI for print-size metadata; PPI does not create pixel detail.",
      "Use View → Proof Setup… and Proof Colors for a display simulation.",
      "Enable Gamut Warning to locate potentially out-of-gamut colors.",
      "Show rulers, guides and grid; adjust units and snapping."
    ],
    "tips": [
      "ICC/CMYK proofing is an approximation, not certified print color matching."
    ]
  },
  {
    "id": "image-imports",
    "title": "Import formats and video frame extraction",
    "category": "Color & files",
    "path": "File → Open… / Open as Layer… / Place (Smart Object)…",
    "summary": "Choose import paths for raster, layered and media files.",
    "steps": [
      "Open a file as a new document, Open as Layer… to add to the current image, or Place… as a Smart Object.",
      "Open MP4/WebM/MKV to scrub a local preview, choose a timestamp and Import frame.",
      "Consult the feature/format reference to distinguish native codecs from previews and fallback extractors."
    ],
    "tips": [
      "File extension recognition does not guarantee decoding.",
      "RAW development on main is largely preview-oriented; deeper development is in PRs #79/#84.",
      "HEIC, JPEG XL and JPEG 2000 depend on operating-system/WebView codecs."
    ]
  },
  {
    "id": "format-exports",
    "title": "Layered exports, Save As and metadata",
    "category": "Color & files",
    "path": "File → Save Project / Export As… / Export Layers to Files…",
    "summary": "Preserve work in the native project and deliver suitable formats.",
    "steps": [
      "Save .zproj.json for editable projects, masks and supported document state.",
      "Choose PNG, JPEG, WebP, TIFF, BMP, TGA, QOI, PPM, ICO, OpenRaster or PSD from Export As….",
      "Use Export Layers to Files or Layer Comps export for multi-output deliverables.",
      "Review File Info metadata and stripping controls before sharing."
    ],
    "tips": [
      "PSD/ORA may approximate or rasterize effects.",
      "TIFF 16-bit output depends on the supported document and export path."
    ]
  },
  {
    "id": "hdr-precision",
    "title": "High-depth workflows and guarded edits",
    "category": "Color & files",
    "path": "File → New (color depth) / Image / Filter / Layer",
    "summary": "Avoid losing 16/32-bit pixel precision during editing.",
    "steps": [
      "Create a suitable high-bit-depth document only when the runtime supports its pixel buffers.",
      "Prefer adjustment layers, layer masks and Smart Filters to destructive 8-bit processing.",
      "Use supported Float32 operations for merging, filling and transforming when available.",
      "If a tool refuses a high-depth edit, save the original and use a supported operation or separate SDR copy."
    ],
    "tips": [
      "Not every codec, plugin, filter or PSD export preserves float precision.",
      "Unsafe high-depth destructive edits should be blocked instead of silently flattened."
    ]
  },
  {
    "id": "offline-desktop",
    "title": "Offline editing and desktop releases",
    "category": "Advanced",
    "path": "GitHub Releases / File / Recent & Recovery",
    "summary": "Choose a distribution that matches connectivity and OS needs.",
    "steps": [
      "Use the browser/PWA, bundled Electron desktop app, or lightweight Tauri WebView build.",
      "Default Tauri releases embed their frontend but require the OS WebView runtime to be present or provisioned.",
      "Save .zproj.json files outside the browser profile as backups.",
      "External AI, remote image URLs and release updates require connectivity.",
      "The About dialog includes a manual Check for updates control; it does not silently install or restart the app."
    ],
    "tips": [
      "The extra offline Windows installer and embedded WebView CSP/window-state/recovery improvements are in main after merged PRs #85/#86.",
      "Electron uses a bundled localhost server and does not depend on GitHub Pages."
    ]
  },
  {
    "id": "performance",
    "title": "Large documents, performance and memory",
    "category": "Support",
    "path": "Settings / Window → Layers / Filter",
    "summary": "Keep large layered projects responsive.",
    "steps": [
      "Hide unneeded panels, reduce heavy live previews and close unused documents.",
      "Use bounded selections and nondestructive filters instead of repeating full-image operations.",
      "Review History snapshots and layer count when memory grows.",
      "Check WebGL2, browser codecs and pixel-worker support if a tool fails or falls back."
    ],
    "tips": [
      "Lazy panel/dialog loading reduces startup overhead but does not eliminate large-image memory costs.",
      "Bug reports should include document size, bit depth, layer count and reproducible steps."
    ]
  },
  {
    "id": "gimp-compat",
    "title": "GIMP plugins, PDB runtime and script interpreters",
    "category": "Advanced",
    "path": "Plugin Manager → Desktop Filters / GIMP Scripts / GIMP Runtime",
    "summary": "Discover compatible GIMP assets and use supported external GIMP procedures without starting runtimes at launch.",
    "steps": [
      "Import supported .gbr brush, .ggr gradient and related GIMP assets into native editing controls.",
      "In Electron, use Desktop Filters to inspect an existing G'MIC or GEGL install; these are never bundled by the browser app.",
      "In Plugin Manager → GIMP Runtime, click Detect GIMP 3, inspect/select a noninteractive procedure, and execute it only after reviewing/trusting it.",
      "Use GIMP Scripts for static source analysis. Electron can run explicitly chosen Python/Script-Fu source in a separate GIMP 3 process; image results are returned as a new layer.",
      "For simple standalone experiments, choose the embedded Scheme subset or enable Python/Pyodide; these interpreters start only when you press Run.",
      "With GIMP runtime or embedded interpretation, only the required external process/interpreter starts on explicit execution."
    ],
    "tips": [
      "Native GIMP 3 is Electron-only, installed separately, and runs with OS permissions; scripts are not sandboxed.",
      "Pyodide is downloaded from a pinned remote CDN on first explicit request and may not work offline.",
      "Embedded interpreters do not implement native GIMP GI, PDB or direct image editing; PNG interchange is not HDR/RAW round-tripping."
    ]
  }
]

export function getHelpTopic(id: unknown): HelpTopic | undefined {
  return typeof id === 'string' ? HELP_TOPICS.find(t => t.id === id) : undefined
}
export function searchHelpTopics(query: string, category: HelpCategory | 'All' = 'All'): HelpTopic[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return HELP_TOPICS.filter(t => {
    if (category !== 'All' && t.category !== category) return false
    const text = [t.title, t.category, t.path, t.summary, ...t.steps, ...t.tips].join(' ').toLocaleLowerCase()
    return words.every(word => text.includes(word))
  })
}
