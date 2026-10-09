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
export const HELP_TOPICS: readonly HelpTopic[] = [
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
      "Check File → Recent & Recovery after an interruption."
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
      "Use the theme toggle for Dark, Light or OLED black; Settings also offers Touch / mobile mode.",
      "Choose Settings → Reset panel layout if a panel is difficult to locate."
    ],
    "tips": [
      "The top-toolbar Help button opens this manual without leaving the editor."
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
      "Use clipping masks when the visible area should follow the layer underneath."
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
      "Plugin effects do not necessarily support Smart Filters."
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
      "16-bit float editing requires native float16 Canvas2D readback and writeback. If a browser lacks either, the affected operation is stopped rather than converted silently to 8-bit."
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
      "Use File → Recent & Recovery after a browser crash or unexpected restart."
    ],
    "tips": [
      "Autosave and recovery depend on local storage retention; clearing browser data may delete them."
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
      "Reset shortcut overrides if a custom binding conflicts."
    ],
    "tips": [
      "The Shortcuts dialog shows the current binding if it has been customized."
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
      "Use Generate / AI Tools to access locally configured or external AI services."
    ],
    "tips": [
      "Photoshop UXP and GIMP compatibility is partial.",
      "Optional remote AI workflows can transmit content to outside providers."
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
      "Custom lens profiles use user-calibrated distortion, lateral color-fringing and vignette coefficients. Automatic camera/lens matching against a Lensfun database is not yet provided.",
      "OpenEXR supports scanline and single-level tiled images with NONE/RLE/ZIPS/ZIP compression; deep, multipart and multiresolution EXR remain unsupported.",
      "FITS and a limited subset of DICOM medical images import as display renderings. DICOM supports uncompressed, RLE Lossless, JPEG baseline, JPEG-LS and JPEG 2000 via available decoders; clinical values and measurements are not preserved.",
      "When TIFF, DCX, FITS or DICOM contains multiple images, choose one frame or import all frames as selectable layers."
    ],
    "tips": [
      "Files larger than 64 MiB can be developed as ordinary raster images but their original RAW bytes are not embedded. RAW decoders may use a clearly labeled 8-bit camera preview if sensor decoding fails.",
      "These lens corrections are manually calibrated coefficients, not verified manufacturer or Lensfun camera profiles. Save the project to retain RAW originals and recipes.",
      "DICOM support is only for graphic editing, never diagnosis or medical measurements. Rare compressed transfer syntaxes and ambiguous multifragment frame tables are rejected.",
      "BPG has no vetted decoder. Deep/multipart EXR, multiresolution tile levels, PIZ/PXR24/B44 EXR compression and proprietary camera compression remain unsupported; actual camera samples require separate tests."
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
      "Report reproducible defects with browser version, bit depth, steps and errors on GitHub Issues."
    ],
    "tips": [
      "32-bit HDR, complex PSD layer effects and ICC processing still have compatibility limits.",
      "Project issues: https://github.com/Chaython/ChaysPhotoStudio/issues"
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
