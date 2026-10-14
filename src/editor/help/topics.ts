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
      "Choose the Photoshop-style or Classic workspace from the top-right workspace selector; each workspace remembers independent tool and panel layouts. In that menu you can independently **Lock panels layout** or **Lock tools layout** for the active workspace; these guards preserve positions, grouping and sizing while still allowing you to select tools and existing panels. Unlock before restoring a workspace template or applying a saved preset that changes a locked layout. Locks are stored per workspace, not embedded in exported presets.",
      "In Photoshop-style, drag inspector tabs within or between the upper and lower stacks; Alt+Left/Right reorders and Alt+Up/Down moves a tab between stacks. Use Window → Show Panel or the + menu to add another panel (such as Metadata or Timeline) to the lower inspector stack; move it between stacks like any other tab. On wide screens, Show second inspector column adds a separately resizable column: drag tabs into it or press Alt+Shift+Right on a tab; Alt+Shift+Left returns it to the lower stack. On narrower screens, those tabs appear in the lower stack without changing the saved layout. The collapsed icon rail follows your custom grouping. The reset icon restores the default tab groups and closes the secondary column without removing named layouts.",
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
      "Use File → Open or File → Place to select RAW images. Develop includes LibRaw sensor controls, reversible 16-bit Basic adjustments, a five-point composite RGB/per-channel tone curve, eight-band HSL Color Mixer, and on-demand optical corrections.",
      "Under Camera color calibration, select Prefer embedded DNG/file matrix (default) to let LibRaw use camera-provided matrix data when available, regardless of white-balance mode. Choose LibRaw built-in calibration to ignore the embedded matrix where a built-in camera calibration is available.",
      "Choose Custom sensor multipliers in White balance to adjust Red, Green, Blue and Second green coefficients (0.1–16) before LibRaw demosaicing. These are camera/sensor coefficients, not Kelvin/tint values. Use Camera as-shot or Auto unless you have measured camera-specific multipliers. RAW Smart Objects retain them for redevelopment.",
      "Batch RAW JPEG, 8-bit TIFF and native 16-bit TIFF exports now embed a generated ICC v2 sRGB display profile. This tags the current sRGB output for compatible color-managed viewers without altering the underlying developed pixels.",
      "To develop several RAW files with the same global recipe, select multiple RAW photos with File → Open. In the first RAW Develop dialog, check Apply these global development settings to the remaining RAW photos, then choose Open RAW. Files process one at a time, and a failed file does not stop the others. Leave the checkbox unchecked to customize photos individually.",
      "Choose File → Batch Export RAW Photos… to select multiple camera RAW files, a saved global or neutral RAW recipe, and JPEG, TIFF 8-bit or native TIFF 16-bit output. In Chromium, choose an output folder to prevent browser multiple-download blocking; otherwise permit multiple browser downloads.",
      "Select Load / Refresh RAW preview to decode a half-resolution sample on demand. Basic, curve and HSL edits update the side-by-side Before/After display and RGB/luminance histogram; exposure, white balance, demosaicing, noise reduction and lens changes require Refresh. The preview is not the final-resolution output.",
      "Expand Detail to adjust display-referred, 16-bit luminance and color noise reduction, sharpening amount, 1–3 developed-pixel radius, and sharpening threshold. All adjustments are reversible in RAW Smart Object recipes and disabled by default; Reset detail restores neutral values.",
      "Expand Local adjustments to add up to eight radial-ellipse or linear-gradient masks. Select a mask to set normalized position, radius, feather/strength, enabled/inverted state, and local Exposure, Saturation and Warmth. Expand the section while previewing to see a yellow outline/line marking the selected mask; it is never part of the export.",
      "For painted masks choose Add brush under Local adjustments, load the RAW preview, and paint on the After image. Use Erase to subtract regions, adjustable brush diameter and feather, Undo last stroke or Clear brush strokes. Mask parameters and edits remain in the RAW Smart Object recipe; the yellow/pink stroke guide is preview-only.",
      "When Keep original RAW is enabled, files up to 64 MiB are embedded in editable Smart Objects. Select the Smart Object and choose Layer → Redevelop RAW Smart Object… to regenerate from original bytes without changing transforms or Smart Filters.",
      "Custom lens profiles use user-calibrated distortion, lateral color-fringing and vignette coefficients. Import individual Lensfun XML calibration files on demand using Import Lensfun XML… in the Develop dialog; Match EXIF Lens requires unambiguous camera lens metadata. A full Lensfun WASM database is not bundled.",
      "OpenEXR supports regular single and multipart scanline/single-level tiled images with NONE/RLE/ZIPS/ZIP compression. Float32 HDR samples are retained per part; deep and multiresolution EXR remain unsupported.",
      "FITS and a limited subset of DICOM medical images import as display renderings. DICOM supports uncompressed, RLE Lossless, JPEG baseline, JPEG-LS and JPEG 2000 via available decoders; clinical values and measurements are not preserved.",
      "When TIFF, DCX, FITS, DICOM or multipart EXR contains multiple images, choose one frame/part or import all as selectable layers."
    ],
    "tips": [
      "ICC tagging describes the export color space; it is not a DCP camera-profile importer, an ICC color-space conversion, a wide-gamut workflow, or proof of Lightroom-equivalent rendering. Output remains sRGB, and viewers without ICC support may ignore the metadata.",
      "Custom white-balance sensor multipliers are specific to the original photograph. They are not transferred to other photos during batch develop/export, and opening a different RAW resets saved custom coefficients to Camera as-shot.",
      "The editor continues to output sRGB. Embedded DNG/file matrices improve use of available camera calibration but do not provide Adobe DCP profiles, calibrated illuminant interpolation or ICC-managed wide-gamut output. Actual color fidelity depends on camera metadata and LibRaw support.",
      "Batch export is sequential and does not change the current document or the original RAW files. It excludes per-photo brush masks and lens calibration, never silently overwrites an existing folder export, reports individual failures, and supports cancelling between photos. TIFF 16-bit exports directly from LibRaw's native 16-bit samples; JPEG/TIFF8 are display-referred. Browser downloads may require permission and cannot be confirmed as completed.",
      "Batch RAW import copies global exposure, camera-WB mode, demosaicing, highlight recovery, denoising, Basic, Curves, HSL and Detail settings. Each file reads its own camera metadata and retains its own RAW original and Smart Object. Image-specific lens profiles, local gradients and brush masks are intentionally not copied. Batch import is separate from batch exporting and does not create output files automatically.",
      "Detail uses a conservative edge-aware neighborhood smoother and luma-based unsharp filter after RAW color/HSL processing, before local masks. The half-resolution preview is useful for rough adjustments, but its pixel-scale sharpening and noise texture will differ from full-resolution output. Inspect at 100% after development. These filters are not Lightroom's proprietary camera-specific denoising algorithms.",
      "Brush strokes are limited to 48 strokes per mask and 128 samples per stroke to bound project size and full-resolution processing. Paint and erase strokes work in order; local masks and brush paths never modify original RAW bytes. The current brush implementation is manual, not AI subject selection.",
      "Local mask recipes live with RAW Smart Object settings and are applied after global Basic, RGB curves and HSL. Color presets deliberately omit local masks. Manual brush-painted masks are supported, but automatic subject-aware or AI-generated masks are not. Mask coordinates are relative to the developed image dimensions.",
      "RAW color presets export/import Basic tone, RGB/per-channel point curves and HSL as local JSON. Camera, EXIF and lens calibration are excluded; older presets without curves import with a neutral identity curve. Display-referred color rendering is not equivalent to Adobe Lightroom's proprietary camera profiles.",
      "Files larger than 64 MiB can be developed as ordinary raster images but their original RAW bytes are not embedded. RAW decoders may use a clearly labeled 8-bit camera preview if sensor decoding fails.",
      "Imported Lensfun XML uses recorded calibration values with conservative EXIF matching; the full licensed database and WASM remapping engine are not bundled. Save the project to retain RAW originals and recipes.",
      "DICOM support is only for graphic editing, never diagnosis or medical measurements. Rare compressed transfer syntaxes and ambiguous multifragment frame tables are rejected.",
      "BPG has no vetted decoder. Deep EXR, multiresolution tile levels and PIZ/PXR24/B44 compression remain unsupported. A six-camera real RAW sensor matrix passed but newer vendor compression variants still need testing."
    ]
  },
  {
    "id": "photo-library-catalog",
    "title": "Photo Library: indexing, ratings and keywords",
    "category": "Color & files",
    "path": "File → Photo Library / Catalog…",
    "summary": "Organize local camera RAWs and photographs using a private browser catalog with thumbnails, searchable keywords, ratings and picks/rejects.",
    "steps": [
      "Choose File → Photo Library / Catalog… and select photos to index. Thumbnails and a small amount of camera metadata are stored locally in the current browser; the original photos remain on your disk.",
      "Search filenames, camera models, capture dates and keywords. Narrow by RAW versus regular images, star rating, and Pick/Reject/Unflagged status; sort by import date, capture date, filename, or rating.",
      "Select a thumbnail to assign 0–5 stars, set a Pick/Reject flag, and save comma-separated keywords. Changes persist when you reopen the catalog.",
      "To edit a newly indexed photograph, select Open original. After restarting the app, choose Relink original and select the same source photo before opening it again. Remove from catalog deletes only the local thumbnail/metadata record."
    ],
    "tips": [
      "The catalog is local IndexedDB storage. Originals and file paths are not saved or uploaded. Browser data clearing or private browsing can erase the catalog; it is not a backup or an external Lightroom-style synced library.",
      "RAW thumbnails use available embedded previews where possible. Files without decodable thumbnails still index as metadata-only entries; full RAW development remains in File → Open.",
      "Photo relinking compares a fast SHA-256 fingerprint of file size plus first/last 64 KiB, not the entire original file. It is intended for accidental mismatch prevention, not cryptographic whole-file integrity.",
      "Each import selection is capped at 250 photos with a 256 MiB maximum per source. Imports are sequential and can be cancelled between files."
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
      "Open MP4/WebM/MKV to scrub a local preview, choose a timestamp, or use the estimated frame-step buttons with a selected FPS (24, 25, 30 or 60), then choose Import frame.",
      "Consult the feature/format reference to distinguish native codecs from previews and fallback extractors."
    ],
    "tips": [
      "File extension recognition does not guarantee decoding.",
      "Browser video support depends on installed codecs; MKV and some MP4 variants may not decode. Frame stepping advances by an assumed 1/FPS interval, not an exact source-frame index. Import is blocked until asynchronous seek completes; Cancel leaves the document unchanged.",
      "RAW development supports editable settings, curves, HSL adjustments and manual local masks, but decoder coverage, lens corrections and non-destructive compatibility vary by camera and file format.",
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
  },
  {
    "id": "shared-layer-context-menus",
    "title": "Shared canvas and Layers panel right-click menus",
    "category": "Workspace",
    "path": "Move tool → canvas right-click / Layers panel → layer right-click",
    "summary": "Use one customizable set of layer commands across both editing surfaces.",
    "steps": [
      "Right-click a layer on the canvas with the Move tool, or right-click its row in the Layers panel.",
      "Both menus honor the same action visibility and order; choose Edit context menu… from either location.",
      "The shared Masks and clipping section includes Add Mask, Apply/Delete Mask, vector mask operations and clipping; Convert and merge also includes Trim to Content.",
      "Right-clicking an unselected layer row makes it the active target before Cut or Copy; right-clicking an already-selected row retains the current multi-selection.",
      "Customizations synchronize immediately between the two menus and are saved in the current browser/app profile."
    ],
    "tips": [
      "Unavailable commands remain disabled or are omitted when the active layer type does not support them.",
      "Old saved menu layouts are preserved; newly introduced commands and sections are appended automatically.",
      "Other editing tools' canvas right-click gestures are unaffected."
    ]
  },
  {
    "id": "customize-context-menu",
    "title": "Customize the canvas right-click menu",
    "category": "Workspace",
    "path": "Move tool (V) → right-click a layer → Edit context menu…",
    "summary": "Choose which layer commands appear when right-clicking the canvas.",
    "steps": [
      "Activate Move (V), right-click a layer on the canvas, then choose Edit context menu… at the bottom.",
      "Use checkboxes to show or hide an action, and arrow buttons to move it up or down within its section.",
      "Choose Reset defaults to restore all actions and their original order, or Done to close the editor.",
      "Use the Edit section for Undo, Redo, Cut Layer and Paste Layer, alongside transforms, layer styles, arrange and merge."
    ],
    "tips": [
      "Preferences persist locally in the current browser or desktop-app profile.",
      "The Edit context menu… entry cannot be hidden, so the layout can always be restored.",
      "The context menu remains scoped to the Move tool to avoid interfering with other tools' right-click gestures.",
      "Commands that do not apply to the active layer may be disabled or omitted."
    ]
  },
  {
    "id": "ruler-color-sampler",
    "title": "Ruler measurements and persistent color sampler points",
    "category": "Tools",
    "path": "Measure tool (K) / Color Sampler (I tool group) / Window → Info",
    "summary": "Measure calibrated distances and keep color sample readouts on an editable document.",
    "steps": [
      "Drag with Measure to read pixel length, angle and horizontal/vertical deltas; hold Shift to constrain the measurement angle.",
      "Enable Multi-segment to measure a connected path. Select inches, centimeters or millimeters and use the document PPI, or disable Use Document Resolution to supply manual pixels-per-unit calibration.",
      "Choose Save Ruler to store the current segments in the document's Info panel; choose Clear or press Escape while measuring to remove the temporary ruler.",
      "Enable Keep Measurement to leave the live ruler visible when switching tools; it is not shown on other open documents.",
      "Place Color Sampler points on the canvas, drag a point to move it, or Alt/Option-click it to remove it.",
      "Select a sampler and use arrow keys for one-pixel movement, or Shift plus an arrow for ten pixels; Delete removes the selection and Escape deselects it.",
      "In the Info panel, enter exact X/Y values for a point, click Copy to copy its HEX value, or export all point colors, coordinates, sample sizes and source choices with CSV."
    ],
    "tips": [
      "Saved measurements are part of the project; temporary ruler geometry is not.",
      "Color Sampler markers remain visible while other tools are active.",
      "A sample on a fully transparent pixel displays Transparent instead of an invented opaque color.",
      "Some high-depth colors are represented as display-preview values; these readouts are not a substitute for scene-linear sampling.",
      "The Info panel lets you enter exact X/Y sampler coordinates, copy non-transparent HEX values and export sampler readings to CSV.",
      "Fully transparent or empty-layer samples are reported as Transparent, without fake black RGB/CMYK/Lab values."
    ]
  },
  {
    "id": "hdr-retouch-tools",
    "title": "High-precision 16-bit and 32-bit retouching",
    "category": "Tools",
    "path": "Dodge / Burn / Sponge in 16-bit sRGB; Blur / Sharpen / Smudge / Dodge / Burn / Sponge in 32-bit Float32",
    "summary": "Use native Float16 Dodge, Burn, and Sponge on supported 16-bit sRGB raster layers, or the expanded scene-linear Float32 retouch toolkit in 32-bit documents.",
    "steps": [
      "Open a 16-bit sRGB document on a browser exposing native Float16 Canvas2D readback. Dodge, Burn, and Sponge use a bounded native Float16 brush region rather than 8-bit ImageData.",
      "Each 16-bit tonal dab expands only its own area into scene-linear Float32, applies the retouch, and writes back changed Float16 RGB channels; untouched channels and alpha remain unchanged.",
      "16-bit Dodge/Burn support tonal ranges, exposure, pressure and Alt/Option mode switching. Sponge supports Saturate/Desaturate and Vibrance. All honor brush opacity, layer offsets and selections.",
      "Open a 32-bit document and select a raster with authoritative Float32 pixels to use Blur, Sharpen, Smudge, Dodge, Burn or Sponge.",
      "32-bit Smudge supports Current Layer pickup and Finger Painting; keep Sample All Layers disabled. Blur and Sharpen New Layer output is not HDR-safe.",
      "Undo or redo actual changes through History. Unsupported depth/modes refuse edits rather than silently lowering the precision."
    ],
    "tips": [
      "16-bit tonal support requires genuine Float16 readback and an sRGB canvas; unsupported browsers or Display-P3 canvases are explicitly rejected.",
      "16-bit Blur, Sharpen, Smudge, and other byte-based tools remain guarded until dedicated Float16 algorithms are validated.",
      "32-bit Smudge Sample All Layers and 32-bit retouch New Layer output remain guarded against lossy compositing.",
      "Canvas Float16 read/write is native half-float precision, not the 32-bit Float32 HDR backing store; the display result may be rounded to representable half-float values.",
      "Selections, transparency and document/layer targeting remain in effect for supported high-bit-depth retouching."
    ]
  },
  {
    "id": "artboards-pages",
    "title": "Artboards, page layers and export",
    "category": "Color & files",
    "path": "File → Artboards / Pages…",
    "summary": "Define multiple named artboards in one editable document and export artboard-specific compositions.",
    "steps": [
      "Open a document, then choose File → Artboards / Pages… to open the artboard editor.",
      "Drag over the artwork to create a named rectangle, or use Add canvas, Split 2, and Grid 2×2. Click an artboard to edit its name and bounds.",
      "For the selected artboard, use Layers on this artboard to choose the subset of document layers included in that artboard's preview and raster export. All layers uses the original document stack; Hide all exports an empty region.",
      "Choose All artboards or Selected artboard and PNG, WebP, or JPEG, then click Export Artboards. Compatible browsers save into a selected folder; other browsers download files individually.",
      "Choose Show on canvas to toggle non-exporting artboard outlines. Save Project retains artboards and their layer-inclusion lists; History restores edits.",
      "For basic Fireworks-style rollovers, select an artboard and link Normal, Hover and Pressed states to existing Layer Comps, or use Capture to create a new snapshot of the current layer appearance. Export Artboards writes state images and a CSS-only HTML rollover prototype when Hover or Pressed is configured."
    ],
    "tips": [
      "Artboards share the original editable layer stack and canvas. Layer inclusion changes artboard exports without changing document-wide layer visibility or deleting source layers.",
      "Globally hidden layers remain hidden even when listed on an artboard; newly created layers may need to be included in artboards with custom layer lists.",
      "Artboards cannot extend beyond the existing document. CSS rollover previews reuse Layer Comps; native Fireworks page/state/symbol objects, editable Illustrator AI round trips and independent page-layer trees remain unsupported."
    ]
  },
  {
    "id": "design-library",
    "title": "Design templates and brand kits",
    "category": "Color & files",
    "path": "File → Design Templates & Brand Kits…",
    "summary": "Create new editable designs from saved local project templates, and reuse brand swatches, font families and logos without an account or cloud service.",
    "steps": [
      "Open an editable document, choose File → Design Templates & Brand Kits, and use Save active document as template. Name and categorize the template for later reuse.",
      "Search local templates and choose Use template to open a separate editable document; the original template remains unchanged. Export a .ztemplate.json backup or import one on another Studio installation.",
      "Switch to Brand kits and create a kit. Add named hex swatches, local font family names and PNG/JPEG/WebP logo images (up to 512 KiB each). Save the kit.",
      "Choose Apply on a swatch/font for a one-time change. Choose Link to give the selected editable text/shape layer a persistent brand-style reference; linked colors/fonts remain editable and save with the project.",
      "Edit an existing swatch color/name or font family in the kit without deleting its identity; choose Save brand kit & update links to propagate changes to linked layers across open documents with Undo/Redo. Choose Unlink selected layer to keep its current appearance without future propagation."
    ],
    "tips": [
      "Template projects are copies of native .zproj.json content (up to 32 MiB each); the thumbnail is only a preview. Huge documents should be saved as standalone projects instead of templates.",
      "The design library uses browser/device IndexedDB storage. Clearing site/app data deletes local templates and brand kits; export backups before doing so.",
      "Imported font names do not install fonts. Linked brand styles are embedded per project and update across currently open documents when their matching local brand kit is saved or explicitly synced. Closed documents preserve their last saved colors until reopened and synced.",
      "Deleted kit colors/fonts do not erase artwork: linked layers retain their last embedded values, and you can unlink them. This is local brand-token propagation, not Canva's stock-asset marketplace, multi-user permissions, network publishing or real-time collaboration."
    ]
  },
  {
    "id": "bulk-design",
    "title": "Bulk Create designs from CSV",
    "category": "Color & files",
    "path": "File → Bulk Create from CSV…",
    "summary": "Create multiple flattened designs by replacing text-layer placeholders with literal values from an imported CSV, without changing the source design.",
    "steps": [
      "Add editable text layers to a document using exact {{Column Name}} placeholders, such as {{Name}} and {{Job}}.",
      "Choose File → Bulk Create from CSV and load a UTF-8 CSV file. The first row defines column names; commas, quoted strings and newlines are supported.",
      "Check the columns against detected text placeholders. Every placeholder must match a CSV heading exactly before export. Choose a filename column and PNG, JPEG or WebP.",
      "Click Export designs, choose an output directory when supported and review the images. Each CSV row creates a separate flattened design using detached text-layer copies.",
      "Stop after the current design if needed. The source document, text layers and editing History are left unchanged."
    ],
    "tips": [
      "CSV imports are local-only, limited to 1 MiB, 64 columns and 100 data rows. Individual CSV fields are limited to 2,000 characters.",
      "Text placeholders are literal substitutions, not script execution or rich formatting. This first version does not merge images, modify shapes/colors from CSV, or produce new layered documents per row.",
      "For browsers lacking a folder-picker API, downloading more than 20 images at once is disabled to avoid blocked/missing browser downloads.",
      "Missing CSV columns block export rather than producing accidentally unfilled placeholders. Text with matched placeholders retains its existing layer styling."
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
