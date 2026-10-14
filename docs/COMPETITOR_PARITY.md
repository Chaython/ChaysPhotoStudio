# Cross-application feature parity matrix

**Audit baseline:** Chay's Photo Studio **main** (14 October 2026). This is a source-code/documentation audit, **not** a guarantee of runtime parity or an automated end-to-end comparison. It complements the [52-tool Photoshop-oriented audit](../TOOL_PARITY.md) and the [format-specific limitations](FEATURES_AND_FORMATS.md).

**Compared products:** Adobe Photoshop (desktop), **GIMP 3.2**, **Adobe Fireworks CS6** (legacy/discontinued), and Adobe Illustrator (desktop). Fireworks is compared against CS6, not a current Adobe release. Competitor columns identify whether each product has that *kind* of workflow; they do **not** imply compatible file formats or identical semantics.

## Legend

- **✓** = usable native workflow exists for the stated feature (with normal caveats).
- **◐** = a related workflow exists, but it is limited, indirect or does not preserve the same editability.
- **—** = no corresponding native workflow identified, or not a primary capability.
- The **Studio** column rates current behavior; **a feature name, recognized file extension, dialog or optional bridge does not by itself earn ✓**. External installed programs, downloads and optional ComfyUI workflows are not treated as built-in parity.
- The **Other products** columns are reference capability checks, not exhaustive compatibility tests.

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
| Multiple artboards / pages in **one document** | — | ✓ | ◐ | ✓ | ✓ | Studio supports multiple **document tabs**, not per-document artboards/pages with separate bounds, page organization and per-page export. |
| Reusable linked symbols, shared design components / master pages | ◐ | ◐ | ◐ | ✓ | ✓ | Smart Objects and layer comps are related, but Studio lacks a dedicated linked symbol-instance library and shared master-page inheritance. |
| Interactive UI states / rollover prototype workflow | — | ◐ | ◐ | ✓ | ◐ | Layer Comps capture alternative layer states; no Fireworks-style button rollover/state sequencing, interaction links or prototype preview/export. |
| Web slices / hotspots / image maps | — | ✓ | ◐ | ✓ | ◐ | Export Layers to Files exists, but no editable slice/hotspot overlay, per-slice links or HTML image-map output. |
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
| **High** | **Fireworks: pages, states and design components** | A single Studio canvas plus Layer Comps cannot reproduce reusable multi-page/state UI mockups. | Editable Pages/States panels, linked component/symbol instances, master-page behavior, per-page/state export and round-trip tests. |
| **High** | **Native format safety and parity** | Flat preview import can look successful while silently discarding editing structure. | Detect Fireworks layered-PNG metadata explicitly and report unsupported structures; preserve supported layers/objects or offer an explicit flatten-only import; AI/EPS/PDF imports accurately report lost vectors. |
| **Medium** | **Fireworks: slices, hotspots and web assets** | Core to the Fireworks web design workflow but absent from the Studio export model. | Editable slice/hotspot geometry, link/alt fields, preview and independently optimized asset plus HTML/image-map export. |
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
