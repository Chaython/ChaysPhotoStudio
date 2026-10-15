# Cross-application feature parity matrix

**Audit baseline:** Chay's Photo Studio **main** (14 October 2026). This is a source-code/documentation audit, **not** a guarantee of runtime parity or an automated end-to-end comparison. It complements the [52-tool Photoshop-oriented audit](../TOOL_PARITY.md) and the [format-specific limitations](FEATURES_AND_FORMATS.md).

**Compared products:** Adobe Photoshop (desktop), **GIMP 3.2**, **Adobe Fireworks CS6** (legacy/discontinued), Adobe Illustrator (desktop), and **PhotoCraft** (the `storytold/photocraft` open-source Photoshop-targeting editor). See the [companion comparison of Canva, Adobe Express, Figma, Affinity, Photopea, Pixlr, Krita, Inkscape and Clip Studio Paint](CREATIVE_SUITE_PARITY.md) for template, publishing, UI-design and drawing workflows. Fireworks is compared against CS6, not a current Adobe release. Competitor columns identify whether each product has that *kind* of workflow; they do **not** imply compatible file formats or identical semantics.

## Legend

- **✓** = usable native workflow exists for the stated feature (with normal caveats).
- **◐** = a related workflow exists, but it is limited, indirect or does not preserve the same editability.
- **—** = no corresponding native workflow identified, or not a primary capability.
- The **Studio** column rates current behavior; **a feature name, recognized file extension, dialog or optional bridge does not by itself earn ✓**. External installed programs, downloads and optional ComfyUI workflows are not treated as built-in parity.
- The **Other products** columns are reference capability checks, not exhaustive compatibility tests.

## Additional popular and adjacent editors

The [Canva and creative-suite companion chart](CREATIVE_SUITE_PARITY.md) scores **nine additional competitors** separately so this Photoshop/Fireworks-focused matrix remains readable. Its highest-impact *missing* Studio workflows are **editable design templates, brand kits, component instances, responsive auto-layout and true independent page models**. It also distinguishes Canva/Adobe Express **cloud publishing and collaboration** from local-first image editing, and compares painting/animation gaps with Krita and Clip Studio Paint. No new editor features are implied by this documentation update.

## Missing-first implementation backlog

The following workflows are still **absent** rather than merely incomplete; prioritize these before polishing already working Photoshop-style tools.

| Missing functionality | Reference app | First complete milestone |
|---|---|---|
| **Full multi-artboard/page document architecture** | Illustrator, Fireworks | Artboards now have per-page layer inclusion and Layer-Comp-linked Normal/Hover/Pressed previews with CSS image swaps. **Still missing:** separate layer trees, outside-canvas artboards, native state inheritance and project interchange |
| **Native Fireworks layered PNG import/export** | Fireworks CS6 | Detect Fireworks metadata, preserve editability when supported, and warn before flattening |
| **Full Fireworks states / interactive prototypes** | Fireworks CS6 | Basic Layer-Comp-based Normal/Hover/Pressed exports and CSS rollover previews exist. **Still missing:** native Fireworks States objects, transitions, symbol inheritance, page navigation and editable interchange |
| **Vector Live Paint** | Illustrator | Select intersecting vector faces and recolor editable regions |
| **Full gradient mesh editor** | Illustrator | Editable mesh points and interpolation on shape objects |
| **Full Illustrator AI round-trip writer** | Illustrator | Loss-aware preservation of editable vector appearance and artboard structure |
| **Native ICC-managed CMYK/spot separations** | Illustrator, Photoshop | Editable press-color documents rather than approximate RGB previews |

**No longer entirely missing:** basic rectangular **web slices/hotspots** have canvas tools and a File-menu editor, while **artboards/pages** now also have a working main-canvas Artboard tool plus File-menu settings, native persistence and regional raster export. Both remain **partial parity**, not native Illustrator/Fireworks project support.


## PhotoCraft comparison — missing and partial workflow focus

