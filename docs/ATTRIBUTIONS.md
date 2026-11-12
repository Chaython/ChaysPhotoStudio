# Attributions and inspirations

Chay's Photo Studio is original work. It is inspired by other editors, and this page records where an idea came from so the provenance of the code is never in doubt.

## PhotoCraft

[PhotoCraft](https://github.com/storytold/photocraft) is an open-source, Rust-based editor targeting Photoshop-like workflows. It is licensed **MIT OR Apache-2.0** and is credited as **inspiration only**.

**No PhotoCraft code is copied into, vendored by, or linked into this repository.** The work described below was written from scratch in Studio's own code structure, using the published file-format specifications and the observable behaviour of the reference application.

### What was inspired, and how it was reimplemented

| Area | What was adopted | How it was written |
|---|---|---|
| 3D LUT interchange | Reading Lustre/Flame `.3dl` and SpeedGrade `.look` tables in addition to Adobe/Resolve `.cube` | `src/editor/image-ops/lut-formats.ts` implements the published grammars from scratch: the `3DMESH` magic, the `Mesh <inBits> <outBits>` declaration, the optional shaper row, blue-fastest node order, code-range inference and the `.look` XML `<size>`/`<data>` layout |
| HDR tone mapping | An HDR Toning adjustment layer | `src/editor/image-ops/hdr-toning.ts` is a from-scratch base/detail tone mapper: a log-luminance base/detail split, compression toward the scene's own mean and a re-key to the middle grey the geometric mean luminance defines |
| Blur throughput | The idea that a box blur's row pass can skip clamping in the interior and that its column pass can avoid a cache miss per sample | `src/editor/image-ops/blur.ts` was rewritten in Studio's own idiom: a head/middle/tail row split and a transposed cache-resident column strip. The accumulation order was kept identical, so the output is byte-for-byte the same as before the rewrite |
| Photoshop Actions interchange | The recognition that native `.atn` import/export is what lets recorded actions travel to and from Photoshop | `src/editor/formats/atn-descriptor.ts`, `atn.ts` and `atn-actions.ts` implement the published Action Descriptor and `.atn` container layouts from scratch: the version 16 container, the version 12 legacy dialect, every descriptor value and reference type with bounds and nesting limits, a subset of Photoshop events mapped onto Studio's own operations, and steps that cannot be played faithfully preserved verbatim |

### Where Studio deliberately differs

- **`.3dl` shaper curves are kept exact.** The shaper row is stored separately from the cube grid and applied at sample time, rather than being baked onto the grid. Baking would have to resample the curve onto the cube's node spacing and would bend its own breakpoints.
- **The Desaturate methods are Luminance and HSL Lightness.** An earlier draft offered "Perceptual (Lab)" and "Luminance", but CIE Lab's L\* is derived from luminance, so the two were mathematically identical. The shipped options are genuinely different: a saturated green stays bright under Luminance and becomes a mid-grey under HSL Lightness.
- **The blur output is unchanged.** The rewrite is a performance change only; a validation script compares the new kernels against the previous ones byte-for-byte.
- **Unmappable `.atn` steps are preserved, not guessed.** Where another implementation might approximate an unknown event, Studio stores the step exactly as Photoshop recorded it, skips it on playback and writes it back unchanged on export; unmappable Studio operations are exported as visible placeholder steps instead of being dropped.

## Other references

- **Adobe Photoshop** — the interaction model (layer stack, adjustment layers, blending modes, tool semantics) that this editor follows. Adobe Photoshop is proprietary; no Adobe code, assets or formats are reproduced here beyond implementing publicly documented interchange formats.
- **GIMP** — open alternatives in the areas of plug-ins, Script-Fu/Python and PDB bridges, and the XCF container.
- **Photopea** — a web-native raster editor whose in-browser feature set motivated much of Studio's browser-first design.

If you believe something in this repository needs an additional attribution, please open an issue. Attribution requests are taken seriously and acted on promptly.