**Reference:** [PhotoCraft](https://github.com/storytold/photocraft) and its published [capability assessment](https://github.com/storytold/photocraft/blob/main/docs/target-app-parity.md), [gaps](https://github.com/storytold/photocraft/blob/main/docs/gaps.md), and [UI audit](https://github.com/storytold/photocraft/blob/main/docs/ui-parity.md), inspected 14 October 2026. PhotoCraft's `0.6.0` reference materials describe **alpha**, not complete Photoshop equivalence. Different stacks (PhotoCraft native Rust/egui, Studio web/Electron) mean the same UI name is not proof of identical behavior.

| Workflow / gap | Studio | PhotoCraft | Action to reach parity |
|---|:---:|:---:|---|
| Photoshop-like desktop workspace, tool rail, menus, document tabs | ◐ | ◐ | **Studio:** interactive Essentials inspector and dense toolbar; **still not pixel-identical** to current Photoshop. Verify placements, scaling, keyboard and docking on real desktop displays. |
| Flexible panels: float, dock, tab groups and layout persistence | ◐ | ◐ | **Studio:** eight dock locations, individual floating panels, content-fit sizing and persisted layouts; Photoshop preset has two primary stacks plus an optional independently sized second column that can itself split into separately resizable upper/lower groups. All four tab groups support cross-group drag/drop, saving, export and narrow-window folding, alongside a collapsible icon rail. **Studio now offers separate per-workspace panel and tool layout locks** without blocking normal editing. **Missing:** unrestricted arbitrary multi-column/tab-group docking. |
| Color, adjustments, properties, layers and history inspector stacks | ✓ | ◐ | Studio renders real panels in a two-stack Photoshop layout, not placeholders. PhotoCraft documents incomplete Color panel and floating-panel grouping; neither is a Photoshop-equivalent guarantee. |
| Brush responsiveness / pen pressure and feel | ◐ | ◐ | Studio should run large brush pressure/tilt, spacing and latency benchmarks; PhotoCraft also documents brush lag and feel gaps. |
| PSD/PSB deep, editable interchange with Photoshop | ◐ | ◐ | Both can open/edit meaningful PSD structures but **neither establishes universal Photoshop round trips**. Add a shared oracle corpus with Photoshop-authored fixtures, Smart Objects, type, CMYK, adjustment and complex masks; never conflate file opening with object fidelity. |
| Artboards within one document | ◐ | ✓ | **Studio:** named artboards editable on the main canvas (create/move/resize/nudge), per-artboard layer inclusion, previews and individual raster exports. **Still missing:** independent layer trees/canvases and off-canvas page authoring; PhotoCraft documents working artboards. |
| Native Photoshop Actions `.atn` import/export | ◐ | ◐ | Studio has its own recording and replay, but Photoshop binary action interchange is not demonstrated here. PhotoCraft reports mapped `.atn` actions; the mapping is not exhaustive. |
| Camera Raw and lens corrections | ◐ | ◐ | Studio has RAW development and lens work but not verified full camera-model/codec coverage; PhotoCraft also records Camera Raw depth gaps. |
| CMYK/Lab/ICC color-managed editing | ◐ | ◐ | Studio's editing pipeline remains primarily RGB; PhotoCraft has CMYK/Lab infrastructure, but its published Photoshop oracle still identifies color/adjustment discrepancies. |
| Select and Mask, Content-Aware Fill and Vanishing Point workspaces | ◐ | ◐ | Studio must distinguish dedicated interactive workspaces from a set of tool dialogs. PhotoCraft likewise records parameter-dialog versus workspace gaps. |
| Photoshop UXP and native binary plug-ins | ◐ | — | Studio's limited compatibility bridge is not full UXP/.8BF. PhotoCraft documents no native .8BF or UXP host. |
| Multi-page Fireworks design / Illustrator Shape Builder / editable vector tracing | — / ◐ | ? | These are **Studio gaps** from the matrix below; PhotoCraft's Photoshop-oriented audit is not evidence of equivalent Fireworks/Illustrator behavior. Test before scoring. |

Here **?** means unverified from PhotoCraft's referenced audit; ratings are qualitative rather than percentages. Items labelled ◐ can be usable, but need representative round-trip or interaction tests. Studio's Photoshop workspace only changes interface organization; it does **not** import Photoshop code or imply feature equivalence.

## Implemented, partial and missing compared with other editors

| Workflow | Studio | Photoshop | GIMP | Fireworks CS6 | Illustrator | What Studio has / still lacks |
|---|:---:|:---:|:---:|:---:|:---:|---|
| Raster layers, blending, masks, editable effects | ✓ | ✓ | ✓ | ✓ | ◐ | Native layer stack, masks, adjustments, layer styles, Smart Objects/Filters; operation-depth restrictions still apply. |
| Retouch / healing / content-aware operations | ✓ | ✓ | ◐ | ◐ | ◐ | Dedicated painting and selection tools exist; learned model quality, very-high-depth and edge cases differ. |
| Full-fidelity PSD / PSB interoperability | ◐ | ✓ | ◐ | ◐ | ◐ | Studio reads/writes selected layered PSD/PSB. Native Photoshop text, adjustments, groups, Smart Objects, CMYK and complex HDR are **not** fully interchangeable. |
| GIMP XCF editable round-trip | ◐ | ◐ | ✓ | — | — | Studio's XCF parser reconstructs supported **raster layers**; it does not implement full GIMP live effects, group semantics or XCF export. |
| Fireworks native *layered PNG* (pages/states/objects) | — | ◐ | ◐ | ✓ | ◐ | Standard PNG decoding gets rendered image pixels; it **does not** reconstruct Fireworks editable objects, page/state metadata, symbols or slices. No Fireworks layered-PNG importer/exporter is present. |
| Illustrator AI/EPS/PDF editable round-trip | ◐ | ◐ | ◐ | ◐ | ✓ | Studio's AI/EPS/PDF parser extracts compatible PDF images/text or previews; unsupported PostScript/vector objects and artboard structures are not preserved. **Opening .ai is not Illustrator-native editing.** |
| Editable Bézier paths, simple shapes and text | ✓ | ✓ | ✓ | ✓ | ✓ | Pen/Freeform/Curvature, saved Paths, shape layers and native editable text; not advanced typography or print/vector design parity. |
| Boolean construction across independent vector shapes / Shape Builder | ◐ | ◐ | ◐ | ✓ | ✓ | Studio has **compound vector-mask** add/subtract/intersect/exclude operations, but no full multi-object Pathfinder / Shape Builder editing of separate shape layers. |
| Advanced vector fills (freeform gradients / gradient mesh) | ◐ | ◐ | ◐ | ◐ | ✓ | Studio has multi-stop gradient variants and paint fills, but no editable Illustrator-class mesh, freeform-gradient point field or vector mesh manipulation. |
| Live Paint faces / region-based vector recoloring | — | — | — | ◐ | ✓ | Paint Bucket fills raster regions, not editable faces formed by intersecting vector paths. |
| Automatic raster-to-*editable-vector* tracing | ◐ | ◐ | ◐ | ◐ | ✓ | **Vector Trace Guide** creates a high-contrast *raster edge layer* for hand tracing. It does **not** generate editable paths or match Illustrator Image Trace. |
| Multiple artboards / pages in **one document** | ◐ | ✓ | ◐ | ✓ | ✓ | Studio now stores named artboards with a direct canvas Artboard tool, **per-page layer inclusion**, previews and raster exports. A single master canvas and layer stack remain shared; there are no true independent page trees, page-local object positioning or native Illustrator/Fireworks round trips. |
| Reusable linked symbols, shared design components / master pages | ◐ | ◐ | ◐ | ✓ | ✓ | Smart Objects and layer comps are related, but Studio lacks a dedicated linked symbol-instance library and shared master-page inheritance. |
| Interactive UI states / rollover prototype workflow | ◐ | ◐ | ◐ | ✓ | ◐ | Artboards can reference Normal/Hover/Pressed Layer Comps, preview states and export separate images plus a standalone CSS rollover HTML file. No full Fireworks States panel, linked symbols, transitions or page navigation. |
| Web slices / hotspots / image maps | ◐ | ✓ | ◐ | ✓ | ◐ | **Slice and Hotspot canvas tools** draw, select, resize and nudge rectangular web regions directly on the image; File → Web Slices & Hotspots edits link metadata and exports slices and safe HTML image maps. Polygon hotspots and native Fireworks interchange remain missing. |
| Per-slice web-image optimization and export | ◐ | ✓ | ◐ | ✓ | ◐ | PNG/JPEG/WebP export settings and independent layer export exist, not slice-specific optimization or Fireworks multi-page/state/slice output. |
| Export individual layers/assets | ✓ | ✓ | ◐ | ✓ | ✓ | Export Layers to Files supports selected formats and transparency; not a full UI-asset batch/spec generator or Fireworks state export. |
| Native editable vector/SVG design interchange | ◐ | ◐ | ◐ | ◐ | ✓ | Selected SVG paths/shapes can be parsed; unsupported SVG paint features and AI/EPS/PDF operators may be dropped/approximated. No Illustrator-grade editable AI writer. |
| Color management, CMYK/spot/press workflows | ◐ | ✓ | ◐ | ◐ | ✓ | RGB editing, soft-proof previews and approximate CMYK/Lab conversion; no full ICC-managed editable CMYK/spot-color separation/overprint workflow. |
| High-depth 16/32-bit raster pipeline | ◐ | ✓ | ✓ | — | ◐ | HDR/Float32/Float16 infrastructure and tested operations exist, but not every retouch tool, importer, compositor combination or export preserves precision. |
| GIMP GEGL / Script-Fu / Python / PDB interoperability | ◐ | — | ✓ | — | — | Assets, analysis and on-demand **Electron + separately installed GIMP 3** bridge for supported procedures; not a complete embedded GEGL/GIMP plug-in runtime. |
| Native Photoshop UXP and binary plugin ecosystem | ◐ | ✓ | — | — | — | Selected manifest/command/batchPlay compatibility only; neither full UXP runtime nor Photoshop binary filter/plugin compatibility. |

### Highest-value parity gaps (work not yet claimed as implemented)

| Priority | Target | Why it matters | Completion criterion |
|---|---|---|---|
| **High** | **Illustrator: editable vector operations** | Studio already has paths and shapes, but cannot combine arbitrary independent vector objects the way Illustrator / Fireworks can. | Tested select/multi-select path boolean, Shape Builder-like face extraction, editable result and Undo/Redo. |
| **High** | **Illustrator: true image-to-vector trace** | The current guide is a raster image and must not be marketed as automatic vectorization. | Trace returns editable Bézier path objects; threshold/color modes, simplification and exports have reference fixtures. |
| **High** | **Fireworks: independent pages, states and design components** | Studio now has page-specific layer inclusion and basic Layer-Comp-driven CSS rollovers, but not separate editable page trees or native states/symbols. | Independent page editing, a dedicated States panel, symbols/master-page inheritance and native Fireworks fixture tests. |
| **High** | **Native format safety and parity** | Flat preview import can look successful while silently discarding editing structure. | Detect Fireworks layered-PNG metadata explicitly and report unsupported structures; preserve supported layers/objects or offer an explicit flatten-only import; AI/EPS/PDF imports accurately report lost vectors. |
| **Medium** | **Fireworks: advanced web assets** | Basic rectangular web regions now exist, but Fireworks-class authoring and optimized output are still incomplete. | Main-canvas overlay tools, polygon hotspots, per-slice format/quality, full layout export and native Fireworks layered-PNG metadata interchange. |
| **Medium** | **Illustrator: gradients, meshes and typography** | Existing gradients, text and shape layers do not cover Illustrator's vector object/appearance toolchain. | Editable gradient meshes/freeform stops, compound paths and per-run typographic styling retained in native project saves. |
| **Medium** | **GIMP: richer XCF and GEGL parity** | Raster extraction and an optional GIMP subprocess are not a complete independent XCF editor. | Round-trip group/effect/text semantics for supported fixtures; unsupported effects are visibly reported; in-process vs external requirements clear. |
| **Medium** | **Photoshop: PSD/PSB deep interchange** | The broad tool list overstates parity if native layer descriptors disappear on interchange. | Fixtures for editable type, adjustments, Smart Objects, masks, nested groups and supported high-depth documents with explicit loss reports. |

## Import ≠ editing ≠ export

| Source document | Open/import on Studio | Native editing retained? | Export back to same source document? |
|---|---|---|---|
| Photoshop PSD/PSB | Selected layered files | **Partial:** raster layers and some metadata; original advanced layer descriptors may be opaque | **Partial:** selected layered PSD/PSB; unsupported features warn, rasterize or remain preserved only when unchanged |
| GIMP XCF | Supported XCF variants via dedicated parser | **Partial:** extracted raster layers; original GIMP effects/groups not fully editable | **No native XCF writer** |
| Fireworks layered PNG | PNG pixels via standard image decoder | **No Fireworks object/page/state fidelity** | **Only ordinary raster PNG**, not native Fireworks project metadata |
| Illustrator AI/EPS | Selected PDF-compatible data, extracted assets or fallback preview | **Partial:** some extracted content; most Illustrator objects/artboards/appearances not retained | **No native editable AI/EPS writer** |
| SVG | Dedicated structured SVG parsing for supported elements | **Partial:** supported geometry can become native elements; unsupported effects differ | No guarantee of full editable SVG round-trip |
| Native Studio .zproj.json | Full native project file | **Yes** for supported Studio editing structures | **Yes** in the versioned Studio project format |

**No implied round-trip guarantee:** always retain the original external project file and review import warnings. Embedded previews, document-extension recognition, and optional external applications are distinct from native, lossless editing.

## Evidence / reference points

**Studio source inspected:** [tools and options](../src/editor/constants/tools.ts), [vector-mask operations](../src/editor/engine/vector-mask.ts), [local vector trace guide](../src/editor/ai/local.ts), [AI tools UI](../src/editor/components/dialogs/ai-tools-dialog.tsx), [structured-document dispatch](../src/editor/formats/structured.ts), [AI/EPS/PDF parsing](../src/editor/formats/pdf-family.ts), [XCF decoding](../src/editor/formats/xcf.ts), [SVG document parsing](../src/editor/formats/svg-document.ts), [GIMP bridge](../electron/gimp-runtime.cjs), [format limits](FEATURES_AND_FORMATS.md), and [Photoshop tool audit](../TOOL_PARITY.md).

**Vendor documentation:** [Adobe Fireworks Pages / Master Pages / States / slice export](https://helpx.adobe.com/fireworks/using/prototyping-websites-interfaces-fireworks-pages.html), [Adobe Fireworks product end-of-support](https://helpx.adobe.com/support/programs/eol-matrix.html), [Illustrator artboards](https://helpx.adobe.com/ca/illustrator/desktop/create-manage-artboards/add-edit-artboards/introduction-to-artboards.html), [Illustrator Shape Builder](https://helpx.adobe.com/ca/illustrator/using/creating-shapes-shape-builder-tool.html), [Illustrator Image Trace](https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/trace-images-to-convert-raster-into-vector-artwork.html), [Illustrator mesh tool](https://helpx.adobe.com/illustrator/using/tool-techniques/mesh-tool.html), [Illustrator Live Paint](https://helpx-origin-uw2.aws116.adobeitc.com/illustrator/desktop/paint-and-fill/learn-painting-basics/about-live-paint.html), and [GIMP 3.2 release notes](https://www.gimp.org/release-notes/gimp-3.2.html).

This matrix is deliberately conservative; upgrade ✓/◐/— ratings **only after implementing and validating** the underlying behavior, not simply adding a tool name or recognized extension.
